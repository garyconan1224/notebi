from __future__ import annotations

"""A2 — 说话人名称映射后端测试。

覆盖：
  PATCH speaker_map 正常保存
  PATCH speaker_map 404 未知 item
  GET subtitles 导出时应用 speaker_map 替换
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import export as export_module
from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """每个测试用独立 data 目录。"""
    fake_data = tmp_path / "workspaces"
    store = WorkspaceStore(root=fake_data)
    monkeypatch.setattr(ws_module, "_store", store)
    monkeypatch.setattr(export_module, "_store", store)
    app = FastAPI()
    app.include_router(ws_module.router)
    app.include_router(export_module.router)
    with TestClient(app) as c:
        yield c


def _create_audio_item(client: TestClient) -> tuple[str, str]:
    """辅助：创建 workspace + audio 素材，返回 (ws_id, item_id)。"""
    ws = client.post("/workspaces", json={"name": "speaker-test"}).json()
    ws_id = ws["workspace_id"]
    rec = client.post(
        f"/workspaces/{ws_id}/items",
        json={"source": "url", "source_value": "https://example.com/a.mp3", "name": "test-audio", "type": "audio"},
    ).json()
    item_id = rec["items"][-1]["item_id"]
    return ws_id, item_id


def test_patch_speaker_map_saves_to_results(client: TestClient) -> None:
    ws_id, item_id = _create_audio_item(client)
    # 先写入 transcript_segments
    ws_module._store.update_item(
        ws_id,
        item_id,
        results={
            "transcript_segments": [
                {"start": 0.0, "end": 1.5, "text": "你好", "speaker": "SPEAKER_00"},
                {"start": 1.5, "end": 3.0, "text": "世界", "speaker": "SPEAKER_01"},
            ],
        },
    )

    mapping = {"SPEAKER_00": "小明", "SPEAKER_01": "小红"}
    resp = client.patch(
        f"/workspaces/{ws_id}/items/{item_id}/speaker_map",
        json={"speaker_map": mapping},
    )

    assert resp.status_code == 200
    assert resp.json() == {"speaker_map": mapping}

    # 验证已持久化到 item.results
    rec = ws_module._store.get(ws_id)
    item = next(it for it in rec.items if it.item_id == item_id)
    assert item.results["speaker_map"] == mapping
    # 原始 segments 不应被修改
    assert item.results["transcript_segments"][0]["speaker"] == "SPEAKER_00"


def test_patch_speaker_map_404_unknown_item(client: TestClient) -> None:
    ws = client.post("/workspaces", json={"name": "t"}).json()
    ws_id = ws["workspace_id"]

    resp = client.patch(
        f"/workspaces/{ws_id}/items/nonexistent/speaker_map",
        json={"speaker_map": {"S0": "Alice"}},
    )
    assert resp.status_code == 404


def test_export_subtitles_with_speaker_map(client: TestClient) -> None:
    ws_id, item_id = _create_audio_item(client)
    ws_module._store.update_item(
        ws_id,
        item_id,
        results={
            "transcript_segments": [
                {"start": 0.0, "end": 1.5, "text": "你好", "speaker": "SPEAKER_00"},
                {"start": 1.5, "end": 3.0, "text": "世界", "speaker": "SPEAKER_01"},
            ],
            "speaker_map": {"SPEAKER_00": "小明", "SPEAKER_01": "小红"},
        },
        status="done",
    )

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/subtitles?format=srt")

    assert resp.status_code == 200
    body = resp.content.decode()
    # 应使用映射后的名称
    assert "[小明]" in body
    assert "[小红]" in body
    # 原始 ID 不应出现
    assert "SPEAKER_00" not in body
    assert "SPEAKER_01" not in body
