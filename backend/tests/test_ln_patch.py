"""PATCH /workspaces/{id}/ln — 学习笔记保存测试。"""

from __future__ import annotations

import tempfile
import pathlib

import pytest
from fastapi.testclient import TestClient

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


def _make_test_store(tmp_dir: str) -> WorkspaceStore:
    """创建含一个 workspace + video item 的临时 store。"""
    store = WorkspaceStore(root=pathlib.Path(tmp_dir))
    item = WorkspaceItem.from_dict({
        "item_id": "item-1",
        "type": "video",
        "source": "local",
        "source_value": "/tmp/test.mp4",
        "name": "测试视频",
        "status": "done",
        "results": {},
    })
    rec = WorkspaceRecord(workspace_id="ws-1", name="测试工作空间")
    rec.items.append(item)
    store.create(rec)
    return store


@pytest.fixture(autouse=True)
def _setup(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
    """用临时 store + workspace root 替换路由模块的全局依赖。"""
    import backend.app.routes.export as export_module

    store = _make_test_store(str(tmp_path))
    monkeypatch.setattr(export_module, "_store", store)

    # 让 get_workspace_root 指向 tmp_path/ws-1
    ws_root = tmp_path / "ws-1"
    ws_root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)


from backend.app.main import app  # noqa: E402

client = TestClient(app)


class TestPatchLn:
    def test_patch_creates_file_and_returns_version(self):
        """首次保存：创建 ln.md，version 从 0 变 1。"""
        resp = client.patch("/workspaces/ws-1/ln", json={"markdown": "# Hello"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["version"] == 1
        assert "saved_at" in data

    def test_patch_writes_file_content(self, tmp_path: pathlib.Path):
        """保存后 ln.md 内容应与提交的一致。"""
        client.patch("/workspaces/ws-1/ln", json={"markdown": "## 笔记内容"})
        content = (tmp_path / "ws-1" / "ln.md").read_text(encoding="utf-8")
        assert content == "## 笔记内容"

    def test_patch_bumps_version_on_each_call(self):
        """连续保存两次，version 应递增到 2。"""
        client.patch("/workspaces/ws-1/ln", json={"markdown": "v1"})
        resp = client.patch("/workspaces/ws-1/ln", json={"markdown": "v2"})
        assert resp.json()["version"] == 2

    def test_patch_overwrites_existing_file(self, tmp_path: pathlib.Path):
        """二次保存应覆盖旧内容。"""
        client.patch("/workspaces/ws-1/ln", json={"markdown": "旧内容"})
        client.patch("/workspaces/ws-1/ln", json={"markdown": "新内容"})
        content = (tmp_path / "ws-1" / "ln.md").read_text(encoding="utf-8")
        assert content == "新内容"

    def test_patch_nonexistent_workspace_returns_404(self):
        """workspace 不存在时返回 404。"""
        resp = client.patch("/workspaces/no-such-ws/ln", json={"markdown": "x"})
        assert resp.status_code == 404
