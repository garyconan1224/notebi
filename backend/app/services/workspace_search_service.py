"""Phase 3B.2/3B.3：workspace 语义检索服务。

- search_one_workspace：单工作空间检索（3B.2）
- search_across_workspaces：跨工作空间合并 + reranker 精排（3B.3）

返回结构与 plan §Q4 SearchSource 字段约定一致。
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from math import ceil
from typing import Any, Dict, List, Optional, Tuple

from backend.app.services.knowledge_source import compute_source_id
from backend.app.services.workspace_knowledge import (
    SourceMap,
    build_or_load_workspace_index,
)
from backend.app.services.workspace_store import WorkspaceStore
from shared.knowledge_base import (
    LongKnowledge,
    ShortKnowledge,
    VideoChunk,
    retrieve_candidates_with_sources,
    retrieve_with_sources,
)
from shared.sf_client import SiliconFlowError, rerank_documents
from shared.settings_store import load_settings
from shared.runtime_llm_config import (
    get_embedding_model_for_rag,
    get_openai_compat_api_key,
    get_reranker_model_for_rag,
)
from src.vidmirror.core.providers import ChatRequest
from src.vidmirror.core.providers.registry import create_default_registry


_EXCERPT_LIMIT = 200
MIN_EVIDENCE_SCORE = 0.20


def _excerpt(text: str, limit: int = _EXCERPT_LIMIT) -> str:
    if not text:
        return ""
    s = text.strip().replace("\n", " ")
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _jump_url(workspace_id: str, item_id: str, item_type: str) -> str:
    """返回不会经过兼容重定向、可保留证据定位参数的前端正式路由。"""
    type_seg = (item_type or "video").lower()
    suffix_map = {
        "video": "video_detail",
        "image": "image_detail",
        "audio": "note",
        "text": "text_detail",
    }
    return f"/workspaces/{workspace_id}/items/{item_id}/{suffix_map.get(type_seg, 'video_detail')}"


def _timestamp_to_ms(value: str) -> Optional[int]:
    parts = value.strip().split(":")
    if not parts or len(parts) > 3:
        return None
    try:
        seconds = float(parts[-1])
        minutes = int(parts[-2]) if len(parts) >= 2 else 0
        hours = int(parts[-3]) if len(parts) == 3 else 0
    except ValueError:
        return None
    return round((hours * 3600 + minutes * 60 + seconds) * 1000)


def _time_range_ms(value: Any) -> tuple[Optional[int], Optional[int]]:
    if not isinstance(value, str) or not value.strip():
        return None, None
    normalized = value.replace("~", "-")
    start_text, separator, end_text = normalized.partition("-")
    start_ms = _timestamp_to_ms(start_text)
    end_ms = _timestamp_to_ms(end_text) if separator else None
    return start_ms, end_ms


def _resolve_api_key(api_key: Optional[str]) -> str:
    if api_key and api_key.strip():
        return api_key.strip()
    settings = load_settings()
    eff = str(getattr(settings, "openai_api_key", "") or "").strip()
    if not eff:
        eff = get_openai_compat_api_key(settings)
    if not eff:
        raise ValueError("RAG search requires an openai-compatible api key")
    return eff


def _source_from_short(workspace_id: str, workspace_name: str) -> Dict[str, Any]:
    """ShortKnowledge 模式下没有 chunk，做一个占位 source。"""
    return {
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "item_id": "",
        "item_type": "text",
        "item_title": workspace_name,
        "chunk_excerpt": "",
        "score": 0.0,
        "jump_url": f"/workspaces/{workspace_id}",
    }


def _build_source(
    raw: Dict[str, Any],
    source_map: SourceMap,
    workspace_id_fallback: str,
    workspace_name_fallback: str,
) -> Dict[str, Any]:
    info = source_map.get(str(raw.get("source_file") or "")) or {}
    wid = info.get("workspace_id") or workspace_id_fallback
    item_id = str(info.get("item_id") or "")
    item_type = str(info.get("item_type") or "video")
    excerpt = _excerpt(str(raw.get("skeleton_text") or ""))
    parsed_start, parsed_end = _time_range_ms(raw.get("time_range"))
    start_ms = raw.get("start_ms")
    end_ms = raw.get("end_ms")
    start_ms = int(start_ms) if isinstance(start_ms, (int, float)) else parsed_start
    end_ms = int(end_ms) if isinstance(end_ms, (int, float)) else parsed_end
    field = str(raw.get("field") or ("transcript" if start_ms is not None else "content"))
    segment_id = str(raw.get("segment_id") or f"segment-{raw.get('chunk_index', 0)}")
    source_type = str(info.get("source_type") or "")
    jump_url = str(info.get("jump_url") or "") or _jump_url(wid, item_id, item_type)
    if start_ms is not None:
        separator = "&" if "?" in jump_url else "?"
        jump_url = (
            f"{jump_url}{separator}start_ms={start_ms}"
            f"&field={field}&segment={segment_id}"
        )
    return {
        "source_id": compute_source_id(
            wid,
            item_id,
            field,
            segment_id,
            int(start_ms or 0),
            int(end_ms or 0),
        ),
        "workspace_id": wid,
        "workspace_name": info.get("workspace_name") or workspace_name_fallback,
        "item_id": item_id,
        "content_id": str(info.get("content_id") or ""),
        "lineage_id": str(info.get("lineage_id") or ""),
        "item_type": item_type,
        "source_type": source_type or ("transcript" if start_ms is not None else "content"),
        "item_title": info.get("item_title") or raw.get("title") or "",
        "excerpt": excerpt,
        "chunk_excerpt": excerpt,
        "field": field,
        "segment_id": segment_id,
        "segment": segment_id,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "score": float(raw.get("score") or 0.0),
        "jump_url": jump_url,
    }


def _llm_answer(query: str, context: str) -> str:
    settings = load_settings()
    registry = create_default_registry()
    profile = registry.resolve_default_profile(settings, "chat")
    provider = registry.build(profile)
    model = profile.default_models.get("chat") or settings.text_model
    if not model:
        raise ValueError("default chat model is not configured")
    return provider.chat(
        ChatRequest(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a helpful RAG assistant. Every factual claim must cite "
                        "one of the provided source IDs using exactly "
                        "[source:<source_id>]. Never invent a source ID."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Question:\n{query}\n\nContext:\n{context}\n\n"
                        "请用中文作答，并用 [source:<source_id>] 标注对应证据。"
                    ),
                },
            ],
            temperature=0.2,
            max_tokens=2048,
        )
    )


def search_one_workspace(
    *,
    workspace_id: str,
    query: str,
    top_k: int = 5,
    api_key: Optional[str] = None,
    store: Optional[WorkspaceStore] = None,
    task_store: Any = None,
) -> Dict[str, Any]:
    """单 workspace 检索。返回 {answer, sources[]}。"""
    if not query or not query.strip():
        raise ValueError("query is required")

    eff_key = _resolve_api_key(api_key)
    store = store or WorkspaceStore()
    settings = load_settings()
    embedding_model = get_embedding_model_for_rag(settings)
    rec = store.get(workspace_id)
    if rec is None:
        raise KeyError(f"workspace not found: {workspace_id}")

    knowledge, source_map = build_or_load_workspace_index(
        workspace_id, eff_key, embedding_model=embedding_model, store=store, task_store=task_store
    )

    sources_out: List[Dict[str, Any]] = []
    context_parts: List[str] = []

    if isinstance(knowledge, LongKnowledge):
        raws = list(retrieve_with_sources(eff_key, knowledge, query))
        raws = raws[:top_k]
        for i, r in enumerate(raws):
            s = _build_source(r, source_map, workspace_id, rec.name)
            sources_out.append(s)
            context_parts.append(
                f"[source:{s['source_id']}] {s['item_title']} ({s['item_type']})\n"
                f"{str(r.get('skeleton_text') or '')[:3000]}"
            )
    else:
        assert isinstance(knowledge, ShortKnowledge)
        sources_out.append(_source_from_short(workspace_id, rec.name))
        context_parts.append(knowledge.combined_json_text[:12000])

    answer = _llm_answer(query, "\n\n".join(context_parts))
    return {"answer": answer, "sources": sources_out}


def _retrieve_one(
    *,
    workspace_id: str,
    query: str,
    api_key: str,
    per_ws_top_k: int,
    store: WorkspaceStore,
    task_store: Any = None,
) -> Tuple[List[Dict[str, Any]], List[VideoChunk], SourceMap, str, str]:
    """跨空间检索单 worker：返回 (raw_sources, chunks_for_rerank, source_map, ws_id, ws_name)。"""
    rec = store.get(workspace_id)
    if rec is None:
        return [], [], {}, workspace_id, ""
    try:
        embedding_model = get_embedding_model_for_rag(load_settings())
        knowledge, source_map = build_or_load_workspace_index(
            workspace_id, api_key, embedding_model=embedding_model, store=store, task_store=task_store
        )
    except ValueError:
        return [], [], {}, workspace_id, rec.name
    if not isinstance(knowledge, LongKnowledge):
        # short 模式：拿合并文本占位
        assert isinstance(knowledge, ShortKnowledge)
        return (
            [
                {
                    "skeleton_text": knowledge.combined_json_text[:5000],
                    "source_file": "",
                    "title": rec.name,
                    "score": 1.0,
                }
            ],
            [],
            source_map,
            workspace_id,
            rec.name,
        )
    raws = list(
        retrieve_candidates_with_sources(
            api_key,
            knowledge,
            query,
            top_k=per_ws_top_k,
        )
    )
    return raws, list(knowledge.chunks), source_map, workspace_id, rec.name


def search_across_workspaces(
    *,
    query: str,
    top_k: int = 10,
    workspace_ids: Optional[List[str]] = None,
    item_types: Optional[List[str]] = None,
    tags: Optional[List[str]] = None,
    api_key: Optional[str] = None,
    store: Optional[WorkspaceStore] = None,
    task_store: Any = None,
) -> Dict[str, Any]:
    """跨工作空间检索。workspace_ids 为空 → 全部。"""
    if not query or not query.strip():
        raise ValueError("query is required")
    eff_key = _resolve_api_key(api_key)
    store = store or WorkspaceStore()
    settings = load_settings()
    rerank_model = get_reranker_model_for_rag(settings)
    if workspace_ids:
        # 校验存在性，避免静默忽略
        missing = [wid for wid in workspace_ids if store.get(wid) is None]
        if missing:
            raise KeyError(f"workspace(s) not found: {','.join(missing)}")
        target_ids = list(dict.fromkeys(workspace_ids))
    else:
        target_ids = [r.workspace_id for r in store.list_all()]

    if not target_ids:
        return {"answer": "（暂无工作空间）", "sources": []}

    candidate_k = max(top_k, len(target_ids) * 3)
    per_ws_top_k = max(3, ceil(candidate_k / len(target_ids)))
    pool_raws: List[Tuple[Dict[str, Any], SourceMap, str, str]] = []

    with ThreadPoolExecutor(max_workers=min(4, len(target_ids))) as pool:
        futures = [
            pool.submit(
                _retrieve_one,
                workspace_id=wid,
                query=query,
                api_key=eff_key,
                per_ws_top_k=per_ws_top_k,
                store=store,
                task_store=task_store,
            )
            for wid in target_ids
        ]
        for fut in as_completed(futures):
            try:
                raws, _chunks, smap, wid, wname = fut.result()
            except Exception:
                continue
            for r in raws:
                info = smap.get(str(r.get("source_file") or "")) or {}
                if item_types and info.get("item_type") not in set(item_types):
                    continue
                source_tags = set(info.get("tags") or [])
                if tags and not set(tags).issubset(source_tags):
                    continue
                pool_raws.append((r, smap, wid, wname))

    if not pool_raws:
        return {
            "answer": "",
            "sources": [],
            "answer_status": "insufficient_evidence",
            "evidence_status": {
                "sufficient": False,
                "threshold": MIN_EVIDENCE_SCORE,
                "best_score": None,
            },
        }

    workspace_order = {workspace_id: index for index, workspace_id in enumerate(target_ids)}
    pool_raws.sort(key=lambda value: workspace_order.get(value[2], len(workspace_order)))

    # reranker 二次精排（合并 score 量纲不一致问题）
    docs = [str(r.get("skeleton_text") or "")[:3000] for r, *_ in pool_raws]
    try:
        rr = rerank_documents(eff_key, rerank_model, query, docs, top_n=top_k)
        order = sorted(
            [
                (
                    int(item.get("index", -1)),
                    float(item.get("relevance_score", 0.0)),
                )
                for item in rr
            ],
            key=lambda value: value[1],
            reverse=True,
        )
    except SiliconFlowError:
        # 降级：按原始 score 排序
        order = sorted(
            [(i, float(pool_raws[i][0].get("score") or 0.0)) for i in range(len(pool_raws))],
            key=lambda x: x[1],
            reverse=True,
        )[:top_k]

    ranked_sources: List[Dict[str, Any]] = []
    ranked_raws: List[Dict[str, Any]] = []
    for i, score in order:
        if not (0 <= i < len(pool_raws)):
            continue
        raw, smap, wid, wname = pool_raws[i]
        raw_with_score = dict(raw)
        raw_with_score["score"] = score
        ranked_sources.append(_build_source(raw_with_score, smap, wid, wname))
        ranked_raws.append(raw)

    # Copies in several collections share lineage. Keep only the strongest
    # equivalent chunk while preserving distinct moments/fields in that lineage.
    deduped: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    seen: set[tuple[Any, ...]] = set()
    for source, raw in zip(ranked_sources, ranked_raws):
        lineage = source.get("lineage_id") or source.get("content_id")
        key = (
            lineage or source.get("source_id"),
            source.get("field"),
            source.get("start_ms"),
            (source.get("excerpt") or "")[:120].strip(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append((source, raw))
        if len(deduped) >= top_k:
            break

    sources_out: List[Dict[str, Any]] = []
    context_parts: List[str] = []
    for s, raw in deduped:
        sources_out.append(s)
        context_parts.append(
            f"[source:{s['source_id']}] [{s['workspace_name']}] "
            f"{s['item_title']} ({s['item_type']})\n"
            f"{str(raw.get('skeleton_text') or '')[:2500]}"
        )

    best_score = max((float(source.get("score") or 0.0) for source in sources_out), default=0.0)
    evidence_status = {
        "sufficient": best_score >= MIN_EVIDENCE_SCORE,
        "threshold": MIN_EVIDENCE_SCORE,
        "best_score": best_score,
    }
    if not evidence_status["sufficient"]:
        return {
            "answer": "",
            "sources": sources_out,
            "answer_status": "insufficient_evidence",
            "evidence_status": evidence_status,
        }

    answer = _llm_answer(query, "\n\n".join(context_parts))
    return {
        "answer": answer,
        "sources": sources_out,
        "answer_status": "complete",
        "evidence_status": evidence_status,
    }


__all__ = [
    "search_one_workspace",
    "search_across_workspaces",
]
