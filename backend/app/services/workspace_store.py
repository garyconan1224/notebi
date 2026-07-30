from __future__ import annotations

"""Workspace（工作空间）持久化存储。

实现风格完全对齐 backend/app/services/task_store.py：
- JSON 文件 + 原子写入（tmp + os.replace）
- 内存 dict 缓存 + threading.Lock 串行写
- 与 TaskStore 平级，互不耦合

存储路径：data/workspaces/<workspace_id>.json（每个 workspace 一个文件，
便于浏览/手工修改/未来分库；不像 task_store 把所有任务塞一个文件）。
"""

import copy
import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.app.models.workspace import (
    InlineFrame,
    ItemStatus,
    ItemSummary,
    WorkspaceBackground,
    WorkspaceItem,
    WorkspaceRecord,
    WorkspaceStatus,
)
from backend.app.services.note_assembler import note_dir
from backend.app.services.speaker_labels import apply_speaker_renames
from shared.config import DATA_DIR

WORKSPACE_DIR: Path = DATA_DIR / "workspaces"
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
        # ``target workspace -> [{workspace_id, item_id}]``.  The item remains
        # owned by its original workspace; a collection stores only this small
        # membership record, never a copied note/result/media payload.
        self._memberships: Dict[str, List[Dict[str, str]]] = {}
        self._load_all()
        self._load_memberships()

    # ── 内部：磁盘 I/O ────────────────────────────────────────

    def _file_path(self, workspace_id: str) -> Path:
        # 简单消毒：禁止跨目录；workspace_id 由后端生成（uuid），用户不应直接传任意字符串
        safe = workspace_id.replace("/", "_").replace("\\", "_").strip()
        return self.root / f"{safe}.json"

    @property
    def _membership_path(self) -> Path:
        return self.root / "_memberships.json"

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

    def _load_memberships(self) -> None:
        """Read membership data defensively so an old workspace directory works.

        Memberships are deliberately external to ``WorkspaceRecord``: old JSON
        files stay valid and the canonical item has exactly one serialized home.
        """
        try:
            data = json.loads(self._membership_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return
        if not isinstance(data, dict):
            return
        for target_id, refs in data.items():
            if target_id not in self._records or not isinstance(refs, list):
                continue
            cleaned: List[Dict[str, str]] = []
            seen: set[Tuple[str, str]] = set()
            for ref in refs:
                if not isinstance(ref, dict):
                    continue
                source_id = str(ref.get("workspace_id") or "").strip()
                item_id = str(ref.get("item_id") or "").strip()
                if not source_id or not item_id or (source_id, item_id) in seen:
                    continue
                if self._find_local_item(source_id, item_id) is None:
                    continue
                seen.add((source_id, item_id))
                cleaned.append({"workspace_id": source_id, "item_id": item_id})
            if cleaned:
                self._memberships[str(target_id)] = cleaned

    def _save(self, rec: WorkspaceRecord) -> None:
        rec.updated_at = _now_iso()
        data = json.dumps(rec.to_dict(), ensure_ascii=False, indent=2)
        _atomic_write(self._file_path(rec.workspace_id), data)

    def _save_memberships(self) -> None:
        _atomic_write(
            self._membership_path,
            json.dumps(self._memberships, ensure_ascii=False, indent=2),
        )

    def _find_local_item(self, workspace_id: str, item_id: str) -> Optional[WorkspaceItem]:
        rec = self._records.get(workspace_id)
        if rec is None:
            return None
        return next((item for item in rec.items if item.item_id == item_id), None)

    def _locate_item(self, workspace_id: str, item_id: str) -> Tuple[WorkspaceRecord, WorkspaceItem]:
        """Resolve a member reference to the one workspace that owns its data."""
        direct = self._records.get(workspace_id)
        if direct is None:
            raise KeyError(f"workspace not found: {workspace_id}")
        item = self._find_local_item(workspace_id, item_id)
        if item is not None:
            return direct, item
        for ref in self._memberships.get(workspace_id, []):
            if ref["item_id"] != item_id:
                continue
            owner = self._records.get(ref["workspace_id"])
            member = self._find_local_item(ref["workspace_id"], item_id)
            if owner is not None and member is not None:
                return owner, member
        raise KeyError(f"item not found: {item_id}")

    def _view(self, rec: WorkspaceRecord) -> WorkspaceRecord:
        """Return a read view with linked members while retaining one owner item."""
        view = copy.copy(rec)
        items = list(rec.items)
        known_ids = {item.item_id for item in items}
        for ref in self._memberships.get(rec.workspace_id, []):
            if ref["item_id"] in known_ids:
                continue
            item = self._find_local_item(ref["workspace_id"], ref["item_id"])
            if item is not None:
                items.append(item)
                known_ids.add(item.item_id)
        view.items = items
        return view

    def _remove_item_memberships(self, owner_workspace_id: str, item_id: str) -> bool:
        changed = False
        for target_id, refs in list(self._memberships.items()):
            kept = [
                ref for ref in refs
                if not (ref["workspace_id"] == owner_workspace_id and ref["item_id"] == item_id)
            ]
            if len(kept) != len(refs):
                changed = True
                self._unlink_member_note_dir(target_id, item_id)
            if kept:
                self._memberships[target_id] = kept
            else:
                self._memberships.pop(target_id, None)
        return changed

    def _unlink_member_note_dir(self, workspace_id: str, item_id: str) -> None:
        """Remove only our directory alias; never remove the canonical note."""
        alias = note_dir(workspace_id, item_id)
        if alias.is_symlink():
            try:
                alias.unlink()
            except OSError:
                pass

    # ── Workspace 级 CRUD ────────────────────────────────────

    def create(self, rec: WorkspaceRecord) -> WorkspaceRecord:
        with self._lock:
            self._records[rec.workspace_id] = rec
            self._save(rec)
        return rec

    def get(self, workspace_id: str) -> Optional[WorkspaceRecord]:
        if self._lock.acquire(timeout=0.2):
            try:
                rec = self._records.get(workspace_id)
                return self._view(rec) if rec is not None else None
            finally:
                self._lock.release()
        # 写入正在 fsync 时，读路径仍可返回内存快照，避免列表页被长时间阻塞。
        rec = self._records.get(workspace_id)
        return self._view(rec) if rec is not None else None

    def list_all(
        self,
        *,
        include_trashed: bool = False,
        trashed_only: bool = False,
    ) -> List[WorkspaceRecord]:
        """列出工作空间。

        默认仅返回非 trashed 的记录（主列表语义）。
        trashed_only=True：仅返回 trashed 的记录（垃圾桶视图）。
        include_trashed=True：返回全部（含 trashed），用于管理后台/调试。
        trashed_only 优先于 include_trashed。
        """
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
            changed = self._memberships.pop(workspace_id, None) is not None
            for target_id, refs in list(self._memberships.items()):
                kept = [ref for ref in refs if ref["workspace_id"] != workspace_id]
                if len(kept) != len(refs):
                    changed = True
                if kept:
                    self._memberships[target_id] = kept
                else:
                    self._memberships.pop(target_id, None)
            if changed:
                self._save_memberships()
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
            rec, target = self._locate_item(workspace_id, item_id)
            for k, v in kwargs.items():
                setattr(target, k, v)
            target.updated_at = _now_iso()
            self._save(rec)
            requested = self._records.get(workspace_id)
            return self._view(requested) if requested is not None else rec

    def append_item_result(
        self,
        workspace_id: str,
        item_id: str,
        key: str,
        value: object,
    ) -> WorkspaceRecord:
        """Atomically append one entry to a list stored inside item.results."""
        with self._lock:
            rec, target = self._locate_item(workspace_id, item_id)
            results = dict(target.results or {})
            entries = list(results.get(key) or [])
            entries.append(value)
            results[key] = entries
            target.results = results
            target.updated_at = _now_iso()
            self._save(rec)
            return rec

    def delete_item_result_entry(
        self,
        workspace_id: str,
        item_id: str,
        key: str,
        id_key: str,
        entry_id: str,
    ) -> bool:
        """Atomically remove one dict entry from a list inside item.results."""
        with self._lock:
            rec, target = self._locate_item(workspace_id, item_id)
            results = dict(target.results or {})
            entries = list(results.get(key) or [])
            kept = [
                entry for entry in entries
                if not isinstance(entry, dict) or str(entry.get(id_key) or "") != entry_id
            ]
            if len(kept) == len(entries):
                return False
            results[key] = kept
            target.results = results
            target.updated_at = _now_iso()
            self._save(rec)
            return True

    def remove_item(self, workspace_id: str, item_id: str) -> WorkspaceRecord:
        with self._lock:
            rec = self._records.get(workspace_id)
            if rec is None:
                raise KeyError(f"workspace not found: {workspace_id}")
            # A member is not content owned by this collection: removing it only
            # unlinks the relation and deliberately keeps tasks/files untouched.
            refs = self._memberships.get(workspace_id, [])
            kept_refs = [ref for ref in refs if ref["item_id"] != item_id]
            if len(kept_refs) != len(refs) and self._find_local_item(workspace_id, item_id) is None:
                if kept_refs:
                    self._memberships[workspace_id] = kept_refs
                else:
                    self._memberships.pop(workspace_id, None)
                self._save_memberships()
                self._unlink_member_note_dir(workspace_id, item_id)
                return self._view(rec)
            before = len(rec.items)
            rec.items = [it for it in rec.items if it.item_id != item_id]
            if len(rec.items) == before:
                raise KeyError(f"item not found: {item_id}")
            # 同步从收藏夹移除
            rec.favorites = [fid for fid in rec.favorites if fid != item_id]
            self._save(rec)
            if self._remove_item_memberships(workspace_id, item_id):
                self._save_memberships()
            return rec

    def is_member_reference(self, workspace_id: str, item_id: str) -> bool:
        with self._lock:
            return (
                self._find_local_item(workspace_id, item_id) is None
                and any(ref["item_id"] == item_id for ref in self._memberships.get(workspace_id, []))
            )

    def add_item_membership(
        self,
        target_workspace_id: str,
        source_workspace_id: str,
        item_id: str,
    ) -> bool:
        """Add one canonical item to a collection.  Returns False when already linked."""
        with self._lock:
            target = self._records.get(target_workspace_id)
            if target is None:
                raise KeyError(f"workspace not found: {target_workspace_id}")
            owner, item = self._locate_item(source_workspace_id, item_id)
            if owner.kind != target.kind:
                raise ValueError("workspace kind mismatch")
            if owner.workspace_id == target_workspace_id:
                return False
            refs = self._memberships.setdefault(target_workspace_id, [])
            if any(
                ref["workspace_id"] == owner.workspace_id
                and ref["item_id"] == item.item_id
                for ref in refs
            ):
                return False
            # The current route shape addresses a member by item_id.  Old data
            # can theoretically reuse the same item_id in two workspaces; do
            # not silently drop one of them until that route contract can use
            # content_id end-to-end.
            if any(ref["item_id"] == item.item_id for ref in refs):
                raise ValueError(
                    "item_id collision: target collection already contains a different canonical item with this item_id"
                )
            if self._find_local_item(target_workspace_id, item.item_id) is not None:
                raise ValueError(
                    "item_id collision: target collection owns a different item with this item_id"
                )
            refs.append({"workspace_id": owner.workspace_id, "item_id": item.item_id})
            self._save_memberships()
            source_note_dir = note_dir(owner.workspace_id, item.item_id)
            target_note_dir = note_dir(target_workspace_id, item.item_id)
            if source_note_dir.exists() and not target_note_dir.exists():
                try:
                    target_note_dir.parent.mkdir(parents=True, exist_ok=True)
                    target_note_dir.symlink_to(source_note_dir, target_is_directory=True)
                except OSError:
                    # The persisted membership remains authoritative.  A missing
                    # alias only affects optional note-file convenience paths and
                    # must not turn a successful membership request into a copy.
                    pass
            return True

    def promote_owned_items(
        self,
        source_workspace_id: str,
        target_workspace_id: str,
    ) -> List[str]:
        """Move canonical ownership without copying notes or result payloads.

        A workspace is a collection, not the identity of its notes.  Before a
        canonical owner can be permanently removed, its local items are moved
        to the stable inbox and every collection membership is rewired to that
        new owner.  Canonical note directories move with the owner; a regular
        per-collection directory is treated as a prior divergent-write conflict
        and refuses the destructive operation rather than overwriting it.
        """
        with self._lock:
            source = self._records.get(source_workspace_id)
            target = self._records.get(target_workspace_id)
            if source is None or target is None:
                raise KeyError("source or target workspace not found")
            if source_workspace_id == target_workspace_id:
                return []
            owned_items = list(source.items)
            if not owned_items:
                return []

            source_item_ids = {item.item_id for item in owned_items}
            existing_item_ids = {item.item_id for item in target.items}
            if source_item_ids & existing_item_ids:
                raise ValueError("item_id collision while promoting canonical items")

            # Preflight every filesystem mutation.  A real directory in a
            # collection is evidence of an old divergent write, not an alias
            # that we may discard automatically.
            for item in owned_items:
                canonical_dir = note_dir(source_workspace_id, item.item_id)
                target_dir = note_dir(target_workspace_id, item.item_id)
                if target_dir.exists() and not target_dir.is_symlink():
                    raise ValueError(
                        f"canonical note directory conflict for item {item.item_id}"
                    )
                for member_workspace_id, refs in self._memberships.items():
                    if member_workspace_id == source_workspace_id:
                        continue
                    if not any(
                        ref["workspace_id"] == source_workspace_id
                        and ref["item_id"] == item.item_id
                        for ref in refs
                    ):
                        continue
                    alias = note_dir(member_workspace_id, item.item_id)
                    if alias.exists() and not alias.is_symlink() and alias != canonical_dir:
                        raise ValueError(
                            f"member note directory conflict for item {item.item_id}"
                        )

            moved_dirs: List[Tuple[Path, Path]] = []
            try:
                for item in owned_items:
                    canonical_dir = note_dir(source_workspace_id, item.item_id)
                    target_dir = note_dir(target_workspace_id, item.item_id)
                    if target_dir.is_symlink():
                        target_dir.unlink()
                    if canonical_dir.exists():
                        target_dir.parent.mkdir(parents=True, exist_ok=True)
                        os.replace(canonical_dir, target_dir)
                        moved_dirs.append((canonical_dir, target_dir))
            except OSError as exc:
                for original_dir, moved_dir in reversed(moved_dirs):
                    try:
                        original_dir.parent.mkdir(parents=True, exist_ok=True)
                        os.replace(moved_dir, original_dir)
                    except OSError:
                        pass
                raise ValueError("could not move canonical note files") from exc

            source.items = []
            target.items.extend(owned_items)
            for member_workspace_id, refs in list(self._memberships.items()):
                rewritten: List[Dict[str, str]] = []
                seen: set[Tuple[str, str]] = set()
                for ref in refs:
                    if (
                        ref["workspace_id"] == source_workspace_id
                        and ref["item_id"] in source_item_ids
                    ):
                        if member_workspace_id == target_workspace_id:
                            # This used to be the target's membership.  It is
                            # now a local canonical item, so no reference stays.
                            continue
                        ref = {"workspace_id": target_workspace_id, "item_id": ref["item_id"]}
                    key = (ref["workspace_id"], ref["item_id"])
                    if key not in seen:
                        seen.add(key)
                        rewritten.append(ref)
                if rewritten:
                    self._memberships[member_workspace_id] = rewritten
                else:
                    self._memberships.pop(member_workspace_id, None)

            for member_workspace_id, refs in self._memberships.items():
                for ref in refs:
                    if ref["workspace_id"] != target_workspace_id or ref["item_id"] not in source_item_ids:
                        continue
                    alias = note_dir(member_workspace_id, ref["item_id"])
                    canonical_dir = note_dir(target_workspace_id, ref["item_id"])
                    if alias.is_symlink():
                        alias.unlink()
                    if canonical_dir.exists() and not alias.exists():
                        try:
                            alias.parent.mkdir(parents=True, exist_ok=True)
                            alias.symlink_to(canonical_dir, target_is_directory=True)
                        except OSError:
                            # Route file access resolves the canonical owner;
                            # the alias is only a compatibility convenience.
                            pass

            self._save(source)
            self._save(target)
            self._save_memberships()
            return [item.item_id for item in owned_items]

    def unlink_workspace_memberships(self, workspace_id: str) -> int:
        """Remove all memberships owned by a collection without touching notes."""
        with self._lock:
            refs = self._memberships.pop(workspace_id, [])
            if not refs:
                return 0
            self._save_memberships()
            for ref in refs:
                self._unlink_member_note_dir(workspace_id, ref["item_id"])
            return len(refs)

    def membership_count(self, workspace_id: str) -> int:
        with self._lock:
            return len(self._memberships.get(workspace_id, []))

    def owner_reference(self, workspace_id: str, item_id: str) -> Tuple[str, str]:
        with self._lock:
            owner, item = self._locate_item(workspace_id, item_id)
            return owner.workspace_id, item.item_id

    def member_workspace_ids(self, source_workspace_id: str, item_id: str) -> List[str]:
        with self._lock:
            return sorted(
                target_id
                for target_id, refs in self._memberships.items()
                if any(
                    ref["workspace_id"] == source_workspace_id and ref["item_id"] == item_id
                    for ref in refs
                )
            )

    # ── Summary 操作 ──────────────────────────────────────────

    def get_item(self, workspace_id: str, item_id: str) -> WorkspaceItem:
        """获取单个 item，找不到抛 KeyError。"""
        with self._lock:
            _, item = self._locate_item(workspace_id, item_id)
            return item

    def next_summary_version(self, workspace_id: str, item_id: str) -> int:
        """返回该素材的下一个总结版本号（所有模板共用连续序号）。"""
        with self._lock:
            _, item = self._locate_item(workspace_id, item_id)
            return max((s.version for s in item.summaries), default=-1) + 1

    def next_version_for_template(
        self, workspace_id: str, item_id: str, template_id: str
    ) -> int:
        """兼容旧调用：总结版本现已改为素材级连续编号。"""
        del template_id
        return self.next_summary_version(workspace_id, item_id)

    def add_item_summary(
        self, workspace_id: str, item_id: str, summary: ItemSummary
    ) -> ItemSummary:
        """向 item.summaries 追加一份总结并落盘。"""
        with self._lock:
            rec, item = self._locate_item(workspace_id, item_id)
            item.summaries.append(summary)
            item.updated_at = _now_iso()
            self._save(rec)
            return summary

    def update_speaker_summary_labels(
        self,
        workspace_id: str,
        item_id: str,
        speaker_map: Dict[str, str],
        previous_speaker_map: Optional[Dict[str, str]] = None,
    ) -> int:
        """把姓名改动同步到 JSON、主笔记和所有历史总结文件。"""
        with self._lock:
            rec, item = self._locate_item(workspace_id, item_id)
            old_map = previous_speaker_map or {
                str(key): str(value)
                for key, value in (item.results or {}).get("speaker_map", {}).items()
            }
            updated_count = 0
            for summary in item.summaries:
                content_md = apply_speaker_renames(
                    summary.content_md or "", old_map, speaker_map
                )
                if content_md == summary.content_md:
                    continue
                summary.content_md = content_md
                updated_count += 1
            rewritten_files = 0
            nd = note_dir(rec.workspace_id, item_id)
            for path in [nd / "note.md", *sorted(nd.glob("summaries/**/*.md"))]:
                if not path.exists():
                    continue
                current = path.read_text(encoding="utf-8")
                rewritten = apply_speaker_renames(current, old_map, speaker_map)
                if rewritten != current:
                    path.write_text(rewritten, encoding="utf-8")
                    rewritten_files += 1
            if updated_count or rewritten_files:
                item.updated_at = _now_iso()
                self._save(rec)
            return updated_count

    def delete_item_summary(
        self, workspace_id: str, item_id: str, summary_id: str
    ) -> bool:
        """硬删指定 summary，返回是否找到并删除。"""
        with self._lock:
            rec, item = self._locate_item(workspace_id, item_id)
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
            rec, item = self._locate_item(workspace_id, item_id)
            summary = next((s for s in item.summaries if s.summary_id == summary_id), None)
            if summary is None:
                raise KeyError(f"summary not found: {summary_id}")
            summary.name = name
            self._save(rec)
            return summary

    def update_item_summary_content(
        self,
        workspace_id: str,
        item_id: str,
        summary_id: str,
        content_md: str,
    ) -> "ItemSummary":
        """Persist one edited summary and its canonical Markdown companion."""
        with self._lock:
            rec, item = self._locate_item(workspace_id, item_id)
            summary = next((s for s in item.summaries if s.summary_id == summary_id), None)
            if summary is None:
                raise KeyError(f"summary not found: {summary_id}")
            summary.content_md = content_md
            item.updated_at = _now_iso()
            self._save(rec)

            summary_path = note_dir(rec.workspace_id, item_id) / "summaries" / summary.template / f"v{summary.version}.md"
            try:
                summary_path.parent.mkdir(parents=True, exist_ok=True)
                summary_path.write_text(content_md, encoding="utf-8")
            except OSError:
                # JSON is authoritative.  A stale optional companion file must
                # not make the user's saved summary appear to have failed.
                pass
            return summary

    # ── InlineFrames ──────────────────────────────────────────

    def save_inline_frames(
        self, workspace_id: str, item_id: str, frames: List[InlineFrame]
    ) -> List[InlineFrame]:
        """整体覆盖 item.inline_frames 并落盘。"""
        with self._lock:
            rec, item = self._locate_item(workspace_id, item_id)
            item.inline_frames = frames
            item.updated_at = _now_iso()
            self._save(rec)
            return frames
