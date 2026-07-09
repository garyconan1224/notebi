"""
分镜脚本生成（供创作页与后端 storyboard 任务共用）。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any

from shared.config import (
    PLAN_MARKERS,
    TEXT_BACKEND_ANTHROPIC,
    VISION_MODEL_DEFAULT,
    get_workspace_json_dir,
    get_workspace_runtime_dir,
)
from shared.knowledge_base import (
    KnowledgeState,
    LongKnowledge,
    ShortKnowledge,
    load_folder_as_knowledge,
    retrieve_top3_skeletons,
    split_three_plans,
)
from shared.settings_store import AppSettings, ProviderProfile, load_settings
from shared.sf_client import SiliconFlowError, analyze_product_images
from src.vidmirror.core.providers import ChatRequest
from src.vidmirror.core.providers.registry import create_default_registry


def resolve_chat_profile_for_storyboard(
    settings: AppSettings,
    text_backend: str,
    api_key_override: str,
    anthropic_key_override: str,
) -> ProviderProfile:
    backend_kind = "anthropic" if text_backend == TEXT_BACKEND_ANTHROPIC else "openai_compatible"
    candidates = [
        p
        for p in settings.providers
        if p.enabled and "chat" in p.capabilities and p.kind == backend_kind
    ]
    preferred = settings.default_provider_for_chat
    chosen = next((p for p in candidates if p.id == preferred), candidates[0] if candidates else None)
    if chosen is None:
        if backend_kind == "anthropic":
            chosen = ProviderProfile(
                id="legacy-anthropic",
                name="Legacy Anthropic",
                kind="anthropic",
                enabled=True,
                api_key=settings.anthropic_api_key,
                base_url=settings.anthropic_base_url,
                capabilities=("chat",),
                default_models={"chat": settings.anthropic_model},
            )
        else:
            chosen = ProviderProfile(
                id="legacy-openai",
                name="Legacy OpenAI Compatible",
                kind="openai_compatible",
                enabled=True,
                api_key=settings.openai_api_key,
                base_url=settings.openai_base_url,
                capabilities=("chat", "vision", "embedding", "rerank"),
                default_models={"chat": settings.text_model},
            )
    if backend_kind == "anthropic" and anthropic_key_override.strip():
        return replace(chosen, api_key=anthropic_key_override.strip())
    if backend_kind == "openai_compatible" and api_key_override.strip():
        return replace(chosen, api_key=api_key_override.strip())
    return chosen


def _build_user_query(product_name: str, core_features: str, web_markdown: str = "") -> str:
    q = f"新产品名称: {product_name.strip()}\n核心卖点: {core_features.strip()}"
    w = (web_markdown or "").strip()
    if w:
        q += "\n\n联网补充摘录（用于检索相关历史案例）：\n" + w[:3500]
    return q


def _build_reference_block(knowledge: KnowledgeState, api_key: str, query: str) -> str:
    if knowledge.mode == "short":
        assert isinstance(knowledge, ShortKnowledge)
        return knowledge.combined_json_text
    assert isinstance(knowledge, LongKnowledge)
    tops = retrieve_top3_skeletons(api_key, knowledge, query)
    return "\n\n".join(f"### 参考历史视频骨架 {i}\n```json\n{sk}\n```" for i, sk in enumerate(tops, start=1))


def _storyboard_system_prompt() -> str:
    return (
        "你是资深广告导演与编剧，擅长手机宣传片的分镜设计。"
        "请结合历史案例骨架、新产品参数、联网摘录、视觉分析报告输出可执行分镜。"
        "输出 Markdown 表格，列：秒数 | 景别 | 画面描述 | AI生图Prompt。"
    )


def _storyboard_user_payload(
    *,
    product_name: str,
    core_features: str,
    vision_report: str,
    reference_block: str,
    web_research_block: str,
    markers: tuple[str, str, str],
) -> str:
    a, b, c = markers
    web_part = (web_research_block or "").strip() or "（本次未使用联网检索，或暂无结果。）"
    return f"""请基于以下信息，生成三个版本手机宣传片分镜脚本（Markdown）。

## 新产品参数
- 产品名称: {product_name}
- 核心卖点: {core_features}

## 联网检索资料
{web_part}

## 视觉特征报告
{vision_report}

## 历史案例参考
{reference_block}

