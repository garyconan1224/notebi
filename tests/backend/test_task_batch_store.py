"""S3 Task 1-2: 任务批次模型和存储测试。"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.app.models.task_batch import BatchItem, BatchStatus, TaskBatch
from backend.app.models.tasks import TaskRecord
from backend.app.services.task_batch_store import TaskBatchStore


# ── Task 1: 任务身份扩展 ─────────────────────────────────────────────────────


def test_task_record_batch_fields_default() -> None:
    """旧任务 JSON 无批次字段仍可加载。"""
    data = {
        "task_id": "t1",
        "project_id": "p1",
        "task_type": "pipeline",
        "payload": {},
    }
    task = TaskRecord.from_dict(data)
    assert task.batch_id == ""
    assert task.batch_item_id == ""
    assert task.attempt_no == 1


def test_task_record_batch_fields_round_trip() -> None:
    """新任务可保存/读回批次字段。"""
    task = TaskRecord(
        task_id="attempt-2",
        project_id="p1",
        task_type="pipeline",
        payload={},
        batch_id="batch-1",
        batch_item_id="item-1",
        attempt_no=2,
        retry_of="attempt-1",
    )
    data = task.to_dict()
    restored = TaskRecord.from_dict(data)
    assert restored.batch_id == "batch-1"
    assert restored.batch_item_id == "item-1"
    assert restored.attempt_no == 2
    assert restored.retry_of == "attempt-1"


# ── Task 2: 批次模型 ─────────────────────────────────────────────────────────


def test_batch_status_all_pending() -> None:
    """全部等待 → QUEUED。"""
    batch = TaskBatch(
        batch_id="b1",
        name="test",
        items=[
            BatchItem(batch_item_id="i1", status="pending"),
            BatchItem(batch_item_id="i2", status="pending"),
        ],
    )
    assert batch.recompute_status() == BatchStatus.QUEUED.value


def test_batch_status_all_skipped_is_completed() -> None:
    batch = TaskBatch(
        batch_id="b-skipped",
        name="skipped",
        items=[
            BatchItem(batch_item_id="i1", action="skip", status="skipped"),
            BatchItem(batch_item_id="i2", action="skip", status="skipped"),
        ],
    )

    assert batch.recompute_status() == BatchStatus.COMPLETED.value
    assert batch.skipped_count == 2


def test_batch_status_any_running() -> None:
    """任意运行 → RUNNING。"""
    batch = TaskBatch(
        batch_id="b1",
        name="test",
        items=[
            BatchItem(batch_item_id="i1", status="running"),
            BatchItem(batch_item_id="i2", status="pending"),
        ],
    )
    assert batch.recompute_status() == BatchStatus.RUNNING.value


def test_batch_status_all_completed() -> None:
    """全部成功 → COMPLETED。"""
    batch = TaskBatch(
        batch_id="b1",
        name="test",
        items=[
            BatchItem(batch_item_id="i1", status="completed"),
            BatchItem(batch_item_id="i2", status="completed"),
        ],
    )
    assert batch.recompute_status() == BatchStatus.COMPLETED.value


def test_batch_status_partial() -> None:
    """成功和失败并存 → PARTIAL。"""
    batch = TaskBatch(
        batch_id="b1",
        name="test",
        items=[
            BatchItem(batch_item_id="i1", status="completed"),
            BatchItem(batch_item_id="i2", status="failed"),
        ],
    )
    assert batch.recompute_status() == BatchStatus.PARTIAL.value


def test_batch_status_all_failed() -> None:
    """全部失败 → FAILED。"""
    batch = TaskBatch(
        batch_id="b1",
        name="test",
        items=[
            BatchItem(batch_item_id="i1", status="failed"),
            BatchItem(batch_item_id="i2", status="failed"),
        ],
    )
    assert batch.recompute_status() == BatchStatus.FAILED.value


def test_batch_status_cancelled() -> None:
    """用户取消 → CANCELLED。"""
    batch = TaskBatch(
        batch_id="b1",
        name="test",
        cancel_requested=True,
        items=[
            BatchItem(batch_item_id="i1", status="cancelled"),
            BatchItem(batch_item_id="i2", status="pending"),
        ],
    )
    assert batch.recompute_status() == BatchStatus.CANCELLED.value


def test_batch_status_partial_cancelled() -> None:
    """部分取消（有成功）→ PARTIAL_CANCELLED。"""
    batch = TaskBatch(
        batch_id="b1",
        name="test",
        cancel_requested=True,
        items=[
            BatchItem(batch_item_id="i1", status="completed"),
            BatchItem(batch_item_id="i2", status="cancelled"),
        ],
    )
    assert batch.recompute_status() == BatchStatus.PARTIAL_CANCELLED.value


def test_batch_round_trip() -> None:
    """批次序列化/反序列化。"""
    batch = TaskBatch(
        batch_id="b1",
        name="test batch",
        source_type="urls",
        target_workspace_id="ws-1",
        items=[
            BatchItem(batch_item_id="i1", source_url="https://example.com/1"),
            BatchItem(batch_item_id="i2", source_url="https://example.com/2"),
        ],
        settings_snapshot={"note_style": "detailed"},
    )
    data = batch.to_dict()
    restored = TaskBatch.from_dict(data)
    assert restored.batch_id == "b1"
    assert restored.name == "test batch"
    assert len(restored.items) == 2
    assert restored.settings_snapshot == {"note_style": "detailed"}


# ── Task 2: 批次存储 ─────────────────────────────────────────────────────────


@pytest.fixture()
def store(tmp_path: Path) -> TaskBatchStore:
    return TaskBatchStore(tmp_path)


def test_store_save_and_get(store: TaskBatchStore) -> None:
    """保存和获取。"""
    batch = TaskBatch(batch_id="b1", name="test")
    store.save(batch)
    retrieved = store.get("b1")
    assert retrieved is not None
    assert retrieved.name == "test"


def test_store_persistence(tmp_path: Path) -> None:
    """重启后仍能读取。"""
    store1 = TaskBatchStore(tmp_path)
    store1.save(TaskBatch(batch_id="b1", name="persisted"))

    store2 = TaskBatchStore(tmp_path)
    assert store2.get("b1") is not None
    assert store2.get("b1").name == "persisted"


def test_store_list(store: TaskBatchStore) -> None:
    """列表和过滤。"""
    store.save(TaskBatch(batch_id="b1", name="a", status="queued"))
    store.save(TaskBatch(batch_id="b2", name="b", status="completed"))
    store.save(TaskBatch(batch_id="b3", name="c", status="queued"))

    all_batches = store.list()
    assert len(all_batches) == 3

    queued = store.list(status="queued")
    assert len(queued) == 2


def test_store_delete_terminal_only(store: TaskBatchStore) -> None:
    """只能删除终态批次。"""
    store.save(TaskBatch(batch_id="b1", name="running", status="running"))
    store.save(TaskBatch(batch_id="b2", name="done", status="completed"))

    assert store.delete("b1") is False  # 运行中不能删
    assert store.delete("b2") is True  # 终态可以删
    assert store.get("b2") is None
