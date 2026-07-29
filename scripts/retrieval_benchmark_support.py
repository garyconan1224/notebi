"""Strategy runners for the offline retrieval cache benchmark."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Callable

from backend.app.services import global_knowledge
from backend.app.services import workspace_knowledge
from backend.app.services import workspace_search_service
from backend.app.services.workspace_store import WorkspaceStore
from scripts.retrieval_benchmark_metrics import (
    CallCounter,
    cache_bytes,
    measure,
    start_patches,
)
from shared.settings_store import AppSettings


def _global_query(
    store: WorkspaceStore,
    task_store: Any,
    workspace_ids: list[str],
) -> tuple[float, Callable[[list[str]], Any]]:
    build_ms = measure(
        lambda: global_knowledge._run_rebuild(
            force=True,
            store=store,
            task_store=task_store,
            api_key="offline-key",
            embedding_model="offline-embedding",
        )
    )
    rebuild_error = global_knowledge._snapshot_state().get("error")
    if rebuild_error:
        raise RuntimeError(f"global cache build failed: {rebuild_error}")

    def query(ids: list[str]) -> Any:
        return global_knowledge.ask_global(
            question="产品 搜索",
            workspace_ids=None if len(ids) == len(workspace_ids) else ids,
            store=store,
            task_store=task_store,
            api_key="offline-key",
        )

    return build_ms, query


def _workspace_query(
    store: WorkspaceStore,
    task_store: Any,
    workspace_ids: list[str],
) -> tuple[float, Callable[[list[str]], Any]]:
    build_ms = measure(
        lambda: [
            workspace_knowledge.build_or_load_workspace_index(
                workspace_id,
                "offline-key",
                embedding_model="offline-embedding",
                store=store,
                task_store=task_store,
            )
            for workspace_id in workspace_ids
        ]
    )

    def query(ids: list[str]) -> Any:
        return workspace_search_service.search_across_workspaces(
            query="产品 搜索",
            workspace_ids=ids,
            store=store,
            task_store=task_store,
            api_key="offline-key",
        )

    return build_ms, query


def measure_strategy(
    strategy: str,
    store: WorkspaceStore,
    workspace_ids: list[str],
    task_store: Any,
) -> dict[str, Any]:
    """Measure build, cache-hit query, reranker, and storage costs."""

    settings = AppSettings(openai_api_key="offline-key", text_model="offline-model")
    counter = CallCounter()
    with tempfile.TemporaryDirectory(prefix=f"retrieval-{strategy}-") as directory:
        cache_dir = Path(directory)
        patches = start_patches(cache_dir, counter, settings)
        try:
            query_factory = (
                _global_query if strategy == "global" else _workspace_query
            )
            build_ms, query = query_factory(store, task_store, workspace_ids)
            scopes: dict[str, dict[str, float | int]] = {}
            for label, ids in {
                "1": workspace_ids[:1],
                "5": workspace_ids[:5],
                "all": workspace_ids,
            }.items():
                rerank_before = counter.reranker
                first_ms = measure(lambda ids=ids: query(ids))
                hit_ms = measure(lambda ids=ids: query(ids))
                scopes[label] = {
                    "first_ms": first_ms,
                    "hit_ms": hit_ms,
                    "reranker_calls": counter.reranker - rerank_before,
                }
            return {
                "build_ms": build_ms,
                "embedding_calls": counter.embedding,
                "reranker_calls": counter.reranker,
                "cache_bytes": cache_bytes(cache_dir),
                "scopes": scopes,
            }
        finally:
            for active_patch in reversed(patches):
                active_patch.stop()
