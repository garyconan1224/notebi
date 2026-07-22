"""Global knowledge service backed by a shared FAISS cache."""

from __future__ import annotations

import json
import hashlib
import threading
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.app.models.workspace import WorkspaceRecord
from backend.app.services.workspace_knowledge import (
    CACHE_DIR,
    SourceMap,
    _cache_paths,
    _item_has_data,
    _items_hash,
    _load_from_cache,
    _persist_long_cache,
    collect_workspace_json_paths,
    invalidate_workspace_index,
)
from backend.app.services.workspace_search_service import (
    _build_source,
    _llm_answer,
    _resolve_api_key,
)
from backend.app.services.workspace_store import WorkspaceStore
from shared.knowledge_base import LongKnowledge, ShortKnowledge, retrieve_with_sources
from shared.config import EMBEDDING_MODEL
from shared.runtime_llm_config import get_embedding_model_for_rag
from shared.settings_store import load_settings

GLOBAL_CACHE_ID = "__global__"


def _sub_cache_id(workspace_ids: List[str]) -> str:
    """Derive a stable, ordered cache id from a workspace-id list.

    The id is deterministic per sorted set so repeated queries with the same
    scope hit the same cache, and it never collides with ``GLOBAL_CACHE_ID``.
    """
    return f"__global_sub__:{','.join(sorted(workspace_ids))}"

_state_lock = threading.Lock()
_rebuild_state: Dict[str, Any] = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "error": None,
    "processed_workspaces": 0,
    "total_workspaces": 0,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _snapshot_state() -> Dict[str, Any]:
    with _state_lock:
        return dict(_rebuild_state)


def _update_state(**kwargs: Any) -> None:
    with _state_lock:
        _rebuild_state.update(kwargs)


def _cache_ready(workspace_id: str, expected_hash: str, embedding_model: str) -> bool:
    faiss_path, meta_path = _cache_paths(workspace_id)
    if not (faiss_path.exists() and meta_path.exists()):
        return False
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return False
    cached_model = str(meta.get("embedding_model") or EMBEDDING_MODEL)
    return meta.get("items_hash") == expected_hash and cached_model == embedding_model


def _short_cache_path(cache_id: str = GLOBAL_CACHE_ID) -> Path:
    faiss_path, _ = _cache_paths(cache_id)
    return faiss_path.with_suffix(".short.json")


def _load_short_cache(
    expected_hash: str,
    embedding_model: str,
    *,
    cache_id: str = GLOBAL_CACHE_ID,
) -> Tuple[ShortKnowledge, SourceMap, Dict[str, Any]] | None:
    path = _short_cache_path(cache_id)
    if not path.exists():
        return None
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if meta.get("items_hash") != expected_hash:
        return None
    if str(meta.get("embedding_model") or EMBEDDING_MODEL) != embedding_model:
        return None
    knowledge = ShortKnowledge(
        mode="short",
        combined_json_text=str(meta.get("combined_json_text") or ""),
        total_chars=int(meta.get("total_chars") or 0),
    )
    return knowledge, dict(meta.get("source_map") or {}), meta


def _persist_short_cache(
    items_hash: str,
    embedding_model: str,
    knowledge: ShortKnowledge,
    source_map: SourceMap,
    *,
    cache_id: str = GLOBAL_CACHE_ID,
) -> None:
    path = _short_cache_path(cache_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "workspace_id": cache_id,
        "items_hash": items_hash,
        "embedding_model": embedding_model,
        "total_chars": knowledge.total_chars,
        "combined_json_text": knowledge.combined_json_text,
        "source_map": source_map,
        "created_at": _now_iso(),
        "mode": "short",
    }
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def invalidate_global_knowledge_caches() -> None:
    """Remove global and scoped-global knowledge caches after bulk kind cleanup."""

    invalidate_workspace_index(GLOBAL_CACHE_ID)
    failures: List[str] = []
    for path in (_short_cache_path(GLOBAL_CACHE_ID),):
        if path.exists():
            try:
                path.unlink()
            except OSError as exc:
                failures.append(f"{path}: {exc}")

    if CACHE_DIR.exists():
        for path in CACHE_DIR.glob("__global_sub__:*"):
            if not path.is_file():
                continue
            try:
                path.unlink()
            except OSError as exc:
                failures.append(f"{path}: {exc}")
    if failures:
        raise OSError("failed to invalidate global knowledge caches: " + "; ".join(failures))


def _indexable_records(
    store: WorkspaceStore,
    task_store: Any = None,
) -> List[WorkspaceRecord]:
    return [
        rec
        for rec in store.list_all(include_trashed=False)
        if any(_item_has_data(it, task_store) for it in rec.items)
    ]


