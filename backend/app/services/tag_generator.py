"""Phase 3C.2：LLM 自动打标 service。

对单个 WorkspaceItem 调当前默认 chat provider 生成 7 维度标签 dict。
失败（非法 JSON / provider 抛异常）返回空 dict + log，不抛、不阻塞主流程。
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_knowledge import _resolve_item_results
from shared.config import TAG_DIMENSIONS
from shared.settings_store import load_settings
from src.vidmirror.core.providers import ChatRequest
from src.vidmirror.core.providers.registry import create_default_registry

logger = logging.getLogger(__name__)

SYSTEM_DIMENSIONS = [k for k in TAG_DIMENSIONS if k != "custom_tags"]

_MAX_CONTENT_CHARS = 6000
_MAX_TAGS_TOKENS = 512


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _summarize_item(item: WorkspaceItem, task_store: Any = None) -> str:
    """把 item 关键文本压成喂给 LLM 的简短摘要。"""
    results = _resolve_item_results(item, task_store)
    parts: list[str] = []
    title = item.name or item.source_value or item.item_id
    parts.append(f"标题: {title}")
    parts.append(f"类型: {item.type}")
    parts.append(f"来源: {item.source_value}")

    if results:
        # 按常见字段优先级抽取文本
        for key in ("video_title", "title"):
            v = results.get(key)
            if isinstance(v, str) and v.strip() and v.strip() != title:
                parts.append(f"标题(分析): {v.strip()}")
                break
        for key in (
            "summary",
            "global_visual_summary",
            "description",
            "analysis_summary",
            "content",
        ):
            v = results.get(key)
            if isinstance(v, str) and v.strip():
                parts.append(f"摘要({key}): {v.strip()}")
                break
        # transcript / frames 抽前几条片段
        transcript = results.get("transcript")
        if isinstance(transcript, list) and transcript:
            first = transcript[:5]
            lines: list[str] = []
            for seg in first:
                if isinstance(seg, dict):
                    lines.append(str(seg.get("text") or seg.get("content") or "").strip())
                elif isinstance(seg, str):
                    lines.append(seg.strip())
            t = " | ".join(x for x in lines if x)
            if t:
                parts.append(f"字幕首段: {t}")
        frames = results.get("frames")
        if isinstance(frames, list) and frames:
            descs: list[str] = []
            for fr in frames[:3]:
                if isinstance(fr, dict):
                    d = fr.get("description_zh") or fr.get("description") or ""
                    if isinstance(d, str) and d.strip():
                        descs.append(d.strip())
            if descs:
                parts.append(f"画面前几帧: {' | '.join(descs)}")
        # text 类素材的 content 字段可能很长
        # tags（如果已有）不喂给模型避免诱导
    text = "\n".join(parts)
    if len(text) > _MAX_CONTENT_CHARS:
        text = text[:_MAX_CONTENT_CHARS] + "…"
    return text


def _build_prompt(item_summary: str, workspace: Optional[WorkspaceRecord]) -> str:
    dim_lines: list[str] = []
    for key in SYSTEM_DIMENSIONS:
        spec = TAG_DIMENSIONS[key]
        choices = spec.get("choices") or []
        dim_lines.append(
            f"- {key} ({spec['label']})：必须从以下取一：{', '.join(choices)}"
        )
    workspace_ctx = ""
    if workspace and workspace.background:
        bg = workspace.background
        bg_parts = []
        if bg.content_type:
            bg_parts.append(f"内容类型预设={bg.content_type}")
        if bg.topic:
            bg_parts.append(f"主题={bg.topic}")
        if bg.purpose:
            bg_parts.append(f"用途={bg.purpose}")
        if bg_parts:
            workspace_ctx = f"\n工作空间背景：{'; '.join(bg_parts)}\n"

    return (
        "你是一个内容标签生成助手。基于下方素材信息，输出一个**严格 JSON 对象**，"
        "包含以下 7 个键，缺一不可：\n\n"
        + "\n".join(dim_lines)
        + "\n- custom_tags：4~8 个自由文本标签的数组（字符串数组），每个不超过 8 字；"
        + "必须优先提取内容本身的主题、工具、模型、平台、人物/项目、任务意图和输出形态，"
        + "可覆盖多个维度，例如 AI、大模型、知识库、Codex、Claude、GPT、DeepSeek、Gemini、Qwen、Kimi、Cursor、MCP、"
        + "Obsidian、Notion、B站、YouTube、小红书、开源、编程、自动化、提示词、工具评测、知识管理、效率工具、教程、会议、播客、复刻。"
        + "不要重复系统维度的泛化词，例如 视频、音频、文本、学习、待处理。\n"
        + workspace_ctx
        + "\n素材信息：\n"
        + "----\n"
        + item_summary
        + "\n----\n\n"
        + "只输出 JSON，不要前后多余文字、解释或代码块标记。"
    )


def _extract_json(raw: str) -> Optional[Dict[str, Any]]:
    """从 LLM 原始输出里抠出第一个合法 JSON 对象。"""
    if not raw:
        return None
    s = raw.strip()
    # 去 markdown 代码块
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", s)
    if m:
        s = m.group(1)
    else:
        # 找第一个 { 到最后一个 } 之间
        first = s.find("{")
        last = s.rfind("}")
        if first >= 0 and last > first:
            s = s[first : last + 1]
    try:
        obj = json.loads(s)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def _validate_and_normalize(raw_tags: Dict[str, Any]) -> Dict[str, Any]:
    """对照 TAG_DIMENSIONS 校验/规范化。非法 value 丢弃该维度，不抛。"""
    out: Dict[str, Any] = {}
    for key in SYSTEM_DIMENSIONS:
        v = raw_tags.get(key)
        if not isinstance(v, str):
            continue
        v = v.strip()
        choices = TAG_DIMENSIONS[key].get("choices") or []
        if v in choices:
            out[key] = v
        else:
            logger.warning("tag_generator: dimension %s 收到非法值 %r，丢弃", key, v)
    custom = raw_tags.get("custom_tags")
    if isinstance(custom, list):
        cleaned = [
            str(x).strip()
            for x in custom
            if isinstance(x, (str, int, float)) and str(x).strip()
        ]
        out["custom_tags"] = cleaned[:10]  # 防止 LLM 失控塞太多
    else:
        out["custom_tags"] = []
    return out


def generate_tags(
    item: WorkspaceItem,
    workspace: Optional[WorkspaceRecord] = None,
    *,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    task_store: Any = None,
) -> Dict[str, Any]:
    """对 item 调 LLM 打 7 维度标签，返回校验后的 dict（失败返回 {}）。"""
    try:
        summary = _summarize_item(item, task_store=task_store)
        if not summary.strip():
            logger.warning("tag_generator: item %s 无可用内容，跳过", item.item_id)
            return {}

        settings = load_settings()
        registry = create_default_registry()
        profile = registry.resolve_default_profile(settings, "chat")
        provider = registry.build(profile)
        effective_model = (model or "").strip() or profile.default_models.get("chat") or settings.text_model
        if not effective_model:
            logger.warning("tag_generator: 未配置 default chat model，跳过")
            return {}

        prompt = _build_prompt(summary, workspace)
        raw = provider.chat(
            ChatRequest(
                model=effective_model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are a strict JSON-only labeling assistant.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                max_tokens=_MAX_TAGS_TOKENS,
            )
        )
        obj = _extract_json(raw or "")
        if obj is None:
            logger.warning(
                "tag_generator: item %s LLM 返回非法 JSON，原文前 200 字：%s",
                item.item_id,
                (raw or "")[:200],
            )
            return {}
        normalized = _validate_and_normalize(obj)
        if not any(k in normalized for k in SYSTEM_DIMENSIONS):
            # 没有任何系统维度命中，视为失败（custom_tags 单独存在意义不大）
            logger.warning("tag_generator: item %s 0 个系统维度命中", item.item_id)
            return {}
        normalized["_generated_at"] = _now_iso()
        normalized["_generated_model"] = effective_model
        return normalized
    except Exception as err:  # noqa: BLE001
        logger.exception("tag_generator: item %s 打标异常：%s", item.item_id, err)
        return {}


__all__ = ["generate_tags", "SYSTEM_DIMENSIONS"]
