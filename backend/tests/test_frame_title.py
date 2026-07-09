"""PATCH /workspaces/{id}/items/{item_id}/frames/{idx}/title — 帧标题改名测试。"""

from __future__ import annotations

import pathlib

import pytest

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


def _make_store(tmp_dir: str) -> WorkspaceStore:
    store = WorkspaceStore(root=pathlib.Path(tmp_dir))
    item = WorkspaceItem.from_dict({
        "item_id": "item-1",
        "type": "video",
        "source": "local",
        "source_value": "/tmp/test.mp4",
        "name": "测试视频",
        "status": "done",
        "results": {
            "frames": [
                {"idx": 0, "ts": "00:00", "title": "开场", "prompt_mj": "a city"},
                {"idx": 1, "ts": "00:15", "title": "特写", "prompt_mj": "a face"},
            ],
        },
        "related_task_ids": [],
    })
    rec = WorkspaceRecord(workspace_id="ws-1", name="测试工作空间")
    rec.items.append(item)
    store.create(rec)
    return store


@pytest.fixture()
def _setup(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
    import backend.app.routes.workspaces as ws_module

    store = _make_store(str(tmp_path))
    monkeypatch.setattr(ws_module, "_store", store)

    class FakeRunnerStore:
        def get(self, _tid):
            return None

    class FakeRunner:
        store = FakeRunnerStore()

    monkeypatch.setattr(ws_module, "_pipeline_runner", FakeRunner())
    return store


def test_update_frame_title_saves_override(_setup):
    """PATCH 保存 override 到 item.results.frame_title_overrides。"""
    from backend.app.main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    resp = client.patch(
        "/workspaces/ws-1/items/item-1/frames/0/title",
        json={"title": "新标题"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["title"] == "新标题"

    # 验证 override 已持久化到 item.results
    store = _setup
    rec = store.get("ws-1")
    item = next(it for it in rec.items if it.item_id == "item-1")
    overrides = item.results.get("frame_title_overrides", {})
    assert overrides["0"] == "新标题"


def test_update_frame_title_out_of_range(_setup):
    """越界帧索引仍保存 override（物化时忽略无效索引）。"""
    from backend.app.main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    resp = client.patch(
        "/workspaces/ws-1/items/item-1/frames/99/title",
        json={"title": "未来帧"},
    )
    assert resp.status_code == 200  # override 存储不校验帧数

    store = _setup
    rec = store.get("ws-1")
    item = next(it for it in rec.items if it.item_id == "item-1")
    assert item.results["frame_title_overrides"]["99"] == "未来帧"


def test_update_frame_title_workspace_not_found(_setup):
    from backend.app.main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    resp = client.patch(
        "/workspaces/nonexistent/items/item-1/frames/0/title",
        json={"title": "不存在"},
    )
    assert resp.status_code == 404


def test_update_multiple_frames(_setup):
    """多次改名各自保存到 overrides。"""
    from backend.app.main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    client.patch("/workspaces/ws-1/items/item-1/frames/0/title", json={"title": "标题A"})
    client.patch("/workspaces/ws-1/items/item-1/frames/1/title", json={"title": "标题B"})

    store = _setup
    rec = store.get("ws-1")
    item = next(it for it in rec.items if it.item_id == "item-1")
    overrides = item.results.get("frame_title_overrides", {})
    assert overrides["0"] == "标题A"
    assert overrides["1"] == "标题B"
