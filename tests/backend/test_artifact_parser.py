"""Q4 / D7：AI 产物 Markdown → 结构化 JSON 解析与校验。"""

from __future__ import annotations

import pytest

from backend.app.services.artifact_parser import (
    MAX_MIND_MAP_DEPTH,
    mind_map_stats,
    parse_artifact_json,
    validate_mind_map,
)


def test_mind_map_single_root_and_stable_ids() -> None:
    md = """# 主题
- 根节点
  - 分支一
    - 叶子 1
    - 叶子 2
  - 分支二
"""
    parsed = parse_artifact_json("mind_map", md)
    assert parsed is not None
    root = parsed["root"]
    assert root["text"] == "根节点"
    assert validate_mind_map(parsed) is True
    stats = mind_map_stats(parsed)
    assert stats["nodes"] == 5
    assert stats["max_depth"] <= MAX_MIND_MAP_DEPTH

    # 相同输入 id 稳定
    parsed2 = parse_artifact_json("mind_map", md)
    assert parsed2["root"]["children"][0]["id"] == root["children"][0]["id"]


def test_mind_map_clamps_to_four_levels() -> None:
    md = """- 根
  - L2
    - L3
      - L4
        - L5 应并入第四层
"""
    parsed = parse_artifact_json("mind_map", md)
    assert parsed is not None
    assert validate_mind_map(parsed) is True
    stats = mind_map_stats(parsed)
    assert stats["max_depth"] <= MAX_MIND_MAP_DEPTH


def test_mind_map_empty_returns_none() -> None:
    assert parse_artifact_json("mind_map", "") is None
    assert parse_artifact_json("mind_map", "没有列表的普通文字") is None


def test_action_items_parses_todo_and_done() -> None:
    md = """- [ ] 写周报
- [x] 开评审会
- 跟进发布
"""
    parsed = parse_artifact_json("action_items", md)
    assert parsed is not None
    items = parsed["items"]
    assert len(items) == 3
    assert items[0]["done"] is False and "写周报" in items[0]["text"]
    assert items[1]["done"] is True
    assert items[2]["done"] is False


def test_action_items_nested_details_grouped_under_task() -> None:
    md = """- [ ] **探索并试用网站**
    - **负责人**：未明确
    - **截止时间**：未明确
    - **完成标准**：成功使用
- [x] 跟进发布
    - **依据**：材料提到
"""
    parsed = parse_artifact_json("action_items", md)
    assert parsed is not None
    items = parsed["items"]
    assert len(items) == 2
    first, second = items
    assert first["done"] is False and "探索并试用网站" in first["text"]
    assert "details" in first and len(first["details"]) == 3
    assert first["details"][0] == "负责人：未明确"
    assert second["done"] is True
    assert second["details"] == ["依据：材料提到"]


def test_action_items_top_level_plain_list_is_task() -> None:
    parsed = parse_artifact_json("action_items", "- 写周报\n- 跟进发布")
    assert parsed is not None
    assert len(parsed["items"]) == 2
    assert all(item["done"] is False for item in parsed["items"])
    assert "details" not in parsed["items"][0]


def test_action_items_empty_returns_none() -> None:
    assert parse_artifact_json("action_items", "没有列表") is None


def test_key_cards_parses_h3_sections() -> None:
    md = """### 卡片一
核心结论 A
证据 A

### 卡片二
核心结论 B
"""
    parsed = parse_artifact_json("key_cards", md)
    assert parsed is not None
    cards = parsed["cards"]
    assert len(cards) == 2
    assert cards[0]["title"] == "卡片一"
    assert "核心结论 A" in cards[0]["body"]
    assert cards[1]["title"] == "卡片二"


