from __future__ import annotations

"""Phase 1A — GET /workspaces 派生字段测试。

验证：
  happy path  — 新建 workspace 后列表和详情都含 5 个派生字段，四类计数齐全
  error path  — 查不存在的 workspace_id 返回 404
"""

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# ── 测试用隔离 App ────────────────────────────────────────────────────────────
# 直接构建一个轻量 FastAPI app，挂 workspaces router；
# 不启动 uvicorn，避免跑全部 lifespan 钩子（seed provider 等）。

from fastapi import FastAPI
from unittest.mock import MagicMock, patch

from backend.app.routes import workspaces as ws_module
from backend.app.models.tasks import TaskRecord, TaskStatus
from backend.app.models.workspace import PreflightConfig, WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path):
    """每个测试用独立临时目录的 WorkspaceStore，并 mock pipeline runner store。"""
    # 替换路由模块里的单例 store
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")

    # mock pipeline runner：store.get 全返回 None（无活跃任务）
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


# ── Happy path ────────────────────────────────────────────────────────────────


def test_list_workspaces_derived_fields_present(client: TestClient) -> None:
    """新建 workspace 后，GET /workspaces 返回条目含所有 Phase 1A 派生字段。"""
    # 新建
    resp = client.post("/workspaces", json={"name": "测试空间"})
    assert resp.status_code == 200

    # 列表
    resp = client.get("/workspaces")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    ws = items[0]

    # 派生字段存在
    assert "current_step" in ws
    assert "items_count_by_type" in ws
    assert "cover_thumbnail" in ws
    assert "last_active_at" in ws

    # current_step — 无活跃任务应为 null
    assert ws["current_step"] is None

    # cover_thumbnail — 无 video items 应为 null
    assert ws["cover_thumbnail"] is None

    # items_count_by_type — 四类都要有，初始全为 0
    counts = ws["items_count_by_type"]
    assert counts == {"video": 0, "audio": 0, "image": 0, "text": 0}

    # last_active_at 等于 updated_at
    assert ws["last_active_at"] == ws["updated_at"]


def test_get_workspace_derived_fields_present(client: TestClient) -> None:
    """GET /workspaces/{id} 详情也含派生字段。"""
    resp = client.post("/workspaces", json={"name": "详情测试"})
    ws_id = resp.json()["workspace_id"]

    resp = client.get(f"/workspaces/{ws_id}")
    assert resp.status_code == 200
    ws = resp.json()

    for key in ("current_step", "items_count_by_type", "cover_thumbnail", "last_active_at"):
        assert key in ws, f"缺少字段: {key}"


