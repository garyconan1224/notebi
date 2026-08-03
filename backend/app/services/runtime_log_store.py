"""S2 Task 1: 持久日志事件存储。

设计目标：
1. JSONL 分段文件持久化，重启后继续读取
2. 严格递增 ID
3. 7 天保留，50 MB 上限
4. 支持 after_id 增量和 before_id 向前分页
5. 线程安全
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel

from backend.app.services.log_context import get_log_context

# 默认配置
DEFAULT_MAX_BYTES = 50 * 1024 * 1024  # 50 MB
DEFAULT_RETENTION_DAYS = 7
# S6：结构化文本字段，写入前与 message 一样做密钥/路径脱敏
_STRUCTURED_TEXT_FIELDS = (
    "event_code",
    "operation",
    "component",
    "outcome",
    "summary",
    "probable_cause",
    "suggested_action",
    "error_code",
    "engine",
    "provider",
    "model",
    "device",
    "correlation_id",
    "technical_detail",
)
_ALLOWED_DETAIL_KEYS = frozenset(
    {
        "platform",
        "host",
        "status_code",
        "error_type",
        "item_count",
        "source_type",
        "task_type",
        "task_title",
    }
)


class LogEvent(BaseModel):
    """统一日志事件。

    S6：新增结构化诊断字段均为可选，旧 JSONL（缺少这些键）按 None 读取，
    保证历史日志兼容。所有导出/查询路径输出前均已脱敏。
    """

    id: int
    timestamp: datetime
    level: str
    category: str
    message: str
    task_id: Optional[str] = None
    batch_id: Optional[str] = None
    workspace_id: Optional[str] = None
    stage: Optional[str] = None
    progress: Optional[float] = None
    duration_ms: Optional[int] = None
    retry_count: Optional[int] = None
    # ── S6 结构化诊断字段（可选）─────────────────────────────
    event_code: Optional[str] = None
    operation: Optional[str] = None
    component: Optional[str] = None
    outcome: Optional[str] = None
    summary: Optional[str] = None
    probable_cause: Optional[str] = None
    suggested_action: Optional[str] = None
    error_code: Optional[str] = None
    retry_max: Optional[int] = None
    engine: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    device: Optional[str] = None
    correlation_id: Optional[str] = None
    technical_detail: Optional[str] = None
    details: Optional[dict[str, Any]] = None


class QueryResult(BaseModel):
    """查询结果。"""

    entries: list[LogEvent]
    latest_id: int
    oldest_id: int
    has_more_older: bool


class RuntimeLogStore:
    """持久 JSONL 日志存储。"""

    def __init__(
        self,
        log_dir: Path,
        max_bytes: int = DEFAULT_MAX_BYTES,
        retention_days: int = DEFAULT_RETENTION_DAYS,
    ) -> None:
        self._log_dir = log_dir
        self._max_bytes = max_bytes
        self._retention_days = retention_days
        self._lock = threading.Lock()
        self._next_id = 1
        self._current_file: Optional[Path] = None
        self._current_size = 0

        # 初始化
        self._log_dir.mkdir(parents=True, exist_ok=True)
        self._recover_state()

    def _recover_state(self) -> None:
        """从现有文件恢复最大 ID。"""
        max_id = 0
        for file in sorted(self._log_dir.glob("*.jsonl")):
            try:
                with open(file, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            max_id = max(max_id, data.get("id", 0))
                        except json.JSONDecodeError:
                            continue
            except OSError:
                continue
        self._next_id = max_id + 1

    def _get_current_file(self) -> Path:
        """获取当前写入文件（按日期分段）。"""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        file = self._log_dir / f"log-{today}.jsonl"
        if self._current_file != file:
            self._current_file = file
            self._current_size = file.stat().st_size if file.exists() else 0
        return file

    def _cleanup_old_files(self) -> None:
        """清理过期和超限文件。"""
        cutoff = datetime.now(timezone.utc) - timedelta(days=self._retention_days)
        files = sorted(self._log_dir.glob("*.jsonl"))

        # 按日期清理
        for file in files:
            try:
                # 从文件名解析日期 log-YYYY-MM-DD.jsonl
                date_str = file.stem.replace("log-", "")
                file_date = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                if file_date < cutoff:
                    file.unlink()
            except (ValueError, OSError):
                continue

        # 按大小清理（从最旧开始，不删当前文件）
        files = sorted(self._log_dir.glob("*.jsonl"))
        total_size = sum(f.stat().st_size for f in files)
        current = self._get_current_file()

        for file in files:
            if total_size <= self._max_bytes:
                break
            if file == current:
                continue  # 不删当前文件
            try:
                size = file.stat().st_size
                file.unlink()
                total_size -= size
            except OSError:
                continue

    def append(
        self,
        level: str,
        category: str,
        message: str,
        task_id: Optional[str] = None,
        batch_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
        stage: Optional[str] = None,
        progress: Optional[float] = None,
        duration_ms: Optional[int] = None,
        retry_count: Optional[int] = None,
        details: Optional[dict[str, Any]] = None,
        event_code: Optional[str] = None,
        operation: Optional[str] = None,
        component: Optional[str] = None,
        outcome: Optional[str] = None,
        summary: Optional[str] = None,
        probable_cause: Optional[str] = None,
        suggested_action: Optional[str] = None,
        error_code: Optional[str] = None,
        retry_max: Optional[int] = None,
        engine: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        device: Optional[str] = None,
        correlation_id: Optional[str] = None,
        technical_detail: Optional[str] = None,
    ) -> LogEvent:
        """写入一条日志事件。

        - 显式未传的 task_id / batch_id / workspace_id / correlation_id
          会从当前 contextvars 日志上下文自动补齐（显式参数优先）；
        - message 与所有结构化文本字段写入前统一脱敏。
        """
        # 脱敏
        from backend.app.services.runtime_log_buffer import sanitize_message

        sanitized = sanitize_message(message)
        sanitized_details = None
        if details:
            sanitized_details = {
                key: sanitize_message(value) if isinstance(value, str) else value
                for key, value in details.items()
                if key in _ALLOWED_DETAIL_KEYS
                and isinstance(value, (str, int, float, bool, type(None)))
            }

        # S6：上下文自动补齐 ID（显式参数优先）
        context = get_log_context()
        task_id = task_id or context.get("task_id")
        batch_id = batch_id or context.get("batch_id")
        workspace_id = workspace_id or context.get("workspace_id")
        correlation_id = correlation_id or context.get("correlation_id")

        # S6：结构化文本字段脱敏后收集（None 保持 None）
        structured: dict[str, Any] = {}
        for key, value in (
            ("event_code", event_code),
            ("operation", operation),
            ("component", component),
            ("outcome", outcome),
            ("summary", summary),
            ("probable_cause", probable_cause),
            ("suggested_action", suggested_action),
            ("error_code", error_code),
            ("engine", engine),
            ("provider", provider),
            ("model", model),
            ("device", device),
            ("correlation_id", correlation_id),
            ("technical_detail", technical_detail),
        ):
            if value is not None:
                structured[key] = sanitize_message(str(value))

        with self._lock:
            event = LogEvent(
                id=self._next_id,
                timestamp=datetime.now(timezone.utc),
                level=level,
                category=category,
                message=sanitized,
                task_id=task_id,
                batch_id=batch_id,
                workspace_id=workspace_id,
                stage=stage,
                progress=progress,
                duration_ms=duration_ms,
                retry_count=retry_count,
                retry_max=retry_max,
                details=sanitized_details,
                **structured,
            )
            self._next_id += 1

            # 写入文件
            file = self._get_current_file()
            line = event.model_dump_json() + "\n"
            with open(file, "a", encoding="utf-8") as f:
                f.write(line)
            self._current_size += len(line.encode("utf-8"))

            # 定期清理
            if self._current_size > self._max_bytes // 10:  # 每 5MB 检查一次
                self._cleanup_old_files()

            return event

    def query(
        self,
        after_id: int = 0,
        before_id: int = 0,
        level: Optional[str] = None,
        category: Optional[str] = None,
        task_id: Optional[str] = None,
        batch_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
        limit: int = 200,
    ) -> QueryResult:
        """查询日志。

        - 无游标：返回最新 limit 条，按时间升序
        - after_id：返回 ID > after_id 的记录
        - before_id：返回 ID < before_id 的记录（更早）
        """
        if after_id and before_id:
            raise ValueError("after_id and before_id are mutually exclusive")

        with self._lock:
            all_entries: list[LogEvent] = []

            # 读取所有文件
            for file in sorted(self._log_dir.glob("*.jsonl")):
                try:
                    with open(file, encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                data = json.loads(line)
                                event = LogEvent(**data)
                                all_entries.append(event)
                            except (json.JSONDecodeError, Exception):
                                continue
                except OSError:
                    continue

            # 过滤
            filtered: list[LogEvent] = []
            for event in all_entries:
                if after_id and event.id <= after_id:
                    continue
                if before_id and event.id >= before_id:
                    continue
                if level and event.level != level:
                    continue
                if category and event.category != category:
                    continue
                if task_id and event.task_id != task_id:
                    continue
                if batch_id and event.batch_id != batch_id:
                    continue
                if workspace_id and event.workspace_id != workspace_id:
                    continue
                filtered.append(event)

            # 排序
            filtered.sort(key=lambda e: e.id)

            # 分页
            latest_id = all_entries[-1].id if all_entries else 0
            if before_id:
                # 向前分页：取最后 limit 条
                result = filtered[-limit:] if len(filtered) > limit else filtered
                has_more = len(filtered) > limit
            elif after_id:
                # 增量：取前 limit 条
                result = filtered[:limit]
                has_more = False
            else:
                # 默认：最新 limit 条
                result = filtered[-limit:] if len(filtered) > limit else filtered
                has_more = len(filtered) > limit

            return QueryResult(
                entries=result,
                latest_id=latest_id,
                oldest_id=result[0].id if result else 0,
                has_more_older=has_more,
            )


# 默认单例
_default_store: Optional[RuntimeLogStore] = None
_default_lock = threading.Lock()


def resolve_log_dir() -> Path:
    """解析日志目录：优先 NOTEBI_LOG_DIR 环境变量（测试隔离），否则 data/logs。

    Q7（反馈 #15）：测试通过 NOTEBI_LOG_DIR 指向临时目录，避免污染 data/logs。
    """
    import os

    override = os.environ.get("NOTEBI_LOG_DIR", "").strip()
    if override:
        return Path(override).expanduser()
    from shared.config import ROOT_DIR

    return ROOT_DIR / "data" / "logs"


def get_default_store() -> RuntimeLogStore:
    """返回进程级默认存储单例。"""
    global _default_store
    if _default_store is None:
        with _default_lock:
            if _default_store is None:
                _default_store = RuntimeLogStore(resolve_log_dir())
    return _default_store
