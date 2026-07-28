from __future__ import annotations

import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Callable

import pytest

from backend.app.models.task_batch import BatchItem, TaskBatch
from backend.app.services.task_batch_service import TaskBatchService
from backend.app.services.task_batch_store import TaskBatchStore
from backend.app.services.task_runner import TaskRunner
from backend.app.services.task_store import TaskStore


def _wait_until(predicate: Callable[[], bool], timeout: float = 3.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition did not become true before timeout")


@pytest.fixture()
def batch_system(tmp_path: Path):
    task_store = TaskStore(tmp_path / "backend_tasks.json")
    batch_store = TaskBatchStore(tmp_path / "batch-data")
    runner = TaskRunner(task_store, max_workers=1)
    releases: dict[str, threading.Event] = defaultdict(threading.Event)
    started: list[str] = []

    def handle_note(record, _runner):
        started.append(record.batch_item_id)
        releases[record.batch_item_id].wait(timeout=2)
        if record.payload.get("fail_first") and record.attempt_no == 1:
            raise RuntimeError("first attempt failed")
        return {"item": record.batch_item_id}

    runner.register("note", handle_note)
    service = TaskBatchService(
        batch_store=batch_store,
        runner=runner,
        concurrency_limit=lambda: 1,
    )
    yield service, batch_store, task_store, releases, started
    for event in releases.values():
        event.set()
    runner._executor.shutdown(wait=True)


def test_pause_stops_new_items_without_cancelling_running_task(batch_system) -> None:
    service, batch_store, task_store, releases, started = batch_system
    batch = service.create_batch(
        name="pause",
        target_workspace_id="ws-1",
        items=[
            BatchItem(batch_item_id="i1", source_url="https://example.com/1"),
            BatchItem(batch_item_id="i2", source_url="https://example.com/2"),
        ],
        settings_snapshot={},
    )
    _wait_until(lambda: started == ["i1"])

    service.pause(batch.batch_id)
    running = task_store.list_all()[0]
    assert running.cancel_requested is False

    releases["i1"].set()
    _wait_until(lambda: batch_store.get(batch.batch_id).items[0].status == "completed")
    paused = batch_store.get(batch.batch_id)
    assert paused.status == "paused"
    assert paused.items[1].status == "pending"
    assert len(task_store.list_all()) == 1

    service.resume(batch.batch_id)
    _wait_until(lambda: started == ["i1", "i2"])
    releases["i2"].set()


def test_cancel_requests_running_task_and_cancels_waiting_items(batch_system) -> None:
    service, batch_store, task_store, releases, started = batch_system
    batch = service.create_batch(
        name="cancel",
        target_workspace_id="ws-1",
        items=[
            BatchItem(batch_item_id="i1", source_url="https://example.com/1"),
            BatchItem(batch_item_id="i2", source_url="https://example.com/2"),
        ],
        settings_snapshot={},
    )
    _wait_until(lambda: started == ["i1"])

    service.cancel(batch.batch_id)
    current = batch_store.get(batch.batch_id)
    assert current.items[1].status == "cancelled"
    assert task_store.list_all()[0].cancel_requested is True

    releases["i1"].set()
    _wait_until(
        lambda: all(
            item.status == "cancelled"
            for item in batch_store.get(batch.batch_id).items
        )
    )
    assert batch_store.get(batch.batch_id).status == "cancelled"
    assert all(item.status == "cancelled" for item in batch_store.get(batch.batch_id).items)


def test_retry_failed_creates_a_new_attempt_in_same_batch_item(batch_system) -> None:
    service, batch_store, task_store, releases, started = batch_system
    batch = service.create_batch(
        name="retry",
        target_workspace_id="ws-1",
        items=[
            BatchItem(
                batch_item_id="i1",
                source_url="https://example.com/1",
            ),
        ],
        settings_snapshot={"fail_first": True},
    )
    _wait_until(lambda: started == ["i1"])
    releases["i1"].set()
    _wait_until(lambda: batch_store.get(batch.batch_id).status == "failed")

    first_task = task_store.list_all()[0]
    releases["i1"] = threading.Event()
    service.retry_failed(batch.batch_id)
    _wait_until(lambda: len(task_store.list_all()) == 2)
    second_task = max(task_store.list_all(), key=lambda record: record.attempt_no)

    assert second_task.batch_item_id == first_task.batch_item_id == "i1"
    assert second_task.batch_id == first_task.batch_id == batch.batch_id
    assert second_task.attempt_no == 2
    assert second_task.retry_of == first_task.task_id
    assert batch_store.get(batch.batch_id).items[0].task_ids == [
        first_task.task_id,
        second_task.task_id,
    ]
    releases["i1"].set()


def test_scheduler_gives_next_slot_to_another_batch(batch_system) -> None:
    service, _batch_store, _task_store, releases, started = batch_system
    service.create_batch(
        name="large",
        target_workspace_id="ws-1",
        items=[
            BatchItem(batch_item_id="a1", source_url="https://example.com/a1"),
            BatchItem(batch_item_id="a2", source_url="https://example.com/a2"),
        ],
        settings_snapshot={},
    )
    _wait_until(lambda: started == ["a1"])
    service.create_batch(
        name="small",
        target_workspace_id="ws-2",
        items=[BatchItem(batch_item_id="b1", source_url="https://example.com/b1")],
        settings_snapshot={},
    )

    releases["a1"].set()
    _wait_until(lambda: len(started) == 2)
    assert started == ["a1", "b1"]
    releases["b1"].set()
    _wait_until(lambda: started == ["a1", "b1", "a2"])
    releases["a2"].set()


def test_copy_item_uses_copy_callback_without_creating_pipeline_task(tmp_path: Path) -> None:
    task_store = TaskStore(tmp_path / "tasks.json")
    batch_store = TaskBatchStore(tmp_path / "batches")
    runner = TaskRunner(task_store, max_workers=1)
    copied: list[tuple[str, str, str]] = []
    service = TaskBatchService(
        batch_store=batch_store,
        runner=runner,
        concurrency_limit=lambda: 1,
        copy_item=lambda source_workspace_id, source_item_id, target_workspace_id: copied.append(
            (source_workspace_id, source_item_id, target_workspace_id)
        ),
    )

    batch = service.create_batch(
        name="copy",
        target_workspace_id="target",
        items=[
            BatchItem(
                batch_item_id="copy-1",
                source_url="https://example.com/1",
                action="copy",
                existing_workspace_id="source",
                existing_item_id="item-1",
            )
        ],
        settings_snapshot={},
    )

    assert copied == [("source", "item-1", "target")]
    assert batch.items[0].status == "completed"
    assert task_store.list_all() == []
    runner._executor.shutdown(wait=True)


def test_retry_rejects_nonterminal_batch(batch_system) -> None:
    service, _batch_store, _task_store, _releases, started = batch_system
    batch = service.create_batch(
        name="still running",
        target_workspace_id="ws-1",
        items=[BatchItem(batch_item_id="i1", source_url="https://example.com/1")],
        settings_snapshot={},
    )
    _wait_until(lambda: started == ["i1"])

    with pytest.raises(ValueError, match="terminal"):
        service.retry_failed(batch.batch_id)


def test_restart_marks_orphaned_running_attempt_failed(tmp_path: Path) -> None:
    task_store = TaskStore(tmp_path / "tasks.json")
    batch_store = TaskBatchStore(tmp_path / "batches")
    persisted = TaskBatch(
        batch_id="b-restart",
        name="restart",
        target_workspace_id="ws",
        items=[
            BatchItem(
                batch_item_id="i1",
                source_url="https://example.com/1",
                task_id="missing-task",
                task_ids=["missing-task"],
                status="running",
            )
        ],
        status="running",
    )
    batch_store.save(persisted)
    runner = TaskRunner(task_store, max_workers=1)
    runner.register("note", lambda _record, _runner: {})

    TaskBatchService(
        batch_store=batch_store,
        runner=runner,
        concurrency_limit=lambda: 1,
    )

    recovered = batch_store.get("b-restart")
    assert recovered is not None
    assert recovered.items[0].status == "failed"
    assert "重启" in recovered.items[0].error
    assert recovered.status == "failed"
    runner._executor.shutdown(wait=True)


def test_retry_carries_forward_verified_workspace_item(batch_system) -> None:
    service, batch_store, task_store, releases, started = batch_system
    batch = service.create_batch(
        name="resume",
        target_workspace_id="ws-1",
        items=[BatchItem(batch_item_id="i1", source_url="https://example.com/1")],
        settings_snapshot={"fail_first": True},
    )
    _wait_until(lambda: started == ["i1"])
    first = task_store.list_all()[0]
    task_store.update(
        first.task_id,
        result={"item_id": "workspace-item-1", "video_path": "/tmp/media.mp4"},
    )
    releases["i1"].set()
    _wait_until(lambda: batch_store.get(batch.batch_id).status == "failed")

    releases["i1"] = threading.Event()
    service.retry_failed(batch.batch_id)
    _wait_until(lambda: len(task_store.list_all()) == 2)
    retry = max(task_store.list_all(), key=lambda record: record.attempt_no)
    assert retry.payload["item_id"] == "workspace-item-1"
    assert retry.payload["video_path"] == "/tmp/media.mp4"
    assert retry.payload["_resume_from_task_id"] == first.task_id
    releases["i1"].set()