def test_resolve_batch_source_multi_url(client: TestClient) -> None:
    """多链接文本解析为 multi_url，不触发外部平台网络解析。"""
    resp = client.post(
        "/workspaces/batch-sources/resolve",
        json={
            "source": "\n".join([
                "https://www.youtube.com/watch?v=abc123",
                "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
            ])
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["source_type"] == "multi_url"
    assert len(data["items"]) == 2
    assert data["items"][1]["source_url"].endswith("?p=2")


def test_import_batch_source_creates_workspace_cover(client: TestClient) -> None:
    """批量导入的新合集应从首个条目的远端封面派生合集封面和素材封面。"""
    thumb = "https://i.ytimg.com/vi/abc123/hqdefault.jpg"
    resp = client.post(
        "/workspaces/batch-sources/import",
        json={
            "workspace_name": "批量测试合集",
            "source_type": "multi_url",
            "source_url": "",
            "start": False,
            "items": [
                {
                    "source_url": "https://www.youtube.com/watch?v=abc123",
                    "title": "第一条",
                    "platform": "youtube",
                    "index": 1,
                    "duration_seconds": 12,
                    "thumbnail": thumb,
                    "external_id": "abc123",
                }
            ],
        },
    )
    assert resp.status_code == 200
    workspace = resp.json()["workspace"]
    assert workspace["name"] == "批量测试合集"
    assert workspace["cover_thumbnail"] == thumb
    assert workspace["items"][0]["thumbnail"] == thumb


def test_items_count_by_type_after_adding_items(client: TestClient) -> None:
    """添加素材后，items_count_by_type 数字正确累加。"""
    resp = client.post("/workspaces", json={"name": "素材计数测试"})
    ws_id = resp.json()["workspace_id"]

    client.post(f"/workspaces/{ws_id}/items", json={"type": "video", "source": "url", "source_value": "https://example.com/a.mp4"})
    client.post(f"/workspaces/{ws_id}/items", json={"type": "video", "source": "url", "source_value": "https://example.com/b.mp4"})
    client.post(f"/workspaces/{ws_id}/items", json={"type": "image", "source": "local", "source_value": "/tmp/img.jpg"})

    resp = client.get(f"/workspaces/{ws_id}")
    counts = resp.json()["items_count_by_type"]
    assert counts["video"] == 2
    assert counts["image"] == 1
    assert counts["audio"] == 0
    assert counts["text"] == 0


def test_upload_item_persists_file_and_registers_item(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """上传本地文件后，应落盘并登记为 workspace local item。"""
    monkeypatch.setattr(
        ws_module,
        "WORKSPACE_UPLOAD_ROOT",
        tmp_path / "workspace_uploads",
        raising=False,
    )

    resp = client.post("/workspaces", json={"name": "上传测试"})
    ws_id = resp.json()["workspace_id"]

    payload = b"fake-video-bytes"
    files = {"file": ("hello world.mp4", io.BytesIO(payload), "video/mp4")}
    resp = client.post(f"/workspaces/{ws_id}/items/upload", files=files)

    assert resp.status_code == 200
    ws = resp.json()
    assert len(ws["items"]) == 1
    item = ws["items"][0]
    assert item["type"] == "video"
    assert item["source"] == "local"
    assert item["name"] == "hello_world.mp4"

    stored = Path(item["source_value"])
    assert stored.is_file()
    assert stored.read_bytes() == payload

    # N1.3 之后 DELETE 是软删除，文件保留；需 permanent 才会清理上传目录
    resp = client.delete(f"/workspaces/{ws_id}")
    assert resp.status_code == 200
    assert stored.exists(), "soft delete should not remove uploaded files"

    resp = client.delete(f"/workspaces/{ws_id}/permanent")
    assert resp.status_code == 200
    assert not stored.exists()


def test_upload_item_workspace_not_found(client: TestClient) -> None:
    """上传到不存在的 workspace 应返回 404。"""
    files = {"file": ("hello.mp4", io.BytesIO(b"video"), "video/mp4")}
    resp = client.post("/workspaces/missing/items/upload", files=files)

    assert resp.status_code == 404


def test_upload_item_rejects_empty_file(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """空文件不应落盘或登记为素材。"""
    upload_root = tmp_path / "workspace_uploads"
    monkeypatch.setattr(ws_module, "WORKSPACE_UPLOAD_ROOT", upload_root, raising=False)

    resp = client.post("/workspaces", json={"name": "空文件测试"})
    ws_id = resp.json()["workspace_id"]

    files = {"file": ("empty.txt", io.BytesIO(b""), "text/plain")}
    resp = client.post(f"/workspaces/{ws_id}/items/upload", files=files)

    assert resp.status_code == 400
    assert resp.json()["detail"] == "uploaded file cannot be empty"
    assert not any(p.is_file() for p in upload_root.rglob("*"))
    ws = client.get(f"/workspaces/{ws_id}").json()
    assert ws["items"] == []


def test_upload_item_rejects_oversized_file(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """超过上传上限的文件不应保留部分文件或登记为素材。"""
    upload_root = tmp_path / "workspace_uploads"
    monkeypatch.setattr(ws_module, "WORKSPACE_UPLOAD_ROOT", upload_root, raising=False)
    monkeypatch.setattr(ws_module, "MAX_UPLOAD_BYTES", 4, raising=False)

    resp = client.post("/workspaces", json={"name": "超限测试"})
    ws_id = resp.json()["workspace_id"]

    files = {"file": ("big.txt", io.BytesIO(b"12345"), "text/plain")}
    resp = client.post(f"/workspaces/{ws_id}/items/upload", files=files)

    assert resp.status_code == 413
    assert resp.json()["detail"] == "uploaded file exceeds 500MB limit"
    assert not any(p.is_file() for p in upload_root.rglob("*"))
    ws = client.get(f"/workspaces/{ws_id}").json()
    assert ws["items"] == []


# ── Phase 1E — 网络链接添加 ──────────────────────────────────────────────────


def test_add_url_item_happy_path(client: TestClient) -> None:
    """提交合法 http URL 时素材成功登记，并出现在工作空间详情里。"""
    ws_id = client.post("/workspaces", json={"name": "URL 测试"}).json()["workspace_id"]
    resp = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "type": "video",
            "source": "url",
            "source_value": "  https://www.bilibili.com/video/BV1xx411c7mD  ",
        },
    )
    assert resp.status_code == 200
    ws = resp.json()
    assert len(ws["items"]) == 1
    item = ws["items"][0]
    assert item["source"] == "url"
    # 校验通过后存储的是 strip 过的值
    assert item["source_value"] == "https://www.bilibili.com/video/BV1xx411c7mD"


@pytest.mark.parametrize(
    "bad_url,expected_keyword",
    [
        ("ftp://example.com/a.mp4", "http"),
        ("https://", "host"),
        ("   ", "empty"),
    ],
)
def test_add_url_item_rejects_invalid_url(
    client: TestClient, bad_url: str, expected_keyword: str
) -> None:
    """非 http(s) / 缺 host / 空白 URL 一律返回 400。

    F1.7 note: 缺 scheme 的纯文本（如 "not a url"）会被 _normalize_media_url
    自动补 https:// → 通过入口校验 → 下游 yt-dlp 报更具体的格式错误。
    """
    ws_id = client.post("/workspaces", json={"name": "URL 错误测试"}).json()[
        "workspace_id"
    ]
    resp = client.post(
        f"/workspaces/{ws_id}/items",
        json={"type": "video", "source": "url", "source_value": bad_url},
    )
    assert resp.status_code == 400
    assert expected_keyword in resp.json()["detail"].lower()
    # 错误请求不应留下任何 item
    ws = client.get(f"/workspaces/{ws_id}").json()
    assert ws["items"] == []


def test_bridge_audio_accepts_ip9_boolean_task_ids() -> None:
    """IP.9 audio task IDs from AddMaterialModal are booleans and must map through."""
    workspace = WorkspaceRecord(workspace_id="ws-audio", name="audio")
    item = WorkspaceItem(
        item_id="audio-1",
        type="audio",
        source="url",
        source_value="https://example.com/podcast.mp3",
        preflight=PreflightConfig(
            models={"text": "chat-model"},
            tasks={
                "asr_summary": True,
                "subtitle_file": True,
                "music_analysis": False,
                "vocal_separation": True,
                "music_transcribe": False,
                "prompt_generation": True,
            },
        ),
    )

    task_type, payload = ws_module._bridge_to_pipeline_payload(item, workspace)

    assert task_type == "audio"
    assert payload["text_model"] == "chat-model"
    assert payload["asr"] is True
    assert payload["srt"] is True
    assert payload["music"] is False
    assert payload["vocal_separation"] is True
    assert payload["music_transcribe"] is False
    assert payload["prompt_generation"] is True


def test_bridge_video_url_routes_to_note_task() -> None:
    """视频 URL 重新触发时应走 note task，避免 download 成功回调再创建 analyze task。"""
    workspace = WorkspaceRecord(workspace_id="ws-video", name="video")
    item = WorkspaceItem(
        item_id="video-1",
        type="video",
        source="url",
        source_value="https://example.com/video.mp4",
    )

    task_type, payload = ws_module._bridge_to_pipeline_payload(item, workspace)

    assert task_type == "note"
    assert payload["url"] == "https://example.com/video.mp4"
    assert payload["workspace_id"] == "ws-video"


def test_download_success_inherits_video_summary_preflight(tmp_path: Path) -> None:
    """URL video download -> analyze should carry IP.9 summary path settings."""
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")
    item = WorkspaceItem(
        item_id="video-1",
        type="video",
        source="url",
        source_value="https://example.com/video",
        name="video",
        related_task_ids=["download-1"],
        preflight=PreflightConfig(
            tasks={
                "preflight": {
                    "intent": "learning",
                    "background_for_recognition": "Pocket 4, D-Log M",
                },
                "summary": {
                    "enabled": True,
                    "path": "video_model",
                    "video_template": "访谈",
                },
            },
        ),
    )
    isolated_store.create(
        WorkspaceRecord(workspace_id="ws-video", name="video", items=[item])
    )
    completed = TaskRecord(
        task_id="download-1",
        project_id="default_project",
        task_type="download",
        payload={},
        status="SUCCESS",
        result={"save_path": "/tmp/downloaded-video.mp4"},
    )
    runner = MagicMock()
    runner.create_task.return_value = TaskRecord(
        task_id="analyze-1",
        project_id="default_project",
        task_type="analyze",
        payload={},
    )

    with patch.object(ws_module, "_store", isolated_store):
        ws_module._on_download_success(completed, runner)

    runner.create_task.assert_called_once()
    payload = runner.create_task.call_args.args[2]
    assert payload["video_basenames"] == ["downloaded-video.mp4"]
    assert payload["summary_path"] == "video_model"
    assert payload["video_template"] == "访谈"
    assert payload["intent"] == "learning"
    assert payload["background_for_recognition"] == "Pocket 4, D-Log M"
    assert isolated_store.get("ws-video").items[0].related_task_ids == [
        "download-1",
        "analyze-1",
    ]


# ── Error path ────────────────────────────────────────────────────────────────


def test_get_workspace_not_found(client: TestClient) -> None:
    """查不存在的 workspace_id 返回 404。"""
    resp = client.get("/workspaces/nonexistent-id")
    assert resp.status_code == 404


# ── Phase 1G: 视频结果页聚合接口 ─────────────────────────────────────────────


def test_get_item_result_returns_demo_fixture_when_results_empty(client: TestClient) -> None:
    """happy path：results 空时返回 demo fixture，含 frames + transcript + tracks_meta。"""
    ws_id = client.post("/workspaces", json={"name": "1G demo"}).json()["workspace_id"]
    add = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "type": "video",
            "source": "url",
            "source_value": "https://example.com/sample.mp4",
            "name": "示例视频",
        },
    ).json()
    item_id = add["items"][0]["item_id"]

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/result")
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "demo_fixture"
    assert body["video"]["item_id"] == item_id
    assert body["video"]["duration_sec"] > 0
    assert isinstance(body["frames"], list) and len(body["frames"]) >= 3
    assert isinstance(body["transcript"], list) and len(body["transcript"]) >= 3
    assert body["tracks_meta"]["frame_count"] == len(body["frames"])
    first_frame = body["frames"][0]
    for key in ("idx", "ts", "sec", "prompt_mj", "prompt_sd", "tags"):
        assert key in first_frame


def test_get_item_result_item_not_found(client: TestClient) -> None:
    """error path：item_id 不存在返回 404。"""
    ws_id = client.post("/workspaces", json={"name": "1G 404"}).json()["workspace_id"]
    resp = client.get(f"/workspaces/{ws_id}/items/nonexistent/result")
    assert resp.status_code == 404


# ── Phase X.1 状态桥（拉模式）────────────────────────────────────────


def _make_task(status: str, result: dict | None = None, updated_at: str = "2026-05-17T00:00:00+00:00"):
    t = MagicMock()
    t.status = status
    t.result = result or {}
    t.updated_at = updated_at
    return t


def test_sync_item_with_tasks_success_maps_to_done(tmp_path: Path) -> None:
    """SUCCESS 任务 → item.status=done，且 result 挂回 item.results。"""
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")
    mock_runner = MagicMock()
    tasks = {
        "t1": _make_task("DOWNLOAD", updated_at="2026-05-17T00:00:00+00:00"),
        "t2": _make_task("SUCCESS", result={"title": "x", "content": "y"},
                          updated_at="2026-05-17T01:00:00+00:00"),
    }
    mock_runner.store.get.side_effect = lambda tid: tasks.get(tid)

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", isolated_store),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            ws = c.post("/workspaces", json={"name": "bridge"}).json()
            ws_id = ws["workspace_id"]
            it = c.post(f"/workspaces/{ws_id}/items", json={
                "type": "text", "source": "url",
                "source_value": "https://example.com/a",
            }).json()
            item_id = it["items"][0]["item_id"]
            # 手动塞 related_task_ids（绕过 /start，避免依赖真实 pipeline）
            rec = isolated_store.get(ws_id)
            rec.items[0].related_task_ids = ["t1", "t2"]

            body = c.get(f"/workspaces/{ws_id}").json()
            it_out = body["items"][0]
            assert it_out["status"] == "done"
            assert it_out["results"] == {"title": "x", "content": "y"}
            # 没污染 store
            assert isolated_store.get(ws_id).items[0].status == "pending"
            assert isolated_store.get(ws_id).items[0].results == {}


def test_sync_item_with_tasks_running_maps_to_processing(tmp_path: Path) -> None:
    """非终结 task → item.status=processing。"""
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")
    mock_runner = MagicMock()
    mock_runner.store.get.return_value = _make_task("ASR")

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", isolated_store),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            ws_id = c.post("/workspaces", json={"name": "p"}).json()["workspace_id"]
            it = c.post(f"/workspaces/{ws_id}/items", json={
                "type": "text", "source": "url", "source_value": "https://example.com/b",
            }).json()
            isolated_store.get(ws_id).items[0].related_task_ids = ["t1"]
            body = c.get(f"/workspaces/{ws_id}").json()
            assert body["items"][0]["status"] == "processing"


def test_sync_item_with_tasks_failed_maps_to_failed(tmp_path: Path) -> None:
    """FAILED/CANCELLED → item.status=failed。"""
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")
    mock_runner = MagicMock()
    mock_runner.store.get.return_value = _make_task("FAILED")

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", isolated_store),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            ws_id = c.post("/workspaces", json={"name": "f"}).json()["workspace_id"]
            c.post(f"/workspaces/{ws_id}/items", json={
                "type": "text", "source": "url", "source_value": "https://example.com/c",
            })
            isolated_store.get(ws_id).items[0].related_task_ids = ["t1"]
            body = c.get(f"/workspaces/{ws_id}").json()
            assert body["items"][0]["status"] == "failed"


def test_note_retry_success_links_back_to_workspace_item(tmp_path: Path) -> None:
    """note retry SUCCESS 应补挂回原 item，库页可读到最新成功结果。"""
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")
    ws_id = "ws-retry-note"
    item_id = "item-note"
    isolated_store.create(WorkspaceRecord(workspace_id=ws_id, name="retry"))
    isolated_store.add_item(
        ws_id,
        WorkspaceItem(
            item_id=item_id,
            type="image",
            source="url",
            source_value="https://www.xiaohongshu.com/explore/retry-note",
            name="https://www.xiaohongshu.com/explore/retry-note",
            related_task_ids=["note-old"],
            status="failed",
        ),
    )

    old_task = TaskRecord(
        task_id="note-old",
        project_id="default_project",
        task_type="note",
        payload={},
        status=TaskStatus.FAILED.value,
    )
    new_task = TaskRecord(
        task_id="note-new",
        project_id="default_project",
        task_type="note",
        payload={},
        status=TaskStatus.SUCCESS.value,
        retry_of="note-old",
        result={"video_title": "新图文标题", "note_body": "ok"},
    )
    old_task.updated_at = "2026-05-17T00:00:00+00:00"
    new_task.updated_at = "2026-05-17T01:00:00+00:00"

    mock_runner = MagicMock()
    tasks = {"note-old": old_task, "note-new": new_task}
    mock_runner.store.get.side_effect = lambda tid: tasks.get(tid)

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", isolated_store),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
    ):
        app.include_router(ws_module.router)
        ws_module._on_note_success_write_title(new_task, mock_runner)
        with TestClient(app) as c:
            body = c.get(f"/workspaces/{ws_id}").json()

    item = isolated_store.get(ws_id).items[0]
    assert item.related_task_ids == ["note-old", "note-new"]
    assert item.name == "新图文标题"
    assert body["items"][0]["status"] == "done"
    assert body["items"][0]["results"]["note_body"] == "ok"


