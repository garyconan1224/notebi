"""SQLite-backed, fully rebuildable exact-search index."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Iterable, Optional


class SearchIndexStore:
    """Persist derived search chunks without becoming a source of truth."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _create_schema(self, connection: sqlite3.Connection) -> bool:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS search_chunks (
                source_id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                workspace_name TEXT NOT NULL,
                item_id TEXT NOT NULL,
                content_id TEXT NOT NULL,
                lineage_id TEXT NOT NULL DEFAULT '',
                source_type TEXT NOT NULL DEFAULT 'content',
                item_type TEXT NOT NULL,
                item_title TEXT NOT NULL,
                field TEXT NOT NULL,
                segment_id TEXT NOT NULL,
                start_ms INTEGER,
                end_ms INTEGER,
                content TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_search_scope
                ON search_chunks(workspace_id, item_type, field);
            """
        )
        columns = {
            str(row["name"])
            for row in connection.execute("PRAGMA table_info(search_chunks)")
        }
        if "content_id" not in columns:
            connection.execute(
                "ALTER TABLE search_chunks ADD COLUMN content_id TEXT NOT NULL DEFAULT ''"
            )
        if "lineage_id" not in columns:
            connection.execute(
                "ALTER TABLE search_chunks ADD COLUMN lineage_id TEXT NOT NULL DEFAULT ''"
            )
        if "source_type" not in columns:
            connection.execute(
                "ALTER TABLE search_chunks ADD COLUMN source_type TEXT NOT NULL DEFAULT 'content'"
            )
        try:
            connection.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS search_chunks_fts
                USING fts5(content, content='search_chunks', content_rowid='rowid')
                """
            )
            return True
        except sqlite3.OperationalError:
            return False

    def rebuild(
        self,
        rows: Iterable[dict[str, Any]],
        *,
        signature: str,
    ) -> dict[str, Any]:
        """Replace the derived index atomically at transaction level."""

        try:
            connection = self._connect()
            connection.execute("PRAGMA quick_check")
        except sqlite3.DatabaseError:
            self.path.unlink(missing_ok=True)
            connection = self._connect()
        with connection:
            fts5 = self._create_schema(connection)
            connection.execute("DELETE FROM search_chunks")
            connection.execute("DELETE FROM schema_meta")
            payload = list(rows)
            connection.executemany(
                """
                INSERT INTO search_chunks (
                    source_id, workspace_id, workspace_name, item_id, content_id,
                    lineage_id, source_type,
                    item_type, item_title, field, segment_id, start_ms,
                    end_ms, content, tags
                ) VALUES (
                    :source_id, :workspace_id, :workspace_name, :item_id, :content_id,
                    :lineage_id, :source_type,
                    :item_type, :item_title, :field, :segment_id, :start_ms,
                    :end_ms, :content, :tags
                )
                """,
                payload,
            )
            if fts5:
                connection.execute(
                    "INSERT INTO search_chunks_fts(search_chunks_fts) VALUES('rebuild')"
                )
            connection.executemany(
                "INSERT INTO schema_meta(key, value) VALUES(?, ?)",
                [
                    ("schema_version", "3"),
                    ("signature", signature),
                    ("fts5", "1" if fts5 else "0"),
                ],
            )
        connection.close()
        return {
            "chunk_count": len(payload),
            "fts5": fts5,
            "database_bytes": self.path.stat().st_size,
        }

    def signature(self) -> Optional[str]:
        """Return the source signature stored in the index."""

        if not self.path.exists():
            return None
        try:
            with self._connect() as connection:
                row = connection.execute(
                    "SELECT value FROM schema_meta WHERE key='signature'"
                ).fetchone()
                return str(row["value"]) if row else None
        except sqlite3.DatabaseError:
            return None

    def search(
        self,
        query: str,
        *,
        workspace_ids: Optional[list[str]] = None,
        item_refs: Optional[list[dict[str, str]]] = None,
        item_types: Optional[list[str]] = None,
        tags: Optional[list[str]] = None,
        limit: int = 30,
    ) -> list[dict[str, Any]]:
        """Search locally, using FTS5 when safe and LIKE as portable fallback."""

        filters: list[str] = []
        params: list[Any] = []
        scope_filters: list[str] = []
        scope_params: list[Any] = []
        if workspace_ids:
            scope_filters.append(
                f"c.workspace_id IN ({','.join('?' for _ in workspace_ids)})"
            )
            scope_params.extend(workspace_ids)
        if item_refs:
            item_filters: list[str] = []
            for ref in item_refs:
                workspace_id = str(ref.get("workspace_id") or "")
                item_id = str(ref.get("item_id") or "")
                if not workspace_id or not item_id:
                    continue
                item_filters.append("(c.workspace_id = ? AND c.item_id = ?)")
                scope_params.extend([workspace_id, item_id])
            if item_filters:
                scope_filters.append("(" + " OR ".join(item_filters) + ")")
        if scope_filters:
            filters.append("(" + " OR ".join(scope_filters) + ")")
            params.extend(scope_params)
        if item_types:
            filters.append(
                f"c.item_type IN ({','.join('?' for _ in item_types)})"
            )
            params.extend(item_types)
        for tag in tags or []:
            filters.append("c.tags LIKE ?")
            params.append(f"%{tag}%")
        where = f" AND {' AND '.join(filters)}" if filters else ""
        has_cjk = any("\u3400" <= character <= "\u9fff" for character in query)
        with self._connect() as connection:
            fts_row = connection.execute(
                "SELECT value FROM schema_meta WHERE key='fts5'"
            ).fetchone()
            if fts_row and fts_row["value"] == "1" and not has_cjk:
                sql = (
                    "SELECT c.* FROM search_chunks_fts f "
                    "JOIN search_chunks c ON c.rowid=f.rowid "
                    f"WHERE f.content MATCH ?{where} LIMIT ?"
                )
                values = [query, *params, limit]
            else:
                sql = (
                    "SELECT c.* FROM search_chunks c "
                    f"WHERE c.content LIKE ?{where} LIMIT ?"
                )
                values = [f"%{query}%", *params, limit]
            return [dict(row) for row in connection.execute(sql, values)]

    def suggest(self, prefix: str, limit: int = 8) -> list[str]:
        """Return local title/tag suggestions without model calls."""

        needle = f"%{prefix.strip()}%"
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT content,COUNT(*) frequency FROM search_chunks "
                "WHERE field IN ('title','tags') AND content LIKE ? "
                "GROUP BY content ORDER BY frequency DESC,LENGTH(content),content LIMIT ?",
                (needle, limit),
            )
            return [str(row["content"]).strip() for row in rows if str(row["content"]).strip()]
