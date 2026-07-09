"""
知识库：扫描本地 JSON、智能路由（短文本 / RAG）、FAISS 向量索引与检索骨架。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator, Literal, Optional, Sequence, Union

import faiss
import numpy as np

from shared.config import (
    EMBEDDING_INPUT_MAX_CHARS,
    EMBEDDING_MODEL,
    RAG_FINAL_TOP_N,
    RAG_TOP_K,
    SHORT_MODE_MAX_CHARS,
    embedding_char_limit_for_model,
)
from shared.runtime_llm_config import get_reranker_model_for_rag
from shared.sf_client import SiliconFlowError, create_embeddings, rerank_documents

# progress(0~1, 说明文案)，供 Streamlit 进度条使用
ProgressCallback = Optional[Callable[[float, str], None]]


@dataclass(frozen=True)
class VideoChunk:
    """单条可检索单元：面向向量的短文本 + 面向生成的完整骨架。"""

    source_file: str
    chunk_index: int
    embed_text: str
    skeleton_text: str
    title: str = ""
    author: str = ""
    tags: tuple[str, ...] = ()
    published_at: str = ""
    source_url: str = ""
    time_range: str = ""


@dataclass(frozen=True)
class ShortKnowledge:
    mode: Literal["short"]
    combined_json_text: str
    total_chars: int


@dataclass(frozen=True)
class LongKnowledge:
    mode: Literal["long"]
    chunks: tuple[VideoChunk, ...]
    total_chars: int
    index: Any  # faiss.IndexFlatIP
    embeddings: np.ndarray  # float32, L2 归一化，与 chunks 行对齐
    # 构建索引时使用的嵌入模型，检索查询向量须与之一致
    embedding_model: str


KnowledgeState = Union[ShortKnowledge, LongKnowledge]


def list_json_files(folder: str) -> list[Path]:
    root = Path(folder).expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"不是有效文件夹: {root}")
    files = sorted(root.rglob("*.json"))
    return [p for p in files if p.is_file()]


def compute_total_json_chars(paths: Sequence[Path]) -> int:
    """按「原始文件 UTF-8 文本长度」统计总字符数，用于智能路由阈值。"""
    total = 0
    for p in paths:
        text = p.read_text(encoding="utf-8", errors="replace")
        total += len(text)
    return total


def _first_str(d: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _collect_keyframe_descriptions(obj: Any) -> list[str]:
    """从常见字段结构中抽取关键帧/分镜描述列表。"""
    out: list[str] = []
    key_paths = (
        "keyframes",
        "关键帧",
        "shots",
        "scenes",
        "分镜",
        "镜头列表",
        "storyboard",
        "frames",
    )
    if isinstance(obj, dict):
        for kp in key_paths:
            if kp not in obj:
                continue
            raw = obj[kp]
            if isinstance(raw, list):
                for item in raw:
                    if isinstance(item, str) and item.strip():
                        out.append(item.strip())
                    elif isinstance(item, dict):
                        # 兼容本项目「视觉数据」JSON：frames[].description_zh / timestamp / image_prompt_en
                        desc = _first_str(
                            item,
                            (
                                "description_zh",
                                "description",
                                "画面描述",
                                "caption",
                                "text",
                                "visual",
                                "画面",
                                "content",
                            ),
                        )
                        ts = item.get("time") or item.get("timestamp") or item.get("秒")
                        line = ""
                        if ts is not None:
                            line += f"[{ts}] "
                        if desc:
                            line += desc
                        en_hint = _first_str(item, ("image_prompt_en", "image_prompt", "prompt_en"))
                        if en_hint and len(en_hint) > 20:
                            line += f" | EN_Prompt摘录: {en_hint[:400]}{'…' if len(en_hint) > 400 else ''}"
                        if line.strip():
                            out.append(line.strip())
            elif isinstance(raw, str) and raw.strip():
                out.append(raw.strip())
    return out


def _video_summary_line(obj: dict[str, Any]) -> str:
    # 与 JSON数据/*.json 对齐：video_title、product_name、global_visual_summary
    video_title = _first_str(obj, ("video_title", "title", "name", "视频标题"))
    product = _first_str(obj, ("product_name", "产品名", "product"))
    summary = _first_str(
        obj,
        (
            "global_visual_summary",
            "global_summary",
            "summary",
            "视频总结",
            "总结",
            "overview",
            "description",
            "analysis_summary",
        ),
    )
    parts: list[str] = []
    if video_title:
        parts.append(f"视频: {video_title}")
    if product:
        parts.append(f"产品: {product}")
    if summary:
        # 全局总结往往很长，嵌入检索时截断，避免撑爆单条向量文本
        cap = 3500
        summ = summary if len(summary) <= cap else summary[:cap] + "…"
        parts.append(f"全局视觉总结: {summ}")
    return " | ".join(parts) if parts else ""


def _extract_metadata(obj: dict[str, Any]) -> dict[str, object]:
    title = _first_str(obj, ("video_title", "title", "name", "视频标题")) or ""
    author = _first_str(obj, ("author", "creator", "up_name", "up", "作者")) or ""
    published_at = _first_str(obj, ("published_at", "publish_time", "date", "发布时间")) or ""
    source_url = _first_str(obj, ("source_url", "url", "video_url", "链接")) or ""
    time_range = _first_str(obj, ("time_range", "range", "时间区间")) or ""
    tags_raw = obj.get("tags") or obj.get("tag_list") or obj.get("标签")
    tags: tuple[str, ...] = ()
    if isinstance(tags_raw, list):
        tags = tuple(str(t).strip() for t in tags_raw if str(t).strip())
    elif isinstance(tags_raw, str) and tags_raw.strip():
        tags = tuple(x.strip() for x in tags_raw.split(",") if x.strip())
    return {
        "title": title,
        "author": author,
        "published_at": published_at,
        "source_url": source_url,
        "time_range": time_range,
        "tags": tags,
    }


def _build_chunk_texts_from_object(obj: dict[str, Any], source_file: str, idx: int) -> VideoChunk | None:
    """
    将单个「视频级」对象压成：
    - embed_text：较短，供向量与重排序
    - skeleton_text：尽量保留结构化 JSON 字符串，供大模型参考
    """
    summary_line = _video_summary_line(obj)
    kfs = _collect_keyframe_descriptions(obj)
    kf_block = "\n".join(f"- {x}" for x in kfs) if kfs else ""
    meta = _extract_metadata(obj)
    meta_line = (
        f"元信息: 标题={meta['title'] or 'N/A'} | 作者={meta['author'] or 'N/A'} | "
        f"发布时间={meta['published_at'] or 'N/A'} | 标签={','.join(meta['tags']) if meta['tags'] else 'N/A'}"
    )

    embed_parts = [meta_line, summary_line, "关键帧与分镜摘要:", kf_block if kf_block else "（未提供结构化关键帧字段）"]
    embed_text = "\n".join(p for p in embed_parts if p).strip()
    if not embed_text:
        embed_text = json.dumps(obj, ensure_ascii=False)[:8000]

    skeleton_text = json.dumps(obj, ensure_ascii=False, indent=2)
    return VideoChunk(
        source_file=source_file,
        chunk_index=idx,
        # 与硅基流动 BGE-M3 的 8192 token 上限对齐；过长由 create_embeddings 再次截断兜底
        embed_text=embed_text[:EMBEDDING_INPUT_MAX_CHARS],
        skeleton_text=skeleton_text,
        title=str(meta["title"]),
        author=str(meta["author"]),
        tags=tuple(meta["tags"]) if isinstance(meta.get("tags"), tuple) else (),
        published_at=str(meta["published_at"]),
        source_url=str(meta["source_url"]),
        time_range=str(meta["time_range"]),
    )


def _iter_video_dicts(data: Any) -> Iterator[dict[str, Any]]:
    """尽可能从任意 JSON 根结构迭代出「单视频」字典。"""
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                yield item
        return
    if isinstance(data, dict):
        container_keys = ("videos", "data", "items", "records", "analyses", "list", "results")
        for ck in container_keys:
            inner = data.get(ck)
            if isinstance(inner, list):
                for item in inner:
                    if isinstance(item, dict):
                        yield item
                return
        yield data


def build_video_chunks_from_file(path: Path) -> list[VideoChunk]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # 无法解析则整文件当作一条文本骨架
        fake = {"_parse_error": True, "_raw_excerpt": raw[:15000]}
        vc = VideoChunk(
            source_file=str(path),
            chunk_index=0,
            embed_text=raw[:EMBEDDING_INPUT_MAX_CHARS],
            skeleton_text=json.dumps(fake, ensure_ascii=False, indent=2),
        )
        return [vc]

    chunks: list[VideoChunk] = []
    for i, d in enumerate(_iter_video_dicts(data)):
        ch = _build_chunk_texts_from_object(d, str(path), i)
        if ch:
            chunks.append(ch)
    if not chunks:
        whole = VideoChunk(
            source_file=str(path),
            chunk_index=0,
            embed_text=raw[:EMBEDDING_INPUT_MAX_CHARS],
            skeleton_text=raw[:50000],
        )
        chunks.append(whole)
    return chunks


def load_folder_as_knowledge(
    api_key: str,
    folder: str,
    embedding_model: str = EMBEDDING_MODEL,
    progress: ProgressCallback = None,
    only_paths: Sequence[Path] | None = None,
) -> KnowledgeState:
    """
    读取文件夹内全部 JSON（或仅 only_paths 指定文件）：
    - 总字符数 < SHORT_MODE_MAX_CHARS：合并原始文本，直接作为上下文
    - 否则：按视频切块 + BGE-M3 嵌入 + FAISS(IndexFlatIP，向量已 L2 归一化，内积=余弦)
    """
    if progress:
        progress(0.02, "正在扫描 JSON 文件…")
    if only_paths is not None:
        paths: list[Path] = []
        for p in only_paths:
            pp = Path(p).expanduser().resolve()
            if pp.is_file() and pp.suffix.lower() == ".json":
                paths.append(pp)
        paths.sort(key=lambda x: str(x))
    else:
        paths = list_json_files(folder)
    if not paths:
        raise ValueError("该文件夹下未找到任何 .json 文件")

    total_chars = compute_total_json_chars(paths)

    if total_chars < SHORT_MODE_MAX_CHARS:
        if progress:
            progress(0.15, "短文本模式：正在合并 JSON 原文…")
        merged_parts: list[str] = []
        for p in paths:
            merged_parts.append(f"===== 文件: {p.name} =====\n")
            merged_parts.append(p.read_text(encoding="utf-8", errors="replace"))
            merged_parts.append("\n")
        if progress:
            progress(1.0, "知识库就绪（短文本直灌）")
        return ShortKnowledge(
            mode="short",
            combined_json_text="".join(merged_parts),
            total_chars=total_chars,
        )

    if progress:
        progress(0.08, f"长文本模式：解析 {len(paths)} 个 JSON 文件…")
    all_chunks: list[VideoChunk] = []
    for i, p in enumerate(paths):
        all_chunks.extend(build_video_chunks_from_file(p))
        if progress and paths:
            t = 0.08 + 0.12 * (i + 1) / len(paths)
            progress(min(t, 0.2), f"已解析 {i + 1}/{len(paths)} 个文件…")
    if not all_chunks:
        raise ValueError("未能从 JSON 中解析出有效视频块")

    # 与所选嵌入模型的 token 上限对齐（如 bge-large 仅 512 tokens），并保证向量与 rerank 文本一致
    _cap = embedding_char_limit_for_model(embedding_model)
    trimmed_chunks: list[VideoChunk] = []
    for c in all_chunks:
        et = c.embed_text
        if len(et) > _cap:
            et = et[:_cap] + "…"
        trimmed_chunks.append(
            VideoChunk(
                source_file=c.source_file,
                chunk_index=c.chunk_index,
                embed_text=et,
                skeleton_text=c.skeleton_text,
                title=c.title,
                author=c.author,
                tags=c.tags,
                published_at=c.published_at,
                source_url=c.source_url,
                time_range=c.time_range,
            )
        )
    all_chunks = trimmed_chunks

    texts = [c.embed_text for c in all_chunks]

    def _on_batch(cur: int, total: int) -> None:
        if progress and total > 0:
            # 嵌入阶段占 0.2 ~ 0.88
            ratio = cur / total
            p = 0.2 + 0.68 * ratio
            progress(min(p, 0.88), f"正在调用嵌入 API：批次 {cur}/{total}…")

    if progress:
        progress(0.2, f"正在向量化 {len(texts)} 条视频块（{embedding_model}）…")
    vectors = create_embeddings(api_key, embedding_model, texts, on_batch=_on_batch)
    if progress:
        progress(0.9, "正在构建 FAISS 索引…")
    mat = np.array(vectors, dtype="float32")
    faiss.normalize_L2(mat)
    dim = mat.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(mat)

    if progress:
        progress(1.0, "知识库构建完成")
    return LongKnowledge(
        mode="long",
        chunks=tuple(all_chunks),
        total_chars=total_chars,
        index=index,
        embeddings=mat,
        embedding_model=embedding_model,
    )


def _faiss_search(index: Any, query_vec: list[float], top_k: int) -> list[int]:
    q = np.array([query_vec], dtype="float32")
    faiss.normalize_L2(q)
    k = min(top_k, index.ntotal)
    scores, ids = index.search(q, k)
    return [int(i) for i in ids[0] if i >= 0]


def retrieve_top3_skeletons(
    api_key: str,
    knowledge: LongKnowledge,
    query: str,
) -> tuple[str, ...]:
    """
    RAG 主流程：FAISS Top-10 + bge-reranker Top-3，返回 3 段历史视频骨架文本。
    短文本模式请直接使用 ShortKnowledge.combined_json_text，勿调用本函数。
    """
    assert isinstance(knowledge, LongKnowledge)
    if not knowledge.chunks:
        return tuple()

    # 兼容旧会话中缓存的 LongKnowledge（早期版本无 embedding_model 字段）
    emb_model = getattr(knowledge, "embedding_model", None) or EMBEDDING_MODEL

    q_vec = create_embeddings(api_key, emb_model, [query])[0]
    idxs = _faiss_search(knowledge.index, q_vec, RAG_TOP_K)
    candidates: list[VideoChunk] = [knowledge.chunks[i] for i in idxs]
    docs = [c.embed_text for c in candidates]
    results: list[dict[str, Any]] = []
    try:
        rerank_model = get_reranker_model_for_rag()
        results = rerank_documents(api_key, rerank_model, query, docs, top_n=RAG_FINAL_TOP_N)
    except SiliconFlowError:
        # 重排序模型未开通或 id 变更（20012 等）时，降级为纯向量 Top-K
        results = [{"index": i} for i in range(min(RAG_FINAL_TOP_N, len(candidates)))]
    top_skeletons: list[str] = []
    for r in results[:RAG_FINAL_TOP_N]:
        j = int(r.get("index", -1))
        if 0 <= j < len(candidates):
            top_skeletons.append(candidates[j].skeleton_text)
    if not top_skeletons:
        for c in candidates[:RAG_FINAL_TOP_N]:
            top_skeletons.append(c.skeleton_text)
    return tuple(top_skeletons)


def retrieve_with_sources(
    api_key: str,
    knowledge: LongKnowledge,
    query: str,
) -> tuple[dict[str, Any], ...]:
    """
    返回带来源元信息的检索结果，便于可解释引用。
    """
    assert isinstance(knowledge, LongKnowledge)
    emb_model = getattr(knowledge, "embedding_model", None) or EMBEDDING_MODEL
    q_vec = create_embeddings(api_key, emb_model, [query])[0]
    idxs = _faiss_search(knowledge.index, q_vec, RAG_TOP_K)
    candidates: list[VideoChunk] = [knowledge.chunks[i] for i in idxs]
    docs = [c.embed_text for c in candidates]
    results: list[dict[str, Any]] = []
    try:
        rerank_model = get_reranker_model_for_rag()
        results = rerank_documents(api_key, rerank_model, query, docs, top_n=RAG_FINAL_TOP_N)
    except SiliconFlowError:
        results = [{"index": i, "relevance_score": 0.0} for i in range(min(RAG_FINAL_TOP_N, len(candidates)))]

    out: list[dict[str, Any]] = []
    for r in results[:RAG_FINAL_TOP_N]:
        j = int(r.get("index", -1))
        if not (0 <= j < len(candidates)):
            continue
        c = candidates[j]
        out.append(
            {
                "skeleton_text": c.skeleton_text,
                "source_file": c.source_file,
                "chunk_index": c.chunk_index,
                "title": c.title,
                "author": c.author,
                "tags": list(c.tags),
                "published_at": c.published_at,
                "source_url": c.source_url,
                "time_range": c.time_range,
                "score": float(r.get("relevance_score", 0.0)),
            }
        )
    if not out:
        for c in candidates[:RAG_FINAL_TOP_N]:
            out.append(
                {
                    "skeleton_text": c.skeleton_text,
                    "source_file": c.source_file,
                    "chunk_index": c.chunk_index,
                    "title": c.title,
                    "author": c.author,
                    "tags": list(c.tags),
                    "published_at": c.published_at,
                    "source_url": c.source_url,
                    "time_range": c.time_range,
                    "score": 0.0,
                }
            )
    return tuple(out)


def split_three_plans(raw: str, markers: tuple[str, str, str]) -> tuple[str, str, str]:
    """
    按约定分隔符切分三个方案；若模型未严格遵守，则做降级整段展示。
    """
    a_m, b_m, c_m = markers
    if a_m not in raw:
        return raw.strip(), "_（未检测到方案 A 标记，以上为完整输出）_", ""
    _, rest = raw.split(a_m, 1)
    if b_m not in rest:
        return rest.strip(), "", ""
    plan_a, rest2 = rest.split(b_m, 1)
    if c_m not in rest2:
        return plan_a.strip(), rest2.strip(), ""
    plan_b, plan_c = rest2.split(c_m, 1)
    return plan_a.strip(), plan_b.strip(), plan_c.strip()
