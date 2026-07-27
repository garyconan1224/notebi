"""S3 Task 2: 批次原子存储。"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.app.models.task_batch import TaskBatch


class TaskBatchStore:
    """批次 JSON 持久化存储。"""

    def __init__(self, data_dir: Path) -> None:
        self._dir = data_dir / "batches"
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._cache: Dict[str, TaskBatch] = {}
        self._load_all()

    def _load_all(self) -> None:
        """启动时加载所有批次。"""
        for file in self._dir.glob("*.json"):
            try:
                data = json.loads(file.read_text(encoding="utf-8"))
                batch = TaskBatch.from_dict(data)
                self._cache[batch.batch_id] = batch
            except (json.JSONDecodeError, OSError):
                continue

    def _file_path(self, batch_id: str) -> Path:
        return self._dir / f"{batch_id}.json"

    def _atomic_write(self, batch: TaskBatch) -> None:
        """原子写入。"""
        path = self._file_path(batch.batch_id)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(batch.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)

    def save(self, batch: TaskBatch) -> None:
        """保存批次。"""
        with self._lock:
            self._cache[batch.batch_id] = batch
            self._atomic_write(batch)

    def get(self, batch_id: str) -> Optional[TaskBatch]:
        """获取批次。"""
        with self._lock:
            return self._cache.get(batch_id)

    def list(
        self,
        status: Optional[str] = None,
        workspace_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[TaskBatch]:
        """列出批次。"""
        with self._lock:
            batches = list(self._cache.values())

        # 过滤
        if status:
            batches = [b for b in batches if b.status == status]
        if workspace_id:
            batches = [b for b in batches if b.target_workspace_id == workspace_id]

        # 按创建时间倒序
        batches.sort(key=lambda b: b.created_at, reverse=True)

        return batches[offset : offset + limit]

    def delete(self, batch_id: str) -> bool:
        """删除批次（仅终态）。"""
        with self._lock:
            batch = self._cache.get(batch_id)
            if not batch:
                return False
            # 只允许删除终态
            terminal = {"completed", "partial", "failed", "cancelled", "partial_cancelled"}
            if batch.status not in terminal:
                return False
            del self._cache[batch_id]
            try:
                self._file_path(batch_id).unlink()
            except OSError:
                pass
            return True

    def count(self) -> int:
        """批次总数。"""
        with self._lock:
            return len(self._cache)


# 默认单例
_default_store: Optional[TaskBatchStore] = None
_default_lock = threading.Lock()


def get_default_batch_store() -> TaskBatchStore:
    """返回进程级默认批次存储单例。"""
    global _default_store
    if _default_store is None:
        with _default_lock:
            if _default_store is None:
                from shared.config import ROOT_DIR

                _default_store = TaskBatchStore(ROOT_DIR / "data")
    return _default_store