def _global_items_hash(records: List[WorkspaceRecord]) -> str:
    payload = [
        {
            "workspace_id": rec.workspace_id,
            "items_hash": _items_hash(rec),
        }
        for rec in sorted(records, key=lambda item: item.workspace_id)
    ]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def collect_all_json_paths(
    dest: Path,
    *,
    store: Optional[WorkspaceStore] = None,
    task_store: Any = None,
) -> Tuple[List[Path], SourceMap, List[WorkspaceRecord]]:
    """Serialize all non-trashed workspace item results into one temp tree."""

    store = store or WorkspaceStore()
    records = _indexable_records(store, task_store)
    paths: List[Path] = []
    source_map: SourceMap = {}
    for rec in records:
        ws_dir = dest / rec.workspace_id
        ws_paths, ws_map, _ = collect_workspace_json_paths(
            rec.workspace_id,
            ws_dir,
            store=store,
            task_store=task_store,
        )
        paths.extend(ws_paths)
        source_map.update(ws_map)
    return paths, source_map, records


def _global_meta(expected_hash: str, embedding_model: str) -> Dict[str, Any] | None:
    if not _cache_ready(GLOBAL_CACHE_ID, expected_hash, embedding_model):
        short = _load_short_cache(expected_hash, embedding_model)
        return short[2] if short else None
    _, meta_path = _cache_paths(GLOBAL_CACHE_ID)
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def get_global_status(
    *,
    store: Optional[WorkspaceStore] = None,
    task_store: Any = None,
) -> Dict[str, Any]:
    """Return coverage/readiness for the global knowledge surface."""

    store = store or WorkspaceStore()
    settings = load_settings()
    embedding_model = get_embedding_model_for_rag(settings)
    records = store.list_all(include_trashed=False)

    indexable = _indexable_records(store, task_store)
    indexable_workspaces = len(indexable)
    indexable_items = sum(sum(1 for it in rec.items if _item_has_data(it, task_store)) for rec in indexable)
    cur_hash = _global_items_hash(indexable)
    meta = _global_meta(cur_hash, embedding_model) if indexable_items > 0 else None
    ready = meta is not None
    indexed_workspaces = indexable_workspaces if ready else 0
    indexed_items = indexable_items if ready else 0
    stale_workspaces = [] if ready else [rec.workspace_id for rec in indexable]
    last_indexed_at = str(meta.get("created_at") or "") if meta else None

    state = _snapshot_state()
    return {
        "ready": bool(ready and indexable_items > 0),
        "running": bool(state.get("running")),
        "workspace_count": len(records),
        "indexable_workspace_count": indexable_workspaces,
        "indexed_workspace_count": indexed_workspaces,
        "item_count": indexable_items,
        "indexed_item_count": indexed_items,
        "stale_workspace_ids": stale_workspaces,
        "last_indexed_at": last_indexed_at or state.get("finished_at"),
        "embedding_model": embedding_model,
        "rebuild": state,
    }


def _run_rebuild(
    *,
    force: bool,
    store: WorkspaceStore,
    task_store: Any,
    api_key: str,
    embedding_model: str,
) -> None:
    records = _indexable_records(store, task_store)
    _update_state(
        running=True,
        started_at=_now_iso(),
        finished_at=None,
        error=None,
        processed_workspaces=0,
        total_workspaces=len(records),
    )
    try:
        if force:
            invalidate_workspace_index(GLOBAL_CACHE_ID)
            try:
                _short_cache_path().unlink(missing_ok=True)
            except OSError:
                pass
        cur_hash = _global_items_hash(records)
        cached = _load_from_cache(GLOBAL_CACHE_ID, cur_hash, embedding_model) or _load_short_cache(
            cur_hash, embedding_model
        )
        if cached is None and records:
            with tempfile.TemporaryDirectory(prefix="globalidx_") as td:
                paths, source_map, _ = collect_all_json_paths(
                    Path(td),
                    store=store,
                    task_store=task_store,
                )
                if paths:
                    from shared.knowledge_base import load_folder_as_knowledge

                    knowledge = load_folder_as_knowledge(
                        api_key.strip(),
                        td,
                        embedding_model=embedding_model,
                        only_paths=paths,
                    )
                    if isinstance(knowledge, LongKnowledge):
                        _persist_long_cache(GLOBAL_CACHE_ID, cur_hash, knowledge, source_map)
                    elif isinstance(knowledge, ShortKnowledge):
                        _persist_short_cache(cur_hash, embedding_model, knowledge, source_map)
                _update_state(processed_workspaces=len(records))
        else:
            _update_state(processed_workspaces=len(records))
        _update_state(running=False, finished_at=_now_iso(), error=None)
    except Exception as exc:  # noqa: BLE001
        _update_state(running=False, finished_at=_now_iso(), error=str(exc))