# ── Phase L1：资料库聚合端点 ──────────────────────────────────────────────


def test_library_empty(client: TestClient) -> None:
    """空库时 GET /workspaces/library 返回 200 + 空列表。"""
    resp = client.get("/workspaces/library")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"items": [], "workspaces": []}


def test_library_with_data(client: TestClient) -> None:
    """2 workspace × 各含 items → 字段齐全 + 数量正确。"""
    # ws1: 2 items (video + audio)
    ws1 = client.post("/workspaces", json={"name": "空间A"}).json()
    ws1_id = ws1["workspace_id"]
    client.post(
        f"/workspaces/{ws1_id}/items",
        json={"type": "video", "source": "url", "source_value": "https://example.com/v.mp4", "name": "视频1"},
    )
    client.post(
        f"/workspaces/{ws1_id}/items",
        json={"type": "audio", "source": "url", "source_value": "https://example.com/a.mp3", "name": "音频1"},
    )

    # ws2: 2 items (image + text)
    ws2 = client.post("/workspaces", json={"name": "空间B"}).json()
    ws2_id = ws2["workspace_id"]
    client.post(
        f"/workspaces/{ws2_id}/items",
        json={"type": "image", "source": "local", "source_value": "/tmp/img.jpg", "name": "图片1"},
    )
    client.post(
        f"/workspaces/{ws2_id}/items",
        json={"type": "text", "source": "url", "source_value": "https://example.com/article", "name": "文章1"},
    )

    resp = client.get("/workspaces/library")
    assert resp.status_code == 200
    body = resp.json()

    # 2 workspaces
    assert len(body["workspaces"]) == 2
    ws_out = {w["workspace_id"]: w for w in body["workspaces"]}
    assert ws_out[ws1_id]["name"] == "空间A"
    assert ws_out[ws1_id]["items_count"] == 2
    assert ws_out[ws1_id]["items_count_by_type"] == {"video": 1, "audio": 1, "image": 0, "text": 0}
    assert ws_out[ws2_id]["name"] == "空间B"
    assert ws_out[ws2_id]["items_count"] == 2
    assert ws_out[ws2_id]["items_count_by_type"] == {"video": 0, "audio": 0, "image": 1, "text": 1}
    for w in body["workspaces"]:
        assert "cover_thumbnail" in w
        assert "updated_at" in w
        assert "status" in w

    # 4 items 摊平
    assert len(body["items"]) == 4

    # 验证每个 item 的必需字段
    required_keys = {
        "item_id", "workspace_id", "workspace_name", "type", "source",
        "source_value", "name", "status", "created_at", "updated_at",
        "duration_seconds", "thumbnail", "results_summary", "primary_task_status",
    }
    for it in body["items"]:
        assert required_keys.issubset(it.keys()), f"缺字段: {required_keys - set(it.keys())}"
        assert "has_summary" in it["results_summary"]
        assert "has_transcript" in it["results_summary"]
        # image/text 无 duration
        if it["type"] in ("image", "text"):
            assert it["duration_seconds"] is None

    # workspace_name 正确反向带出
    by_ws = {}
    for it in body["items"]:
        by_ws.setdefault(it["workspace_id"], []).append(it)
    assert len(by_ws[ws1_id]) == 2
    for it in by_ws[ws1_id]:
        assert it["workspace_name"] == "空间A"
    assert len(by_ws[ws2_id]) == 2
    for it in by_ws[ws2_id]:
        assert it["workspace_name"] == "空间B"


