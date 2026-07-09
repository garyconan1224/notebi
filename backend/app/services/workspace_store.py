from __future__ import annotations

"""Workspace（工作空间）持久化存储。

实现风格完全对齐 backend/app/services/task_store.py：
- JSON 文件 + 原子写入（tmp + os.replace）
- 内存 dict 缓存 + threading.Lock 串行写
- 与 TaskStore 平级，互不耦合

存储路径：data/workspaces/<workspace_id>.json（每个 workspace 一个文件，
便于浏览/手工修改/未来分库；不像 task_store 把所有任务塞一个文件）。
"""

import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set

from backend.app.models.workspace import (
    InlineFrame,
    ItemStatus,
    ItemSummary,
    PromptVersion,
    WorkspaceBackground,
    WorkspaceItem,
    WorkspaceRecord,
    WorkspaceStatus,
)
from shared.config import DATA_DIR

WORKSPACE_DIR: Path = DATA_DIR / "workspaces"
WORKSPACE_KINDS: Set[str] = {"note", "replica"}


def normalize_workspace_kinds(kinds: Optional[Iterable[str]]) -> Optional[Set[str]]:
    """Return a validated workspace kind filter.

    ``None`` means no product-mode filter. An empty iterable is treated the
    same way so callers can pass optional request fields directly.
    """

    if kinds is None:
        return None
    normalized = {str(kind).strip() for kind in kinds if str(kind).strip()}
    if not normalized:
        return None
    invalid = normalized - WORKSPACE_KINDS
    if invalid:
        raise ValueError(f"invalid workspace kind(s): {', '.join(sorted(invalid))}")
    return normalized


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write(path: Path, payload: str) -> None:
    """复用 task_store 的原子写策略，但内联避免循环依赖。"""
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


