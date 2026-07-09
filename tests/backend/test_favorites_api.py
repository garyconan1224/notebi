"""Phase 2A — favorites 端点测试。

happy path  — 添加收藏 → workspace.favorites 含 item_id；重复添加幂等；删除后移除。
error path  — workspace 不存在返回 404；item 不存在返回 404。
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.models.workspace import WorkspaceItem
from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceRecord, WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path):
    store = WorkspaceStore(root=tmp_path / "workspaces")
    mock_runner = MagicMock()
    mock_runner.store.get.return_value = None

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", store),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            yield c, store


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
    c, store = client
    ws_id, item_id = _create_ws_with_item(store)

    resp = c.post(f"/workspaces/{ws_id}/favorites/{item_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert item_id in data["favorites"]


def test_favorite_item_is_idempotent(client):
    """重复收藏不报错，也不重复加入列表。"""
    c, store = client
    ws_id, item_id = _create_ws_with_item(store)

    c.post(f"/workspaces/{ws_id}/favorites/{item_id}")
    resp = c.post(f"/workspaces/{ws_id}/favorites/{item_id}")
    assert resp.status_code == 200
    assert resp.json()["favorites"].count(item_id) == 1


def test_unfavorite_item_removes_from_favorites(client):
    c, store = client
    ws_id, item_id = _create_ws_with_item(store)

    c.post(f"/workspaces/{ws_id}/favorites/{item_id}")
    resp = c.delete(f"/workspaces/{ws_id}/favorites/{item_id}")
    assert resp.status_code == 200
    assert item_id not in resp.json()["favorites"]


def test_favorite_workspace_not_found(client):
    c, _ = client
    resp = c.post("/workspaces/nonexistent/favorites/some_item")
    assert resp.status_code == 404


def test_favorite_item_not_found(client):
    c, store = client
    rec = WorkspaceRecord(workspace_id="ws_fav_02", name="空工作区")
    store.create(rec)
    resp = c.post("/workspaces/ws_fav_02/favorites/ghost_item")
    assert resp.status_code == 404
