"""Phase 3C.1 — WorkspaceItem.tags 字段序列化/反序列化测试。"""

from __future__ import annotations

import json

from backend.app.models.workspace import WorkspaceItem


def test_tags_roundtrip():
    """happy path: tags 内容经过 to_dict → json.dumps → from_dict 后保持一致。"""
    tags = {
        "content_type": "教程",
        "subject_domain": "科技",
        "difficulty": "入门",
        "duration_band": "短",
        "information_density": "高",
        "emotion_tone": "中性",
        "custom_tags": ["前端", "React"],
        "_generated_at": "2026-05-18T12:00:00+00:00",
        "_generated_model": "Qwen/Qwen2.5-72B-Instruct",
    }
    item = WorkspaceItem(
        item_id="test-1",
        type="video",
        source="url",
        source_value="https://example.com/v",
        tags=tags,
    )
    serialized = json.dumps(item.to_dict())
    restored = WorkspaceItem.from_dict(json.loads(serialized))
    assert restored.tags == tags


def test_tags_default_empty():
    """默认值: from_dict({}) 时 tags 应为空 dict。"""
    item = WorkspaceItem.from_dict({})
    assert item.tags == {}
