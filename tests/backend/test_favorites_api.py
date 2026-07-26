"""Phase 2A — favorites 端点测试。

happy path  — 添加收藏 → workspace.favorites 含 item_id；重复添加幂等；删除后移除。
error path  — workspace 不存在返回 404；item 不存在返回 404。
R3-A       — GET /workspaces/metadata/favorites/resolved 已解析收藏数据源。
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.models.workspace import WorkspaceItem
from backend.app.routes import workspaces as ws_module
from backend.app.services.metadata_store import MetadataStore
from backend.app.services.workspace_store import WorkspaceRecord, WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path):
    store = WorkspaceStore(root=tmp_path / "workspaces")
    metadata = MetadataStore(tmp_path / "metadata.sqlite3")
    mock_runner = MagicMock()
    mock_runner.store.get.return_value = None

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", store),
        patch.object(ws_module, "_metadata", metadata),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            yield c, store, metadata


def _create_ws_with_item(store: WorkspaceStore) -> tuple[str, str]:
    """创建一个含一个 URL item 的 workspace，返回 (workspace_id, item_id)。"""
    rec = WorkspaceRecord(workspace_id="ws_fav_01", name="收藏测试区")
    store.create(rec)
    item = WorkspaceItem(
        item_id="item_001",
        type="video",
        source="url",
        source_value="https://example.com/video",
        name="测试视频",
    )
    store.add_item("ws_fav_01", item)
    return "ws_fav_01", "item_001"


def test_favorite_item_adds_to_favorites(client):
    c, store, _ = client
    ws_id, item_id = _create_ws_with_item(store)

    resp = c.post(f"/workspaces/{ws_id}/favorites/{item_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert item_id in data["favorites"]


def test_favorite_item_is_idempotent(client):
    """重复收藏不报错，也不重复加入列表。"""
    c, store, _ = client
    ws_id, item_id = _create_ws_with_item(store)

    c.post(f"/workspaces/{ws_id}/favorites/{item_id}")
    resp = c.post(f"/workspaces/{ws_id}/favorites/{item_id}")
    assert resp.status_code == 200
    assert resp.json()["favorites"].count(item_id) == 1


def test_unfavorite_item_removes_from_favorites(client):
    c, store, _ = client
    ws_id, item_id = _create_ws_with_item(store)

    c.post(f"/workspaces/{ws_id}/favorites/{item_id}")
    resp = c.delete(f"/workspaces/{ws_id}/favorites/{item_id}")
    assert resp.status_code == 200
    assert item_id not in resp.json()["favorites"]


def test_favorite_workspace_not_found(client):
    c, _, _ = client
    resp = c.post("/workspaces/nonexistent/favorites/some_item")
    assert resp.status_code == 404


def test_favorite_item_not_found(client):
    c, store, _ = client
    rec = WorkspaceRecord(workspace_id="ws_fav_02", name="空工作区")
    store.create(rec)
    resp = c.post("/workspaces/ws_fav_02/favorites/ghost_item")
    assert resp.status_code == 404


# ── R3-A: resolved favorites 端点测试 ──────────────────────────


def _make_item(item_id: str, content_id: str, name: str = "", item_type: str = "video") -> WorkspaceItem:
    return WorkspaceItem(
        item_id=item_id,
        type=item_type,
        source="url",
        source_value="https://example.com/v",
        content_id=content_id,
        name=name or item_id,
    )


def test_resolved_includes_inbox_favorites(client):
    """收纳箱收藏应被解析返回。"""
    c, store, metadata = client
    # 创建 inbox workspace
    inbox = WorkspaceRecord(workspace_id="__inbox__", name="收纳箱", source="inbox")
    store.create(inbox)
    item = _make_item("inbox_item_1", "cid_inbox_1", "收纳视频")
    store.add_item("__inbox__", item)
    metadata.set_favorite("__inbox__", "cid_inbox_1")

    resp = c.get("/workspaces/metadata/favorites/resolved")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    entry = data[0]
    assert entry["workspace_id"] == "__inbox__"
    assert entry["workspace_name"] == "收纳箱"
    assert entry["item_id"] == "inbox_item_1"
    assert entry["content_id"] == "cid_inbox_1"
    assert entry["item_name"] == "收纳视频"
    assert "favorited_at" in entry
    assert "jump_url" in entry


def test_resolved_includes_normal_workspace(client):
    """普通合集收藏正常解析。"""
    c, store, metadata = client
    rec = WorkspaceRecord(workspace_id="ws_normal", name="普通合集")
    store.create(rec)
    item = _make_item("item_n1", "cid_n1", "普通视频")
    store.add_item("ws_normal", item)
    metadata.set_favorite("ws_normal", "cid_n1")

    resp = c.get("/workspaces/metadata/favorites/resolved")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["workspace_name"] == "普通合集"


def test_resolved_skips_trashed_workspace(client):
    """软删除的合集收藏不返回。"""
    c, store, metadata = client
    rec = WorkspaceRecord(workspace_id="ws_trashed", name="已删除", trashed=True)
    store.create(rec)
    item = _make_item("item_t1", "cid_t1")
    store.add_item("ws_trashed", item)
    metadata.set_favorite("ws_trashed", "cid_t1")

    resp = c.get("/workspaces/metadata/favorites/resolved")
    assert resp.json() == []


def test_resolved_skips_missing_item(client):
    """收藏对应的 item 已不存在时跳过。"""
    c, store, metadata = client
    rec = WorkspaceRecord(workspace_id="ws_miss", name="缺失")
    store.create(rec)
    # 不添加 item，直接收藏一个不存在的 content_id
    metadata.set_favorite("ws_miss", "cid_ghost")

    resp = c.get("/workspaces/metadata/favorites/resolved")
    assert resp.json() == []


def test_resolved_same_content_different_workspaces_independent(client):
    """同源副本在不同合集中状态独立。"""
    c, store, metadata = client
    rec_a = WorkspaceRecord(workspace_id="ws_copy_a", name="副本 A")
    rec_b = WorkspaceRecord(workspace_id="ws_copy_b", name="副本 B")
    store.create(rec_a)
    store.create(rec_b)
    item_a = _make_item("item_ca", "cid_shared", "视频 A")
    item_b = _make_item("item_cb", "cid_shared", "视频 B")
    store.add_item("ws_copy_a", item_a)
    store.add_item("ws_copy_b", item_b)
    # 只收藏 A 的副本
    metadata.set_favorite("ws_copy_a", "cid_shared")

    resp = c.get("/workspaces/metadata/favorites/resolved")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["workspace_id"] == "ws_copy_a"
    assert data[0]["item_id"] == "item_ca"


def test_resolved_group_filter(client):
    """可选 group_id 过滤。"""
    c, store, metadata = client
    rec = WorkspaceRecord(workspace_id="ws_gf", name="分组测试")
    store.create(rec)
    item1 = _make_item("item_g1", "cid_g1")
    item2 = _make_item("item_g2", "cid_g2")
    store.add_item("ws_gf", item1)
    store.add_item("ws_gf", item2)
    metadata.set_favorite("ws_gf", "cid_g1")  # default group
    group = metadata.create_favorite_group("精选")
    metadata.set_favorite("ws_gf", "cid_g2", group["group_id"])

    resp = c.get(f"/workspaces/metadata/favorites/resolved?group_id={group['group_id']}")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["content_id"] == "cid_g2"


def test_resolved_ordered_by_favorited_at_desc(client):
    """结果按 favorited_at 倒序。"""
    c, store, metadata = client
    rec = WorkspaceRecord(workspace_id="ws_order", name="排序")
    store.create(rec)
    item1 = _make_item("item_o1", "cid_o1")
    item2 = _make_item("item_o2", "cid_o2")
    store.add_item("ws_order", item1)
    store.add_item("ws_order", item2)
    metadata.set_favorite("ws_order", "cid_o1")
    metadata.set_favorite("ws_order", "cid_o2")

    resp = c.get("/workspaces/metadata/favorites/resolved")
    data = resp.json()
    assert len(data) == 2
    # 后收藏的排前面
    assert data[0]["content_id"] == "cid_o2"
    assert data[1]["content_id"] == "cid_o1"