class WorkspaceStore:
    """工作空间存储——按 workspace_id 一文件保存。"""

    def __init__(self, root: Path = WORKSPACE_DIR) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._records: Dict[str, WorkspaceRecord] = {}
        self._load_all()

    # ── 内部：磁盘 I/O ────────────────────────────────────────

    def _file_path(self, workspace_id: str) -> Path:
        # 简单消毒：禁止跨目录；workspace_id 由后端生成（uuid），用户不应直接传任意字符串
        safe = workspace_id.replace("/", "_").replace("\\", "_").strip()
        return self.root / f"{safe}.json"

    def _load_all(self) -> None:
        if not self.root.is_dir():
            return
        for fp in self.root.glob("*.json"):
            try:
                data = json.loads(fp.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            rec = WorkspaceRecord.from_dict(data)
            if rec.workspace_id:
                self._records[rec.workspace_id] = rec

    def _save(self, rec: WorkspaceRecord) -> None:
        rec.updated_at = _now_iso()
        data = json.dumps(rec.to_dict(), ensure_ascii=False, indent=2)
        _atomic_write(self._file_path(rec.workspace_id), data)

    # ── Workspace 级 CRUD ────────────────────────────────────

    def create(self, rec: WorkspaceRecord) -> WorkspaceRecord:
        with self._lock:
            self._records[rec.workspace_id] = rec
            self._save(rec)
        return rec

    def get(self, workspace_id: str) -> Optional[WorkspaceRecord]:
        if self._lock.acquire(timeout=0.2):
            try:
                return self._records.get(workspace_id)
            finally:
                self._lock.release()
        # 写入正在 fsync 时，读路径仍可返回内存快照，避免列表页被长时间阻塞。
        return self._records.get(workspace_id)

    def list_all(
        self,
        *,
        include_trashed: bool = False,
        trashed_only: bool = False,
        kinds: Optional[Iterable[str]] = None,
    ) -> List[WorkspaceRecord]:
        """列出工作空间。

        默认仅返回非 trashed 的记录（主列表语义）。
        trashed_only=True：仅返回 trashed 的记录（垃圾桶视图）。
        include_trashed=True：返回全部（含 trashed），用于管理后台/调试。
        kinds：按 workspace.kind 过滤；None 表示不过滤。
        trashed_only 优先于 include_trashed。
        """
        kind_filter = normalize_workspace_kinds(kinds)
        if self._lock.acquire(timeout=0.2):
            try:
                recs = list(self._records.values())
            finally:
                self._lock.release()
        else:
            # 写锁繁忙时使用当前内存快照；这里不修改对象，只服务 UI 列表读取。
            recs = list(self._records.values())
        if trashed_only:
            recs = [r for r in recs if r.trashed]
        elif not include_trashed:
            recs = [r for r in recs if not r.trashed]
        if kind_filter is not None:
            recs = [r for r in recs if r.kind in kind_filter]
        # 按 updated_at 倒序，最近更新在前
        return sorted(recs, key=lambda r: r.updated_at, reverse=True)

    def update(self, workspace_id: str, **kwargs: object) -> WorkspaceRecord:
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            for k, v in kwargs.items():
                if k == "background" and isinstance(v, dict):
                    rec.background = WorkspaceBackground.from_dict(v)
                else:
                    setattr(rec, k, v)
            self._save(rec)
            return rec

    def delete(self, workspace_id: str) -> bool:
        """删除工作空间。

        顺序：先删磁盘文件，成功后再从内存移除。这样若磁盘 IO 失败，
        内存视图保持一致，避免「内存已删但磁盘还在 → 重启后又加载回来」。
        """
        with self._lock:
            if workspace_id not in self._records:
                return False
            fp = self._file_path(workspace_id)
            if fp.exists():
                try:
                    fp.unlink()
                except OSError:
                    return False
            del self._records[workspace_id]
            return True

    # ── Item 级操作 ──────────────────────────────────────────

    def add_item(self, workspace_id: str, item: WorkspaceItem) -> WorkspaceRecord:
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            rec.items.append(item)
            self._save(rec)
            return rec

    def update_item(
        self, workspace_id: str, item_id: str, **kwargs: object
    ) -> WorkspaceRecord:
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            target = next((it for it in rec.items if it.item_id == item_id), None)
            if target is None:
                raise KeyError(f"item not found: {item_id}")
            for k, v in kwargs.items():
                setattr(target, k, v)
            target.updated_at = _now_iso()
            self._save(rec)
            return rec

    def remove_item(self, workspace_id: str, item_id: str) -> WorkspaceRecord:
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            before = len(rec.items)
            rec.items = [it for it in rec.items if it.item_id != item_id]
            if len(rec.items) == before:
                raise KeyError(f"item not found: {item_id}")
            # 同步从复刻收藏夹移除
            rec.favorites = [fid for fid in rec.favorites if fid != item_id]
            self._save(rec)
            return rec

    # ── Prompt 版本栈 ──────────────────────────────────────

    def add_prompt_version(
        self, workspace_id: str, item_id: str, content: str
    ) -> PromptVersion:
        """为指定 item 追加一个提示词版本，version 自增。"""
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            if not any(it.item_id == item_id for it in rec.items):
                raise KeyError(f"item not found: {item_id}")
            versions = rec.prompt_versions.setdefault(item_id, [])
            next_ver = (versions[-1].version + 1) if versions else 1
            pv = PromptVersion(version=next_ver, content=content)
            versions.append(pv)
            self._save(rec)
            return pv

    def list_prompt_versions(
        self, workspace_id: str, item_id: str
    ) -> List[PromptVersion]:
        """列出指定 item 的所有提示词版本。"""
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            if not any(it.item_id == item_id for it in rec.items):
                raise KeyError(f"item not found: {item_id}")
            return list(rec.prompt_versions.get(item_id) or [])

    # ── Summary 操作 ──────────────────────────────────────────

    def get_item(self, workspace_id: str, item_id: str) -> WorkspaceItem:
        """获取单个 item，找不到抛 KeyError。"""
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            item = next((it for it in rec.items if it.item_id == item_id), None)
            if item is None:
                raise KeyError(f"item not found: {item_id}")
            return item

    def next_version_for_template(
        self, workspace_id: str, item_id: str, template_id: str
    ) -> int:
        """返回该 item + template 的下一个 version 号。"""
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            item = next((it for it in rec.items if it.item_id == item_id), None)
            if item is None:
                raise KeyError(f"item not found: {item_id}")
            existing = [s for s in item.summaries if s.template == template_id]
            return max((s.version for s in existing), default=-1) + 1

    def add_item_summary(
        self, workspace_id: str, item_id: str, summary: ItemSummary
    ) -> ItemSummary:
        """向 item.summaries 追加一份总结并落盘。"""
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            item = next((it for it in rec.items if it.item_id == item_id), None)
            if item is None:
                raise KeyError(f"item not found: {item_id}")
            item.summaries.append(summary)
            item.updated_at = _now_iso()
            self._save(rec)
            return summary

    def delete_item_summary(
        self, workspace_id: str, item_id: str, summary_id: str
    ) -> bool:
        """硬删指定 summary，返回是否找到并删除。"""
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            item = next((it for it in rec.items if it.item_id == item_id), None)
            if item is None:
                raise KeyError(f"item not found: {item_id}")
            before = len(item.summaries)
            item.summaries = [s for s in item.summaries if s.summary_id != summary_id]
            if len(item.summaries) == before:
                return False
            item.updated_at = _now_iso()
            self._save(rec)
            return True

    def rename_item_summary(
        self, workspace_id: str, item_id: str, summary_id: str, name: str
    ) -> "ItemSummary":
        """改名指定 summary 并落盘。"""
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            item = next((it for it in rec.items if it.item_id == item_id), None)
            if item is None:
                raise KeyError(f"item not found: {item_id}")
            summary = next((s for s in item.summaries if s.summary_id == summary_id), None)
            if summary is None:
                raise KeyError(f"summary not found: {summary_id}")
            summary.name = name
            self._save(rec)
            return summary

    # ── InlineFrames ──────────────────────────────────────────

    def save_inline_frames(
        self, workspace_id: str, item_id: str, frames: List[InlineFrame]
    ) -> List[InlineFrame]:
        """整体覆盖 item.inline_frames 并落盘。"""
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            item = next((it for it in rec.items if it.item_id == item_id), None)
            if item is None:
                raise KeyError(f"item not found: {item_id}")
            item.inline_frames = frames
            item.updated_at = _now_iso()
            self._save(rec)
            return frames