def test_flashcards_parses_qa_pairs() -> None:
    md = """Q: 什么是光合作用？
A: 植物利用光能合成有机物的过程。
Q: 谁提出了相对论？
A: 爱因斯坦。
"""
    parsed = parse_artifact_json("flashcards", md)
    assert parsed is not None
    cards = parsed["cards"]
    assert len(cards) == 2
    assert cards[0]["question"] == "什么是光合作用？"
    assert "植物" in cards[0]["answer"]
    assert cards[1]["question"] == "谁提出了相对论？"


def test_glossary_parses_table() -> None:
    md = """| 术语 | 解释 | 语境 |
|---|---|---|
| API | 应用程序接口 | 本文指开放接口 |
| SDK | 软件开发工具包 | 集成用 |
"""
    parsed = parse_artifact_json("glossary", md)
    assert parsed is not None
    rows = parsed["rows"]
    assert len(rows) == 2
    assert rows[0]["term"] == "API"
    assert "应用程序接口" in rows[0]["definition"]


def test_timeline_parses_table() -> None:
    md = """| 时间 | 事件 | 参与者 | 影响 |
|---|---|---|---|
| 00:10 | 开场 | 主持 | 引入话题 |
| 05:00 | 讨论 | 嘉宾 | 深化观点 |
"""
    parsed = parse_artifact_json("timeline", md)
    assert parsed is not None
    rows = parsed["rows"]
    assert len(rows) == 2
    assert rows[0]["time"] == "00:10"
    assert rows[1]["event"] == "讨论"


def test_selection_rewrite_has_no_parser() -> None:
    assert parse_artifact_json("selection_rewrite", "任意文本") is None


def test_unknown_kind_returns_none() -> None:
    assert parse_artifact_json("not_a_kind", "x") is None


def test_generate_artifact_includes_content_json(monkeypatch) -> None:
    from backend.app.services import note_artifacts
    from types import SimpleNamespace

    md = "- 根\n  - 子一\n  - 子二\n"
    monkeypatch.setattr(note_artifacts, "_call_llm", lambda *a, **k: (md, "test-model"))
    item = SimpleNamespace(results={"note_body": "一些内容"})

    artifact = note_artifacts.generate_note_artifact(item, "mind_map")
    assert artifact["content_md"].strip() == md.strip()
    assert artifact["content_json"] is not None
    assert artifact["content_json"]["root"]["text"] == "根"

    # selection_rewrite 无结构化 JSON
    monkeypatch.setattr(note_artifacts, "_call_llm", lambda *a, **k: ("改写后的文本", "m"))
    rewrite = note_artifacts.generate_note_artifact(
        item, "selection_rewrite", selected_text="原文"
    )
    assert rewrite["content_json"] is None
    assert rewrite["content_md"] == "改写后的文本"


def test_generate_artifact_repairs_invalid_structure_once(monkeypatch) -> None:
    from backend.app.services import note_artifacts
    from types import SimpleNamespace

    outputs = iter([
        ("这不是列表", "test-model"),
        ("- 根\n  - 修复后的子节点", "test-model"),
    ])
    calls: list[str] = []

    def fake_call(_system, user, **_kwargs):
        calls.append(user)
        return next(outputs)

    monkeypatch.setattr(note_artifacts, "_call_llm", fake_call)
    item = SimpleNamespace(results={"note_body": "一些内容"})

    artifact = note_artifacts.generate_note_artifact(item, "mind_map")

    assert len(calls) == 2
    assert "修复后的子节点" in artifact["content_md"]
    assert artifact["content_json"]["root"]["text"] == "根"


def test_generate_artifact_fails_clearly_after_one_repair(monkeypatch) -> None:
    from backend.app.services import note_artifacts
    from types import SimpleNamespace

    calls = 0

    def fake_call(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return "仍然不是结构化内容", "test-model"

    monkeypatch.setattr(note_artifacts, "_call_llm", fake_call)
    item = SimpleNamespace(results={"note_body": "一些内容"})

    with pytest.raises(RuntimeError, match="自动修复后仍无法解析"):
        note_artifacts.generate_note_artifact(item, "mind_map")

    assert calls == 2
