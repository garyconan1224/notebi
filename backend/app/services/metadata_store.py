"""SQLite authority for relational content metadata."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

from backend.app.models.workspace import WorkspaceRecord
from shared.config import DATA_DIR

DEFAULT_FAVORITE_GROUP_ID = "default"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalized(value: str) -> str:
    return " ".join(value.strip().split()).casefold()


class MetadataStore:
    def __init__(self, path: Optional[Path] = None) -> None:
        self.path = path or DATA_DIR / ".local" / "metadata.sqlite3"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                PRAGMA foreign_keys=ON;
                CREATE TABLE IF NOT EXISTS schema_meta (
                    key TEXT PRIMARY KEY, value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tags (
                    tag_id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    normalized_name TEXT NOT NULL, dimension TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(dimension, normalized_name)
                );
                CREATE TABLE IF NOT EXISTS content_tags (
                    content_id TEXT NOT NULL, tag_id TEXT NOT NULL,
                    source TEXT NOT NULL CHECK(source IN ('AUTO','MANUAL')),
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(content_id, tag_id, source),
                    FOREIGN KEY(tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS folders (
                    folder_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
                    parent_id TEXT, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
                    UNIQUE(workspace_id, parent_id, normalized_name)
                );
                CREATE TABLE IF NOT EXISTS content_folders (
                    content_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
                    folder_id TEXT NOT NULL,
                    FOREIGN KEY(folder_id) REFERENCES folders(folder_id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS favorite_groups (
                    group_id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    normalized_name TEXT NOT NULL UNIQUE,
                    sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS favorite_items (
                    group_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
                    content_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(group_id, workspace_id, content_id),
                    FOREIGN KEY(group_id) REFERENCES favorite_groups(group_id) ON DELETE CASCADE
                );
                """
            )
            connection.execute(
                "INSERT OR IGNORE INTO favorite_groups VALUES(?,?,?,?,?)",
                (DEFAULT_FAVORITE_GROUP_ID, "默认收藏", "默认收藏", 0, _now()),
            )
            connection.execute(
                "INSERT OR REPLACE INTO schema_meta VALUES('schema_version','1')"
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def migrate_legacy(self, records: Iterable[WorkspaceRecord]) -> int:
        inserted = 0
        with self._connect() as connection:
            for record in records:
                favorites = set(record.favorites)
                for item in record.items:
                    if item.item_id in favorites:
                        before = connection.total_changes
                        connection.execute(
                            "INSERT OR IGNORE INTO favorite_items VALUES(?,?,?,?,?)",
                            (DEFAULT_FAVORITE_GROUP_ID, record.workspace_id,
                             item.content_id, "", _now()),
                        )
                        inserted += connection.total_changes - before
                    self.replace_tags(item.content_id, item.tags, "AUTO", connection)
        return inserted

    def replace_tags(
        self, content_id: str, tags: dict[str, Any], source: str,
        connection: Optional[sqlite3.Connection] = None,
    ) -> None:
        owned = connection is None
        db = connection or self._connect()
        try:
            db.execute(
                "DELETE FROM content_tags WHERE content_id=? AND source=?",
                (content_id, source),
            )
            for dimension, raw in tags.items():
                if str(dimension).startswith("_"):
                    continue
                values = raw if isinstance(raw, list) else [raw]
                for value in values:
                    name = " ".join(str(value).strip().split())
                    if not name:
                        continue
                    normalized = _normalized(name)
                    row = db.execute(
                        "SELECT tag_id FROM tags WHERE dimension=? AND normalized_name=?",
                        (dimension, normalized),
                    ).fetchone()
                    tag_id = str(row["tag_id"]) if row else str(uuid.uuid4())
                    db.execute(
                        "INSERT OR IGNORE INTO tags VALUES(?,?,?,?,?)",
                        (tag_id, name, normalized, dimension, _now()),
                    )
                    db.execute(
                        "INSERT OR IGNORE INTO content_tags VALUES(?,?,?,?)",
                        (content_id, tag_id, source, _now()),
                    )
            if owned:
                db.commit()
        finally:
            if owned:
                db.close()

    def tags_for_content(
        self, content_id: str, source: Optional[str] = None,
    ) -> dict[str, Any]:
        params: list[Any] = [content_id]
        source_filter = ""
        if source:
            source_filter = " AND ct.source=?"
            params.append(source)
        with self._connect() as db:
            rows = db.execute(
                "SELECT t.dimension,t.name FROM content_tags ct "
                "JOIN tags t USING(tag_id) WHERE ct.content_id=?" + source_filter,
                params,
            )
            output: dict[str, Any] = {}
            for row in rows:
                dimension, name = str(row["dimension"]), str(row["name"])
                if dimension == "custom_tags":
                    output.setdefault(dimension, []).append(name)
                else:
                    output[dimension] = name
            return output

    def create_folder(
        self, workspace_id: str, name: str, parent_id: Optional[str] = None,
    ) -> dict[str, Any]:
        clean = " ".join(name.strip().split())
        if not clean:
            raise ValueError("folder name cannot be empty")
        with self._connect() as db:
            if parent_id and not db.execute(
                "SELECT 1 FROM folders WHERE folder_id=? AND workspace_id=?",
                (parent_id, workspace_id),
            ).fetchone():
                raise ValueError("parent folder belongs to another workspace")
            folder_id = str(uuid.uuid4())
            db.execute(
                "INSERT INTO folders VALUES(?,?,?,?,?,?,?)",
                (folder_id, workspace_id, parent_id, clean, _normalized(clean), 0, _now()),
            )
        return {"folder_id": folder_id, "workspace_id": workspace_id,
                "parent_id": parent_id, "name": clean}

    def list_folders(self, workspace_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT * FROM folders WHERE workspace_id=? ORDER BY sort_order,name",
                (workspace_id,),
            )]

    def delete_folder(self, workspace_id: str, folder_id: str) -> None:
        with self._connect() as db:
            db.execute(
                "DELETE FROM folders WHERE folder_id=? AND workspace_id=?",
                (folder_id, workspace_id),
            )

    def move_content(self, workspace_id: str, content_id: str, folder_id: str) -> None:
        with self._connect() as db:
            if not db.execute(
                "SELECT 1 FROM folders WHERE folder_id=? AND workspace_id=?",
                (folder_id, workspace_id),
            ).fetchone():
                raise ValueError("folder belongs to another workspace")
            db.execute(
                "INSERT OR REPLACE INTO content_folders VALUES(?,?,?)",
                (content_id, workspace_id, folder_id),
            )

    def create_favorite_group(self, name: str) -> dict[str, Any]:
        clean = " ".join(name.strip().split())
        if not clean:
            raise ValueError("group name cannot be empty")
        group_id = str(uuid.uuid4())
        with self._connect() as db:
            db.execute(
                "INSERT INTO favorite_groups VALUES(?,?,?,?,?)",
                (group_id, clean, _normalized(clean), 0, _now()),
            )
        return {"group_id": group_id, "name": clean}

    def list_favorite_groups(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT g.*,COUNT(i.content_id) item_count FROM favorite_groups g "
                "LEFT JOIN favorite_items i USING(group_id) GROUP BY g.group_id "
                "ORDER BY g.sort_order,g.created_at"
            )]

    def delete_favorite_group(self, group_id: str) -> None:
        if group_id == DEFAULT_FAVORITE_GROUP_ID:
            raise ValueError("default favorite group cannot be deleted")
        with self._connect() as db:
            db.execute("DELETE FROM favorite_groups WHERE group_id=?", (group_id,))

    def favorite_items(self, group_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT workspace_id,content_id,note,created_at "
                "FROM favorite_items WHERE group_id=? ORDER BY created_at DESC",
                (group_id,),
            )]

    def set_favorite(
        self, workspace_id: str, content_id: str,
        group_id: str = DEFAULT_FAVORITE_GROUP_ID,
    ) -> None:
        with self._connect() as db:
            db.execute(
                "INSERT OR IGNORE INTO favorite_items VALUES(?,?,?,?,?)",
                (group_id, workspace_id, content_id, "", _now()),
            )

    def remove_favorite(self, workspace_id: str, content_id: str) -> None:
        with self._connect() as db:
            db.execute(
                "DELETE FROM favorite_items WHERE workspace_id=? AND content_id=?",
                (workspace_id, content_id),
            )

    def favorite_content_ids(self, workspace_id: str) -> set[str]:
        with self._connect() as db:
            return {
                str(row["content_id"])
                for row in db.execute(
                    "SELECT DISTINCT content_id FROM favorite_items WHERE workspace_id=?",
                    (workspace_id,),
                )
            }
