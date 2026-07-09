"""Workspace 知识库数据桥 + FAISS 缓存层（Phase 3B.1）。

把工作空间内 items 的分析产物喂给 shared.knowledge_base，
按 workspace_id 持久化 FAISS 索引到 data/.local/embeddings/，
items 变更（hash 不一致）时 lazy 重建。
"""

from __future__ import annotations

import hashlib
import json
import tempfile
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import faiss
import numpy as np

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore
from shared.config import DATA_DIR, EMBEDDING_MODEL
from shared.knowledge_base import (
    KnowledgeState,
    LongKnowledge,
    ShortKnowledge,
    VideoChunk,
    load_folder_as_knowledge,
)

CACHE_DIR: Path = DATA_DIR / ".local" / "embeddings"

SourceMap = Dict[str, Dict[str, Any]]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _items_hash(rec: WorkspaceRecord) -> str:
    """根据 items 内容算 hash，items 任一字段变化则失效缓存。"""
    payload = json.dumps(
        [
            {
                "id": it.item_id,
                "type": it.type,
                "name": it.name,
                "source_value": it.source_value,
                "results": it.results,
                "updated": it.updated_at,
            }
            for it in rec.items
        ],
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _resolve_item_results(it: WorkspaceItem, task_store: Any = None) -> Dict[str, Any]:
    """返回 item 的最佳分析产物 dict。

    优先用 item.results；为空时从 task_store 找最新 SUCCESS 任务的 result。
    task_store 可以是任何实现了 .get(task_id) -> Optional[TaskRecord] 的对象。
    """
    if it.results:
        return dict(it.results)
    if task_store is None or not it.related_task_ids:
        return {}
    latest_success: Any = None
    for tid in it.related_task_ids:
        task = task_store.get(tid)
        if task is None:
            continue
        if str(getattr(task, "status", "")).upper() == "SUCCESS" and getattr(task, "result", None):
            if latest_success is None or task.updated_at > latest_success.updated_at:
                latest_success = task
    return dict(latest_success.result) if latest_success else {}


def _item_has_data(it: WorkspaceItem, task_store: Any = None) -> bool:
    return bool(_resolve_item_results(it, task_store))


def collect_workspace_json_paths(
    workspace_id: str,
    dest: Path,
    store: Optional[WorkspaceStore] = None,
    task_store: Any = None,
) -> Tuple[List[Path], SourceMap, WorkspaceRecord]:
    """把每个 item 的分析产物序列化为 JSON 文件写到 dest 目录。

    task_store 用于补全 item.results 为空但任务已完成的 items（拉模式同 _sync_item_with_tasks）。
    返回 (paths, source_map, workspace_record)。source_map 以绝对路径字符串为 key，
    含 workspace + item 元数据，后续检索结果回填用。
    """
    store = store or WorkspaceStore()
    rec = store.get(workspace_id)
    if rec is None:
        raise KeyError(f"workspace not found: {workspace_id}")

    dest.mkdir(parents=True, exist_ok=True)
    paths: List[Path] = []
    source_map: SourceMap = {}
    for it in rec.items:
        results = _resolve_item_results(it, task_store)
        if not results:
            continue
        title = it.name or it.source_value or it.item_id
        obj: Dict[str, Any] = {
            "item_id": it.item_id,
            "item_type": it.type,
            "video_title": title,
            "title": title,
            **results,
        }
        p = (dest / f"{it.item_id}.json").resolve()
        p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
        paths.append(p)
        source_map[str(p)] = {
            "workspace_id": workspace_id,
            "workspace_name": rec.name,
            "item_id": it.item_id,
            "item_type": it.type,
            "item_title": title,
        }
    return paths, source_map, rec


def _cache_paths(workspace_id: str) -> Tuple[Path, Path]:
    return CACHE_DIR / f"{workspace_id}.faiss", CACHE_DIR / f"{workspace_id}.meta.json"


def _load_from_cache(
    workspace_id: str, expected_hash: str, embedding_model: str = EMBEDDING_MODEL
) -> Optional[Tuple[KnowledgeState, SourceMap]]:
    faiss_path, meta_path = _cache_paths(workspace_id)
    if not (faiss_path.exists() and meta_path.exists()):
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if meta.get("items_hash") != expected_hash:
        return None
    if str(meta.get("embedding_model") or EMBEDDING_MODEL) != embedding_model:
        return None
    try:
        index = faiss.read_index(str(faiss_path))
        chunks = tuple(
            VideoChunk(**{**c, "tags": tuple(c.get("tags") or ())})
            for c in meta.get("chunks", [])
        )
    except Exception:
        return None
    knowledge = LongKnowledge(
        mode="long",
        chunks=chunks,
        total_chars=int(meta.get("total_chars", 0)),
        index=index,
        # 占位：检索时只用 index 做近邻 + 用 query 重新算嵌入，不读这个数组
        embeddings=np.zeros((index.ntotal, index.d), dtype="float32"),
        embedding_model=str(meta.get("embedding_model") or EMBEDDING_MODEL),
    )
    return knowledge, dict(meta.get("source_map") or {})


def _persist_long_cache(
    workspace_id: str,
    items_hash: str,
    knowledge: LongKnowledge,
    source_map: SourceMap,
) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    faiss_path, meta_path = _cache_paths(workspace_id)
    faiss.write_index(knowledge.index, str(faiss_path))
    meta = {
        "workspace_id": workspace_id,
        "items_hash": items_hash,
        "embedding_model": knowledge.embedding_model,
        "total_chars": knowledge.total_chars,
        "chunks": [asdict(c) for c in knowledge.chunks],
        "source_map": source_map,
        "created_at": _now_iso(),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def build_or_load_workspace_index(
    workspace_id: str,
    api_key: str,
    embedding_model: str = EMBEDDING_MODEL,
    store: Optional[WorkspaceStore] = None,
    task_store: Any = None,
) -> Tuple[KnowledgeState, SourceMap]:
    """Lazy 加载/重建 workspace 知识库。

    - 命中缓存（items_hash 一致）→ 反序列化 FAISS + chunks
    - 未命中 → 把 items 序列化为 JSON 临时目录 → load_folder_as_knowledge → 写缓存
    - task_store 用于补全 item.results 为空但任务已完成的 items
    """
    if not api_key or not api_key.strip():
        raise ValueError("api_key required to build workspace index")

    store = store or WorkspaceStore()
    rec = store.get(workspace_id)
    if rec is None:
        raise KeyError(f"workspace not found: {workspace_id}")

    # 若未传 task_store，懒加载一个（从磁盘读，保证数据是最新的）
    if task_store is None:
        from backend.app.services.task_store import TaskStore  # noqa: PLC0415
        task_store = TaskStore()

    items_with_data = [it for it in rec.items if _item_has_data(it, task_store)]
    if not items_with_data:
        raise ValueError(f"workspace {workspace_id} has no items with analysis results")

    cur_hash = _items_hash(rec)
    cached = _load_from_cache(workspace_id, cur_hash, embedding_model)
    if cached is not None:
        return cached

    with tempfile.TemporaryDirectory(prefix=f"wsidx_{workspace_id}_") as td:
        tdp = Path(td)
        paths, source_map, _ = collect_workspace_json_paths(
            workspace_id, tdp, store=store, task_store=task_store
        )
        if not paths:
            raise ValueError(f"workspace {workspace_id} produced no JSON for indexing")
        knowledge = load_folder_as_knowledge(
            api_key.strip(),
            str(tdp),
            embedding_model=embedding_model,
            only_paths=paths,
        )

    if isinstance(knowledge, LongKnowledge):
        _persist_long_cache(workspace_id, cur_hash, knowledge, source_map)
    # ShortKnowledge 不缓存（数据量本就很小，重建成本可忽略）
    return knowledge, source_map


def invalidate_workspace_index(workspace_id: str) -> None:
    """删缓存：item 增删/重命名/results 变化时主动调用。"""
    faiss_path, meta_path = _cache_paths(workspace_id)
    for p in (faiss_path, meta_path):
        if p.exists():
            try:
                p.unlink()
            except OSError:
                pass


__all__ = [
    "CACHE_DIR",
    "SourceMap",
    "build_or_load_workspace_index",
    "collect_workspace_json_paths",
    "invalidate_workspace_index",
]
