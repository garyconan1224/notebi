from __future__ import annotations

"""Persistent task store —— 一任务一文件，对齐 workspace_store 模式。

v2 变更：
- 存储从单文件 backend_tasks.json 改为 .local/tasks/<task_id>.json（每任务一文件）
- 写单个任务只写单个小文件，不再全量序列化 + fsync 整份 JSON
- 公开 API（create/get/update/append_log/list_all/delete）签名与行为完全不变
- 首次启动自动从旧单文件迁移到新目录，旧文件重命名为 .migrated 保留
"""

import json
import logging
import os
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from backend.app.models.tasks import (
    TERMINAL_STATUS_VALUES,
    TaskLogEntry,
    TaskRecord,
    TaskStatus,
)
from shared.config import ROOT_DIR

logger = logging.getLogger(__name__)

# 旧单文件路径（仅用于迁移与测试兼容）
TASK_STORE_PATH = ROOT_DIR / ".local" / "backend_tasks.json"
# 新目录：每任务一个 JSON 文件
TASK_STORE_DIR = ROOT_DIR / ".local" / "tasks"

MAX_LOG_ENTRIES = 200  # 每个任务只保留最近 N 条日志
SAVE_DEBOUNCE_S = 0.5  # progress/download_speed 写入节流间隔


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write_one(path: Path, payload: str) -> None:
    """原子写单个任务文件（tmp + fsync + os.replace）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


class TaskStore:
    def __init__(self, path: Optional[Path] = None) -> None:
        # 兼容旧签名：path 指向旧单文件位置，新目录从其父目录推导
        self._legacy_path: Path = path if path is not None else TASK_STORE_PATH
        self._store_dir: Path = self._legacy_path.parent / "tasks"
        self._lock = threading.Lock()
        self._records: Dict[str, TaskRecord] = {}
        self._last_save_ts: float = 0.0
        self._load()

    # ── 内部：文件路径 ──────────────────────────────────────────

    def _file_path(self, task_id: str) -> Path:
        """消毒 task_id 并返回单个任务文件路径。"""
        safe = task_id.replace("/", "_").replace("\\", "_").strip()
        return self._store_dir / f"{safe}.json"

    # ── 内部：单任务原子写 ──────────────────────────────────────

    def _save_one(self, rec: TaskRecord) -> None:
        """只写这一个任务到它的独立文件。"""
        rec.updated_at = _now_iso()
        data = json.dumps(rec.to_dict(), ensure_ascii=False, indent=2)
        _atomic_write_one(self._file_path(rec.task_id), data)

    # ── 内部：迁移 ──────────────────────────────────────────────

    def _migrate_from_legacy(self) -> bool:
        """从旧单文件迁移到新目录。成功返回 True，无需迁移返回 False。"""
        if not self._legacy_path.is_file():
            return False
        # 新目录已存在且有文件 → 已迁移过，跳过
        if self._store_dir.is_dir() and any(self._store_dir.glob("*.json")):
            logger.info("task_store: 新目录已存在，跳过迁移")
            return False

        logger.info("task_store: 检测到旧单文件 %s，开始迁移...", self._legacy_path)
        try:
            data = json.loads(self._legacy_path.read_text(encoding="utf-8"))
        except Exception:
            logger.exception("task_store: 旧文件读取/解析失败，放弃迁移")
            return False
        if not isinstance(data, list):
            logger.warning("task_store: 旧文件格式非 list，放弃迁移")
            return False

        migrated = 0
        skipped = 0
        for item in data:
            if not isinstance(item, dict):
                skipped += 1
                continue
            try:
                rec = TaskRecord.from_dict(item)
            except Exception:
                logger.warning("task_store: 迁移跳过坏记录: %s", item.get("task_id", "?"))
                skipped += 1
                continue
            if not rec.task_id:
                skipped += 1
                continue
            # 应用启动清理（僵尸→FAILED + 日志裁剪），逻辑与 _load_from_dir 一致
            if rec.status not in TERMINAL_STATUS_VALUES:
                rec.status = TaskStatus.FAILED.value
                rec.error = rec.error or "后端重启，任务中断"
                rec.updated_at = _now_iso()
            if len(rec.log) > MAX_LOG_ENTRIES:
                rec.log = rec.log[-MAX_LOG_ENTRIES:]
            try:
                self._save_one(rec)
            except Exception:
                logger.exception("task_store: 迁移写文件失败: %s", rec.task_id)
                skipped += 1
                continue
            self._records[rec.task_id] = rec
            migrated += 1

        # 迁移成功后重命名旧文件（保留，不删）
        migrated_path = self._legacy_path.with_suffix(".json.migrated")
        try:
            self._legacy_path.rename(migrated_path)
            logger.info(
                "task_store: 迁移完成 %d 条（跳过 %d 条），旧文件→ %s",
                migrated,
                skipped,
                migrated_path.name,
            )
        except OSError:
            logger.warning(
                "task_store: 迁移完成但重命名旧文件失败，请手动处理: %s",
                self._legacy_path,
            )
        return True

    # ── 内部：从新目录加载 ──────────────────────────────────────

    def _load_from_dir(self) -> None:
        """从 .local/tasks/ 目录加载所有任务。"""
        if not self._store_dir.is_dir():
            return
        for fp in sorted(self._store_dir.glob("*.json")):
            try:
                data = json.loads(fp.read_text(encoding="utf-8"))
            except Exception:
                logger.warning("task_store: 跳过损坏文件: %s", fp.name)
                continue
            if not isinstance(data, dict):
                continue
            try:
                rec = TaskRecord.from_dict(data)
            except Exception:
                logger.warning("task_store: from_dict 失败: %s", fp.name)
                continue
            if not rec.task_id:
                continue
            dirty = False
            # 启动清理：僵尸→FAILED
            if rec.status not in TERMINAL_STATUS_VALUES:
                rec.status = TaskStatus.FAILED.value
                rec.error = rec.error or "后端重启，任务中断"
                rec.updated_at = _now_iso()
                dirty = True
            # 日志裁剪
            if len(rec.log) > MAX_LOG_ENTRIES:
                rec.log = rec.log[-MAX_LOG_ENTRIES:]
                dirty = True
            if dirty:
                try:
                    self._save_one(rec)
                except Exception:
                    logger.warning("task_store: 保存清理后的任务失败: %s", rec.task_id)
            self._records[rec.task_id] = rec

    # ── 内部：加载入口 ──────────────────────────────────────────

    def _load(self) -> None:
        """加载任务：优先从新目录，否则尝试迁移旧单文件。"""
        # 1. 尝试迁移（幂等：已迁移则跳过）
        self._migrate_from_legacy()
        # 2. 从新目录加载
        self._load_from_dir()

    # ── 公开 API（签名与行为完全不变）──────────────────────────

    def create(self, record: TaskRecord) -> TaskRecord:
        with self._lock:
            self._records[record.task_id] = record
            self._save_one(record)
        return record

    def get(self, task_id: str) -> Optional[TaskRecord]:
        if self._lock.acquire(timeout=0.2):
            try:
                return self._records.get(task_id)
            finally:
                self._lock.release()
        # 任务进度/日志写盘较频繁；读 UI 状态时允许返回当前内存快照，避免列表页阻塞。
        return self._records.get(task_id)

    def update(self, task_id: str, **kwargs: object) -> TaskRecord:
        with self._lock:
            rec = self._records.get(task_id)
            if rec is None:
                raise KeyError(f"task not found: {task_id}")
            for k, v in kwargs.items():
                setattr(rec, k, v)
            rec.updated_at = _now_iso()
            # 节流：progress / download_speed 变更不触发写盘
            _throttled = {"progress", "download_speed"}
            if set(kwargs.keys()) - _throttled:
                self._save_one(rec)
            else:
                now = time.monotonic()
                if now - self._last_save_ts >= SAVE_DEBOUNCE_S:
                    self._save_one(rec)
                    self._last_save_ts = now
            return rec

    def append_log(self, task_id: str, message: str, *, level: str = "info") -> TaskRecord:
        with self._lock:
            rec = self._records.get(task_id)
            if rec is None:
                raise KeyError(f"task not found: {task_id}")
            rec.log.append(TaskLogEntry.create(message=message, level=level))  # type: ignore[arg-type]
            if len(rec.log) > MAX_LOG_ENTRIES:
                rec.log = rec.log[-MAX_LOG_ENTRIES:]
            rec.updated_at = _now_iso()
            # 写盘节流：info 级日志按 debounce 合并落盘；warning/error 立即落盘
            if level == "info":
                now = time.monotonic()
                if now - self._last_save_ts >= SAVE_DEBOUNCE_S:
                    self._save_one(rec)
                    self._last_save_ts = now
            else:
                self._save_one(rec)
                self._last_save_ts = time.monotonic()
            return rec

    def list_all(self) -> List[TaskRecord]:
        if self._lock.acquire(timeout=0.2):
            try:
                return list(self._records.values())
            finally:
                self._lock.release()
        return list(self._records.values())

    def delete(self, task_id: str) -> bool:
        """从持久化存储中删除一条任务记录。"""
        with self._lock:
            if task_id not in self._records:
                return False
            del self._records[task_id]
            fp = self._file_path(task_id)
            if fp.exists():
                try:
                    fp.unlink()
                except OSError:
                    pass
            return True