def start_global_rebuild(
    *,
    force: bool = False,
    store: Optional[WorkspaceStore] = None,
    task_store: Any = None,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Start background warming of the global index."""

    state = _snapshot_state()
    if state.get("running"):
        return get_global_status(store=store, task_store=task_store)

    settings = load_settings()
    eff_key = _resolve_api_key(api_key)
    embedding_model = get_embedding_model_for_rag(settings)
    effective_store = store or WorkspaceStore()
    thread = threading.Thread(
        target=_run_rebuild,
        kwargs={
            "force": force,
            "store": effective_store,
            "task_store": task_store,
            "api_key": eff_key,
            "embedding_model": embedding_model,
        },
        daemon=True,
    )
    thread.start()
    return get_global_status(store=effective_store, task_store=task_store)


def ask_global(
    *,
    question: str,
    top_k: int = 10,
    workspace_ids: Optional[List[str]] = None,
    store: Optional[WorkspaceStore] = None,
    task_store: Any = None,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Ask across the global cache without triggering rebuild inline.

    When ``workspace_ids`` is non-empty, only those workspaces are searched;
    otherwise all indexable workspaces are included.
    """

    effective_store = store or WorkspaceStore()
    settings = load_settings()
    embedding_model = get_embedding_model_for_rag(settings)
    all_records = _indexable_records(effective_store, task_store)

    # Filter by workspace_ids when provided
    if workspace_ids:
        ws_set = set(workspace_ids)
        records = [r for r in all_records if r.workspace_id in ws_set]
        if not records:
            return {"answer": "（所选合集中暂无可用于知识库问答的笔记）", "sources": [], "status": get_global_status(store=effective_store, task_store=task_store)}
    else:
        records = all_records

    item_count = sum(sum(1 for it in rec.items if _item_has_data(it, task_store)) for rec in records)
    if item_count <= 0:
        return {"answer": "（暂无可用于知识库问答的笔记）", "sources": [], "status": get_global_status(store=effective_store, task_store=task_store)}

    cur_hash = _global_items_hash(records)
    if workspace_ids:
        cur_hash = hashlib.sha256((cur_hash + ",".join(sorted(workspace_ids))).encode("utf-8")).hexdigest()

    eff_key = _resolve_api_key(api_key)
    cache_id = _sub_cache_id(workspace_ids) if workspace_ids else GLOBAL_CACHE_ID
    cached = _load_from_cache(cache_id, cur_hash, embedding_model) or _load_short_cache(
        cur_hash, embedding_model, cache_id=cache_id
    )

    # Sub-range: build a temporary index if no cache hit.
    # Use a dedicated cache id so sub-range caches never collide with global.
    if cached is None and workspace_ids:
        with tempfile.TemporaryDirectory(prefix="subidx_") as td:
            paths, source_map, _ = collect_all_json_paths(
                Path(td),
                store=effective_store,
                task_store=task_store,
            )
            # Filter paths to only requested workspaces.
            # collect_all_json_paths writes dest/<ws_id>/..., so the first
            # directory component relative to the temp root is the workspace id.
            # Use .resolve() on both sides: macOS /var is a symlink to
            # /private/var, so relative_to would otherwise raise ValueError.
            td_resolved = Path(td).resolve()
            ws_set = set(workspace_ids)
            sub_paths: List[Path] = []
            for p in paths:
                try:
                    rel_parts = p.resolve().relative_to(td_resolved).parts
                except ValueError:
                    continue
                if len(rel_parts) >= 1 and rel_parts[0] in ws_set:
                    sub_paths.append(p)
            sub_source_map = {
                k: v
                for k, v in source_map.items()
                if any(f'{ws_id}/' in k or k.endswith(f'/{ws_id}') for ws_id in workspace_ids)
            }
            if sub_paths:
                from shared.knowledge_base import load_folder_as_knowledge

                knowledge = load_folder_as_knowledge(
                    eff_key.strip(),
                    td,
                    embedding_model=embedding_model,
                    only_paths=sub_paths,
                )
                if isinstance(knowledge, ShortKnowledge):
                    _persist_short_cache(
                        cur_hash,
                        embedding_model,
                        knowledge,
                        sub_source_map,
                        cache_id=cache_id,
                    )
                elif isinstance(knowledge, LongKnowledge):
                    _persist_long_cache(cache_id, cur_hash, knowledge, sub_source_map)
                cached = (knowledge, sub_source_map)
    if cached is None and not workspace_ids:
        raise RuntimeError("knowledge index is not ready; rebuild first")
    if cached is None:
        return {"answer": "（所选合集索引未就绪，请先刷新索引）", "sources": [], "status": get_global_status(store=effective_store, task_store=task_store)}

    if len(cached) == 3:
        knowledge, source_map, _ = cached
    else:
        knowledge, source_map = cached

    sources_out: List[Dict[str, Any]] = []
    context_parts: List[str] = []
    if isinstance(knowledge, LongKnowledge):
        raws = list(retrieve_with_sources(eff_key, knowledge, question))[:top_k]
        for idx, raw in enumerate(raws):
            source = _build_source(raw, source_map, "", "")
            sources_out.append(source)
            context_parts.append(
                f"[{idx + 1}] [{source['workspace_name']}] {source['item_title']} ({source['item_type']})\n"
                f"{str(raw.get('skeleton_text') or '')[:2500]}"
            )
    else:
        assert isinstance(knowledge, ShortKnowledge)
        context_parts.append(knowledge.combined_json_text[:12000])
        for source_file in list(source_map.keys())[:top_k]:
            sources_out.append(_build_source({"source_file": source_file, "skeleton_text": ""}, source_map, "", ""))

    answer = _llm_answer(question, "\n\n".join(context_parts))
    return {
        "answer": answer,
        "sources": sources_out,
        "status": get_global_status(store=effective_store, task_store=task_store),
    }
