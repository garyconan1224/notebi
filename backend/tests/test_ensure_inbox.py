"""POST /workspaces/ensure-inbox — 收纳箱懒创建测试。"""

from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture(autouse=True)
def _setup(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
    """用临时 store 替换 workspaces 路由的全局 _store。"""
    import backend.app.routes.workspaces as ws_module

    store = WorkspaceStore(root=tmp_path)
    monkeypatch.setattr(ws_module, "_store", store)


from backend.app.main import app  # noqa: E402

client = TestClient(app)


class TestEnsureInbox:
    def test_first_call_creates_inbox(self):
        """首次调用应创建收纳箱 workspace，source='inbox'。"""
        resp = client.post("/workspaces/ensure-inbox")
        assert resp.status_code == 200
        data = resp.json()
        assert data["workspace_id"] == "__inbox__"
        assert data["name"] == "收纳箱"
        assert data["source"] == "inbox"

    def test_second_call_returns_existing(self):
        """第二次调用应返回同一个收纳箱，不重复创建。"""
        resp1 = client.post("/workspaces/ensure-inbox")
        resp2 = client.post("/workspaces/ensure-inbox")
        assert resp1.json()["workspace_id"] == resp2.json()["workspace_id"]

    def test_inbox_not_in_workspace_list(self):
        """收纳箱不出现在合集列表中。"""
        client.post("/workspaces/ensure-inbox")
        resp = client.get("/workspaces")
        ws_ids = [w["workspace_id"] for w in resp.json()]
        assert "__inbox__" not in ws_ids

    def test_inbox_items_visible_in_library(self):
        """收纳箱的 items 在资料库聚合端点可见（但合集卡片不可见）。"""
        # 先创建收纳箱并手动加一个 item
        import backend.app.routes.workspaces as ws_module
        from backend.app.models.workspace import WorkspaceItem

        client.post("/workspaces/ensure-inbox")
        item = WorkspaceItem(
            item_id="item-inbox-1",
            type="video",
            source="url",
            source_value="https://example.com/video",
            name="测试视频",
        )
        ws_module._store.add_item("__inbox__", item)

        resp = client.get("/workspaces/library")
        data = resp.json()
        item_ids = [it["item_id"] for it in data["items"]]
        ws_ids = [w["workspace_id"] for w in data["workspaces"]]
        assert "item-inbox-1" in item_ids
        assert "__inbox__" not in ws_ids
