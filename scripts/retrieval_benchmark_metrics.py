"""Low-level metrics and patches for retrieval cache benchmarking."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Any, Callable
from unittest.mock import patch

from backend.app.services import global_knowledge
from backend.app.services import workspace_knowledge
from backend.app.services import workspace_search_service
from shared import knowledge_base
from shared.settings_store import AppSettings


class CallCounter:
    def __init__(self) -> None:
        self.embedding = 0
        self.reranker = 0

    def embed(
        self,
        _api_key: str,
        _model: str,
        inputs: list[str],
        on_batch: Callable[[int, int], None] | None = None,
    ) -> list[list[float]]:
        self.embedding += 1
        if on_batch is not None:
            on_batch(1, 1)
        return [
            [
                (byte + 1) / 256
                for byte in hashlib.sha256(text.encode("utf-8")).digest()[:32]
            ]
            for text in inputs
        ]

    def rerank(
        self,
        _api_key: str,
        _model: str,
        _query: str,
        documents: list[str],
        top_n: int,
    ) -> list[dict[str, float | int]]:
        self.reranker += 1
        return [
            {"index": index, "relevance_score": 1.0 - index / max(len(documents), 1)}
            for index in range(min(top_n, len(documents)))
        ]


def measure(call: Callable[[], Any]) -> float:
    """Return elapsed milliseconds for one callable."""

    started = time.perf_counter()
    call()
    return round((time.perf_counter() - started) * 1_000, 3)


def cache_bytes(cache_dir: Path) -> int:
    """Return the total size of files below a cache directory."""

    return sum(path.stat().st_size for path in cache_dir.rglob("*") if path.is_file())


def choose_cache_strategy(metrics: dict[str, Any]) -> dict[str, str]:
    """Choose a cache unit from reproducible benchmark metrics."""

    global_metrics = metrics["global"]
    workspace_metrics = metrics["workspace"]
    build_ratio = workspace_metrics["build_ms"] / max(
        global_metrics["build_ms"],
        0.001,
    )
    size_ratio = workspace_metrics["cache_bytes"] / max(
        global_metrics["cache_bytes"],
        1,
    )
    if build_ratio > 2 or size_ratio > 2:
        return {
            "strategy": "global",
            "reason": "workspace cache build or storage overhead exceeds the 2x safety bound",
        }

    labels = [
        label
        for label in ("1", "5")
        if label in global_metrics["scopes"]
        and label in workspace_metrics["scopes"]
    ]
    global_selective = sum(
        global_metrics["scopes"][label]["hit_ms"] for label in labels
    )
    workspace_selective = sum(
        workspace_metrics["scopes"][label]["hit_ms"] for label in labels
    )
    if labels and workspace_selective <= global_selective * 1.25:
        return {
            "strategy": "workspace",
            "reason": "workspace caches keep selective query latency within the 1.25x bound",
        }
    return {
        "strategy": "global",
        "reason": "global cache is materially faster for selective queries",
    }


def start_patches(
    cache_dir: Path,
    counter: CallCounter,
    settings: AppSettings,
) -> tuple[Any, ...]:
    """Patch external model calls with deterministic offline implementations."""

    patches = (
        patch.object(workspace_knowledge, "CACHE_DIR", cache_dir),
        patch.object(global_knowledge, "CACHE_DIR", cache_dir),
        patch.object(knowledge_base, "SHORT_MODE_MAX_CHARS", 1),
        patch.object(knowledge_base, "create_embeddings", counter.embed),
        patch.object(knowledge_base, "rerank_documents", counter.rerank),
        patch.object(workspace_search_service, "rerank_documents", counter.rerank),
        patch.object(global_knowledge, "load_settings", lambda: settings),
        patch.object(workspace_search_service, "load_settings", lambda: settings),
        patch.object(
            global_knowledge,
            "get_embedding_model_for_rag",
            lambda _settings: "offline-embedding",
        ),
        patch.object(
            workspace_search_service,
            "get_embedding_model_for_rag",
            lambda _settings: "offline-embedding",
        ),
        patch.object(global_knowledge, "_llm_answer", lambda _q, _c: "offline"),
        patch.object(workspace_search_service, "_llm_answer", lambda _q, _c: "offline"),
    )
    for active_patch in patches:
        active_patch.start()
    return patches
