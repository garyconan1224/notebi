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

# 默认配置
DEFAULT_MAX_BYTES = 50 * 1024 * 1024  # 50 MB
DEFAULT_RETENTION_DAYS = 7


class LogEvent(BaseModel):
    """统一日志事件。"""

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
    ) -> LogEvent:
        """写入一条日志事件。"""
        # 脱敏
        from backend.app.services.runtime_log_buffer import sanitize_message

        sanitized = sanitize_message(message)

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
                details=details,
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
            oldest_id = all_entries[0].id if all_entries else 0

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
                oldest_id=oldest_id,
                has_more_older=has_more,
            )


# 默认单例
_default_store: Optional[RuntimeLogStore] = None
_default_lock = threading.Lock()


def get_default_store() -> RuntimeLogStore:
    """返回进程级默认存储单例。"""
    global _default_store
    if _default_store is None:
        with _default_lock:
            if _default_store is None:
                from shared.config import ROOT_DIR

                log_dir = ROOT_DIR / "data" / "logs"
                _default_store = RuntimeLogStore(log_dir)
    return _default_store
