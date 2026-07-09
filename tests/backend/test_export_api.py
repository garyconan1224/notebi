from __future__ import annotations

"""Phase 1I — 复刻工作包 zip 导出端点测试。

覆盖：
  GET happy path 返回 zip（视频素材）
  GET happy path 返回 zip（图片素材）
  GET 404 workspace 不存在
"""

import io
import json
import zipfile
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


def _create_workspace_with_item(client: TestClient, item_type: str) -> tuple[str, str]:
    """辅助：创建 workspace + 指定类型素材，返回 (ws_id, item_id)。"""
    ws = client.post("/workspaces", json={"name": "export-test"}).json()
    ws_id = ws["workspace_id"]
    rec = client.post(
        f"/workspaces/{ws_id}/items",
        json={"source": "url", "source_value": "https://example.com/test.mp4", "name": "test-video", "type": item_type},
    ).json()
    item_id = rec["items"][-1]["item_id"]
    return ws_id, item_id


def test_export_video_happy_path(client: TestClient) -> None:
    ws_id, item_id = _create_workspace_with_item(client, "video")
    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert "filename*" in resp.headers.get("content-disposition", "")

    # 解析 zip 内容
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(zf.namelist())
    assert "prompts.json" in names
    assert "subtitles.srt" in names
    assert "README.md" in names
    # reference_frames/ 下应有帧文件
    ref_frames = [n for n in names if n.startswith("reference_frames/")]
    assert len(ref_frames) > 0

    # 验证 prompts.json 可解析且有内容
    prompts = json.loads(zf.read("prompts.json"))
    assert isinstance(prompts, list)
    assert len(prompts) > 0
    assert "prompt_mj" in prompts[0]

    # 验证 subtitles.srt 有内容
    srt = zf.read("subtitles.srt").decode()
    assert len(srt) > 0
    assert "-->" in srt


def test_export_image_happy_path(client: TestClient) -> None:
    ws_id, item_id = _create_workspace_with_item(client, "image")
    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/export")
    assert resp.status_code == 200

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(zf.namelist())
    assert "prompts.json" in names
    assert "subtitles.srt" in names
    assert "README.md" in names

    # 图片素材的 prompts.json 是 dict
    prompts = json.loads(zf.read("prompts.json"))
    assert isinstance(prompts, dict)

    # subtitles.srt 应为空
    srt = zf.read("subtitles.srt").decode()
    assert srt == ""


def test_export_subtitles_srt_from_audio_segments(client: TestClient) -> None:
    ws_id, item_id = _create_workspace_with_item(client, "audio")
    ws_module._store.update_item(
        ws_id,
        item_id,
        results={
            "transcript_segments": [
                {"start": 0.0, "end": 1.5, "text": "第一句", "speaker": "S0"},
                {"start": 1.5, "end": 3.0, "text": "第二句"},
            ],
        },
        status="done",
    )

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/subtitles?format=srt")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    assert "filename*=UTF-8''" in resp.headers.get("content-disposition", "")
    body = resp.content.decode()
    assert "00:00:00,000 --> 00:00:01,500" in body
    assert "[S0] 第一句" in body
    assert "00:00:01,500 --> 00:00:03,000" in body


def test_export_subtitles_vtt_from_video_display_transcript(client: TestClient) -> None:
    ws_id, item_id = _create_workspace_with_item(client, "video")
    ws_module._store.update_item(
        ws_id,
        item_id,
        results={
            "summary_path": "subtitle",
            "transcript": [
                {"t_sec": 0.0, "t_str": "00:00", "text": "开场"},
                {"t_sec": 2.0, "t_str": "00:02", "text": "第二段"},
            ],
        },
        status="done",
    )

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/subtitles?format=vtt")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/vtt")
    body = resp.content.decode()
    assert body.startswith("WEBVTT")
    assert "00:00:00.000 --> 00:00:02.000" in body
    assert "00:00:02.000 --> 00:00:07.000" in body


def test_export_subtitles_rejects_unknown_format(client: TestClient) -> None:
    ws_id, item_id = _create_workspace_with_item(client, "audio")

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/subtitles?format=txt")

    assert resp.status_code == 400
    assert "unsupported format" in resp.json()["detail"]


def test_export_404_workspace_not_found(client: TestClient) -> None:
    resp = client.get("/workspaces/nonexistent/items/anything/export")
    assert resp.status_code == 404
    assert "workspace not found" in resp.json()["detail"]


# ── batch-export 测试 ─────────────────────────────────────────


def test_batch_export_happy_path_mixed(client: TestClient) -> None:
    """批量导出：混选图片+视频应返回 200，zip 里每个素材一个子目录。"""
    ws_id, img_id = _create_workspace_with_item(client, "image")
    # 在同一个 workspace 里加第二个素材
    rec = client.post(
        f"/workspaces/{ws_id}/items",
        json={"source": "url", "source_value": "https://example.com/test2.mp4", "name": "test-video-2", "type": "video"},
    ).json()
    vid_id = rec["items"][-1]["item_id"]

    resp = client.post(
        f"/workspaces/{ws_id}/items/batch-export",
        json={"item_ids": [img_id, vid_id]},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(zf.namelist())
    # 两个素材各有一个 prompts.json
    prompt_files = [n for n in names if n.endswith("prompts.json")]
    assert len(prompt_files) == 2


def test_batch_export_image_only(client: TestClient) -> None:
    """批量导出：仅图片素材应正常出 zip。"""
    ws_id, item_id = _create_workspace_with_item(client, "image")
    resp = client.post(
        f"/workspaces/{ws_id}/items/batch-export",
        json={"item_ids": [item_id]},
    )
    assert resp.status_code == 200

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    names = set(zf.namelist())
    assert any(n.endswith("prompts.json") for n in names)


def test_batch_export_404_workspace(client: TestClient) -> None:
    """批量导出：workspace 不存在应 404。"""
    resp = client.post(
        "/workspaces/nonexistent/items/batch-export",
        json={"item_ids": ["any"]},
    )
    assert resp.status_code == 404


def test_batch_export_empty_item_ids(client: TestClient) -> None:
    """批量导出：空 item_ids 应 400。"""
    ws = client.post("/workspaces", json={"name": "empty-test"}).json()
    ws_id = ws["workspace_id"]
    resp = client.post(
        f"/workspaces/{ws_id}/items/batch-export",
        json={"item_ids": []},
    )
    assert resp.status_code == 400


def test_batch_export_path_traversal_sanitized(client: TestClient) -> None:
    """批量导出：素材名含 ../ 时 zip 内路径应被清洗。"""
    ws = client.post("/workspaces", json={"name": "traversal-test"}).json()
    ws_id = ws["workspace_id"]
    rec = client.post(
        f"/workspaces/{ws_id}/items",
        json={"source": "url", "source_value": "https://example.com/test.mp4", "name": "../escape", "type": "image"},
    ).json()
    item_id = rec["items"][-1]["item_id"]

    resp = client.post(
        f"/workspaces/{ws_id}/items/batch-export",
        json={"item_ids": [item_id]},
    )
    assert resp.status_code == 200

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    for name in zf.namelist():
        assert not name.startswith("../"), f"zip path not sanitized: {name}"
        assert not name.startswith("/"), f"zip path not sanitized: {name}"
