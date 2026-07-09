"""NI.1 — generate-note 端点测试。

用例：
  1. 小红书图文 URL → item.type="image" + note task 创建 + related_task_ids 关联
  2. 小红书视频 URL → item.type="video"（不误判为 image）
  3. 无效 URL → 400
  4. GET /note 从 results["images"] 返回 media.images
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
from shared.url_sniffer import SniffResult


@pytest.fixture()
def client(tmp_path: Path):
    store = WorkspaceStore(root=tmp_path / "workspaces")
    mock_runner = MagicMock()
    mock_runner.store.get.return_value = None
    # create_task 返回一个带 task_id 的 mock
    mock_task = MagicMock()
    mock_task.task_id = "note-test-001"
    mock_runner.create_task.return_value = mock_task

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", store),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
        patch("backend.app.routes.workspaces.DATA_DIR", tmp_path),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            yield c, store, tmp_path


def _create_ws(store: WorkspaceStore, ws_id: str = "ws_ni_01") -> str:
    rec = WorkspaceRecord(workspace_id=ws_id, name="NI 测试区")
    store.create(rec)
    return ws_id


# ── 1. 小红书图文 → image 类型 ────────────────────────────────────

def test_xhs_image_text_creates_image_item(client):
    """小红书图文 URL 应创建 type=image 的 item 并关联 note task。"""
    c, store, _ = client
    ws_id = _create_ws(store)

    sniff_result = SniffResult(
        primary_type="text",
        possible_types=["text"],
        platform="xiaohongshu",
    )
    with patch.object(ws_module, "sniff_url", return_value=sniff_result):
        resp = c.post(f"/workspaces/{ws_id}/items/generate-note", json={
            "url": "https://www.xiaohongshu.com/explore/683f6b75000000001c010bb3",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["item_type"] == "image"
    assert data["task_type"] == "note"

    # workspace 中应有一条 image item
    ws = store.get(ws_id)
    assert ws is not None
    items = ws.items
    assert len(items) == 1
    assert items[0].type == "image"
    assert items[0].source == "url"
    assert "note-test-001" in items[0].related_task_ids
    created_payload = ws_module._pipeline_runner.create_task.call_args.args[2]
    assert created_payload["workspace_id"] == ws_id
    assert created_payload["item_id"] == items[0].item_id


# ── 2. 小红书视频 → 不误判为 image ────────────────────────────────

def test_xhs_video_not_misclassified_as_image(client):
    """小红书视频 URL（primary_type=video）应落为 video，不落为 image。"""
    c, store, _ = client
    ws_id = _create_ws(store)

    sniff_result = SniffResult(
        primary_type="video",
        possible_types=["video"],
        platform="xiaohongshu",
    )
    with patch.object(ws_module, "sniff_url", return_value=sniff_result):
        resp = c.post(f"/workspaces/{ws_id}/items/generate-note", json={
            "url": "https://www.xiaohongshu.com/explore/some_video_id",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["item_type"] == "video"

    ws = store.get(ws_id)
    assert ws.items[0].type == "video"


# ── 3. 无效 URL → 400 ────────────────────────────────────────────

def test_invalid_url_returns_400(client):
    """非 http/https URL 应返回 400。"""
    c, store, _ = client
    ws_id = _create_ws(store)

    resp = c.post(f"/workspaces/{ws_id}/items/generate-note", json={
        "url": "not a url",
    })
    assert resp.status_code == 400


def test_empty_url_returns_400(client):
    """空 URL 应返回 400。"""
    c, store, _ = client
    ws_id = _create_ws(store)

    resp = c.post(f"/workspaces/{ws_id}/items/generate-note", json={
        "url": "",
    })
    assert resp.status_code == 400


def test_localhost_with_port_passes(client):
    """localhost 带端口（如 http://localhost:8000/a.mp4）应通过校验。"""
    c, store, _ = client
    ws_id = _create_ws(store)

    sniff_result = SniffResult(primary_type="video", possible_types=["video"], platform=None)
    with patch.object(ws_module, "sniff_url", return_value=sniff_result):
        resp = c.post(f"/workspaces/{ws_id}/items/generate-note", json={
            "url": "http://localhost:8000/a.mp4",
        })
    assert resp.status_code == 200


def test_ip_address_passes(client):
    """IP 地址 URL（如 http://192.168.1.1/video.mp4）应通过校验。"""
    c, store, _ = client
    ws_id = _create_ws(store)

    sniff_result = SniffResult(primary_type="video", possible_types=["video"], platform=None)
    with patch.object(ws_module, "sniff_url", return_value=sniff_result):
        resp = c.post(f"/workspaces/{ws_id}/items/generate-note", json={
            "url": "http://192.168.1.1/video.mp4",
        })
    assert resp.status_code == 200


# ── 4. GET /note 从 results["images"] 返回 media.images ──────────

