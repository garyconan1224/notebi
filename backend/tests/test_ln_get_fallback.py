"""GET /workspaces/{id}/ln — 学习笔记读取测试（含 summary 降级）。"""

from __future__ import annotations

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
        "related_task_ids": [],
    })
    rec = WorkspaceRecord(workspace_id="ws-1", name="测试工作空间")
    rec.items.append(item)
    store.create(rec)
    return store


@pytest.fixture()
def _setup_with_summary(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
    """video item.results 含 summary（学习总结 md）。"""
    import backend.app.routes.export as export_module

    store = _make_test_store(str(tmp_path))
    # 给 item 注入 summary
    item = store.get("ws-1").items[0]
    item.results["summary"] = "### 视频综合总结：GameCheats Manager\n\n#### 核心功能与亮点\n\n测试内容。"
    monkeypatch.setattr(export_module, "_store", store)

    ws_root = tmp_path / "ws-1"
    ws_root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)


@pytest.fixture()
def _setup_ln_only(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
    """只有 ln.md（用户编辑层），无 analyze 产物。"""
    import backend.app.routes.export as export_module

    store = _make_test_store(str(tmp_path))
    monkeypatch.setattr(export_module, "_store", store)

    ws_root = tmp_path / "ws-1"
    ws_root.mkdir(parents=True, exist_ok=True)
    (ws_root / "ln.md").write_text("# 用户笔记\n\n自定义内容。", encoding="utf-8")
    monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)


@pytest.fixture()
def _setup_empty(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
    """既无 ln.md 也无 analyze 产物。"""
    import backend.app.routes.export as export_module

    store = _make_test_store(str(tmp_path))
    monkeypatch.setattr(export_module, "_store", store)

    ws_root = tmp_path / "ws-1"
    ws_root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(export_module, "get_workspace_root", lambda _ws_id: ws_root)


from backend.app.main import app  # noqa: E402

client = TestClient(app)


class TestGetLnFallback:
    def test_ln_md_takes_priority(self, _setup_ln_only):
        """有 ln.md 时优先返回 ln.md 内容。"""
        resp = client.get("/workspaces/ws-1/ln")
        assert resp.status_code == 200
        assert "用户笔记" in resp.text

    def test_fallback_to_summary(self, _setup_with_summary):
        """无 ln.md 但有 item.results.summary 时，返回 summary。"""
        resp = client.get("/workspaces/ws-1/ln")
        assert resp.status_code == 200
        assert "视频综合总结" in resp.text
        assert "GameCheats Manager" in resp.text

    def test_404_when_nothing_exists(self, _setup_empty):
        """既无 ln.md 也无 analyze 产物时返回 404。"""
        resp = client.get("/workspaces/ws-1/ln")
        assert resp.status_code == 404
        assert "学习笔记尚未生成" in resp.json()["detail"]

    def test_404_for_nonexistent_workspace(self, tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch):
        """workspace 不存在时返回 404。"""
        import backend.app.routes.export as export_module

        store = WorkspaceStore(root=tmp_path)
        monkeypatch.setattr(export_module, "_store", store)
        resp = client.get("/workspaces/no-such-ws/ln")
        assert resp.status_code == 404
