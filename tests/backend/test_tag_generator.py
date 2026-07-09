"""Phase 3C.2：tag_generator LLM 打标 service 测试。"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services import tag_generator as tg


def _make_item() -> WorkspaceItem:
    return WorkspaceItem(
        item_id="it_001",
        type="video",
        source="url",
        source_value="https://x/v1",
        name="发布会片段",
        results={
            "video_title": "发布会片段",
            "summary": "苹果在加州发布会上展示了新款 iPhone，主持人讲解硬件参数与拍照升级。",
            "frames": [
                {"timestamp": "00:10", "description_zh": "产品特写镜头"},
                {"timestamp": "00:20", "description_zh": "主持人对着观众讲解"},
            ],
        },
    )


def _make_workspace() -> WorkspaceRecord:
    return WorkspaceRecord(workspace_id="ws_a", name="苹果发布会研究")


def _patch_llm(monkeypatch: pytest.MonkeyPatch, response: str) -> MagicMock:
    """统一打桩 provider.chat 与 settings/registry 链路。"""
    fake_settings = MagicMock()
    fake_settings.openai_api_key = "fake-key"
    fake_settings.text_model = "fake-model"
    monkeypatch.setattr(tg, "load_settings", lambda: fake_settings)

    fake_provider = MagicMock()
    fake_provider.chat = MagicMock(return_value=response)
    fake_profile = MagicMock()
    fake_profile.default_models = {"chat": "fake-model"}
    fake_registry = MagicMock()
    fake_registry.resolve_default_profile = MagicMock(return_value=fake_profile)
    fake_registry.build = MagicMock(return_value=fake_provider)
    monkeypatch.setattr(tg, "create_default_registry", lambda: fake_registry)
    return fake_provider


def test_generate_tags_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "content_type": "评测",
        "subject_domain": "科技",
        "difficulty": "入门",
        "duration_band": "短",
        "information_density": "高",
        "emotion_tone": "中性",
        "custom_tags": ["iPhone", "苹果", "硬件"],
    }
    _patch_llm(monkeypatch, json.dumps(payload, ensure_ascii=False))

    tags = tg.generate_tags(_make_item(), _make_workspace())
    assert tags["content_type"] == "评测"
    assert tags["subject_domain"] == "科技"
    assert tags["custom_tags"] == ["iPhone", "苹果", "硬件"]
    assert "_generated_at" in tags
    assert tags["_generated_model"] == "fake-model"


def test_generate_tags_handles_markdown_code_block(monkeypatch: pytest.MonkeyPatch) -> None:
    """LLM 把 JSON 包在 ```json 块里也要能解析。"""
    payload = {
        "content_type": "评测",
        "subject_domain": "科技",
        "difficulty": "入门",
        "duration_band": "短",
        "information_density": "高",
        "emotion_tone": "中性",
        "custom_tags": ["a"],
    }
    wrapped = f"以下是分析结果：\n```json\n{json.dumps(payload)}\n```\n谢谢"
    _patch_llm(monkeypatch, wrapped)

    tags = tg.generate_tags(_make_item(), _make_workspace())
    assert tags["content_type"] == "评测"


def test_generate_tags_invalid_json_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_llm(monkeypatch, "抱歉，我无法生成 JSON。")
    tags = tg.generate_tags(_make_item(), _make_workspace())
    assert tags == {}


def test_generate_tags_invalid_dim_value_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    """系统维度填了非 choices 内的值 → 该维度被丢，其它正常。"""
    payload = {
        "content_type": "外星人入侵",  # 非法
        "subject_domain": "科技",
        "difficulty": "入门",
        "duration_band": "短",
        "information_density": "高",
        "emotion_tone": "中性",
        "custom_tags": [],
    }
    _patch_llm(monkeypatch, json.dumps(payload, ensure_ascii=False))
    tags = tg.generate_tags(_make_item(), _make_workspace())
    assert "content_type" not in tags
    assert tags["subject_domain"] == "科技"
    assert tags["custom_tags"] == []


def test_generate_tags_provider_exception_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_provider = _patch_llm(monkeypatch, "")
    fake_provider.chat.side_effect = RuntimeError("network down")
    tags = tg.generate_tags(_make_item(), _make_workspace())
    assert tags == {}
