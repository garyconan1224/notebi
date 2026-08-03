"""Q5：批量创建的自动类型与 probe 回写（反馈 #16）。

- 批量创建不得硬建 video：未识别条目落 unknown，识别过的按真实类型；
- note task 成功后把 probe 出的 note_kind 原子回写 canonical item.type；
- 回写必须持久（重启不回退视频），失败任务不回写。
"""

from __future__ import annotations

import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    from backend.app.services.task_batch_service import TaskBatchService
    from backend.app.services.task_batch_store import TaskBatchStore
    from backend.app.services.task_runner import TaskRunner
    from backend.app.services.task_store import TaskStore
    from backend.app.services.workspace_store import WorkspaceStore
    from backend.app.models.workspace import WorkspaceRecord
    from backend.app.routes import task_batches, workspaces
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
    workspace_store.create(WorkspaceRecord(workspace_id="ws-1", name="ws-1"))
    monkeypatch.setattr(
        "backend.app.routes.task_batches.get_default_batch_store", lambda: store
    )
    monkeypatch.setattr(
        "backend.app.routes.task_batches.get_batch_service", lambda: service
    )
    monkeypatch.setattr(
        "backend.app.routes.task_batches.get_workspace_store", lambda: workspace_store
    )
    monkeypatch.setattr(
        "backend.app.routes.task_batches.load_settings", lambda: AppSettings()
    )
    monkeypatch.setattr(workspaces, "_store", workspace_store)

    from backend.app.main import app

    with TestClient(app) as test_client:
        yield test_client, workspace_store


def _create_batch(client, items, settings=None):
    return client.post(
        "/pipeline/batches",
        json={
            "name": "Q5 批次",
            "source_type": "urls",
            "workspace_id": "ws-1",
            "start": False,
            "items": items,
            "settings": settings or {},
        },
    )


def test_batch_unknown_source_creates_unknown_item(client) -> None:
    test_client, workspace_store = client
    resp = _create_batch(
        test_client,
        [{"action": "process", "source_url": "https://example.com/x", "source_title": "未知"}],
        settings={"note_type": "auto"},
    )
    assert resp.status_code in (200, 201), resp.text
    items = workspace_store.get("ws-1").items
    assert len(items) == 1
    # 未识别来源不得硬建 video
    assert items[0].type == "unknown"


def test_batch_resolved_audio_source_creates_audio_item(client) -> None:
    test_client, workspace_store = client
    resp = _create_batch(
        test_client,
        [{
            "action": "process",
            "source_url": "https://example.com/a.m4a",
            "source_title": "音频",
            "item_type": "audio",
        }],
        settings={"note_type": "auto"},
    )
    assert resp.status_code in (200, 201), resp.text
    items = workspace_store.get("ws-1").items
    assert items[0].type == "audio"


def test_note_kind_maps_to_item_type() -> None:
    from backend.app.routes.workspaces import _note_kind_to_item_type

    assert _note_kind_to_item_type("video") == "video"
    assert _note_kind_to_item_type("audio") == "audio"
    assert _note_kind_to_item_type("image_text") == "image"
    assert _note_kind_to_item_type("mixed") == "image"
    assert _note_kind_to_item_type("text") == "text"
    # 未知 kind 不回写
    assert _note_kind_to_item_type("") is None
    assert _note_kind_to_item_type("weird") is None


def test_success_writeback_updates_item_type_persistently(client) -> None:
    test_client, workspace_store = client
    resp = _create_batch(
        test_client,
        [{"action": "process", "source_url": "https://example.com/x", "source_title": "未知"}],
        settings={"note_type": "auto"},
    )
    assert resp.status_code in (200, 201), resp.text
    item = workspace_store.get("ws-1").items[0]

    from backend.app.routes.workspaces import _on_note_success_sync_item

    task = SimpleNamespace(
        task_id="note-q5",
        retry_of="",
        payload={"workspace_id": "ws-1", "item_id": item.item_id},
        result={"note_kind": "audio", "workspace_id": "ws-1", "item_id": item.item_id},
    )
    # 关联任务与回写
    workspace_store.get("ws-1").items[0].related_task_ids = ["note-q5"]
    _on_note_success_sync_item(task, runner=None)

    reloaded = workspace_store.get("ws-1")
    updated = next(it for it in reloaded.items if it.item_id == item.item_id)
    assert updated.type == "audio"
    assert (updated.results or {}).get("type_probed") is True

    # 重新从磁盘加载（模拟重启）仍然保持回写后的类型
    from backend.app.services.workspace_store import WorkspaceStore

    fresh = WorkspaceStore(workspace_store.root)
    fresh_item = next(it for it in fresh.get("ws-1").items if it.item_id == item.item_id)
    assert fresh_item.type == "audio"


def test_writeback_skips_when_note_kind_missing(client) -> None:
    test_client, workspace_store = client
    resp = _create_batch(
        test_client,
        [{"action": "process", "source_url": "https://example.com/x", "source_title": "未知"}],
        settings={"note_type": "auto"},
    )
    assert resp.status_code in (200, 201), resp.text
    item = workspace_store.get("ws-1").items[0]
    workspace_store.get("ws-1").items[0].related_task_ids = ["note-q5b"]

    from backend.app.routes.workspaces import _on_note_success_sync_item

    task = SimpleNamespace(
        task_id="note-q5b",
        retry_of="",
        payload={"workspace_id": "ws-1", "item_id": item.item_id},
        result={"workspace_id": "ws-1", "item_id": item.item_id},
    )
    _on_note_success_sync_item(task, runner=None)

    updated = next(
        it for it in workspace_store.get("ws-1").items if it.item_id == item.item_id
    )
    # 无 probe 结果不得猜测类型（绝不静默变 video）
    assert updated.type == "unknown"
