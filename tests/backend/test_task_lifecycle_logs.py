import threading
import time

from backend.app.models.tasks import TaskStatus
from backend.app.services.runtime_log_store import RuntimeLogStore
from backend.app.services.task_runner import TaskRunner
from backend.app.services.task_store import TaskStore


def _wait_terminal(runner: TaskRunner, task_id: str):
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        record = runner.store.get(task_id)
        if record and record.status in {
            TaskStatus.SUCCESS.value,
            TaskStatus.FAILED.value,
            TaskStatus.CANCELLED.value,
        }:
            return record
        time.sleep(0.01)
    raise AssertionError("task did not finish")


def test_task_success_and_failure_write_structured_standard_events(tmp_path) -> None:
    event_store = RuntimeLogStore(tmp_path / "logs")
    task_store = TaskStore(tmp_path / "backend_tasks.json")
    runner = TaskRunner(task_store, max_workers=1, event_sink=event_store)
    runner.register("ok", lambda _record, _runner: {"ok": True})
    runner.register("fail", lambda _record, _runner: (_ for _ in ()).throw(RuntimeError("boom")))

    success = runner.create_task(
        "ws-1",
        "ok",
        {},
        batch_id="batch-1",
    )
    failed = runner.create_task("ws-2", "fail", {})
    _wait_terminal(runner, success.task_id)
    _wait_terminal(runner, failed.task_id)

    events = event_store.query(limit=100).entries
    success_events = [event for event in events if event.task_id == success.task_id]
    failed_events = [event for event in events if event.task_id == failed.task_id]
    assert [event.stage for event in success_events] == [
        "created",
        "started",
        "succeeded",
    ]
    assert success_events[-1].batch_id == "batch-1"
    assert success_events[-1].workspace_id == "ws-1"
    assert failed_events[-1].stage == "failed"
    assert failed_events[-1].level == "ERROR"


def test_cancel_writes_cancelled_not_succeeded(tmp_path) -> None:
    event_store = RuntimeLogStore(tmp_path / "logs")
    task_store = TaskStore(tmp_path / "backend_tasks.json")
    runner = TaskRunner(task_store, max_workers=1, event_sink=event_store)
    release = threading.Event()
    runner.register(
        "blocked",
        lambda _record, _runner: release.wait(timeout=1) or {"ok": True},
    )
    record = runner.create_task("ws-1", "blocked", {})
    runner.cancel_task(record.task_id)
    release.set()
    _wait_terminal(runner, record.task_id)

    stages = [
        event.stage
        for event in event_store.query(limit=100).entries
        if event.task_id == record.task_id
    ]
    assert "cancelled" in stages
    assert "succeeded" not in stages


def test_real_task_failures_write_actionable_diagnostic_codes(tmp_path) -> None:
    event_store = RuntimeLogStore(tmp_path / "logs")
    task_store = TaskStore(tmp_path / "backend_tasks.json")
    runner = TaskRunner(task_store, max_workers=1, event_sink=event_store)
    runner.register("audio", lambda _record, _runner: (_ for _ in ()).throw(RuntimeError("decode failed")))
    runner.register("note", lambda _record, _runner: (_ for _ in ()).throw(RuntimeError("metadata unavailable")))

    audio = runner.create_task("ws-audio", "audio", {"source_type": "local"})
    bilibili = runner.create_task(
        "ws-bili",
        "note",
        {"url": "https://www.bilibili.com/video/BV1example"},
    )
    _wait_terminal(runner, audio.task_id)
    _wait_terminal(runner, bilibili.task_id)

    events = event_store.query(limit=100).entries
    audio_event = next(event for event in events if event.task_id == audio.task_id and event.event_code)
    bili_event = next(event for event in events if event.task_id == bilibili.task_id and event.event_code)
    assert audio_event.event_code == "asr_failed"
    assert bili_event.event_code == "bilibili_meta_failed"
    assert audio_event.probable_cause and audio_event.suggested_action
