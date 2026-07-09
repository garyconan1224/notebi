"""POST /workspaces/{id}/items/{item_id}/reproduce/export — 复刻包 zip 导出测试。"""

from __future__ import annotations

import io
import json
import pathlib
import zipfile

import pytest
from fastapi.testclient import TestClient

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


def _make_test_store(tmp_dir: str, with_frames: bool = True) -> WorkspaceStore:
    """创建含一个 workspace + video item 的临时 store。"""
    store = WorkspaceStore(root=pathlib.Path(tmp_dir))
    results = {}
    if with_frames:
        results = {
            "frames": [
                {
                    "idx": 0,
                    "sec": 0,
                    "ts": "00:00",
                    "title": "开场",
                    "subtitle": "",
                    "description": "opening scene",
                    "shot_type": "wide",
                    "prompt_mj": "a cinematic wide shot of a city skyline",
                    "prompt_sd": {"positive": "city skyline", "negative": ""},
                    "prompt_video": "camera pans across city",
                    "tags": {"style": ["cinematic"], "lighting": ["golden hour"]},
                    "image_path": "",
                    "frame_image_path": "",
                },
                {
                    "idx": 1,
                    "sec": 15,
                    "ts": "00:15",
                    "title": "特写",
                    "subtitle": "",
                    "description": "close-up shot",
                    "shot_type": "close-up",
                    "prompt_mj": "a dramatic close-up of a face",
                    "prompt_sd": {"positive": "face close-up", "negative": ""},
                    "prompt_video": "slow zoom into face",
                    "tags": {"style": ["dramatic"], "lighting": ["soft"]},
                    "image_path": "",
                    "frame_image_path": "",
                },
                {
                    "idx": 2,
                    "sec": 30,
                    "ts": "00:30",
                    "title": "结尾",
                    "subtitle": "",
                    "description": "ending scene",
                    "shot_type": "medium",
                    "prompt_mj": "a medium shot of sunset",
                    "prompt_sd": {"positive": "sunset", "negative": ""},
                    "prompt_video": "fade to sunset",
                    "tags": {"style": ["warm"], "lighting": ["sunset"]},
                    "image_path": "",
                    "frame_image_path": "",
                },
            ],
            "transcript": [],
            "video": {"title": "测试视频", "url": "", "duration_sec": 45, "duration_str": "0:45"},
            "tracks_meta": {"total_sec": 45, "frame_count": 3, "transcript_count": 0},
        }
    item = WorkspaceItem.from_dict({
        "item_id": "item-1",
        "type": "video",
        "source": "local",
        "source_value": "/tmp/test.mp4",
        "name": "测试视频标题",
        "status": "done",
        "results": results,
        "related_task_ids": [],
    })
    rec = WorkspaceRecord(workspace_id="ws-1", name="测试工作空间")
    rec.items.append(item)
    store.create(rec)
    return store


@pytest.fixture()
def _setup(monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path):
    """注入临时 store + runner。"""
    import backend.app.routes.workspaces as ws_module

    store = _make_test_store(str(tmp_path))
    monkeypatch.setattr(ws_module, "_store", store)

    # mock _pipeline_runner.store.get → None（无关联任务）
    class FakeRunnerStore:
        def get(self, _tid):
            return None

    class FakeRunner:
        store = FakeRunnerStore()

    monkeypatch.setattr(ws_module, "_pipeline_runner", FakeRunner())
    return store


def test_export_basic(_setup):
    """基本导出：选 2 帧，校验 zip 内容。"""
    from fastapi.testclient import TestClient
    from backend.app.main import app

    client = TestClient(app)
    resp = client.post(
        "/workspaces/ws-1/items/item-1/reproduce/export",
        json={"frame_indices": [0, 2]},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = zf.namelist()

    # prompts.txt 和 manifest.json 必须存在
    assert "prompts.txt" in names
    assert "manifest.json" in names
    assert "styles.json" in names

    # 校验 manifest
    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["workspace_id"] == "ws-1"
    assert manifest["item_id"] == "item-1"
    assert manifest["frame_count"] == 2
    assert manifest["frames"][0]["index"] == 0
    assert manifest["frames"][1]["index"] == 2

    # 校验 prompts.txt 包含两帧内容
    prompts = zf.read("prompts.txt").decode()
    assert "Frame 0" in prompts
    assert "a cinematic wide shot" in prompts
    assert "Frame 2" in prompts
    assert "a medium shot of sunset" in prompts

    # 校验 styles.json
    styles = json.loads(zf.read("styles.json"))
    assert "cinematic" in styles.get("style", [])
    assert "warm" in styles.get("style", [])


def test_export_invalid_indices(_setup):
    """无效帧索引应返回 400。"""
    from backend.app.main import app

    client = TestClient(app)
    resp = client.post(
        "/workspaces/ws-1/items/item-1/reproduce/export",
        json={"frame_indices": [99, 100]},
    )
    assert resp.status_code == 400


def test_export_workspace_not_found(_setup):
    """不存在的 workspace 应返回 404。"""
    from backend.app.main import app

    client = TestClient(app)
    resp = client.post(
        "/workspaces/nonexistent/items/item-1/reproduce/export",
        json={"frame_indices": [0]},
    )
    assert resp.status_code == 404


def test_export_single_frame(_setup):
    """单帧导出。"""
    from backend.app.main import app

    client = TestClient(app)
    resp = client.post(
        "/workspaces/ws-1/items/item-1/reproduce/export",
        json={"frame_indices": [1]},
    )
    assert resp.status_code == 200

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["frame_count"] == 1
    assert manifest["frames"][0]["ts"] == "00:15"
