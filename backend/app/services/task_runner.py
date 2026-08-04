from __future__ import annotations

"""Background task runner with lifecycle controls."""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional, Protocol

from backend.app.models.tasks import TERMINAL_STATUS_VALUES, TaskRecord, TaskStatus
from backend.app.services.diagnostic_events import (
    DiagnosticAggregator,
    classify_task_failure,
    emit_diagnostic_event,
)
from backend.app.services.log_context import log_context
from backend.app.services.task_store import TaskStore

TaskHandler = Callable[[TaskRecord, "TaskRunner"], Dict[str, Any]]
SuccessCallback = Callable[[TaskRecord, "TaskRunner"], None]
IntermediateCallback = Callable[[TaskRecord, "TaskRunner"], None]
PartialCallback = Callable[[TaskRecord, "TaskRunner"], None]
CompletionCallback = Callable[[TaskRecord, "TaskRunner"], None]
TaskCreatedCallback = Callable[[TaskRecord], None]


class TaskEventSink(Protocol):
    def append(
        self,
        level: str,
        category: str,
        message: str,
        **kwargs: Any,
    ) -> object: ...


class TaskRunner:
    def __init__(
        self,
        store: TaskStore,
        max_workers: int = 4,
        event_sink: Optional[TaskEventSink] = None,
    ) -> None:
        self.store = store
        self._event_sink = event_sink
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="vps-task")
        self._handlers: Dict[str, TaskHandler] = {}
        self._success_callbacks: Dict[str, List[SuccessCallback]] = {}
        self._intermediate_callbacks: Dict[str, List[IntermediateCallback]] = {}
        self._partial_callbacks: Dict[str, List[PartialCallback]] = {}
        self._completion_callbacks: List[CompletionCallback] = []
        self._emitted_events: set[tuple[str, str]] = set()
        self._diagnostic_aggregator = DiagnosticAggregator()
        self._lock = threading.Lock()

    def _emit_task_event(
        self,
        record: TaskRecord,
        stage: str,
        message: str,
        *,
        level: str = "INFO",
    ) -> None:
        if self._event_sink is None:
            return
        identity = (record.task_id, stage)
        with self._lock:
            if identity in self._emitted_events:
                return
            self._emitted_events.add(identity)
        self._event_sink.append(
            level,
            "task",
            message,
            task_id=record.task_id,
            batch_id=record.batch_id or None,
            workspace_id=record.project_id or None,
            stage=stage,
            progress=record.progress,
            retry_count=max(0, record.attempt_no - 1),
            details={
                "task_type": record.task_type,
                "task_title": str(
                    record.result.get("video_title")
                    or record.payload.get("video_title")
                    or record.payload.get("title")
                    or record.payload.get("url")
                    or record.payload.get("source")
                    or record.task_type
                )[:200],
                "source_type": str(record.payload.get("source_type") or ""),
            },
        )

    @staticmethod
    def _public_stage(status: str) -> str:
        """Expose only the user-facing pipeline stage, not lifecycle noise."""
        normalized = str(status or "").upper()
        return {
            "PENDING": "PENDING",
            "DOWNLOAD": "DOWNLOAD",
            "PROBE": "PROBE",
            "FRAMES": "FRAMES",
            "ASR": "ASR",
            "DIARIZATION": "DIARIZATION",
            "VLM": "VLM",
            "FETCH": "FETCH",
            "PARSE": "PARSE",
            "EXTRACT": "EXTRACT",
            "SUM": "SUM",
            "ASSOCIATE": "ASSOCIATE",
            "REWRITE": "REWRITE",
            "TRANSLATE": "TRANSLATE",
            "STORE": "STORE",
        }.get(normalized, "")

    def register(self, task_type: str, handler: TaskHandler) -> None:
        with self._lock:
            self._handlers[task_type] = handler

    def supports(self, task_type: str) -> bool:
        """Return whether a task type has a registered executable handler."""
        with self._lock:
            return task_type in self._handlers

    def append_log(self, task_id: str, message: str, *, level: str = "info") -> None:
        """代理到 store.append_log，供 handler 直接通过 runner 写日志。

        pipeline_tasks.py 历史代码大量使用 `runner.append_log(...)`，
        没有此方法时所有调用方都会抛 AttributeError 让任务失败。
        """
        self.store.append_log(task_id, message, level=level)

    def register_success_callback(self, task_type: str, callback: SuccessCallback) -> None:
        """注册 task_type 成功后的回调（可注册多个，按顺序调用）。"""
        with self._lock:
            self._success_callbacks.setdefault(task_type, []).append(callback)

    def register_intermediate_callback(
        self,
        task_type: str,
        callback: IntermediateCallback,
    ) -> None:
        """注册中间结果落盘后的回调，用于 probe 等需即时反映到 UI 的状态。"""
        with self._lock:
            self._intermediate_callbacks.setdefault(task_type, []).append(callback)

    def notify_intermediate(self, task_id: str) -> None:
        record = self.store.get(task_id)
        if record is None:
            return
        with self._lock:
            callbacks = list(self._intermediate_callbacks.get(record.task_type, []))
        for callback in callbacks:
            try:
                callback(record, self)
            except Exception as callback_error:  # noqa: BLE001
                self.store.append_log(
                    task_id,
                    f"Intermediate callback error: {callback_error}",
                    level="error",
                )

    def register_partial_callback(self, task_type: str, callback: PartialCallback) -> None:
        """注册核心产物可用、但后续阶段未完成时的回调。"""
        with self._lock:
            self._partial_callbacks.setdefault(task_type, []).append(callback)

    def register_completion_callback(self, callback: CompletionCallback) -> None:
        """注册真实执行结束回调，成功、失败和取消都会触发。"""
        with self._lock:
            if callback not in self._completion_callbacks:
                self._completion_callbacks.append(callback)

    @staticmethod
    def _normalize_url_for_dedup(raw: str) -> str:
        """轻量 URL 规整，仅用于去重比较。

        去掉追踪参数 + 尾斜杠，让同一视频的不同粘入变体落地为相同 key。
        """
        from urllib.parse import urlparse

        s = raw.strip().lower()
        if not s:
            return s
        try:
            u = urlparse(s)
            tracking = frozenset({
                "spm_id_from", "vd_source", "share_source", "share_medium",
                "bbid", "ts", "unique_k", "p", "vd_source_2",
            })
            if u.query:
                qs_parts = [
                    f"{k}={v}"
                    for k, v in (p.split("=", 1) for p in u.query.split("&") if "=" in p)
                    if k not in tracking
                ]
                qs = "&".join(qs_parts)
            else:
                qs = ""
            clean = u.scheme + "://" + u.netloc + u.path.rstrip("/")
            if qs:
                clean += "?" + qs
            return clean
        except Exception:
            return s.rstrip("/")

    def _has_active_duplicate(self, project_id: str, task_type: str, payload: Dict[str, Any]) -> Optional[str]:
        """检查是否已有同 project + 同 URL 的 running/queued 下载任务。返回 task_id 或 None。"""
        if task_type != "download":
            return None
        new_url = self._normalize_url_for_dedup(str(payload.get("url") or ""))
        if not new_url:
            return None
        for rec in self.store.list_all():
            if rec.project_id != project_id or rec.task_type != task_type:
                continue
            # 非终结态（含 PENDING 与各运行阶段）均视为活跃
            if rec.status in TERMINAL_STATUS_VALUES:
                continue
            existing_url = self._normalize_url_for_dedup(str(rec.payload.get("url") or ""))
            if existing_url == new_url:
                return rec.task_id
        return None

    def create_task(
        self,
        project_id: str,
        task_type: str,
        payload: Dict[str, Any],
        *,
        retry_of: str = "",
        batch_id: str = "",
        batch_item_id: str = "",
        attempt_no: int = 1,
        on_created: TaskCreatedCallback | None = None,
    ) -> TaskRecord:
        # 防止同 URL 的重复下载任务
        if not retry_of:
            dup_tid = self._has_active_duplicate(project_id, task_type, payload)
            if dup_tid:
                raise ValueError(
                    f"该链接已有正在执行的下载任务 {dup_tid}，请等待完成或取消后再提交"
                )
        rec = TaskRecord(
            task_id=f"{task_type}-{uuid.uuid4().hex[:12]}",
            project_id=project_id,
            task_type=task_type,
            payload=payload,
            retry_of=retry_of,
            batch_id=batch_id,
            batch_item_id=batch_item_id,
            attempt_no=attempt_no,
        )
        self.store.create(rec)
        self.store.append_log(rec.task_id, "Task accepted")
        self._emit_task_event(rec, "created", "任务已创建")
        if on_created is not None:
            try:
                on_created(rec)
            except Exception as error:
                self.store.update(
                    rec.task_id,
                    status=TaskStatus.FAILED.value,
                    error=f"task creation hook failed: {error}",
                )
                self.store.append_log(
                    rec.task_id,
                    f"Task creation hook failed: {error}",
                    level="error",
                )
                raise
        self._executor.submit(self._run, rec.task_id)
        return rec

    def _run(self, task_id: str) -> None:
        try:
            self._execute(task_id)
        finally:
            current = self.store.get(task_id)
            if current and current.status in TERMINAL_STATUS_VALUES:
                with self._lock:
                    callbacks = list(self._completion_callbacks)
                for callback in callbacks:
                    try:
                        callback(current, self)
                    except Exception as callback_error:  # noqa: BLE001
                        self.store.append_log(
                            task_id,
                            f"Completion callback error: {callback_error}",
                            level="error",
                        )

    def _execute(self, task_id: str) -> None:
        record = self.store.get(task_id)
        if record is None:
            return
        if record.cancel_requested:
            if record.status not in TERMINAL_STATUS_VALUES:
                self.store.update(task_id, status=TaskStatus.CANCELLED.value)
            return
        handler = self._handlers.get(record.task_type)
        if handler is None:
            self.store.update(task_id, status=TaskStatus.FAILED.value, error=f"unsupported task_type: {record.task_type}")
            self.store.append_log(task_id, f"Unsupported task type: {record.task_type}", level="error")
            return

        # 按 task_type 选择初始阶段状态，避免 analyze 等任务错误显示"下载中"
        _INITIAL_STATUS: dict[str, str] = {
            "download": TaskStatus.DOWNLOAD.value,
            "note": TaskStatus.DOWNLOAD.value,     # note 任务内部先做下载
            "analyze": TaskStatus.FRAMES.value,
            "text": TaskStatus.FETCH.value,
            "image": TaskStatus.FRAMES.value,
            "audio": TaskStatus.ASR.value,
            "summary": TaskStatus.SUM.value,
        }
        initial_status = _INITIAL_STATUS.get(record.task_type, TaskStatus.DOWNLOAD.value)
        self.store.update(task_id, status=initial_status, progress=0.01)
        self.store.append_log(task_id, "Task started")
        started_record = self.store.get(task_id) or record
        self._emit_task_event(started_record, "started", "任务已开始")
        try:
            # S6：任务生命周期入口绑定日志上下文——handler 内的任意
            # logger/store 写入自动带上 task/batch/workspace ID；
            # 退出 with 后 token 复位，线程池复用不会泄漏给下个任务。
            with log_context(
                task_id=record.task_id,
                batch_id=record.batch_id or None,
                workspace_id=record.project_id or None,
            ):
                result = handler(record, self)
            current = self.store.get(task_id)
            if current and current.cancel_requested:
                # 取消终态保留取消时刻的真实进度：不传 progress 即沿用 store 现值，
                # 不再硬写 1.0（否则取消任务也会显示 100%）。
                self.store.update(task_id, status=TaskStatus.CANCELLED.value, result=result)
                self.store.append_log(task_id, "Task cancelled by request", level="warning")
                cancelled = self.store.get(task_id) or record
                self._emit_task_event(
                    cancelled,
                    "cancelled",
                    "任务已取消",
                    level="WARNING",
                )
                return
            # A3: handler 设了 AWAITING_CONFIRM 后提前返回——不覆盖为 SUCCESS，等用户确认
            if current and current.status == TaskStatus.AWAITING_CONFIRM.value:
                return
            if current and current.status == TaskStatus.PARTIAL.value:
                partial_record = self.store.update(task_id, progress=1.0, result=result)
                self.store.append_log(task_id, "Task partially completed", level="warning")
                with self._lock:
                    callbacks = list(self._partial_callbacks.get(record.task_type, []))
                for cb in callbacks:
                    try:
                        cb(partial_record, self)
                    except Exception as cb_err:  # noqa: BLE001
                        self.store.append_log(task_id, f"Partial callback error: {cb_err}", level="error")
                return
            self.store.update(task_id, status=TaskStatus.SUCCESS.value, progress=1.0, result=result, error="")
            self.store.append_log(task_id, "Task succeeded")
            succeeded = self.store.get(task_id) or record
            self._emit_task_event(succeeded, "succeeded", "任务已完成")
            # 触发成功回调（例如：download→analyze 任务链）
            with self._lock:
                callbacks = list(self._success_callbacks.get(record.task_type, []))
            for cb in callbacks:
                try:
                    cb(record, self)
                except Exception as cb_err:  # noqa: BLE001
                    self.store.append_log(task_id, f"Success callback error: {cb_err}", level="error")
        except Exception as err:  # noqa: BLE001
            failed_at = self.store.get(task_id) or record
            failed_stage = failed_at.status
            self.store.update(task_id, status=TaskStatus.FAILED.value, error=str(err))
            self.store.append_log(task_id, f"Task failed: {err}", level="error")
            failed = self.store.get(task_id) or record
            if self._event_sink is not None:
                event_code = classify_task_failure(failed_at, stage=failed_stage, error=str(err))
                emit_diagnostic_event(
                    self._event_sink,
                    event_code,
                    task_id=failed.task_id,
                    batch_id=failed.batch_id,
                    workspace_id=failed.project_id,
                    stage=failed_stage,
                    component=failed.task_type,
                    technical_detail=str(err),
                    aggregator=self._diagnostic_aggregator,
                )
            self._emit_task_event(
                failed,
                "failed",
                f"任务失败：{err}",
                level="ERROR",
            )

    def set_progress(
        self,
        task_id: str,
        progress: float,
        message: Optional[str] = None,
        *,
        public_stage: Optional[str] = None,
    ) -> None:
        pct = max(0.0, min(float(progress), 1.0))
        self.store.update(task_id, progress=pct)
        if message:
            self.store.append_log(task_id, message)
        current = self.store.get(task_id)
        if current is not None:
            stage = self._public_stage(public_stage or current.status)
            if stage:
                self._emit_task_event(current, stage, message or stage)

    def set_download_speed(self, task_id: str, speed: str) -> None:
        """将实时下载速度字符串合并写入 task.result['download_speed']，供前端展示。

        speed 形如 "1.23MiB/s" / "560KiB/s"，保持 yt-dlp 原生单位，前端自行归一渲染。
        """
        rec = self.store.get(task_id)
        if rec is None:
            return
        merged = dict(rec.result) if rec.result else {}
        merged["download_speed"] = str(speed or "").strip()
        self.store.update(task_id, result=merged)

    def append_log(self, task_id: str, message: str, *, level: str = "info") -> None:
        self.store.append_log(task_id, message, level=level)

    def is_cancel_requested(self, task_id: str) -> bool:
        rec = self.store.get(task_id)
        return bool(rec.cancel_requested) if rec else False

    def cancel_task(self, task_id: str) -> TaskRecord:
        rec = self.store.update(task_id, cancel_requested=True)
        self.store.append_log(task_id, "Cancel requested", level="warning")
        # 非终结态一律可取消（覆盖 PENDING 及各运行阶段）
        if rec.status not in TERMINAL_STATUS_VALUES:
            rec = self.store.update(task_id, status=TaskStatus.CANCELLED.value)
            self._emit_task_event(
                rec,
                "cancelled",
                "任务已取消",
                level="WARNING",
            )
        return rec

    def retry_task(self, task_id: str, *, stage: Optional[str] = None) -> TaskRecord:
        rec = self.store.get(task_id)
        if rec is None:
            raise KeyError(f"task not found: {task_id}")
        if stage is None:
            return self.create_task(
                rec.project_id,
                rec.task_type,
                dict(rec.payload),
                retry_of=rec.task_id,
            )
        if stage not in {"diarization", "summary"}:
            raise ValueError(f"unsupported retry stage: {stage}")
        is_audio = rec.task_type == "audio"
        is_video_note = rec.task_type == "note" and bool(
            (rec.result or {}).get("video_file")
        )
        retryable_kind = is_audio or (stage == "diarization" and is_video_note)
        if not retryable_kind or rec.status not in {
            TaskStatus.PARTIAL.value,
            TaskStatus.SUCCESS.value,
        }:
            raise ValueError(f"{stage} retry requires a terminal audio or video task")
        failure = rec.result.get("partial_failure") if isinstance(rec.result, dict) else None
        if rec.status == TaskStatus.PARTIAL.value:
            if not isinstance(failure, dict) or failure.get("stage") != stage:
                raise ValueError(f"task has no retryable {stage} failure")
        if stage == "diarization" and not rec.result.get("transcript_segments"):
            raise ValueError("task has no reusable transcript segments")
        if stage == "summary":
            if not is_audio:
                raise ValueError("summary retry currently requires a terminal audio task")
            if not rec.result.get("transcript"):
                raise ValueError("task has no reusable transcript")
            if rec.status == TaskStatus.SUCCESS.value and rec.result.get("summary"):
                raise ValueError("task already has a generated summary")

        payload = dict(rec.payload)
        payload["_retry_stage"] = stage
        payload["_retry_source_task_id"] = rec.task_id
        return self.create_task(rec.project_id, rec.task_type, payload, retry_of=rec.task_id)

    def resubmit_task(self, task_id: str) -> None:
        """A3: 将已有任务重新提交到 executor（保持同一 task_id，SSE 连接不断）。"""
        self._executor.submit(self._run, task_id)
