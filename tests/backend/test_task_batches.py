"""S3 Task 7: 批次 API 测试。"""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    """创建隔离的测试客户端。"""
    from backend.app.services.task_batch_service import TaskBatchService
    from backend.app.services.task_batch_store import TaskBatchStore
    from backend.app.services.task_runner import TaskRunner
    from backend.app.services.task_store import TaskStore
    from backend.app.services.workspace_store import WorkspaceStore
    from backend.app.models.workspace import WorkspaceRecord
    from backend.app.routes import task_batches
    from shared.settings_store import AppSettings

    store = TaskBatchStore(tmp_path / "batch-data")
    task_store = TaskStore(tmp_path / "backend_tasks.json")
    runner = TaskRunner(task_store, max_workers=1)
    release = threading.Event()
    runner.register("note", lambda _record, _runner: (release.wait(timeout=2), {})[1])
    service = TaskBatchService(
        batch_store=store,
        runner=runner,
        concurrency_limit=lambda: 1,
        task_created=task_batches._link_created_task_to_workspace,
    )
    workspace_store = WorkspaceStore(tmp_path / "workspaces")
    for workspace_id in ("ws-1", "ws-a", "ws-b", "target-ws"):
        workspace_store.create(
            WorkspaceRecord(workspace_id=workspace_id, name=workspace_id)
        )
    monkeypatch.setattr(
        "backend.app.routes.task_batches.get_default_batch_store",
        lambda: store,
    )
    monkeypatch.setattr(
        "backend.app.routes.task_batches.get_batch_service",
        lambda: service,
    )
    monkeypatch.setattr(
        "backend.app.routes.task_batches.get_workspace_store",
        lambda: workspace_store,
    )
    monkeypatch.setattr(
        "backend.app.routes.task_batches.load_settings",
        lambda: AppSettings(),
    )

    from backend.app.main import app

    with TestClient(app) as test_client:
        test_client.app.state.batch_release = release
        test_client.app.state.batch_task_store = task_store
        test_client.app.state.batch_workspace_store = workspace_store
        yield test_client
    release.set()
    runner._executor.shutdown(wait=True)


# ── 预览 ─────────────────────────────────────────────────────────────────────


