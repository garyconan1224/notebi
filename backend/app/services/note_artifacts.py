"""Generate structured NoteShell AI artifacts without creating summary versions."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict

from backend.app.models.workspace import WorkspaceItem
from backend.app.services.summary_generator import _call_llm

ARTIFACT_KINDS = {
    "mind_map",
    "action_items",
    "key_cards",
    "flashcards",
    "glossary",
    "timeline",
    "selection_rewrite",
}

_ARTIFACT_LABELS = {
    "mind_map": "思维导图",
    "action_items": "行动项",
    "key_cards": "要点卡",
    "flashcards": "闪卡与测验",
    "glossary": "术语表",
    "timeline": "时间线",
    "selection_rewrite": "选区改写",
}

_ARTIFACT_INSTRUCTIONS = {
    "mind_map": "用 Markdown 多级列表输出一棵思维导图。根节点只有一个，最多四层，每个节点简洁且信息不重复。",
    "action_items": "提取可执行行动项。用 Markdown 待办列表输出；有依据时写负责人、截止时间、依赖和完成标准，没有依据就标注未明确。",
    "key_cards": "输出 5-12 张要点卡。每张用三级标题，包含核心结论、证据或例子、适用场景。",
    "flashcards": "输出闪卡与小测验。每张卡使用“Q:”和“A:”，最后增加 3 道带答案的理解题。",
    "glossary": "输出 Markdown 表格，列为术语、通俗解释、材料中的语境。只保留理解材料所必需的术语。",
    "timeline": "按材料顺序输出 Markdown 表格，列为时间/顺序、事件或观点、参与者、影响。没有时间戳时使用顺序编号。",
    "selection_rewrite": "只输出改写后的正文，不要解释、不加标题。保留事实、专有名词和原意，改善清晰度与结构。",
}


def _artifact_source(item: WorkspaceItem) -> str:
    results = item.results or {}
    segments = results.get("transcript_segments") or results.get("transcript")
    if isinstance(segments, list):
        lines = []
        for segment in segments:
            if not isinstance(segment, dict):
                continue
            text = str(segment.get("edited_text") or segment.get("text") or "").strip()
            if not text:
                continue
            time = str(segment.get("t_str") or segment.get("start") or "").strip()
            speaker = str(segment.get("speaker") or "").strip()
            prefix = " ".join(part for part in (time, speaker) if part)
            lines.append(f"[{prefix}] {text}" if prefix else text)
        if lines:
            return "\n".join(lines)
    return str(
        results.get("content")
        or results.get("note_body")
        or results.get("markdown")
        or results.get("source_md_raw")
        or results.get("summary")
        or ""
    ).strip()


def generate_note_artifact(
    item: WorkspaceItem,
    kind: str,
    *,
    selected_text: str = "",
    instructions: str = "",
    provider_id: str = "",
    model: str = "",
    progress: Callable[[float, str], None] | None = None,
) -> Dict[str, Any]:
    """Generate one independently persisted NoteShell artifact."""
    if kind not in ARTIFACT_KINDS:
        raise ValueError(f"unsupported artifact kind: {kind}")
    source = selected_text.strip() if kind == "selection_rewrite" else _artifact_source(item)
    if not source:
        raise RuntimeError("当前笔记没有可用于生成的内容")
    if progress:
        progress(0.18, "已准备笔记材料")

    label = _ARTIFACT_LABELS[kind]
    system_prompt = (
        "你是本地优先笔记软件中的结构化整理助手。"
        "只能依据用户提供的材料，不得编造。输出 Markdown，禁止输出隐藏思维过程。"
    )
    user_prompt = (
        f"任务：{label}\n"
        f"格式要求：{_ARTIFACT_INSTRUCTIONS[kind]}\n"
        f"{f'用户补充要求：{instructions.strip()}' if instructions.strip() else ''}\n\n"
        f"【材料】\n{source[:16000]}"
    )
    if progress:
        progress(0.42, f"正在生成{label}")
    content_md, model_used = _call_llm(
        system_prompt,
        user_prompt,
        provider_id=provider_id,
        model=model,
    )
    if progress:
        progress(0.88, f"正在整理{label}")
    return {
        "artifact_id": str(uuid.uuid4()),
        "kind": kind,
        "title": label,
        "content_md": content_md.strip(),
        "source_scope": "selection" if kind == "selection_rewrite" else "full_note",
        "original_text": source if kind == "selection_rewrite" else "",
        "model_used": model_used,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