def test_library_trashed_filter(client: TestClient) -> None:
    """默认排除 trashed workspace；include_trashed=true 时包含。"""
    # 正常 workspace
    ws1 = client.post("/workspaces", json={"name": "正常空间"}).json()
    ws1_id = ws1["workspace_id"]
    client.post(
        f"/workspaces/{ws1_id}/items",
        json={"type": "video", "source": "url", "source_value": "https://example.com/v.mp4"},
    )

    # trashed workspace
    ws2 = client.post("/workspaces", json={"name": "垃圾桶空间"}).json()
    ws2_id = ws2["workspace_id"]
    client.post(
        f"/workspaces/{ws2_id}/items",
        json={"type": "audio", "source": "url", "source_value": "https://example.com/a.mp3"},
    )
    client.delete(f"/workspaces/{ws2_id}")  # 软删除

    # 默认排除 trashed
    resp = client.get("/workspaces/library")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["workspaces"]) == 1
    assert body["workspaces"][0]["workspace_id"] == ws1_id
    assert len(body["items"]) == 1
    assert body["items"][0]["workspace_id"] == ws1_id

    # include_trashed=true
    resp = client.get("/workspaces/library?include_trashed=true")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["workspaces"]) == 2
    ws_ids = {w["workspace_id"] for w in body["workspaces"]}
    assert ws_ids == {ws1_id, ws2_id}
    assert len(body["items"]) == 2