## 输出格式（必须遵守）
{a}
（方案 A 完整分镜）
{b}
（方案 B 完整分镜）
{c}
（方案 C 完整分镜）
"""


def _resolve_knowledge_only_paths(
    *,
    knowledge_project_id: str,
    rag_json_basenames: list[str] | None,
) -> tuple[Path, list[Path] | None]:
    """返回知识库目录与可选的 JSON 文件列表（basename 限定在项目 json_data 下）。"""
    json_dir = get_workspace_json_dir(knowledge_project_id)
    json_dir.mkdir(parents=True, exist_ok=True)
    root = json_dir.resolve()
    raw_names = rag_json_basenames or []
    if not raw_names:
        return json_dir, None
    out: list[Path] = []
    for bn in raw_names:
        name = Path(str(bn)).name
        cand = (json_dir / name).resolve()
        try:
            cand.relative_to(root)
        except ValueError:
            continue
        if cand.is_file() and cand.suffix.lower() == ".json":
            out.append(cand)
    if not out:
        raise ValueError("rag_json_basenames 未解析到该项目下的任何 JSON 文件")
    return json_dir, out


def run_storyboard_generation(
    *,
    project_id: str,
    product_name: str,
    core_features: str,
    web_enrichment_md: str,
    api_key: str,
    anthropic_key: str,
    vision_model: str,
    text_model: str,
    embedding_model: str,
    text_backend: str,
    anthropic_model: str,
    image_paths: list[str],
    rag_knowledge_project_id: str | None = None,
    rag_json_basenames: list[str] | None = None,
    log: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    def _log(msg: str) -> None:
        if log:
            log(msg)

    settings = load_settings()
    runtime_dir = get_workspace_runtime_dir(project_id)
    runtime_dir.mkdir(parents=True, exist_ok=True)

    kpid = (rag_knowledge_project_id or "").strip() or project_id
    json_dir, only_paths = _resolve_knowledge_only_paths(
        knowledge_project_id=kpid,
        rag_json_basenames=rag_json_basenames,
    )

    _log("加载知识库…")
    knowledge = load_folder_as_knowledge(
        api_key.strip(),
        str(json_dir),
        embedding_model=embedding_model,
        only_paths=only_paths,
    )

    web_md = (web_enrichment_md or "").strip()
    query = _build_user_query(product_name, core_features, web_md)
    _log("构建参考块…")
    ref = _build_reference_block(knowledge, api_key.strip(), query)

    images: list[tuple[bytes, str]] = []
    for p in image_paths[:8]:
        path = Path(p)
        if path.is_file():
            suffix = path.suffix.lower()
            mime = "image/jpeg" if suffix in (".jpg", ".jpeg") else "image/png" if suffix == ".png" else "image/jpeg"
            images.append((path.read_bytes(), mime))

    _log("视觉分析…")
    if images:
        vision_report = analyze_product_images(
            api_key.strip(),
            (vision_model or VISION_MODEL_DEFAULT).strip(),
            images,
        )
    else:
        vision_report = "（无参考图，基于文本卖点推断）"

    user_msg = _storyboard_user_payload(
        product_name=product_name.strip(),
        core_features=core_features.strip(),
        vision_report=vision_report,
        reference_block=ref,
        web_research_block=web_md,
        markers=PLAN_MARKERS,
    )

    chat_profile = resolve_chat_profile_for_storyboard(
        settings,
        text_backend=text_backend,
        api_key_override=api_key,
        anthropic_key_override=anthropic_key,
    )
    provider = create_default_registry().build(chat_profile)
    model = text_model.strip()
    if text_backend == TEXT_BACKEND_ANTHROPIC:
        model = (anthropic_model or "").strip() or model

    _log("生成分镜文本…")
    raw = provider.chat(
        ChatRequest(
            model=model,
            messages=[
                {"role": "system", "content": _storyboard_system_prompt()},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=8192,
            temperature=0.75,
        )
    )

    plan_a, plan_b, plan_c = split_three_plans(raw, PLAN_MARKERS)
    artifact = runtime_dir / "last_storyboard_result.json"
    artifact.write_text(
        json.dumps(
            {
                "plan_a": plan_a,
                "plan_b": plan_b,
                "plan_c": plan_c,
                "vision_report": vision_report,
                "web_context_used": web_md[:2000],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    return {
        "plan_a": plan_a,
        "plan_b": plan_b,
        "plan_c": plan_c,
        "vision_report": vision_report,
        "web_context_used": web_md[:2000],
        "artifact_path": str(artifact),
    }


__all__ = [
    "resolve_chat_profile_for_storyboard",
    "run_storyboard_generation",
]
