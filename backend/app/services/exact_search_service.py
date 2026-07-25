"""Local exact search over content fields without model calls."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable, Optional

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services import workspace_knowledge
from backend.app.services.search_index_store import SearchIndexStore
from backend.app.services.workspace_search_service import _jump_url
from backend.app.services.workspace_store import WorkspaceStore
from shared.config import DATA_DIR


class ExactSearchService:
    """Build and query the derived exact-search index."""

    def __init__(
        self,
        *,
        store: Optional[WorkspaceStore] = None,
        task_store: Any = None,
        database_path: Optional[Path] = None,
    ) -> None:
        self.store = store or WorkspaceStore()
        self.task_store = task_store
        self.index = SearchIndexStore(
            database_path or DATA_DIR / ".local" / "search_index.sqlite3"
        )

    def _signature(self, records: list[WorkspaceRecord]) -> str:
        payload = [
            {
                "workspace_id": record.workspace_id,
                "updated_at": record.updated_at,
                "items": [
                    {
                        "item_id": item.item_id,
                        "content_id": item.content_id,
                        "updated_at": item.updated_at,
                        "summaries": len(item.summaries),
                        "tags": item.tags,
                    }
                    for item in record.items
                ],
            }
            for record in records
        ]
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _base(
        self,
        record: WorkspaceRecord,
        item: WorkspaceItem,
        field: str,
        segment_id: str,
        content: str,
        *,
        start_ms: Optional[int] = None,
        end_ms: Optional[int] = None,
    ) -> dict[str, Any]:
        tag_values = sorted(
            {
                str(tag)
                for values in item.tags.values()
                for tag in (values if isinstance(values, list) else [values])
                if str(tag).strip()
            }
        )
        return {
            "source_id": (
                f"{record.workspace_id}:{item.item_id}:{field}:{segment_id}"
            ),
            "workspace_id": record.workspace_id,
            "workspace_name": record.name,
            "item_id": item.item_id,
            "content_id": item.content_id,
            "item_type": item.type,
            "item_title": item.name or item.source_value or item.item_id,
            "field": field,
            "segment_id": segment_id,
            "start_ms": start_ms,
            "end_ms": end_ms,
            "content": content,
            "tags": "\n".join(tag_values),
        }

    def _item_rows(
        self,
        record: WorkspaceRecord,
        item: WorkspaceItem,
    ) -> Iterable[dict[str, Any]]:
        results = workspace_knowledge._resolve_item_results(item, self.task_store)
        if item.name:
            yield self._base(record, item, "title", "title", item.name)
        for index, segment in enumerate(results.get("transcript_segments") or []):
            if not isinstance(segment, dict) or not str(segment.get("text") or "").strip():
                continue
            start = segment.get("start")
            end = segment.get("end")
            yield self._base(
                record,
                item,
                "transcript",
                f"transcript-{index}",
                str(segment["text"]),
                start_ms=round(float(start) * 1000) if isinstance(start, (int, float)) else None,
                end_ms=round(float(end) * 1000) if isinstance(end, (int, float)) else None,
            )
        for summary in item.summaries:
            if summary.content_md.strip():
                yield self._base(
                    record,
                    item,
                    "summary",
                    summary.summary_id,
                    summary.content_md,
                )
        note = next(
            (
                str(results[key])
                for key in ("content_md", "user_notes", "note", "learning_note")
                if isinstance(results.get(key), str) and str(results[key]).strip()
            ),
            "",
        )
        if note:
            yield self._base(record, item, "note", "current", note)
        if item.tags:
            tags = " ".join(
                str(tag)
                for values in item.tags.values()
                for tag in (values if isinstance(values, list) else [values])
            )
            yield self._base(record, item, "tags", "tags", tags)

    def rebuild(self) -> dict[str, Any]:
        """Rebuild the complete derived index from active JSON workspaces."""

        records = self.store.list_all(include_trashed=False)
        rows = [
            row
            for record in records
            for item in record.items
            for row in self._item_rows(record, item)
        ]
        return self.index.rebuild(rows, signature=self._signature(records))

    def search(
        self,
        query: str,
        *,
        workspace_ids: Optional[list[str]] = None,
        item_types: Optional[list[str]] = None,
        tags: Optional[list[str]] = None,
        top_k: int = 30,
    ) -> dict[str, Any]:
        """Return exact matches and never invoke embedding, reranker, or LLM."""

        records = self.store.list_all(include_trashed=False)
        signature = self._signature(records)
        if self.index.signature() != signature:
            self.rebuild()
        try:
            rows = self.index.search(
                query,
                workspace_ids=workspace_ids,
                item_types=item_types,
                tags=tags,
                limit=top_k,
            )
        except sqlite3.DatabaseError:
            self.rebuild()
            rows = self.index.search(query, limit=top_k)
        sources = []
        for row in rows:
            jump = _jump_url(row["workspace_id"], row["item_id"], row["item_type"])
            if row["start_ms"] is not None:
                jump += f"?start_ms={row['start_ms']}&field={row['field']}"
            sources.append(
                {
                    **{key: row[key] for key in (
                        "source_id", "workspace_id", "workspace_name", "item_id",
                        "content_id",
                        "item_type", "item_title", "field", "segment_id",
                        "start_ms", "end_ms",
                    )},
                    "excerpt": row["content"][:500],
                    "chunk_excerpt": row["content"][:200],
                    "score": 1.0,
                    "jump_url": jump,
                }
            )
        return {"answer": "", "sources": sources, "mode": "exact"}
