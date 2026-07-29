"""S3 Task 2: 批次模型。

批次状态由子任务推导：
- QUEUED: 全部等待
- RUNNING: 任意运行
- COMPLETED: 全部成功
- PARTIAL: 成功和失败并存
- FAILED: 全部失败
- CANCELLED: 用户取消
- PARTIAL_CANCELLED: 部分取消
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BatchStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PARTIAL_CANCELLED = "partial_cancelled"


class BatchSourceType(str, Enum):
    URLS = "urls"
    LOCAL_FILES = "local_files"
    BILIBILI = "bilibili"
    YOUTUBE = "youtube"
    DOUYIN = "douyin"


@dataclass
class BatchItem:
    """批次内单个项目。"""

    batch_item_id: str
    source_url: str = ""
    source_title: str = ""
    external_id: str = ""
    lineage_id: str = ""
    existing_workspace_id: str = ""
    existing_item_id: str = ""
    action: str = "process"  # process / skip / copy
    task_id: str = ""  # 关联的任务 ID
    task_ids: List[str] = field(default_factory=list)  # 同一逻辑项的全部 attempt
    status: str = "pending"  # pending / running / completed / failed / cancelled / skipped
    attempt_no: int = 1
    error: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BatchItem":
        current_task_id = str(data.get("task_id") or "")
        task_ids = [str(task_id) for task_id in data.get("task_ids") or [] if task_id]
        if current_task_id and current_task_id not in task_ids:
            task_ids.append(current_task_id)
        return cls(
            batch_item_id=str(data.get("batch_item_id") or ""),
            source_url=str(data.get("source_url") or ""),
            source_title=str(data.get("source_title") or ""),
            external_id=str(data.get("external_id") or ""),
            lineage_id=str(data.get("lineage_id") or ""),
            existing_workspace_id=str(data.get("existing_workspace_id") or ""),
            existing_item_id=str(data.get("existing_item_id") or ""),
            action=str(data.get("action") or "process"),
            task_id=current_task_id,
            task_ids=task_ids,
            status=str(data.get("status") or "pending"),
            attempt_no=int(data.get("attempt_no") or 1),
            error=str(data.get("error") or ""),
        )


@dataclass
class TaskBatch:
    """批量任务记录。"""

    batch_id: str
    name: str
    source_type: str = BatchSourceType.URLS.value
    target_workspace_id: str = ""
    items: List[BatchItem] = field(default_factory=list)
    status: str = BatchStatus.QUEUED.value
    # 设置快照
    settings_snapshot: Dict[str, Any] = field(default_factory=dict)
    # 聚合计数
    total_count: int = 0
    completed_count: int = 0
    failed_count: int = 0
    cancelled_count: int = 0
    skipped_count: int = 0
    # 时间
    created_at: str = field(default_factory=_now_iso)
    started_at: str = ""
    completed_at: str = ""
    # 暂停/取消标志
    pause_requested: bool = False
    cancel_requested: bool = False

    def to_dict(self) -> Dict[str, Any]:
        obj = asdict(self)
        obj["items"] = [item.to_dict() for item in self.items]
        return obj

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TaskBatch":
        items = [BatchItem.from_dict(item) for item in data.get("items") or []]
        return cls(
            batch_id=str(data.get("batch_id") or ""),
            name=str(data.get("name") or ""),
            source_type=str(data.get("source_type") or BatchSourceType.URLS.value),
            target_workspace_id=str(data.get("target_workspace_id") or ""),
            items=items,
            status=str(data.get("status") or BatchStatus.QUEUED.value),
            settings_snapshot=dict(data.get("settings_snapshot") or {}),
            total_count=int(data.get("total_count") or 0),
            completed_count=int(data.get("completed_count") or 0),
            failed_count=int(data.get("failed_count") or 0),
            cancelled_count=int(data.get("cancelled_count") or 0),
            skipped_count=int(data.get("skipped_count") or 0),
            created_at=str(data.get("created_at") or _now_iso()),
            started_at=str(data.get("started_at") or ""),
            completed_at=str(data.get("completed_at") or ""),
            pause_requested=bool(data.get("pause_requested") or False),
            cancel_requested=bool(data.get("cancel_requested") or False),
        )

    def recompute_status(self) -> str:
        """根据子项状态推导批次状态。"""
        if not self.items:
            return BatchStatus.QUEUED.value

        self.total_count = len(self.items)
        self.skipped_count = sum(
            1
            for item in self.items
            if item.action == "skip" or item.status == "skipped"
        )
        statuses = [item.status for item in self.items if item.action != "skip"]
        if not statuses:
            return BatchStatus.COMPLETED.value

        # 更新计数
        self.completed_count = sum(1 for s in statuses if s == "completed")
        self.failed_count = sum(1 for s in statuses if s == "failed")
        self.cancelled_count = sum(1 for s in statuses if s == "cancelled")

        # 推导状态
        if self.cancel_requested:
            if self.completed_count > 0:
                return BatchStatus.PARTIAL_CANCELLED.value
            return BatchStatus.CANCELLED.value

        if self.pause_requested:
            return BatchStatus.PAUSED.value

        if all(s == "pending" for s in statuses):
            return BatchStatus.QUEUED.value

        if any(s == "running" for s in statuses):
            return BatchStatus.RUNNING.value

        # 全部终态
        if all(s == "completed" for s in statuses):
            return BatchStatus.COMPLETED.value

        if all(s == "failed" for s in statuses):
            return BatchStatus.FAILED.value

        if self.completed_count > 0 and self.failed_count > 0:
            return BatchStatus.PARTIAL.value

        return BatchStatus.RUNNING.value

    def update_status(self) -> None:
        """重新计算并更新状态。"""
        self.status = self.recompute_status()
        if self.status in (BatchStatus.COMPLETED.value, BatchStatus.PARTIAL.value, 
                          BatchStatus.FAILED.value, BatchStatus.CANCELLED.value,
                          BatchStatus.PARTIAL_CANCELLED.value):
            if not self.completed_at:
                self.completed_at = _now_iso()
