"""Phase N6 — chat_context.build_item_context 单元测试。

覆盖：
- happy path：选 1 个 item 拼出 system prompt，含背景 + tags + summary
- 跨素材类型：选视频 + 图片 + 文字，分别正确提取 summary / ocr / prompts
- 截断：超 max_chars 时 truncated=True，且 used_item_ids 是已成功拼入的子集
- 边界：item_ids 为空 → 空 prompt；全部未命中 → 空 prompt
"""

from __future__ import annotations

from backend.app.models.workspace import (
    WorkspaceBackground,
    WorkspaceItem,
    WorkspaceRecord,
)
from backend.app.services.chat_context import build_item_context


def _make_workspace(items: list[WorkspaceItem]) -> WorkspaceRecord:
    return WorkspaceRecord(
        workspace_id="ws_t",
        name="测试任务",
        background=WorkspaceBackground(
            content_type="Vlog",
            topic="春日骑行",
            participants=["小明"],
            glossary=["GoPro"],
            purpose="复刻参考",
        ),
        items=items,
    )


def test_build_context_single_item_happy_path():
    item = WorkspaceItem(
        item_id="it_001",
        type="video",
        source="url",
        source_value="https://example.com/v.mp4",
        name="开场镜头",
        tags={"content_type": "vlog", "emotion_tone": "energetic"},
        results={"summary": "骑行穿过樱花林，画面色调温暖。"},
    )
    ws = _make_workspace([item])
    ctx = build_item_context(ws, ["it_001"])

    assert ctx.truncated is False
    assert ctx.used_item_ids == ["it_001"]
    assert "春日骑行" in ctx.system_prompt
    assert "开场镜头" in ctx.system_prompt
    assert "樱花林" in ctx.system_prompt
    assert "content_type=vlog" in ctx.system_prompt


def test_build_context_multi_type_results():
    items = [
        WorkspaceItem(
            item_id="v1",
            type="video",
            source="local",
            source_value="/x.mp4",
            name="视频 A",
            results={"video_summary": "视频摘要 X"},
        ),
        WorkspaceItem(
            item_id="img1",
            type="image",
            source="local",
            source_value="/y.png",
            name="图片 B",
            results={"ocr_text": "OCR 文字 Y", "frame_prompts": ["a cinematic shot", "warm tone"]},
        ),
        WorkspaceItem(
            item_id="t1",
            type="text",
            source="local",
            source_value="/z.md",
            name="文档 C",
            results={"summary": "文档摘要 Z"},
        ),
    ]
    ws = _make_workspace(items)
    ctx = build_item_context(ws, ["v1", "img1", "t1"])

    assert ctx.used_item_ids == ["v1", "img1", "t1"]
    assert "视频摘要 X" in ctx.system_prompt
    assert "OCR 文字 Y" in ctx.system_prompt
    assert "a cinematic shot" in ctx.system_prompt
    assert "文档摘要 Z" in ctx.system_prompt


def test_build_context_truncates_when_exceeding_max_chars():
    long_summary = "x" * 5000
    items = [
        WorkspaceItem(
            item_id=f"it_{i}",
            type="text",
            source="local",
            source_value=f"/{i}.md",
            name=f"长文 {i}",
            results={"summary": long_summary},
        )
        for i in range(5)
    ]
    ws = _make_workspace(items)
    # max_chars=2000 时 _truncate 把 summary 砍到 800，每 block 约 850 char + header ~150
    # → 第一块就吃光预算后，再追加就溢出 → 截断
    ctx = build_item_context(ws, [it.item_id for it in items], max_chars=2000)

    assert ctx.truncated is True
    assert 0 < len(ctx.used_item_ids) < 5


def test_build_context_empty_item_ids_returns_empty_prompt():
    ws = _make_workspace([])
    ctx = build_item_context(ws, [])
    assert ctx.system_prompt == ""
    assert ctx.used_item_ids == []
    assert ctx.truncated is False


def test_build_context_all_ids_miss_returns_empty_prompt():
    item = WorkspaceItem(
        item_id="exists",
        type="video",
        source="local",
        source_value="/x.mp4",
        name="x",
    )
    ws = _make_workspace([item])
    ctx = build_item_context(ws, ["nope_1", "nope_2"])
    assert ctx.system_prompt == ""
    assert ctx.used_item_ids == []
