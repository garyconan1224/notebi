"""Q3 / D3 / D4：媒体导出路由 + Obsidian 直写。

覆盖：原视频流式复制、软字幕打包、无媒体/无字幕的可操作错误、
ffmpeg 不可用错误、Obsidian 路径校验与同名策略。
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

import backend.app.routes.media_export as media_export_module
import backend.app.routes.workspaces as workspaces_module
from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


class _FakeTaskStore:
    def __init__(self):
        self.created = []

    def create(self, record):
        self.created.append(record)
        return record

    def update(self, task_id, **kwargs):
        return None

    def get(self, task_id):
        return None


class _FakeRunner:
    def __init__(self):
        self.store = _FakeTaskStore()


@pytest.fixture()
def setup(tmp_path: Path, monkeypatch: MonkeyPatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    store = WorkspaceStore(tmp_path / "workspaces")
    ws = WorkspaceRecord(workspace_id="ws-1", name="ws")

    # 本地视频文件（放在 data 目录下，模拟 /static 挂载）
    media_rel = "workspaces/ws-1/videos/movie.mp4"
    media_path = data_dir / media_rel
    media_path.parent.mkdir(parents=True)
    media_path.write_bytes(b"REAL-VIDEO-BYTES")

    video_item = WorkspaceItem(
        item_id="item-video",
        type="video",
        source="url",
        source_value="https://example.com/v",
        name="电影",
        results={
            "media": {"video": {"url": f"/static/{media_rel}", "duration": 10}},
            "transcript": [
                {"t_sec": 0, "text": "第一句"},
                {"t_sec": 2, "text": "第二句"},
            ],
        },
    )
    no_sub_item = WorkspaceItem(
        item_id="item-nosub",
        type="video",
        source="url",
        source_value="https://example.com/v2",
        name="无字幕",
        results={"media": {"video": {"url": f"/static/{media_rel}", "duration": 5}}},
    )
    no_media_item = WorkspaceItem(
        item_id="item-nomedia",
        type="video",
        source="url",
        source_value="https://example.com/v3",
        name="无媒体",
        results={},
    )
    ws.items.extend([video_item, no_sub_item, no_media_item])
    store.create(ws)

    monkeypatch.setattr(media_export_module, "_store", store)
    monkeypatch.setattr(media_export_module, "_pipeline_runner", _FakeRunner())
    monkeypatch.setattr(media_export_module, "DATA_DIR", data_dir)

    app = FastAPI()
    app.include_router(media_export_module.router)
    return TestClient(app), store, data_dir


def test_original_streams_local_media_without_reencode(setup):
    client, store, data_dir = setup
    resp = client.get("/workspaces/ws-1/items/item-video/media-export", params={"kind": "original"})
    assert resp.status_code == 200
    assert resp.content == b"REAL-VIDEO-BYTES"
    assert "attachment" in resp.headers.get("content-disposition", "")


def test_original_missing_media_actionable_error(setup):
    client, store, data_dir = setup
    resp = client.get("/workspaces/ws-1/items/item-nomedia/media-export", params={"kind": "original"})
    assert resp.status_code == 409
    assert "本地媒体文件不存在" in resp.json()["detail"]


def test_softsub_zip_contains_media_and_srt(setup):
    client, store, data_dir = setup
    resp = client.get(
        "/workspaces/ws-1/items/item-video/media-export",
        params={"kind": "softsub", "subtitle_format": "srt"},
    )
    assert resp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = zf.namelist()
        assert any(n.endswith(".mp4") for n in names)
        srt_name = next(n for n in names if n.endswith(".srt"))
        srt = zf.read(srt_name).decode("utf-8")
        assert "第一句" in srt


def test_softsub_without_transcript_actionable_error(setup):
    client, store, data_dir = setup
    resp = client.get(
        "/workspaces/ws-1/items/item-nosub/media-export",
        params={"kind": "softsub"},
    )
    assert resp.status_code == 409
    assert "没有可用字幕" in resp.json()["detail"]


def test_burn_rejects_when_ffmpeg_missing(setup, monkeypatch):
    client, store, data_dir = setup
    monkeypatch.setattr(media_export_module, "is_ffmpeg_available", lambda: False)
    resp = client.post("/workspaces/ws-1/items/item-video/media-export/burn", json={})
    assert resp.status_code == 409
    assert "ffmpeg" in resp.json()["detail"]


def test_burn_rejects_when_no_transcript(setup, monkeypatch):
    client, store, data_dir = setup
    monkeypatch.setattr(media_export_module, "is_ffmpeg_available", lambda: True)
    resp = client.post("/workspaces/ws-1/items/item-nosub/media-export/burn", json={})
    assert resp.status_code == 409
    assert "没有可用字幕" in resp.json()["detail"]


# ── Obsidian 直写（D3）─────────────────────────────────────────


@pytest.fixture()
def obsidian_setup(tmp_path: Path, monkeypatch: MonkeyPatch):
    store = WorkspaceStore(tmp_path / "workspaces")
    ws = WorkspaceRecord(workspace_id="ws-1", name="ws")
    item = WorkspaceItem(
        item_id="item-1", type="text", source="url",
        source_value="https://example.com", name="我的笔记",
        results={},
    )
    ws.items.append(item)
    store.create(ws)

    # 预置 note.md，跳过惰性组装
    notes_dir = tmp_path / "notes" / "item-1"
    notes_dir.mkdir(parents=True)
    (notes_dir / "note.md").write_text("---\ntitle: 我的笔记\n---\n\n# 正文\n\n内容", encoding="utf-8")

    monkeypatch.setattr(workspaces_module, "_store", store)
    monkeypatch.setattr(workspaces_module, "_canonical_note_owner", lambda w, i: "ws-1")
    monkeypatch.setattr(workspaces_module, "note_dir", lambda w, i: notes_dir)
    monkeypatch.setattr(workspaces_module, "_pipeline_runner", _FakeRunner())

    app = FastAPI()
    app.include_router(workspaces_module.router)
    vault = tmp_path / "vault"
    vault.mkdir()
    return TestClient(app), vault


def test_obsidian_direct_write_creates_file(obsidian_setup):
    client, vault = obsidian_setup
    resp = client.post(
        "/workspaces/ws-1/items/item-1/note/export/obsidian-vault",
        json={"vault_path": str(vault), "subdir": "Notes"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    written = Path(body["path"])
    assert written.exists()
    assert written.parent == vault / "Notes"
    assert "正文" in written.read_text(encoding="utf-8")


def test_obsidian_conflict_rename_vs_overwrite(obsidian_setup):
    client, vault = obsidian_setup
    first = client.post("/workspaces/ws-1/items/item-1/note/export/obsidian-vault", json={"vault_path": str(vault)})
    assert first.status_code == 200
    path1 = Path(first.json()["path"])

    # 默认 rename：第二次写入生成 -1 副本
    second = client.post("/workspaces/ws-1/items/item-1/note/export/obsidian-vault", json={"vault_path": str(vault)})
    path2 = Path(second.json()["path"])
    assert path2 != path1 and path2.exists()

    # overwrite：写回同名
    third = client.post(
        "/workspaces/ws-1/items/item-1/note/export/obsidian-vault",
        json={"vault_path": str(vault), "on_conflict": "overwrite"},
    )
    assert Path(third.json()["path"]) == path1
    assert third.json()["overwritten"] is True


def test_obsidian_rejects_path_traversal(obsidian_setup):
    client, vault = obsidian_setup
    resp = client.post(
        "/workspaces/ws-1/items/item-1/note/export/obsidian-vault",
        json={"vault_path": str(vault), "subdir": "../../etc"},
    )
    assert resp.status_code == 422


def test_obsidian_rejects_missing_vault(obsidian_setup):
    client, vault = obsidian_setup
    resp = client.post(
        "/workspaces/ws-1/items/item-1/note/export/obsidian-vault",
        json={"vault_path": str(vault / "not-exist")},
    )
    assert resp.status_code == 422
    assert "Vault 目录不存在" in resp.json()["detail"]


def test_settings_obsidian_roundtrip(tmp_path: Path, monkeypatch: MonkeyPatch):
    import shared.appearance_store as appearance_store_module
    from backend.app.routes.settings import router as settings_router

    monkeypatch.setattr(
        appearance_store_module, "SETTINGS_PATH", tmp_path / "appearance.json"
    )
    monkeypatch.setattr(appearance_store_module, "STORE_DIR", tmp_path)

    app = FastAPI()
    app.include_router(settings_router)
    client = TestClient(app)

    resp = client.patch("/settings", json={"obsidian": {"vault_path": "/tmp/v", "subdir": "Inbox", "direct_write": True}})
    assert resp.status_code == 200
    again = client.get("/settings").json()
    assert again["obsidian"] == {"vault_path": "/tmp/v", "subdir": "Inbox", "direct_write": True}
