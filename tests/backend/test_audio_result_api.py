from __future__ import annotations

"""Phase 2B — 音频结果页端点测试。

覆盖：
  GET happy path 返回 demo fixture（含 audio / transcript / summary / tracks_meta）
  GET 400 item.type != 'audio'
  GET 404 workspace 不存在
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """每个测试用独立 data 目录。"""
    fake_data = tmp_path / "workspaces"
    monkeypatch.setattr(ws_module, "_store", WorkspaceStore(root=fake_data))
    app = FastAPI()
    app.include_router(ws_module.router)
    with TestClient(app) as c:
        yield c


def _create_audio_workspace(client: TestClient) -> tuple[str, str]:
    """辅助：创建一个含音频素材的 workspace，返回 (ws_id, item_id)。"""
    ws = client.post("/workspaces", json={"name": "audio-test"}).json()
    ws_id = ws["workspace_id"]
    rec = client.post(
        f"/workspaces/{ws_id}/items",
        json={"source": "url", "source_value": "https://example.com/podcast.mp3", "name": "podcast", "type": "audio"},
    ).json()
    item_id = rec["items"][-1]["item_id"]
    return ws_id, item_id


def test_audio_result_happy_path(client: TestClient) -> None:
    ws_id, item_id = _create_audio_workspace(client)
    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/audio_result")
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "demo_fixture"
    # audio 块
    assert body["audio"]["item_id"] == item_id
    assert body["audio"]["title"]
    assert body["audio"]["duration_sec"] > 0
    assert body["audio"]["duration_str"]
    # transcript
    assert isinstance(body["transcript"], list)
    assert len(body["transcript"]) > 0
    first = body["transcript"][0]
    assert "t_sec" in first
    assert "t_str" in first
    assert "text" in first
    # summary
    assert body["summary"]
    # tracks_meta
    assert body["tracks_meta"]["total_sec"] > 0
    assert body["tracks_meta"]["transcript_count"] > 0


def test_audio_result_400_wrong_type(client: TestClient) -> None:
    """item.type != 'audio' 时应返回 400。"""
    ws = client.post("/workspaces", json={"name": "wrong-type"}).json()
    ws_id = ws["workspace_id"]
    rec = client.post(
        f"/workspaces/{ws_id}/items",
        json={"source": "url", "source_value": "https://example.com/photo.jpg", "name": "photo", "type": "image"},
    ).json()
    item_id = rec["items"][-1]["item_id"]
    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/audio_result")
    assert resp.status_code == 400
    assert "audio" in resp.json()["detail"]


def test_audio_result_404_workspace_not_found(client: TestClient) -> None:
    resp = client.get("/workspaces/nonexistent/items/anything/audio_result")
    assert resp.status_code == 404
    assert "workspace not found" in resp.json()["detail"]
