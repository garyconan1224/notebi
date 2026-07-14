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


def test_task_runner_preserves_partial_terminal_status_and_result(tmp_path: Path) -> None:
    store = TaskStore(path=tmp_path / "tasks.json")
    runner = TaskRunner(store, max_workers=1)
    callback_task_ids: list[str] = []
    runner.register_partial_callback(
        "partial-check",
        lambda record, _runner: callback_task_ids.append(record.task_id),
    )

    def handler(record: TaskRecord, r: TaskRunner):
        result = {
            "transcript": "转录已完成",
            "partial_failure": {
                "stage": "diarization",
                "code": "model_unavailable",
                "message": "说话人分析不可用",
            },
        }
        r.store.update(
            record.task_id,
            status="PARTIAL",
            progress=1.0,
            result=result,
            error="说话人分析不可用",
        )
        return result

    runner.register("partial-check", handler)
    created = runner.create_task("p1", "partial-check", {})

    import time

    for _ in range(20):
        time.sleep(0.05)
        rec = store.get(created.task_id)
        if rec is not None and rec.status in TERMINAL_STATUS_VALUES:
            break

    rec = store.get(created.task_id)
    assert rec is not None
    assert rec.status == TaskStatus.PARTIAL.value
    assert rec.progress == 1.0
    assert rec.result["transcript"] == "转录已完成"
    assert rec.error == "说话人分析不可用"
    assert callback_task_ids == [created.task_id]


def test_retry_partial_audio_can_target_only_diarization(tmp_path: Path) -> None:
    store = TaskStore(path=tmp_path / "tasks.json")
    runner = TaskRunner(store, max_workers=1)
    runner._executor.submit = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    parent = TaskRecord(
        task_id="audio-partial-parent",
        project_id="p1",
        task_type="audio",
        status=TaskStatus.PARTIAL.value,
        payload={"source": "/tmp/interview.m4a", "voiceprint": {"enabled": True}},
        result={
            "transcript": "已保存的转录",
            "transcript_segments": [{"start": 0, "end": 1, "text": "已保存的转录"}],
            "partial_failure": {"stage": "diarization", "message": "模型失败"},
        },
    )
    store.create(parent)

    retried = runner.retry_task(parent.task_id, stage="diarization")

    assert retried.retry_of == parent.task_id
    assert retried.payload["_retry_stage"] == "diarization"
    assert retried.payload["_retry_source_task_id"] == parent.task_id
    assert parent.payload.get("_retry_stage") is None


def test_diarization_only_retry_accepts_success_audio_task(tmp_path: Path) -> None:
    store = TaskStore(path=tmp_path / "tasks.json")
    runner = TaskRunner(store, max_workers=1)
    parent = TaskRecord(
        task_id="audio-success-parent",
        project_id="p1",
        task_type="audio",
        status=TaskStatus.SUCCESS.value,
        payload={"source": "/tmp/interview.m4a"},
        result={
            "transcript": "已保存的转录",
            "transcript_segments": [{"start": 0, "end": 1, "text": "已保存的转录"}],
        },
    )
    store.create(parent)

    retried = runner.retry_task(parent.task_id, stage="diarization")
    assert retried.retry_of == parent.task_id
    assert retried.payload["_retry_stage"] == "diarization"
