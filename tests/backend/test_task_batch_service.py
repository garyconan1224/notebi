from __future__ import annotations

import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Callable

import pytest

from backend.app.models.task_batch import BatchItem
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
