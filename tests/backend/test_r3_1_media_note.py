from __future__ import annotations

"""R3.1 — to_static_url helper + image item GET /note media 测试。

验证：
  to_static_url  — data 内文件→/static/... URL；data 外→''；/static/ 开头→原样；缺失→''
  image /note    — GET …/note 返回 media.images 为 /static URL 列表
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore


# ── to_static_url 单测 ────────────────────────────────────────────────────────


class TestToStaticUrl:
    """to_static_url 路径转 URL 的各种情况。"""

    def test_path_inside_data_dir(self, tmp_path: Path) -> None:
        """data 目录下文件存在 → /static/ 相对路径。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        target = data_dir / "workspaces" / "ws1" / "images" / "photo.jpg"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"\x89PNG")

        with patch.object(ws_module, "DATA_DIR", data_dir):
            url = ws_module.to_static_url(str(target))
        assert url == "/static/workspaces/ws1/images/photo.jpg"

    def test_path_outside_data_dir(self, tmp_path: Path) -> None:
        """data 目录外的路径 → 空串。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        outside = tmp_path / "other" / "file.jpg"
        outside.parent.mkdir(parents=True)
        outside.write_bytes(b"\x89PNG")

        with patch.object(ws_module, "DATA_DIR", data_dir):
            url = ws_module.to_static_url(str(outside))
        assert url == ""

    def test_path_file_not_exist(self, tmp_path: Path) -> None:
        """data 目录下但文件不存在 → 空串。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        missing = data_dir / "workspaces" / "ws1" / "images" / "gone.jpg"

        with patch.object(ws_module, "DATA_DIR", data_dir):
            url = ws_module.to_static_url(str(missing))
        assert url == ""

    def test_already_static_prefix(self) -> None:
        """已经以 /static/ 开头 → 原样返回。"""
        assert ws_module.to_static_url("/static/workspaces/ws1/images/a.jpg") == "/static/workspaces/ws1/images/a.jpg"

    def test_empty_path(self) -> None:
        """空路径 → 空串。"""
        assert ws_module.to_static_url("") == ""

    def test_path_object_input(self, tmp_path: Path) -> None:
        """接受 Path 对象输入。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        target = data_dir / "audio" / "clip.mp3"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"ID3")

        with patch.object(ws_module, "DATA_DIR", data_dir):
            url = ws_module.to_static_url(target)
        assert url == "/static/audio/clip.mp3"

    def test_relative_path_under_data_dir(self, tmp_path: Path) -> None:
        """相对路径（如 workspaces/ws1/images/a.png）按 DATA_DIR/相对路径 解析。"""
        data_dir = tmp_path / "data"
        target = data_dir / "workspaces" / "ws1" / "images" / "a.png"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"\x89PNG")

        with patch.object(ws_module, "DATA_DIR", data_dir):
            url = ws_module.to_static_url("workspaces/ws1/images/a.png")
        assert url == "/static/workspaces/ws1/images/a.png"

    def test_relative_path_not_exist(self, tmp_path: Path) -> None:
        """相对路径但文件不存在 → 空串。"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        with patch.object(ws_module, "DATA_DIR", data_dir):
            url = ws_module.to_static_url("workspaces/ws1/images/missing.png")
        assert url == ""


# ── image GET /note media 测试 ─────────────────────────────────────────────────


@pytest.fixture()
def client(tmp_path: Path):
    """每个测试用独立临时目录的 WorkspaceStore，并 mock pipeline runner store。"""
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")
    mock_runner = MagicMock()
    mock_runner.store.get.return_value = None

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", isolated_store),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            yield c


def test_image_item_note_returns_media_images(client: TestClient, tmp_path: Path) -> None:
    """上传 image 素材后，GET /…/note 返回 media.images 含可访问 /static URL。"""
    # 准备 data 目录结构
    data_dir = tmp_path / "data"
    data_dir.mkdir(exist_ok=True)

    # 创建 workspace
    resp = client.post("/workspaces", json={"name": "image-test"})
    assert resp.status_code == 200
    ws_id = resp.json()["workspace_id"]

    # 手动创建 image 文件（模拟上传后落盘）
    img_dir = data_dir / "workspaces" / ws_id / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    img_file = img_dir / "test.png"
    img_file.write_bytes(b"\x89PNG fake image data")

    # 添加 image item（source_value 用本地路径）
    resp = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "type": "image",
            "source": "local",
            "source_value": str(img_file),
        },
    )
    assert resp.status_code == 200
    item_id = resp.json()["items"][-1]["item_id"]

    # 给 item 写入 results（模拟分析完成后）
    store = ws_module._store
    rec = store.get(ws_id)
    item = next(i for i in rec.items if i.item_id == item_id)
    item.results = {
        "description": "一张测试图片",
        "ocr_text": "hello",
        "tags": {},
    }

    # PATCH DATA_DIR 让 to_static_url 指向 tmp_path
    with patch.object(ws_module, "DATA_DIR", data_dir):
        resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/note")

    assert resp.status_code == 200
    data = resp.json()
    assert "media" in data
    assert "transcript" in data
    # image 类型应返回 images 列表
    assert isinstance(data["media"]["images"], list)
    assert len(data["media"]["images"]) == 1
    assert data["media"]["images"][0].startswith("/static/")
    assert "test.png" in data["media"]["images"][0]


