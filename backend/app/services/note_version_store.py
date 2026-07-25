"""Durable, append-only user note body versions."""

from __future__ import annotations

import hashlib
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from shared.config import DATA_DIR

VERSION_SOURCES = {"BASELINE", "USER_EDIT", "RESTORE", "ADOPT_FROM_SIBLING"}


class NoteVersionStore:
    def __init__(self, path: Optional[Path] = None) -> None:
        self.path = path or DATA_DIR / ".local" / "metadata.sqlite3"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS note_versions (
                    version_id TEXT PRIMARY KEY,
                    content_id TEXT NOT NULL,
                    version_no INTEGER NOT NULL,
                    body_md TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    source TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(content_id, version_no)
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_note_versions_content "
                "ON note_versions(content_id,version_no DESC)"
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        return connection

    def checkpoint(
        self, content_id: str, body_md: str, source: str,
    ) -> Optional[dict[str, Any]]:
        if source not in VERSION_SOURCES:
            raise ValueError(f"unsupported version source: {source}")
        digest = hashlib.sha256(body_md.encode("utf-8")).hexdigest()
        with self._connect() as connection:
            latest = connection.execute(
                "SELECT content_hash FROM note_versions WHERE content_id=? "
                "ORDER BY version_no DESC LIMIT 1",
                (content_id,),
            ).fetchone()
            if latest and latest["content_hash"] == digest:
                return None
            row = connection.execute(
                "SELECT COALESCE(MAX(version_no),0)+1 next_no "
                "FROM note_versions WHERE content_id=?",
                (content_id,),
            ).fetchone()
            version = {
                "version_id": str(uuid.uuid4()),
                "content_id": content_id,
                "version_no": int(row["next_no"]),
                "body_md": body_md,
                "content_hash": digest,
                "source": source,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            connection.execute(
                "INSERT INTO note_versions VALUES("
                ":version_id,:content_id,:version_no,:body_md,:content_hash,"
                ":source,:created_at)",
                version,
            )
            return version

    def list(self, content_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            return [
                {
                    **dict(row),
                    "preview": str(row["body_md"]).replace("\n", " ")[:120],
                }
                for row in connection.execute(
                    "SELECT version_id,content_id,version_no,content_hash,source,"
                    "created_at,body_md FROM note_versions WHERE content_id=? "
                    "ORDER BY version_no DESC",
                    (content_id,),
                )
            ]

    def get(self, content_id: str, version_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM note_versions WHERE content_id=? AND version_id=?",
                (content_id, version_id),
            ).fetchone()
        if row is None:
            raise KeyError(f"note version not found: {version_id}")
        return dict(row)
