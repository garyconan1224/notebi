from __future__ import annotations

from collections.abc import Callable
import threading
import uuid
from typing import Any

from backend.app.models.task_batch import BatchItem, BatchStatus, TaskBatch
from backend.app.models.tasks import TaskRecord, TaskStatus
from backend.app.services.task_batch_store import TaskBatchStore
from backend.app.services.task_runner import TaskRunner


class TaskBatchService:
    """批次与真实 pipeline 任务之间的生命周期协调器。"""

    def __init__(
        self,
        *,
        batch_store: TaskBatchStore,
        runner: TaskRunner,
        concurrency_limit: Callable[[], int],
        copy_item: Callable[[str, str, str], Any] | None = None,
        task_created: Callable[[TaskBatch, BatchItem, TaskRecord], Any] | None = None,
        event_sink: Any | None = None,
    ) -> None:
        self.batch_store = batch_store
        self.runner = runner
        self.concurrency_limit = concurrency_limit
        self.copy_item = copy_item
        self.task_created = task_created
        self.event_sink = event_sink
        self._lock = threading.RLock()
        self._batch_order: list[str] = []
        self._cursor = 0
        self.runner.register_completion_callback(self._on_task_completed)
        self._reconcile_persisted_batches()

    def _reconcile_persisted_batches(self) -> None:
        """Reconcile persisted batch items with TaskStore after a backend restart."""
        terminal_batches = {
            BatchStatus.COMPLETED.value,
            BatchStatus.PARTIAL.value,
            BatchStatus.FAILED.value,
            BatchStatus.CANCELLED.value,
            BatchStatus.PARTIAL_CANCELLED.value,
        }
        with self._lock:
            for batch in self.batch_store.list(limit=100_000):
                if batch.status in terminal_batches:
                    continue
                dirty = False
                for item in batch.items:
                    if item.status != "running":
                        continue
                    task = self.runner.store.get(item.task_id) if item.task_id else None
                    if task is not None and task.status in {
                        TaskStatus.SUCCESS.value,
                        TaskStatus.PARTIAL.value,
                    }:
                        item.status = "completed"
                        item.error = ""
                    elif task is not None and task.status == TaskStatus.CANCELLED.value:
                        item.status = "cancelled"
                    else:
                        item.status = "failed"
                        item.error = (
                            (task.error if task is not None else "")
                            or "后端重启，批次任务中断，可从失败项重试"
                        )
                    dirty = True
                batch.update_status()
                if dirty:
                    self.batch_store.save(batch)
                if batch.status not in terminal_batches:
                    self._batch_order.append(batch.batch_id)
            self._dispatch_locked()

    def _get(self, batch_id: str) -> TaskBatch:
        batch = self.batch_store.get(batch_id)
        if batch is None:
            raise KeyError(f"batch not found: {batch_id}")
        return batch

    @staticmethod
    def _is_dispatchable(batch: TaskBatch) -> bool:
        return not batch.pause_requested and not batch.cancel_requested

    @staticmethod
    def _pending_item(batch: TaskBatch) -> BatchItem | None:
        for item in batch.items:
            if item.status == "pending" and item.action not in {"skip", "copy"}:
                return item
        return None

    def _active_count(self) -> int:
        return sum(
            1
            for batch_id in self._batch_order
            if (batch := self.batch_store.get(batch_id)) is not None
            for item in batch.items
            if item.status == "running"
        )

    def _dispatch_locked(self) -> None:
        limit = max(1, int(self.concurrency_limit()))
        while self._active_count() < limit and self._batch_order:
            count = len(self._batch_order)
            selected: tuple[int, TaskBatch, BatchItem] | None = None
            for offset in range(count):
                index = (self._cursor + offset) % count
                batch = self.batch_store.get(self._batch_order[index])
                if batch is None or not self._is_dispatchable(batch):
                    continue
                item = self._pending_item(batch)
                if item is not None:
                    selected = (index, batch, item)
                    break
            if selected is None:
                return

            index, batch, item = selected
            self._cursor = (index + 1) % count
            payload = dict(batch.settings_snapshot)
            item_payloads = payload.pop("item_payloads", {})
            if isinstance(item_payloads, dict):
                item_payload = item_payloads.get(item.batch_item_id)
                if isinstance(item_payload, dict):
                    payload.update(item_payload)
            payload["url"] = item.source_url
            task_type = str(payload.pop("task_type", "note") or "note")
            retry_of = item.task_ids[-1] if item.task_ids else ""
            if retry_of:
                previous = self.runner.store.get(retry_of)
                if previous is not None:
                    for key in (
                        "item_id",
                        "video_path",
                        "audio_path",
                        "transcript_path",
                        "subtitle_path",
                    ):
                        value = previous.result.get(key)
                        if value:
                            payload[key] = value
                    payload["_resume_from_task_id"] = previous.task_id

            def link_task_before_worker(task: TaskRecord) -> None:
                item.task_id = task.task_id
                if task.task_id not in item.task_ids:
                    item.task_ids.append(task.task_id)
                item.status = "running"
                if not batch.started_at:
                    batch.started_at = task.created_at
                batch.update_status()
                self.batch_store.save(batch)
                if self.task_created is not None:
                    self.task_created(batch, item, task)

            try:
                task = self.runner.create_task(
                    batch.target_workspace_id,
                    task_type,
                    payload,
                    retry_of=retry_of,
                    batch_id=batch.batch_id,
                    batch_item_id=item.batch_item_id,
                    attempt_no=item.attempt_no,
                    on_created=link_task_before_worker,
                )
            except Exception as error:  # noqa: BLE001
                item.status = "failed"
                item.error = str(error)
                batch.update_status()
                self.batch_store.save(batch)
                continue

            if retry_of:
                self.runner.append_log(
                    task.task_id,
                    f"批次失败重试：从任务 {retry_of} 的可验证产物继续",
                )

    def _on_task_completed(self, task: TaskRecord, _runner: TaskRunner) -> None:
        if not task.batch_id or not task.batch_item_id:
            return
        with self._lock:
            batch = self.batch_store.get(task.batch_id)
            if batch is None:
                return
            item = next(
                (candidate for candidate in batch.items if candidate.batch_item_id == task.batch_item_id),
                None,
            )
            if item is None or item.task_id != task.task_id:
                return

            if task.status in {
                TaskStatus.SUCCESS.value,
                TaskStatus.PARTIAL.value,
            }:
                item.status = "completed"
                item.error = ""
            elif task.status == TaskStatus.CANCELLED.value:
                item.status = "cancelled"
            else:
                item.status = "failed"
                item.error = task.error
            batch.update_status()
            self.batch_store.save(batch)
            self._dispatch_locked()

    def create_batch(
        self,
        *,
        name: str,
        target_workspace_id: str,
        items: list[BatchItem],
        settings_snapshot: dict[str, Any],
        source_type: str = "urls",
        start_paused: bool = False,
    ) -> TaskBatch:
        with self._lock:
            batch_id = str(uuid.uuid4())
            normalized_items: list[BatchItem] = []
            for item in items:
                if item.action == "skip":
                    item.status = "skipped"
                elif item.action == "copy":
                    if self.copy_item is None:
                        item.status = "failed"
                        item.error = "copy action is unavailable"
                    elif not item.existing_workspace_id or not item.existing_item_id:
                        item.status = "failed"
                        item.error = "copy action requires an existing workspace item"
                    else:
                        try:
                            self.copy_item(
                                item.existing_workspace_id,
                                item.existing_item_id,
                                target_workspace_id,
                            )
                            item.status = "completed"
                        except Exception as error:  # noqa: BLE001
                            item.status = "failed"
                            item.error = str(error)
                normalized_items.append(item)
            batch = TaskBatch(
                batch_id=batch_id,
                name=name,
                source_type=source_type,
                target_workspace_id=target_workspace_id,
                items=normalized_items,
                settings_snapshot=dict(settings_snapshot),
                total_count=len(normalized_items),
                pause_requested=start_paused,
            )
            batch.update_status()
            self.batch_store.save(batch)
            self._batch_order.append(batch_id)
            if self.event_sink is not None:
                self.event_sink.append(
                    "INFO",
                    "batch",
                    "batch_created",
                    batch_id=batch_id,
                    workspace_id=target_workspace_id or None,
                    details={"item_count": len(normalized_items)},
                )
            if self._active_count() >= max(1, int(self.concurrency_limit())):
                self._cursor = len(self._batch_order) - 1
            self._dispatch_locked()
            return self._get(batch_id)

    def pause(self, batch_id: str) -> TaskBatch:
        with self._lock:
            batch = self._get(batch_id)
            if batch.status in {
                BatchStatus.COMPLETED.value,
                BatchStatus.FAILED.value,
                BatchStatus.CANCELLED.value,
                BatchStatus.PARTIAL_CANCELLED.value,
            }:
                raise ValueError("terminal batch cannot be paused")
            batch.pause_requested = True
            batch.update_status()
            self.batch_store.save(batch)
            return batch

    def resume(self, batch_id: str) -> TaskBatch:
        with self._lock:
            batch = self._get(batch_id)
            if not batch.pause_requested:
                raise ValueError("batch is not paused")
            batch.pause_requested = False
            batch.update_status()
            self.batch_store.save(batch)
            self._dispatch_locked()
            return batch

    def cancel(self, batch_id: str) -> TaskBatch:
        with self._lock:
            batch = self._get(batch_id)
            if batch.status in {
                BatchStatus.COMPLETED.value,
                BatchStatus.FAILED.value,
                BatchStatus.CANCELLED.value,
                BatchStatus.PARTIAL_CANCELLED.value,
            }:
                raise ValueError("terminal batch cannot be cancelled")
            batch.cancel_requested = True
            running_task_ids: list[str] = []
            for item in batch.items:
                if item.status == "pending":
                    item.status = "cancelled"
                elif item.status == "running" and item.task_id:
                    running_task_ids.append(item.task_id)
            batch.update_status()
            self.batch_store.save(batch)
            for task_id in running_task_ids:
                self.runner.cancel_task(task_id)
            return batch

    def retry_failed(self, batch_id: str) -> TaskBatch:
        with self._lock:
            batch = self._get(batch_id)
            terminal = {
                BatchStatus.PARTIAL.value,
                BatchStatus.FAILED.value,
            }
            if batch.status not in terminal:
                raise ValueError("only terminal failed batches can be retried")
            failed_items = [item for item in batch.items if item.status == "failed"]
            if not failed_items:
                raise ValueError("batch has no failed items")
            for item in failed_items:
                item.status = "pending"
                item.error = ""
                item.attempt_no += 1
            batch.cancel_requested = False
            batch.pause_requested = False
            batch.completed_at = ""
            batch.update_status()
            self.batch_store.save(batch)
            self._dispatch_locked()
            return batch