def test_preview_returns_items(client: TestClient) -> None:
    """预览返回项。"""
    resp = client.post(
        "/pipeline/batches/preview",
        json={"urls": ["https://example.com/1", "https://example.com/2"]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2


def test_preview_ids_are_stable_and_input_duplicates_are_collapsed(client: TestClient) -> None:
    payload = {
        "source_type": "urls",
        "urls": [
            "https://example.com/video/?utm_source=share",
            "https://example.com/video",
        ],
    }
    first = client.post("/pipeline/batches/preview", json=payload).json()
    second = client.post("/pipeline/batches/preview", json=payload).json()
    assert first == second
    assert first["total"] == 1


@pytest.mark.parametrize(
    "source_type",
    [
        "urls",
        "local_files",
        "bilibili_collection",
        "bilibili_favorites",
        "bilibili_uploader",
        "bilibili_parts",
        "youtube_playlist",
    ],
)
def test_preview_accepts_all_approved_source_types(
    client: TestClient,
    monkeypatch,
    source_type: str,
) -> None:
    monkeypatch.setattr(
        "backend.app.routes.task_batches.resolve_batch_sources",
        lambda **_kwargs: [
            {
                "source_url": f"https://example.com/{source_type}",
                "source_title": source_type,
                "external_id": f"id-{source_type}",
            }
        ],
    )
    response = client.post(
        "/pipeline/batches/preview",
        json={
            "source_type": source_type,
            "urls": ["https://example.com/source"],
            "local_files": ["/tmp/example.mp4"] if source_type == "local_files" else [],
        },
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["source_title"] == source_type


def test_preview_marks_existing_item_and_offers_copy(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
    from backend.app.routes import task_batches

    store = task_batches.get_workspace_store()
    store.create(
        WorkspaceRecord(
            workspace_id="source-ws",
            name="source",
            items=[
                WorkspaceItem(
                    item_id="existing-item",
                    type="video",
                    source="url",
                    source_value="https://example.com/video",
                    lineage_id="lineage-1",
                )
            ],
        )
    )
    response = client.post(
        "/pipeline/batches/preview",
        json={
            "source_type": "urls",
            "urls": ["https://example.com/video?utm_source=share"],
            "workspace_id": "target-ws",
        },
    )
    row = response.json()["items"][0]
    assert row["status"] == "exists_elsewhere"
    assert row["existing_workspace_id"] == "source-ws"
    assert row["existing_item_id"] == "existing-item"
    assert row["suggested_action"] == "copy"
    assert set(row["allowed_actions"]) == {"skip", "copy", "process"}


# ── 创建 ─────────────────────────────────────────────────────────────────────


def test_create_batch(client: TestClient) -> None:
    """创建批次。"""
    resp = client.post(
        "/pipeline/batches",
        json={
            "name": "test batch",
            "items": [
                {"batch_item_id": "i1", "source_url": "https://example.com/1"},
                {"batch_item_id": "i2", "source_url": "https://example.com/2"},
            ],
            "workspace_id": "ws-1",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "test batch"
    assert data["status"] in {"queued", "running"}
    assert len(data["items"]) == 2
    assert data["settings_snapshot"]["task_type"] == "note"
    assert data["settings_snapshot"]["note_style"] == "standard"
    assert data["settings_snapshot"]["note_type"] == "auto"
    assert data["settings_snapshot"]["diarize"] is False
    assert data["settings_snapshot"]["frame_analysis"] is True
    assert data["target_workspace_id"]


def test_create_batch_uses_saved_task_defaults(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.app.routes import task_batches
    from shared.settings_store import AppSettings, TaskDefaultsConfig

    monkeypatch.setattr(
        task_batches,
        "load_settings",
        lambda: AppSettings(
            task_defaults=TaskDefaultsConfig(
                summary_template="detailed",
                video_frame_analysis=False,
                frame_interval_sec=11,
                diarize=True,
                speaker_count=3,
            )
        ),
    )

    response = client.post(
        "/pipeline/batches",
        json={
            "name": "saved defaults",
            "workspace_id": "ws-1",
            "start": False,
            "items": [
                {
                    "batch_item_id": "saved-1",
                    "source_url": "https://example.com/saved",
                    "action": "process",
                }
            ],
        },
    )

    assert response.status_code == 200
    snapshot = response.json()["settings_snapshot"]
    assert snapshot["note_style"] == "detailed"
    assert snapshot["frame_analysis"] is False
    assert snapshot["frame_interval"] == 11
    assert snapshot["diarize"] is True
    assert snapshot["speaker_count"] == 3
    payload = snapshot["item_payloads"]["saved-1"]
    assert payload["summary_template"] == "detailed"
    assert payload["preflight"]["embed_frames"] is False
    assert payload["preflight"]["frame_prompt"]["interval_sec"] == 11
    assert payload["diarize"] is True
    assert payload["summary_mode"] == "speaker_aware"
    assert payload["speaker_count"] == 3


def test_create_batch_explicit_settings_override_saved_defaults(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.app.routes import task_batches
    from shared.settings_store import AppSettings, TaskDefaultsConfig

    monkeypatch.setattr(
        task_batches,
        "load_settings",
        lambda: AppSettings(
            task_defaults=TaskDefaultsConfig(
                summary_template="detailed",
                video_frame_analysis=False,
                frame_interval_sec=11,
                diarize=True,
                speaker_count=3,
            )
        ),
    )

    response = client.post(
        "/pipeline/batches",
        json={
            "name": "explicit defaults",
            "workspace_id": "ws-1",
            "start": False,
            "settings": {
                "note_style": "concise",
                "frame_analysis": True,
                "frame_interval": 7,
                "diarize": False,
                "speaker_count": None,
            },
            "items": [
                {
                    "batch_item_id": "explicit-1",
                    "source_url": "https://example.com/explicit",
                    "action": "process",
                }
            ],
        },
    )

    assert response.status_code == 200
    snapshot = response.json()["settings_snapshot"]
    assert snapshot["note_style"] == "concise"
    assert snapshot["frame_analysis"] is True
    assert snapshot["frame_interval"] == 7
    assert snapshot["diarize"] is False
    assert snapshot["speaker_count"] is None
    payload = snapshot["item_payloads"]["explicit-1"]
    assert payload["summary_mode"] == "general"


def test_create_batch_idempotent(client: TestClient) -> None:
    """幂等键重复返回原批次。"""
    payload = {
        "name": "idempotent",
        "items": [{"batch_item_id": "i1", "source_url": "https://example.com/1"}],
        "idempotency_key": "key-123",
    }
    resp1 = client.post("/pipeline/batches", json=payload)
    resp2 = client.post("/pipeline/batches", json=payload)
    assert resp1.json()["batch_id"] == resp2.json()["batch_id"]


def test_create_batch_rejects_invalid_settings_before_mutating_workspace(
    client: TestClient,
) -> None:
    response = client.post(
        "/pipeline/batches",
        json={
            "name": "invalid settings",
            "workspace_id": "ws-1",
            "settings": {"frame_interval": "not-a-number"},
            "items": [
                {"source_url": "https://example.com/1", "action": "process"},
            ],
        },
    )

    assert response.status_code == 422
    workspace = client.app.state.batch_workspace_store.get("ws-1")
    assert workspace is not None
    assert workspace.items == []


def test_create_batch_validates_all_actions_before_mutating_workspace(
    client: TestClient,
) -> None:
    response = client.post(
        "/pipeline/batches",
        json={
            "name": "invalid action",
            "workspace_id": "ws-1",
            "items": [
                {"source_url": "https://example.com/1", "action": "process"},
                {"source_url": "https://example.com/2", "action": "unknown"},
            ],
        },
    )

    assert response.status_code == 422
    workspace = client.app.state.batch_workspace_store.get("ws-1")
    assert workspace is not None
    assert workspace.items == []


def test_batch_tasks_complete_and_stay_linked_to_workspace_items(
    client: TestClient,
) -> None:
    response = client.post(
        "/pipeline/batches",
        json={
            "name": "linked batch",
            "workspace_id": "ws-1",
            "items": [
                {
                    "batch_item_id": "i1",
                    "source_url": "https://example.com/1",
                    "source_title": "第一条",
                },
                {
                    "batch_item_id": "i2",
                    "source_url": "https://example.com/2",
                    "source_title": "第二条",
                },
            ],
        },
    )
    assert response.status_code == 200
    batch_id = response.json()["batch_id"]
    client.app.state.batch_release.set()

    deadline = time.monotonic() + 3
    current = response.json()
    while time.monotonic() < deadline:
        current = client.get(f"/pipeline/batches/{batch_id}").json()
        if current["status"] == "completed":
            break
        time.sleep(0.01)

    assert current["status"] == "completed"
    assert current["completed_count"] == 2
    tasks = client.app.state.batch_task_store.list_all()
    assert len(tasks) == 2
    assert all(task.batch_id == batch_id for task in tasks)
    assert all(task.batch_item_id for task in tasks)
    assert all(task.payload.get("item_id") for task in tasks)
    assert len({task.payload["item_id"] for task in tasks}) == 2

    workspace = client.app.state.batch_workspace_store.get("ws-1")
    assert workspace is not None
    assert len(workspace.items) == 2
    assert {
        task_id
        for item in workspace.items
        for task_id in item.related_task_ids
    } == {task.task_id for task in tasks}


# ── 列表 ─────────────────────────────────────────────────────────────────────


def test_list_batches(client: TestClient) -> None:
    """列出批次。"""
    client.post("/pipeline/batches", json={"name": "b1", "items": []})
    client.post("/pipeline/batches", json={"name": "b2", "items": []})

    resp = client.get("/pipeline/batches")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2


def test_list_filters_apply_to_rows_and_total(client: TestClient) -> None:
    client.post(
        "/pipeline/batches",
        json={
            "name": "Bilibili Course",
            "source_type": "bilibili_collection",
            "workspace_id": "ws-a",
            "items": [],
        },
    )
    client.post(
        "/pipeline/batches",
        json={
            "name": "YouTube Playlist",
            "source_type": "youtube_playlist",
            "workspace_id": "ws-b",
            "items": [],
        },
    )
    response = client.get(
        "/pipeline/batches",
        params={"source": "youtube_playlist", "workspace_id": "ws-b", "keyword": "playlist"},
    )
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["batches"][0]["name"] == "YouTube Playlist"


# ── 详情 ─────────────────────────────────────────────────────────────────────


def test_get_batch(client: TestClient) -> None:
    """获取批次详情。"""
    create_resp = client.post("/pipeline/batches", json={"name": "detail", "items": []})
    batch_id = create_resp.json()["batch_id"]

    resp = client.get(f"/pipeline/batches/{batch_id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "detail"


def test_get_batch_includes_user_visible_task_progress_and_summary(client: TestClient) -> None:
    """批次详情一次返回阶段、可见进度与实际产出，不需要前端逐条补请求。"""
    from backend.app.models.tasks import TaskLogEntry, TaskRecord, TaskStatus
    from backend.app.routes import task_batches

    create_resp = client.post(
        "/pipeline/batches",
        json={
            "name": "transparent detail",
            "workspace_id": "ws-1",
            "start": False,
            "items": [{"batch_item_id": "detail-item", "source_url": "https://example.com/detail"}],
        },
    )
    batch_id = create_resp.json()["batch_id"]
    task = TaskRecord(
        task_id="detail-task",
        project_id="ws-1",
        task_type="note",
        status=TaskStatus.SUCCESS.value,
        progress=1.0,
        payload={"workspace_id": "ws-1", "item_id": "note-1"},
        result={"summary": "# 可见总结\n\n已经完成。"},
        log=[
            TaskLogEntry(ts="2026-07-29T00:00:00Z", level="info", message="正在生成总结"),
            TaskLogEntry(ts="2026-07-29T00:00:01Z", level="info", message="总结已保存"),
        ],
    )
    service = task_batches.get_batch_service()
    service.runner.store.create(task)
    batch = service.batch_store.get(batch_id)
    assert batch is not None
    batch.items[0].task_id = task.task_id
    batch.items[0].task_ids = [task.task_id]
    service.batch_store.save(batch)

    response = client.get(f"/pipeline/batches/{batch_id}")

    assert response.status_code == 200
    detail = response.json()["task_details"][task.task_id]
    assert detail["stage"] == "总结已保存"
    assert detail["visible_events"] == ["正在生成总结", "总结已保存"]
    assert detail["summary_preview"] == "# 可见总结\n\n已经完成。"
    assert detail["workspace_id"] == "ws-1"
    assert detail["item_id"] == "note-1"


def test_get_batch_not_found(client: TestClient) -> None:
    """批次不存在返回 404。"""
    resp = client.get("/pipeline/batches/nonexistent")
    assert resp.status_code == 404


# ── 暂停/恢复 ────────────────────────────────────────────────────────────────


def test_pause_and_resume(client: TestClient) -> None:
    """暂停和恢复。"""
    create_resp = client.post(
        "/pipeline/batches",
        json={"name": "pause-test", "items": [{"batch_item_id": "i1", "source_url": "x"}]},
    )
    batch_id = create_resp.json()["batch_id"]

    # 暂停
    pause_resp = client.post(f"/pipeline/batches/{batch_id}/pause")
    assert pause_resp.status_code == 200
    assert pause_resp.json()["status"] == "paused"

    # 恢复
    resume_resp = client.post(f"/pipeline/batches/{batch_id}/resume")
    assert resume_resp.status_code == 200
    assert resume_resp.json()["status"] in {"queued", "running"}


def test_pause_is_not_cancel(client: TestClient) -> None:
    """暂停不等于取消。"""
    create_resp = client.post(
        "/pipeline/batches",
        json={"name": "p", "items": [{"batch_item_id": "i1", "source_url": "x"}]},
    )
    batch_id = create_resp.json()["batch_id"]

    client.post(f"/pipeline/batches/{batch_id}/pause")
    resp = client.get(f"/pipeline/batches/{batch_id}")
    # 暂停只阻止后续调度；已经启动的项允许完成当前阶段，但绝不能被当作取消。
    assert resp.json()["items"][0]["status"] in {"pending", "running"}
    assert resp.json()["items"][0]["status"] != "cancelled"


# ── 取消 ─────────────────────────────────────────────────────────────────────


def test_cancel_batch(client: TestClient) -> None:
    """取消批次。"""
    create_resp = client.post(
        "/pipeline/batches",
        json={"name": "cancel-test", "items": [{"batch_item_id": "i1", "source_url": "x"}]},
    )
    batch_id = create_resp.json()["batch_id"]

    cancel_resp = client.post(f"/pipeline/batches/{batch_id}/cancel")
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "cancelled"


# ── 删除 ─────────────────────────────────────────────────────────────────────


def test_delete_terminal_batch(client: TestClient) -> None:
    """删除终态批次。"""
    create_resp = client.post(
        "/pipeline/batches",
        json={"name": "del-test", "items": [{"batch_item_id": "i1", "source_url": "x"}]},
    )
    batch_id = create_resp.json()["batch_id"]

    # 先取消变成终态
    client.post(f"/pipeline/batches/{batch_id}/cancel")

    # 删除
    del_resp = client.delete(f"/pipeline/batches/{batch_id}")
    assert del_resp.status_code == 200

    # 确认已删除
    get_resp = client.get(f"/pipeline/batches/{batch_id}")
    assert get_resp.status_code == 404


def test_delete_running_batch_fails(client: TestClient) -> None:
    """运行中批次不能删除。"""
    create_resp = client.post(
        "/pipeline/batches",
        json={"name": "running", "items": [{"batch_item_id": "i1", "source_url": "x"}]},
    )
    batch_id = create_resp.json()["batch_id"]

    del_resp = client.delete(f"/pipeline/batches/{batch_id}")
    assert del_resp.status_code == 409
