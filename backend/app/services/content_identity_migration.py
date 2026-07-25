"""Dry-run, backup, apply, validate, and rollback content identities."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.app.models.workspace import WorkspaceRecord


def _workspace_files(root: Path) -> list[Path]:
    return sorted(path for path in root.glob("*.json") if path.is_file())


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    descriptor, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def inspect_content_identities(root: Path) -> dict[str, Any]:
    """Return deterministic migration output without writing."""

    workspaces = 0
    items = 0
    changed_items = 0
    content_ids: set[str] = set()
    lineages: dict[str, set[str]] = {}
    payloads: dict[Path, dict[str, Any]] = {}
    for path in _workspace_files(root):
        raw = json.loads(path.read_text(encoding="utf-8"))
        record = WorkspaceRecord.from_dict(raw)
        migrated = record.to_dict()
        payloads[path] = migrated
        workspaces += 1
        items += len(record.items)
        for before, after in zip(raw.get("items") or [], migrated["items"]):
            if any(
                before.get(key) != after.get(key)
                for key in (
                    "content_id",
                    "lineage_id",
                    "origin_content_id",
                    "legacy_item_id",
                )
            ):
                changed_items += 1
            content_id = str(after["content_id"])
            if content_id in content_ids:
                raise ValueError(f"duplicate content_id: {content_id}")
            content_ids.add(content_id)
            lineages.setdefault(str(after["lineage_id"]), set()).add(content_id)
    return {
        "workspace_count": workspaces,
        "item_count": items,
        "changed_item_count": changed_items,
        "content_id_count": len(content_ids),
        "lineage_count": len(lineages),
        "payloads": payloads,
    }


def migrate_content_identities(root: Path, backup_root: Path) -> dict[str, Any]:
    """Back up all workspace JSON before applying an idempotent migration."""

    report = inspect_content_identities(root)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_dir = backup_root / f"content-identity-{stamp}"
    backup_dir.mkdir(parents=True, exist_ok=False)
    for source in _workspace_files(root):
        shutil.copy2(source, backup_dir / source.name)
    try:
        for path, payload in report.pop("payloads").items():
            _atomic_json(path, payload)
        verified = inspect_content_identities(root)
        if verified["item_count"] != report["item_count"]:
            raise RuntimeError("item count changed during migration")
        if verified["content_id_count"] != verified["item_count"]:
            raise RuntimeError("content identities are not unique")
    except Exception:
        rollback_content_identities(root, backup_dir)
        raise
    report["backup_dir"] = str(backup_dir)
    report["verified"] = True
    return report


def rollback_content_identities(root: Path, backup_dir: Path) -> dict[str, int]:
    """Restore the exact JSON snapshot created before migration."""

    backups = _workspace_files(backup_dir)
    if not backups:
        raise ValueError(f"backup is empty: {backup_dir}")
    for current in _workspace_files(root):
        current.unlink()
    for source in backups:
        shutil.copy2(source, root / source.name)
    return {"restored_workspace_count": len(backups)}