def test_url_image_item_note_returns_external_url(client: TestClient) -> None:
    """URL 来源的 image 素材，GET /…/note 返回 media.images 为外部 URL。"""
    resp = client.post("/workspaces", json={"name": "url-image-test"})
    ws_id = resp.json()["workspace_id"]

    resp = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "type": "image",
            "source": "url",
            "source_value": "https://example.com/photo.jpg",
        },
    )
    item_id = resp.json()["items"][-1]["item_id"]

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/note")
    assert resp.status_code == 200
    data = resp.json()
    assert data["media"]["images"] == ["https://example.com/photo.jpg"]


def test_video_item_note_prefers_result_video_file(client: TestClient, tmp_path: Path) -> None:
    """video note 的播放器 URL 应优先使用 results.video_file，而不是扫目录最新文件。"""
    data_dir = tmp_path / "data"
    ws_id = "video-note-ws"
    video_dir = data_dir / "workspaces" / ws_id / "videos"
    video_dir.mkdir(parents=True)
    preferred = video_dir / "preferred.mp4"
    unrelated = video_dir / "unrelated-newer.mp4"
    preferred.write_bytes(b"preferred")
    unrelated.write_bytes(b"unrelated")

    resp = client.post("/workspaces", json={"name": "video-note", "workspace_id": ws_id})
    # create endpoint ignores supplied workspace_id, so use returned id for consistency
    ws_id = resp.json()["workspace_id"]
    video_dir = data_dir / "workspaces" / ws_id / "videos"
    video_dir.mkdir(parents=True, exist_ok=True)
    preferred = video_dir / "preferred.mp4"
    unrelated = video_dir / "unrelated-newer.mp4"
    preferred.write_bytes(b"preferred")
    unrelated.write_bytes(b"unrelated")

    resp = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "type": "video",
            "source": "url",
            "source_value": "https://example.com/video",
        },
    )
    item_id = resp.json()["items"][-1]["item_id"]

    rec = ws_module._store.get(ws_id)
    item = next(i for i in rec.items if i.item_id == item_id)
    item.results = {
        "video_file": str(preferred),
        "duration": 12,
    }

    with patch.object(ws_module, "DATA_DIR", data_dir):
        resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/note")

    assert resp.status_code == 200
    data = resp.json()
    assert data["media"]["video"]["url"].endswith("/preferred.mp4")
    assert "unrelated-newer.mp4" not in data["media"]["video"]["url"]


# ── k-8.2/8.3: transcript 规范化 + 落盘兜底 ────────────────────────────────────


class TestNoteTranscript:
    """字幕统一规范成 [{t_sec,t_str,text}] + 重启后从 transcript.json 兜底。"""

    def test_normalize_start_end_to_t_sec(self) -> None:
        """transcriber 段格式 {start,end} → {t_sec,t_str}（修复字段名对不上前端）。"""
        from backend.app.services.note_assembler import normalize_transcript

        out = normalize_transcript(
            [
                {"start": 0.0, "end": 21.72, "text": "第一段"},
                {"start": 21.72, "end": 33.78, "text": "第二段"},
            ]
        )
        assert out == [
            {"t_sec": 0.0, "t_str": "00:00", "text": "第一段"},
            {"t_sec": 21.72, "t_str": "00:21", "text": "第二段"},
        ]

    def test_normalize_string_fallback(self) -> None:
        """纯字符串 → 单行 t_sec=0（无时间码降级，但仍是 list 不是 str）。"""
        from backend.app.services.note_assembler import normalize_transcript

        out = normalize_transcript("整段文本")
        assert out == [{"t_sec": 0.0, "t_str": "00:00", "text": "整段文本"}]
        assert normalize_transcript("") == []

    def test_note_transcript_persists_and_survives_restart(self, tmp_path: Path) -> None:
        """内存有 → 落盘 transcript.json；内存清空（模拟重启）→ 从盘恢复带时间码字幕。"""
        nd = tmp_path / "notes" / "item-x"
        results = {
            "transcript_segments": [
                {"start": 0.0, "end": 10.0, "text": "A"},
                {"start": 21.72, "end": 30.0, "text": "B"},
            ]
        }
        out = ws_module._note_transcript(results, nd)
        assert len(out) == 2 and out[1]["t_str"] == "00:21"
        assert (nd / "transcript.json").exists()

        # 模拟后端重启：item.results 丢失 → 仍能从落盘恢复
        out2 = ws_module._note_transcript({}, nd)
        assert out2 == out

    def test_note_transcript_empty_when_nothing(self, tmp_path: Path) -> None:
        """内存空 + 无落盘 → 返回空 list（前端显示"暂无字幕"，不报错）。"""
        out = ws_module._note_transcript({}, tmp_path / "notes" / "none")
        assert out == []
