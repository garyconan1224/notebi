"""Phase 3.1 TaskStatus 枚举与旧状态字符串兼容映射的单元测试。"""

from __future__ import annotations

import pytest

from backend.app.models.tasks import (
    LEGACY_STATUS_MAP,
    TERMINAL_STATUS_VALUES,
    TaskRecord,
    TaskStatus,
    coerce_status,
)


def test_task_status_members_are_strings_matching_names() -> None:
    """所有 Enum 成员都是 str 子类，且成员值等于成员名（大写）。"""
    for member in TaskStatus:
        assert isinstance(member.value, str)
        assert member.value == member.name
        # 由于继承 (str, Enum)，成员本身也应当是 str 实例
        assert isinstance(member, str)


def test_task_status_construct_from_value() -> None:
    """TaskStatus("PENDING") 能正确构造为 PENDING 成员。"""
    assert TaskStatus("PENDING") is TaskStatus.PENDING
    assert TaskStatus("SUCCESS") is TaskStatus.SUCCESS


def test_legacy_running_maps_to_download() -> None:
    """phase-1 早期 'running' 映射到新 DOWNLOAD（语义对齐 v1.1 §11）。"""
    assert LEGACY_STATUS_MAP["running"] == TaskStatus.DOWNLOAD


def test_legacy_done_maps_to_success() -> None:
    assert LEGACY_STATUS_MAP["done"] == TaskStatus.SUCCESS


def test_unknown_raw_raises_but_coerce_falls_back_to_pending() -> None:
    """未知旧状态值直接构造 TaskStatus 抛 ValueError；coerce_status 兜底为 PENDING。"""
    with pytest.raises(ValueError):
        TaskStatus("totally-unknown-status")
    assert coerce_status("totally-unknown-status") is TaskStatus.PENDING
    assert coerce_status(None) is TaskStatus.PENDING
    assert coerce_status("") is TaskStatus.PENDING


def test_legacy_succeeded_maps_to_success() -> None:
    """phase-2 生产数据里的 'succeeded' 必须被映射为 SUCCESS，不能兜底丢失。"""
    assert LEGACY_STATUS_MAP["succeeded"] == TaskStatus.SUCCESS
    assert coerce_status("succeeded") is TaskStatus.SUCCESS


def test_legacy_cancelled_maps_to_cancelled() -> None:
    """'cancelled'（小写）必须被映射为 CANCELLED，不能兜底到 PENDING。"""
    assert LEGACY_STATUS_MAP["cancelled"] == TaskStatus.CANCELLED
    assert coerce_status("cancelled") is TaskStatus.CANCELLED


def test_legacy_failed_maps_to_failed() -> None:
    """补充：'failed'（小写）作为实测生产值，也必须被覆盖。"""
    assert LEGACY_STATUS_MAP["failed"] == TaskStatus.FAILED
    assert coerce_status("failed") is TaskStatus.FAILED


def test_terminal_status_values_are_uppercase_strings() -> None:
    assert TERMINAL_STATUS_VALUES == frozenset({"SUCCESS", "FAILED", "CANCELLED"})


def test_task_record_from_dict_coerces_legacy_lowercase_status() -> None:
    """TaskRecord.from_dict 加载旧 JSON 条目时自动归一大小写。"""
    rec = TaskRecord.from_dict(
        {
            "task_id": "t1",
            "project_id": "p1",
            "task_type": "download",
            "payload": {},
            "status": "succeeded",
        }
    )
    assert rec.status == TaskStatus.SUCCESS.value == "SUCCESS"

    rec_failed = TaskRecord.from_dict({"task_id": "t2", "status": "failed"})
    assert rec_failed.status == TaskStatus.FAILED.value == "FAILED"

    rec_running = TaskRecord.from_dict({"task_id": "t3", "status": "running"})
    assert rec_running.status == TaskStatus.DOWNLOAD.value == "DOWNLOAD"

    rec_unknown = TaskRecord.from_dict({"task_id": "t4", "status": "garbage"})
    assert rec_unknown.status == TaskStatus.PENDING.value == "PENDING"


def test_task_record_to_dict_status_is_plain_string() -> None:
    """to_dict 返回的 status 必须是纯字符串值（不是 'TaskStatus.PENDING'）。"""
    rec = TaskRecord(task_id="t1", project_id="p1", task_type="download", payload={})
    payload = rec.to_dict()
    assert payload["status"] == "PENDING"
    # 模拟误把 Enum 成员直接赋给 status 的场景
    rec.status = TaskStatus.SUCCESS  # type: ignore[assignment]
    assert rec.to_dict()["status"] == "SUCCESS"

