"""Phase 3C.3 — tags CRUD + 重新生成端点测试。"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore

client = TestClient(app)


@pytest.fixture(autouse=True)
def _fresh_store():
    """每个测试用例使用干净的 WorkspaceStore。"""
    store = WorkspaceStore()
    store._records.clear()
    with patch("backend.app.routes.workspaces._store", store):
        yield store


def _create_workspace_with_item(store: WorkspaceStore) -> tuple[str, str]:
    """辅助：创建一个含单个 video item 的 workspace，返回 (wid, iid)。"""
    item = WorkspaceItem(
        item_id="item-1",
        type="video",
        source="local",
        source_value="/tmp/test.mp4",
        name="test.mp4",
    )
    rec = WorkspaceRecord(
        workspace_id="ws-1",
        name="测试工作空间",
        items=[item],
    )
    store.create(rec)
    return rec.workspace_id, item.item_id


# ── GET happy ─────────────────────────────────────────────


def test_get_tags_happy(_fresh_store: WorkspaceStore):
    wid, iid = _create_workspace_with_item(_fresh_store)
    # 先写入一些 tags
    _fresh_store.update_item(wid, iid, tags={"content_type": "教程", "custom_tags": ["Python"]})

    resp = client.get(f"/workspaces/{wid}/items/{iid}/tags")
    assert resp.status_code == 200
    body = resp.json()
    assert body["tags"]["content_type"] == "教程"
    assert body["tags"]["custom_tags"] == ["Python"]


# ── PUT happy ─────────────────────────────────────────────


def test_put_tags_happy(_fresh_store: WorkspaceStore):
    wid, iid = _create_workspace_with_item(_fresh_store)
    new_tags = {
        "content_type": "访谈",
        "subject_domain": "科技",
        "difficulty": "进阶",
        "duration_band": "中",
        "information_density": "高",
        "emotion_tone": "激励",
        "custom_tags": ["AI", "深度学习"],
    }
    resp = client.put(f"/workspaces/{wid}/items/{iid}/tags", json={"tags": new_tags})
    assert resp.status_code == 200
    body = resp.json()
    assert body["tags"]["content_type"] == "访谈"
    assert body["tags"]["custom_tags"] == ["AI", "深度学习"]


# ── PUT 错误：系统维度填非法值 → 422 ────────────────────


def test_put_tags_invalid_value(_fresh_store: WorkspaceStore):
    wid, iid = _create_workspace_with_item(_fresh_store)
    bad_tags = {"content_type": "不存在的类型"}
    resp = client.put(f"/workspaces/{wid}/items/{iid}/tags", json={"tags": bad_tags})
    assert resp.status_code == 422
    assert "invalid value" in resp.json()["detail"]


# ── POST regenerate happy ─────────────────────────────────


def test_regenerate_tags_happy(_fresh_store: WorkspaceStore):
    wid, iid = _create_workspace_with_item(_fresh_store)
    fake_tags = {
        "content_type": "评测",
        "subject_domain": "科技",
        "difficulty": "入门",
        "duration_band": "短",
        "information_density": "中",
        "emotion_tone": "中性",
        "custom_tags": ["手机"],
    }
    with patch(
        "backend.app.services.tag_generator.generate_tags",
        return_value=fake_tags,
    ) as mock_gen:
        resp = client.post(f"/workspaces/{wid}/items/{iid}/tags/regenerate")
        assert resp.status_code == 200
        body = resp.json()
        assert body["tags"]["content_type"] == "评测"
        assert body["tags"]["custom_tags"] == ["手机"]
        mock_gen.assert_called_once()

    # 验证 tags 已持久化到 store
    rec = _fresh_store.get(wid)
    item = next(it for it in rec.items if it.item_id == iid)
    assert item.tags["content_type"] == "评测"
