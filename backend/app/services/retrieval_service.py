"""Authoritative orchestration for smart and exact retrieval."""

from __future__ import annotations

import re
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.app.services import workspace_knowledge
from backend.app.services import workspace_search_service
from backend.app.services.exact_search_service import ExactSearchService
from backend.app.services.workspace_store import WorkspaceStore
from shared.runtime_llm_config import get_embedding_model_for_rag
from shared.settings_store import load_settings


_CITATION_RE = re.compile(r"\[(\d+)\]")
_SOURCE_CITATION_RE = re.compile(r"\[source:([A-Za-z0-9._:-]+)\]")


def _record_indexable_content_count(record: Any, task_store: Any) -> int:
    item_count = sum(
        workspace_knowledge._item_has_data(item, task_store)
        for item in record.items
    )
    merged_count = sum(
        bool(
            not note.deleted_at
            and note.current_version_id
            and note.content_md.strip()
        )
        for note in record.merged_notes
    )
    return item_count + merged_count


def _extract_citations(
    answer: str,
    sources: List[Dict[str, Any]],
    *,
    include_warnings: bool = False,
) -> Any:
    """Extract valid [n] citations from answer, map to source_id.

    Rules:
    - Only 1-based indices within range of sources are valid.
    - Duplicates are removed (first occurrence wins).
    - Out-of-range indices are silently discarded.
    - Returns [] when no valid citations found.
    """
    if not answer or not sources:
        return ([], []) if include_warnings else []
    by_id = {
        str(source.get("source_id") or ""): source
        for source in sources
        if source.get("source_id")
    }
    seen_ids: set[str] = set()
    citations: List[Dict[str, Any]] = []
    warnings: List[str] = []
    for match in _SOURCE_CITATION_RE.finditer(answer):
        source_id = match.group(1)
        if source_id not in by_id:
            warning = f"unknown citation source_id: {source_id}"
            if warning not in warnings:
                warnings.append(warning)
            continue
        if source_id in seen_ids:
            continue
        seen_ids.add(source_id)
        citations.append({"number": len(citations) + 1, "source_id": source_id})

    # Backward-compatible parsing for old model responses during migration.
    seen_numbers: set[int] = set()
    for match in _CITATION_RE.finditer(answer):
        num = int(match.group(1))
        if num < 1 or num > len(sources):
            continue
        if num in seen_numbers:
            continue
        seen_numbers.add(num)
        source = sources[num - 1]
        source_id = str(source.get("source_id") or "")
        if not source_id or source_id in seen_ids:
            continue
        seen_ids.add(source_id)
        citations.append({"number": num, "source_id": source_id})
    return (citations, warnings) if include_warnings else citations


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class RetrievalService:
    """Coordinate cache lifecycle, filters, retrieval, and compatibility."""

    _lock = threading.Lock()
    _rebuild: Dict[str, Any] = {
        "running": False,
        "started_at": None,
        "finished_at": None,
        "error": None,
    }

    def __init__(
        self,
        *,
        store: Optional[WorkspaceStore] = None,
        task_store: Any = None,
        exact_service: Optional[ExactSearchService] = None,
    ) -> None:
        self.store = store or workspace_search_service.WorkspaceStore()
        self.task_store = task_store
        self.exact_service = exact_service or ExactSearchService(
            store=self.store,
            task_store=task_store,
        )

    def search(
        self,
        *,
        query: str,
        mode: str = "smart",
        top_k: int = 10,
        workspace_ids: Optional[List[str]] = None,
        item_refs: Optional[List[Dict[str, str]]] = None,
        item_types: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Search using one public contract."""

        if mode == "exact":
            result = self.exact_service.search(
                query,
                workspace_ids=workspace_ids,
                item_refs=item_refs,
                item_types=item_types,
                tags=tags,
                top_k=top_k,
            )
            result["citations"] = []
            result["status"] = self.status()
            return result
        if mode == "hybrid":
            semantic = self.search(
                query=query,
                mode="smart",
                top_k=top_k,
                workspace_ids=workspace_ids,
                item_refs=item_refs,
                item_types=item_types,
                tags=tags,
            )
            exact = self.exact_service.search(
                query,
                workspace_ids=workspace_ids,
                item_refs=item_refs,
                item_types=item_types,
                tags=tags,
                top_k=top_k,
            )
            semantic["sources"] = self._rrf_sources(
                semantic.get("sources", []),
                exact.get("sources", []),
                top_k,
            )
            semantic["mode"] = "hybrid"
            # Re-extract citations against fused sources
            semantic["citations"] = _extract_citations(
                semantic.get("answer", ""), semantic.get("sources", [])
            )
            return semantic
        if mode != "smart":
            raise ValueError(f"unsupported search mode: {mode}")
        result = workspace_search_service.search_across_workspaces(
            query=query,
            top_k=top_k,
            workspace_ids=workspace_ids,
            item_refs=item_refs,
            item_types=item_types,
            tags=tags,
            store=self.store,
            task_store=self.task_store,
        )
        identities = {
            (record.workspace_id, item.item_id): item.content_id
            for record in self.store.list_all(include_trashed=False)
            for item in record.items
        }
        for source in result.get("sources", []):
            source["content_id"] = identities.get(
                (source.get("workspace_id"), source.get("item_id")),
                "",
            )
        result["mode"] = mode
        citations, warnings = _extract_citations(
            result.get("answer", ""),
            result.get("sources", []),
            include_warnings=True,
        )
        result["citations"] = citations
        result["warnings"] = warnings
        if result.get("answer_status") == "complete" and not citations:
            result["answer_status"] = "insufficient_evidence"
        result["status"] = self.status()
        return result

    @staticmethod
    def _rrf_sources(
        semantic: List[Dict[str, Any]],
        exact: List[Dict[str, Any]],
        limit: int,
    ) -> List[Dict[str, Any]]:
        """Fuse independent ranked lists with reciprocal-rank fusion."""

        fused: Dict[tuple[Any, ...], Dict[str, Any]] = {}
        scores: Dict[tuple[Any, ...], float] = {}
        channels: Dict[tuple[Any, ...], set[str]] = {}
        for channel, sources in (("semantic", semantic), ("exact", exact)):
            for rank, source in enumerate(sources, start=1):
                key = (
                    source.get("content_id")
                    or f"{source.get('workspace_id')}:{source.get('item_id')}",
                    source.get("field"),
                    source.get("segment_id"),
                    source.get("start_ms"),
                )
                fused.setdefault(key, dict(source))
                scores[key] = scores.get(key, 0.0) + 1.0 / (60 + rank)
                channels.setdefault(key, set()).add(channel)
        ranked = sorted(fused, key=lambda key: scores[key], reverse=True)[:limit]
        return [
            {
                **fused[key],
                "fusion_score": scores[key],
                "retrieval_channels": sorted(channels[key]),
            }
            for key in ranked
        ]

    def status(self) -> Dict[str, Any]:
        """Return readiness for the workspace caches used by search."""

        settings = load_settings()
        model = get_embedding_model_for_rag(settings)
        records = self.store.list_all(include_trashed=False)
        indexable = [
            record
            for record in records
            if _record_indexable_content_count(record, self.task_store)
        ]
        ready_ids = [
            record.workspace_id
            for record in indexable
            if workspace_knowledge._load_from_cache(
                record.workspace_id,
                workspace_knowledge._items_hash(record),
                model,
            )
            is not None
        ]
        with self._lock:
            rebuild = dict(self._rebuild)
        return {
            "ready": bool(indexable) and len(ready_ids) == len(indexable),
            "running": bool(rebuild["running"]),
            "workspace_count": len(records),
            "indexable_workspace_count": len(indexable),
            "indexed_workspace_count": len(ready_ids),
            "item_count": sum(
                _record_indexable_content_count(record, self.task_store)
                for record in indexable
            ),
            "indexed_item_count": sum(
                _record_indexable_content_count(record, self.task_store)
                for record in indexable
                if record.workspace_id in ready_ids
            ),
            "stale_workspace_ids": [
                record.workspace_id
                for record in indexable
                if record.workspace_id not in ready_ids
            ],
            "last_indexed_at": rebuild["finished_at"],
            "embedding_model": model,
            "rebuild": rebuild,
        }

    def start_rebuild(self, *, force: bool = False) -> Dict[str, Any]:
        """Warm all workspace caches in a background thread."""

        with self._lock:
            if self._rebuild["running"]:
                already_running = True
            else:
                already_running = False
                self._rebuild.update(
                    running=True,
                    started_at=_now_iso(),
                    finished_at=None,
                    error=None,
                )
        if already_running:
            return self.status()

        def run() -> None:
            try:
                settings = load_settings()
                model = get_embedding_model_for_rag(settings)
                api_key = str(settings.openai_api_key or "").strip()
                records = self.store.list_all(include_trashed=False)
                for record in records:
                    if not any(
                        workspace_knowledge._item_has_data(item, self.task_store)
                        for item in record.items
                    ):
                        continue
                    if force:
                        workspace_knowledge.invalidate_workspace_index(
                            record.workspace_id
                        )
                    workspace_knowledge.build_or_load_workspace_index(
                        record.workspace_id,
                        api_key,
                        embedding_model=model,
                        store=self.store,
                        task_store=self.task_store,
                    )
                with self._lock:
                    self._rebuild.update(
                        running=False,
                        finished_at=_now_iso(),
                        error=None,
                    )
            except Exception as error:  # noqa: BLE001
                with self._lock:
                    self._rebuild.update(
                        running=False,
                        finished_at=_now_iso(),
                        error=str(error),
                    )

        threading.Thread(target=run, daemon=True).start()
        return self.status()
