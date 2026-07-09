"""4 个 summary API endpoint 测试。"""

from __future__ import annotations

import tempfile
import pathlib
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.app.models.workspace import ItemSummary, WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


def _make_test_store() -> WorkspaceStore:
    """创建含一个 workspace + item 的临时 store。"""
    tmp = tempfile.mkdtemp()
    store = WorkspaceStore(root=pathlib.Path(tmp))
    item = WorkspaceItem.from_dict({
        "item_id": "item-1",
        "type": "video",
        "source": "local",
        "source_value": "/tmp/test.mp4",
        "name": "测试视频",
        "status": "done",
        "results": {"transcript": "测试转写文本"},
    })
    rec = WorkspaceRecord(workspace_id="ws-1", name="测试工作空间")
    rec.items.append(item)
    store.create(rec)
    return store


@pytest.fixture(autouse=True)
def _patch_store(monkeypatch: pytest.MonkeyPatch) -> WorkspaceStore:
    """用临时 store 替换路由模块的全局 _store。"""
    import backend.app.routes.workspaces as ws_module
    store = _make_test_store()
    monkeypatch.setattr(ws_module, "_store", store)
    return store


# 在 fixture 之后导入，确保 monkeypatch 生效
from backend.app.main import app  # noqa: E402

client = TestClient(app)


# ── GET list ────────────────────────────────────────────────────


class TestListSummaries:
    def test_empty_list(self) -> None:
        resp = client.get("/workspaces/ws-1/items/item-1/summaries")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_workspace_not_found(self) -> None:
        resp = client.get("/workspaces/nonexistent/items/item-1/summaries")
        assert resp.status_code == 404

    def test_item_not_found(self) -> None:
        resp = client.get("/workspaces/ws-1/items/nonexistent/summaries")
        assert resp.status_code == 404


# ── POST create ────────────────────────────────────────────────


class TestCreateSummary:
    @patch("backend.app.routes.workspaces.generate_summary")
    def test_create_success(self, mock_gen: MagicMock) -> None:
        mock_gen.return_value = ItemSummary(
            summary_id="s-1",
            template="concise",
            version=1,
            content_md="# 摘要\n\n生成内容",
            model_used="openai/gpt-4o",
        )
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
            "background_for_summary": "背景信息",
        })
        assert resp.status_code == 201
        data = resp.json()
        assert data["template"] == "concise"
        assert data["content_md"] == "# 摘要\n\n生成内容"
        assert data["model_used"] == "openai/gpt-4o"
        assert data["version"] == 0  # 首版 = v0

    @patch("backend.app.routes.workspaces.generate_summary")
    def test_create_version_increment(self, mock_gen: MagicMock) -> None:
        """同模板第二次生成 → version=1。"""
        mock_gen.return_value = ItemSummary(
            summary_id="s-1", template="concise", version=0, content_md="v0",
        )
        client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
        })

        mock_gen.return_value = ItemSummary(
            summary_id="s-2", template="concise", version=1, content_md="v1",
        )
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
        })
        assert resp.status_code == 201
        assert resp.json()["version"] == 1

    def test_invalid_template(self) -> None:
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "nonexistent_template",
        })
        assert resp.status_code == 400
        assert "未知模板" in resp.json()["detail"]

    @patch("backend.app.routes.workspaces.generate_summary")
    def test_llm_failure(self, mock_gen: MagicMock) -> None:
        mock_gen.side_effect = RuntimeError("未配置 chat model")
        resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
        })
        assert resp.status_code == 500


# ── GET detail ──────────────────────────────────────────────────


class TestGetSummary:
    def test_not_found(self) -> None:
        resp = client.get("/workspaces/ws-1/items/item-1/summaries/nonexistent")
        assert resp.status_code == 404

    @patch("backend.app.routes.workspaces.generate_summary")
    def test_get_after_create(self, mock_gen: MagicMock) -> None:
        mock_gen.return_value = ItemSummary(
            summary_id="s-detail", template="detailed", version=1, content_md="详细内容",
        )
        create_resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "detailed",
        })
        sid = create_resp.json()["summary_id"]

        resp = client.get(f"/workspaces/ws-1/items/item-1/summaries/{sid}")
        assert resp.status_code == 200
        assert resp.json()["content_md"] == "详细内容"


# ── DELETE ──────────────────────────────────────────────────────


class TestDeleteSummary:
    def test_delete_not_found(self) -> None:
        resp = client.delete("/workspaces/ws-1/items/item-1/summaries/nonexistent")
        assert resp.status_code == 404

    @patch("backend.app.routes.workspaces.generate_summary")
    def test_delete_after_create(self, mock_gen: MagicMock) -> None:
        mock_gen.return_value = ItemSummary(
            summary_id="s-del", template="concise", version=1, content_md="要删的",
        )
        create_resp = client.post("/workspaces/ws-1/items/item-1/summaries", json={
            "template": "concise",
        })
        sid = create_resp.json()["summary_id"]

        # 删除
        del_resp = client.delete(f"/workspaces/ws-1/items/item-1/summaries/{sid}")
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "deleted"

        # 列表变空
        list_resp = client.get("/workspaces/ws-1/items/item-1/summaries")
        assert list_resp.status_code == 200
        assert list_resp.json() == []