def test_library_uses_task_overlay_for_duration_and_thumbnail(
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Library should surface merged task results for card duration and thumbnail."""
    data_root = tmp_path / "data"
    thumb = data_root / "videos" / "cover.jpg"
    thumb.parent.mkdir(parents=True)
    thumb.write_bytes(b"fake-thumbnail")
    monkeypatch.setattr(ws_module, "_ROOT_DIR", tmp_path)

    ws = client.post("/workspaces", json={"name": "结果叠加"}).json()
    ws_id = ws["workspace_id"]
    item = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "type": "video",
            "source": "url",
            "source_value": "https://example.com/v.mp4",
            "name": "视频",
        },
    ).json()["items"][0]
    item_id = item["item_id"]

    ws_module._store.update_item(
        ws_id,
        item_id,
        related_task_ids=["download-task", "analyze-task"],
    )
    tasks = {
        "download-task": TaskRecord(
            task_id="download-task",
            project_id=ws_id,
            task_type="download",
            payload={},
            status=TaskStatus.SUCCESS.value,
            result={"cover_thumbnail": str(thumb)},
            updated_at="2026-01-01T00:00:00+00:00",
        ),
        "analyze-task": TaskRecord(
            task_id="analyze-task",
            project_id=ws_id,
            task_type="analyze",
            payload={},
            status=TaskStatus.SUCCESS.value,
            result={"duration_sec": 42.5, "summary": "ok"},
            updated_at="2026-01-02T00:00:00+00:00",
        ),
    }
    ws_module._pipeline_runner.store.get.side_effect = lambda task_id: tasks.get(task_id)

    resp = client.get("/workspaces/library")
    assert resp.status_code == 200
    item_out = resp.json()["items"][0]
    assert item_out["duration_seconds"] == 42.5
    assert item_out["thumbnail"] == "/static/videos/cover.jpg"
    assert item_out["results_summary"]["has_summary"] is True
    assert item_out["primary_task_status"] == TaskStatus.SUCCESS.value


def test_library_materializes_replica_frames_from_json_outputs(
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """复刻卡片应从视觉 JSON 物化帧数，避免结果页有帧但库卡显示 0 帧。"""
    data_root = tmp_path / "data"
    json_dir = data_root / "workspaces" / "ws-replica" / "json_data"
    frames_dir = json_dir / "sample_分析报告" / "frames"
    frames_dir.mkdir(parents=True)
    frame_path = frames_dir / "sample_00_00_00.jpg"
    frame_path.write_bytes(b"fake-frame")
    json_path = json_dir / "sample_视觉数据.json"
    json_path.write_text(
        """
        {
          "frames": [
            {
              "timestamp": "00:00:00",
              "description_zh": "开场画面",
              "image_prompt_en": "opening frame"
            }
          ],
          "global_visual_summary": "视觉总结"
        }
        """,
        encoding="utf-8",
    )
    monkeypatch.setattr(ws_module, "_ROOT_DIR", tmp_path)

    ws = client.post("/workspaces", json={"workspace_id": "ws-replica", "name": "复刻合集", "kind": "replica"}).json()
    ws_id = ws["workspace_id"]
    item = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "type": "video",
            "source": "url",
            "source_value": "https://example.com/v.mp4",
            "name": "复刻视频",
        },
    ).json()["items"][0]
    item_id = item["item_id"]
    ws_module._store.update_item(
        ws_id,
        item_id,
        preflight=PreflightConfig(intent="replica"),
        results={
            "json_outputs": [str(json_path)],
            "json_output_basenames": ["sample"],
        },
    )

    resp = client.get("/workspaces/library")
    assert resp.status_code == 200
    item_out = resp.json()["items"][0]
    assert item_out["frames_count"] == 1
    assert item_out["primary_view"] == "replica"
    assert item_out["thumbnail"] == "/static/workspaces/ws-replica/json_data/sample_分析报告/frames/sample_00_00_00.jpg"


def test_library_task_overlay_enriches_existing_item_results(client: TestClient) -> None:
    """已有旧 results 时，最新 task metadata 仍应补回资料库标题和封面。"""
    ws = client.post("/workspaces", json={"name": "旧结果补封面"}).json()
    ws_id = ws["workspace_id"]
    item = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "type": "audio",
            "source": "url",
            "source_value": "https://www.bilibili.com/video/BV1xx1234",
            "name": "https://www.bilibili.com/video/BV1xx1234",
        },
    ).json()["items"][0]
    item_id = item["item_id"]

    ws_module._store.update_item(
        ws_id,
        item_id,
        related_task_ids=["audio-task"],
        results={"transcript": "old transcript"},
    )
    task = TaskRecord(
        task_id="audio-task",
        project_id=ws_id,
        task_type="audio",
        payload={},
        status=TaskStatus.SUCCESS.value,
        result={
            "video_title": "Codex 10个必装插件！实战演示",
            "video_thumbnail_url": "https://example.com/cover.jpg",
            "transcript": "new transcript",
        },
        updated_at="2026-01-02T00:00:00+00:00",
    )
    ws_module._pipeline_runner.store.get.side_effect = lambda task_id: task if task_id == "audio-task" else None

    resp = client.get("/workspaces/library")
    assert resp.status_code == 200
    item_out = resp.json()["items"][0]
    assert item_out["name"] == "Codex 10个必装插件！实战演示"
    assert item_out["thumbnail"] == "https://example.com/cover.jpg"
    assert item_out["results_summary"]["has_transcript"] is True


def test_library_audio_uses_filename_title_and_local_audio_thumbnail(
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """旧 audio result 只有 audio.filename 时，资料库仍应显示标题和同名封面。"""
    data_root = tmp_path / "data"
    audio_dir = data_root / "workspaces" / "default_project" / "audio"
    audio_dir.mkdir(parents=True)
    thumb = audio_dir / "Codex 10个必装插件.jpg"
    thumb.write_bytes(b"fake-thumbnail")
    monkeypatch.setattr(ws_module, "_ROOT_DIR", tmp_path)
    monkeypatch.setattr(ws_module, "DATA_DIR", data_root)

    ws = client.post("/workspaces", json={"name": "bilibili · Codex 10个必装插件"}).json()
    ws_id = ws["workspace_id"]
    item = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "type": "audio",
            "source": "url",
            "source_value": "https://www.bilibili.com/video/BV1xx1234",
            "name": "https://www.bilibili.com/video/BV1xx1234",
        },
    ).json()["items"][0]
    item_id = item["item_id"]
    ws_module._store.update_item(
        ws_id,
        item_id,
        results={
            "project_id": "default_project",
            "transcript": "old transcript",
            "audio": {"filename": "Codex 10个必装插件.mp4"},
        },
    )

    resp = client.get("/workspaces/library")
    assert resp.status_code == 200
    item_out = resp.json()["items"][0]
    assert item_out["name"] == "Codex 10个必装插件"
    assert item_out["thumbnail"] == "/static/workspaces/default_project/audio/Codex 10个必装插件.jpg"


def test_batch_delete_items_removes_valid_items_and_reports_failures(client: TestClient) -> None:
    """批量删除应删除合法 item，并返回失败条目供前端提示。"""
    ws = client.post("/workspaces", json={"name": "批量删除"}).json()
    ws_id = ws["workspace_id"]
    first = client.post(
        f"/workspaces/{ws_id}/items",
        json={"type": "video", "source": "url", "source_value": "https://example.com/a.mp4"},
    ).json()["items"][0]
    second = client.post(
        f"/workspaces/{ws_id}/items",
        json={"type": "audio", "source": "url", "source_value": "https://example.com/b.mp3"},
    ).json()["items"][1]

    resp = client.post(
        "/workspaces/items/batch-delete",
        json={
            "items": [
                {"workspace_id": ws_id, "item_id": first["item_id"]},
                {"workspace_id": ws_id, "item_id": "missing"},
                {"workspace_id": ws_id},
            ],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["removed"] == 1
    assert body["failed"] == 2
    assert body["removed_ids"] == [first["item_id"]]

    remaining = client.get(f"/workspaces/{ws_id}").json()["items"]
    assert [it["item_id"] for it in remaining] == [second["item_id"]]


# ── normalize_video_summary_path ────────────────────────────────────────────


def test_normalize_video_summary_path() -> None:
    """各中文/英文 summary_path 值规范化到 canonical 值。"""
    from backend.app.routes.workspaces import normalize_video_summary_path as n

    assert n("字幕直接总结") == "subtitle"
    assert n("只听字幕/音频转写") == "subtitle"
    assert n("subtitle") == "subtitle"

    assert n("音视频合并 · 最详细") == "av_combined"
    assert n("音视频综合") == "av_combined"
    assert n("detailed") == "av_combined"
    assert n("av_combined") == "av_combined"

    assert n("只看画面") == "visual_only"
    assert n("visual_only") == "visual_only"

    assert n("视频模型直接分析") == "video_model"
    assert n("video_model") == "video_model"

    assert n("") == ""
    assert n("unknown_value") == "unknown_value"


def test_augment_video_analyze_payload_r8_summary_path() -> None:
    """R8 新格式 summary.summary_path 应被读取并规范化。"""
    from backend.app.routes.workspaces import _augment_video_analyze_payload

    item = WorkspaceItem(
        item_id="v1", type="video", source="url",
        source_value="https://x.com/v", name="v",
        preflight=PreflightConfig(tasks={
            "summary": {"on": True, "summary_path": "音视频综合", "summary_depth": "详细"},
        }),
    )
    payload: dict = {}
    _augment_video_analyze_payload(payload, item)
    assert payload["summary_path"] == "av_combined"


def test_augment_video_analyze_payload_legacy_path_fallback() -> None:
    """旧格式 summary.path 仍兼容（fallback）。"""
    from backend.app.routes.workspaces import _augment_video_analyze_payload

    item = WorkspaceItem(
        item_id="v2", type="video", source="url",
        source_value="https://x.com/v", name="v",
        preflight=PreflightConfig(tasks={
            "summary": {"enabled": True, "path": "detailed"},
        }),
    )
    payload: dict = {}
    _augment_video_analyze_payload(payload, item)
    assert payload["summary_path"] == "av_combined"


def test_augment_video_analyze_payload_r8_frame_prompt_adaptation() -> None:
    """R8 frame_prompt 字段名（frame_mode/sec_per_frame/shot_frames）适配到 CaptureParams 可读字段。"""
    from backend.app.routes.workspaces import _augment_video_analyze_payload

    item = WorkspaceItem(
        item_id="v3", type="video", source="url",
        source_value="https://x.com/v", name="v",
        preflight=PreflightConfig(tasks={
            "frame_prompt": {
                "on": True,
                "frame_mode": "按秒截帧",
                "sec_per_frame": 5,
                "max_frames": 60,
            },
        }),
    )
    payload: dict = {}
    _augment_video_analyze_payload(payload, item)
    fp = payload.get("frame_prompt", {})
    assert fp.get("mode") == "interval"
    assert fp.get("interval_sec") == 5
    assert fp.get("max_frames") == 60
    assert "frame_mode" not in fp
    assert "sec_per_frame" not in fp


def test_augment_video_analyze_payload_r21_p3_preflight_fields() -> None:
    """R21.P3.S1 video intent / recognition background should reach analyze."""
    from backend.app.routes.workspaces import _augment_video_analyze_payload

    item = WorkspaceItem(
        item_id="v4", type="video", source="local",
        source_value="/tmp/local.mp4", name="v",
        preflight=PreflightConfig(tasks={
            "preflight": {
                "intent": "learning",
                "background_for_recognition": "课程专有名词 ABC",
            },
        }),
    )
    payload: dict = {}
    _augment_video_analyze_payload(payload, item)
    assert payload["intent"] == "learning"
    assert payload["background_for_recognition"] == "课程专有名词 ABC"


def test_bridge_local_video_preflight_reaches_note_payload() -> None:
    """Local-video AddMaterial preflight must reach the note task consumer shape."""
    from backend.app.routes.workspaces import _bridge_to_pipeline_payload

    item = WorkspaceItem(
        item_id="local-1",
        type="video",
        source="local",
        source_value="/tmp/demo.mp4",
        name="demo.mp4",
        preflight=PreflightConfig(
            background_overrides={"frame_interval_sec": 7},
            models={"vision": "vision-model", "text": "text-model"},
            tasks={
                "summary": {
                    "embed_frames": False,
                    "max_embed_frames": 5,
                    "summary_template": "concise",
                    "diarize": True,
                },
            },
        ),
    )
    ws = WorkspaceRecord(workspace_id="ws-1", name="合集", items=[item])

    task_type, payload = _bridge_to_pipeline_payload(item, ws)

    assert task_type == "note"
    assert payload["vision_model"] == "vision-model"
    assert payload["text_model"] == "text-model"
    assert payload["summary_template"] == "concise"
    assert payload["diarize"] is True
    assert payload["preflight"]["embed_frames"] is False
    assert payload["preflight"]["max_embed_frames"] == 5
    assert payload["preflight"]["frame_prompt"] == {
        "mode": "interval",
        "interval_sec": 7,
    }


# ── _video_result_has_real_data 新路径 ──────────────────────────────────────


def test_video_result_has_real_data_visual_only() -> None:
    """visual_only: frames 非空 list 即为真数据。"""
    assert ws_module._video_result_has_real_data({
        "summary_path": "visual_only",
        "frames": [{"frame_image": "f1.jpg"}],
    }) is True
    assert ws_module._video_result_has_real_data({
        "summary_path": "visual_only",
        "frames": [],
    }) is False


def test_video_result_has_real_data_av_combined() -> None:
    """av_combined: frames + (transcript 或 summary)。"""
    # 有 frames + transcript
    assert ws_module._video_result_has_real_data({
        "summary_path": "av_combined",
        "frames": [{"frame_image": "f1.jpg"}],
        "transcript": [{"t_sec": 0, "text": "hello"}],
    }) is True
    # 有 frames + summary
    assert ws_module._video_result_has_real_data({
        "summary_path": "av_combined",
        "frames": [{"frame_image": "f1.jpg"}],
        "summary": "combined result",
    }) is True
    # 只有 frames 不够
    assert ws_module._video_result_has_real_data({
        "summary_path": "av_combined",
        "frames": [{"frame_image": "f1.jpg"}],
    }) is False
