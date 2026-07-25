#!/usr/bin/env python3
"""Offline benchmark for global and workspace-scoped retrieval caches."""

from __future__ import annotations

import argparse
import copy
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.models.workspace import WorkspaceRecord
from backend.app.services import workspace_knowledge
from backend.app.services.task_store import TaskStore
from backend.app.services.workspace_store import WorkspaceStore
from scripts.retrieval_benchmark_metrics import choose_cache_strategy
from scripts.retrieval_benchmark_support import measure_strategy

__all__ = ["choose_cache_strategy", "run_benchmark"]


def _build_scope_store(
    source_store: WorkspaceStore,
    task_store: TaskStore,
    root: Path,
    workspace_count: int,
) -> WorkspaceStore:
    candidates = [
        (item, workspace_knowledge._resolve_item_results(item, task_store))
        for record in source_store.list_all(include_trashed=False)
        for item in record.items
        if workspace_knowledge._item_has_data(item, task_store)
    ]
    if not candidates:
        raise RuntimeError("no indexable items found")
    benchmark_store = WorkspaceStore(root=root)
    for index in range(workspace_count):
        source_item, results = candidates[index % len(candidates)]
        item = copy.deepcopy(source_item)
        item.item_id = f"benchmark-item-{index:03d}"
        item.results = results
        item.related_task_ids = []
        benchmark_store.create(
            WorkspaceRecord(
                workspace_id=f"benchmark-ws-{index:03d}",
                name=f"Benchmark {index + 1}",
                items=[item],
            )
        )
    return benchmark_store


def _indexable_ids(
    store: WorkspaceStore,
    task_store: TaskStore,
) -> list[str]:
    return [
        record.workspace_id
        for record in store.list_all(include_trashed=False)
        if any(
            workspace_knowledge._item_has_data(item, task_store)
            for item in record.items
        )
    ]


def run_benchmark(root: Path | None = None) -> dict[str, Any]:
    """Run the offline cache benchmark against the selected workspace store."""

    store = WorkspaceStore(root=root) if root else WorkspaceStore()
    records = store.list_all(include_trashed=False)
    task_store = TaskStore()
    actual_indexable_ids = _indexable_ids(store, task_store)
    if not actual_indexable_ids:
        raise RuntimeError("no indexable workspaces found")

    benchmark_kind = "actual"
    benchmark_store = store
    benchmark_task_store: Any = task_store
    workspace_ids = actual_indexable_ids
    temporary_store: tempfile.TemporaryDirectory[str] | None = None
    if len(workspace_ids) < 5:
        benchmark_kind = "actual-content-scaled-to-44-workspaces"
        temporary_store = tempfile.TemporaryDirectory(prefix="retrieval-scope-")
        benchmark_store = _build_scope_store(
            store,
            task_store,
            Path(temporary_store.name),
            44,
        )
        benchmark_task_store = TaskStore(
            path=Path(temporary_store.name) / "tasks.json"
        )
        workspace_ids = _indexable_ids(benchmark_store, benchmark_task_store)
    try:
        metrics = {
            strategy: measure_strategy(
                strategy,
                benchmark_store,
                workspace_ids,
                benchmark_task_store,
            )
            for strategy in ("global", "workspace")
        }
    finally:
        if temporary_store is not None:
            temporary_store.cleanup()
    return {
        "corpus": {
            "workspace_count": len(records),
            "indexable_workspace_count": len(actual_indexable_ids),
            "item_count": sum(len(record.items) for record in records),
            "benchmark_kind": benchmark_kind,
            "benchmark_workspace_count": len(workspace_ids),
        },
        "metrics": metrics,
        "recommendation": choose_cache_strategy(metrics),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, help="Workspace JSON directory")
    args = parser.parse_args()
    print(json.dumps(run_benchmark(args.root), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