def test_get_note_returns_images_from_results(client):
    """note API 应优先使用 results['images']（下载的图片路径列表）作为 media.images。"""
    c, store, tmp_path = client
    ws_id = _create_ws(store)

    # 创建真实文件让 to_static_url 能转成 /static/ URL
    img_dir = tmp_path / "workspaces" / ws_id / "videos"
    img_dir.mkdir(parents=True)
    (img_dir / "xhs_001.jpg").write_bytes(b"\xff\xd8")
    (img_dir / "xhs_002.jpg").write_bytes(b"\xff\xd8")

    item = WorkspaceItem(
        item_id="img_001",
        type="image",
        source="url",
        source_value="https://www.xiaohongshu.com/explore/test",
        name="测试图文",
        results={
            "markdown": "图文内容",
            "images": [
                str(img_dir / "xhs_001.jpg"),
                str(img_dir / "xhs_002.jpg"),
            ],
        },
    )
    store.add_item(ws_id, item)

    resp = c.get(f"/workspaces/{ws_id}/items/img_001/note")
    assert resp.status_code == 200
    data = resp.json()

    # media.images 应包含 2 张图（转成 /static/ URL）
    assert "images" in data["media"]
    assert len(data["media"]["images"]) == 2
    assert all(img.startswith("/static/") for img in data["media"]["images"])


def test_get_note_image_fallback_to_source_value(client):
    """无 results['images'] 时，image 类型应回退到 source_value。"""
    c, store, _ = client
    ws_id = _create_ws(store)

    item = WorkspaceItem(
        item_id="img_002",
        type="image",
        source="url",
        source_value="https://example.com/photo.jpg",
        name="普通图片",
        results={},
    )
    store.add_item(ws_id, item)

    resp = c.get(f"/workspaces/{ws_id}/items/img_002/note")
    assert resp.status_code == 200
    data = resp.json()

    assert data["media"]["images"] == ["https://example.com/photo.jpg"]


def test_intent_and_note_media_kind_in_payload(client):
    """generate-note payload 应包含 intent 和 note_media_kind。"""
    c, store, _ = client
    ws_id = _create_ws(store)

    sniff_result = SniffResult(
        primary_type="text",
        possible_types=["text"],
        platform="xiaohongshu",
    )
    with patch.object(ws_module, "sniff_url", return_value=sniff_result):
        resp = c.post(f"/workspaces/{ws_id}/items/generate-note", json={
            "url": "https://www.xiaohongshu.com/explore/683f6b75000000001c010bb3",
            "intent": "note",
            "note_media_kind": "image_text",
        })

    assert resp.status_code == 200

    created_payload = ws_module._pipeline_runner.create_task.call_args.args[2]
    assert created_payload["intent"] == "note"
    assert created_payload["note_media_kind"] == "image_text"


def test_replica_generate_note_payload_and_preflight(client):
    """逐帧复刻入口应写入 item.preflight，并把复刻参数透传给 pipeline。"""
    c, store, _ = client
    ws_id = _create_ws(store)

    sniff_result = SniffResult(
        primary_type="video",
        possible_types=["video"],
        platform="bilibili",
    )
    with patch.object(ws_module, "sniff_url", return_value=sniff_result):
        resp = c.post(f"/workspaces/{ws_id}/items/generate-note", json={
            "url": "https://www.bilibili.com/video/BV1xx",
            "intent": "replica",
            "replica_kind": "prompt",
            "image_mode": "replica_prompt",
            "frame_interval": 15,
            "vision_model": "provider/model",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["item_type"] == "video"

    ws = store.get(ws_id)
    assert ws is not None
    item = ws.items[0]
    assert item.preflight is not None
    assert item.preflight.intent == "replica"

    created_payload = ws_module._pipeline_runner.create_task.call_args.args[2]
    assert created_payload["intent"] == "replica"
    assert created_payload["replica_kind"] == "prompt"
    assert created_payload["preflight"]["intent"] == "replica"
    assert created_payload["preflight"]["image_mode"] == "replica_prompt"
    assert created_payload["preflight"]["frame_prompt"]["interval_sec"] == 15
    assert created_payload["vision_model"] == "provider/model"


def test_intent_defaults_to_note(client):
    """不传 intent/note_media_kind 时应使用默认值。"""
    c, store, _ = client
    ws_id = _create_ws(store)

    sniff_result = SniffResult(
        primary_type="video",
        possible_types=["video"],
        platform="bilibili",
    )
    with patch.object(ws_module, "sniff_url", return_value=sniff_result):
        resp = c.post(f"/workspaces/{ws_id}/items/generate-note", json={
            "url": "https://www.bilibili.com/video/BV1xx",
        })

    assert resp.status_code == 200

    created_payload = ws_module._pipeline_runner.create_task.call_args.args[2]
    assert created_payload["intent"] == "note"
    assert created_payload["note_media_kind"] == "auto"


def test_summary_hint_in_note_response(client):
    """note API 返回 summary_hint（content_category + default_template）。"""
    c, store, _ = client
    ws_id = _create_ws(store)

    item = WorkspaceItem(
        item_id="img_hint",
        type="image",
        source="url",
        source_value="https://example.com/photo.jpg",
        name="图文笔记",
        results={
            "content_category": "tool_recommendation",
            "default_summary_template": "tool_recommendation",
        },
    )
    store.add_item(ws_id, item)

    resp = c.get(f"/workspaces/{ws_id}/items/img_hint/note")
    assert resp.status_code == 200
    data = resp.json()

    assert data["summary_hint"]["content_category"] == "tool_recommendation"
    assert data["summary_hint"]["default_template"] == "tool_recommendation"
