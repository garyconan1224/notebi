from __future__ import annotations

from pathlib import Path

from backend.app.models.tasks import TERMINAL_STATUS_VALUES, TaskRecord, TaskStatus
from backend.app.services.task_runner import TaskRunner
from backend.app.services.task_store import TaskStore


def test_task_lifecycle_create_and_retry(tmp_path: Path) -> None:
    store = TaskStore(path=tmp_path / "tasks.json")
    runner = TaskRunner(store, max_workers=1)

    def handler(record: TaskRecord, _runner: TaskRunner):
        return {"ok": record.task_id}

    runner.register("dummy", handler)
    created = runner.create_task("p1", "dummy", {"x": 1})
    assert created.status in (TaskStatus.PENDING.value, TaskStatus.DOWNLOAD.value)

    # wait briefly for worker
    import time

    time.sleep(0.3)
    done = store.get(created.task_id)
    assert done is not None
    assert done.status in (
        TaskStatus.SUCCESS.value,
        TaskStatus.DOWNLOAD.value,
        TaskStatus.PENDING.value,
    )

    retried = runner.retry_task(created.task_id)
    assert retried.retry_of == created.task_id


def test_task_runner_exposes_append_log(tmp_path: Path) -> None:
    store = TaskStore(path=tmp_path / "tasks.json")
    runner = TaskRunner(store, max_workers=1)

    captured: list[str] = []

    def handler(record: TaskRecord, r: TaskRunner):
        r.append_log(record.task_id, "handler info")
        r.append_log(record.task_id, "handler warn", level="warning")
        captured.append("ran")
        return {"ok": True}

    runner.register("log-check", handler)
    created = runner.create_task("p1", "log-check", {})

    import time

    for _ in range(20):
        time.sleep(0.05)
        rec = store.get(created.task_id)
        if rec is not None and rec.status in TERMINAL_STATUS_VALUES:
            break

    rec = store.get(created.task_id)
    assert rec is not None
    assert rec.status == TaskStatus.SUCCESS.value, rec.error
    messages = [entry.message for entry in rec.log]
    levels = [entry.level for entry in rec.log]
    assert "handler info" in messages
    assert "handler warn" in messages
    assert "warning" in levels
