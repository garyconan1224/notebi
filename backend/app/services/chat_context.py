"""任务级 AI 对话的 system prompt 构建器（N6）。

输入：WorkspaceRecord + 选中的 item_ids 列表。
输出：拼接好的 system prompt 文本 + 是否触发了 char 截断 + 实际用到的 item_ids。

策略（v1，char-based 阈值）：
- 按 item 顺序拼接关键字段（name / type / tags / preflight.background / results）。
- 中文 1 char ≈ 1 token，英文 4 char ≈ 1 token，保守阈值 12000 chars（约 6k token）。
- 超阈值时停止追加后续 item，标 truncated=True，前端展示「上下文已自动精简」。
- 真正的 embedding RAG 等 N9/N10 跨素材对比时再做。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from backend.app.models.workspace import (
    WorkspaceBackground,
    WorkspaceItem,
    WorkspaceRecord,
)


DEFAULT_MAX_CHARS = 12000


@dataclass
class ChatContext:
    system_prompt: str
    used_item_ids: List[str]
    truncated: bool


def build_item_context(
    workspace: WorkspaceRecord,
    item_ids: List[str],
    max_chars: int = DEFAULT_MAX_CHARS,
) -> ChatContext:
    """根据选中 items 构建 system prompt。

    - item_ids 为空 → 返回空 prompt（旧浮动 ChatSidebar 行为兼容）。
    - item_ids 含未知 id → 跳过（不报错）。
    - 拼接超阈值 → 截断后续 items + truncated=True。
    """
    if not item_ids:
        return ChatContext(system_prompt="", used_item_ids=[], truncated=False)

    item_map: Dict[str, WorkspaceItem] = {it.item_id: it for it in workspace.items}
    parts: List[str] = []
    used: List[str] = []
    truncated = False

    header = _render_header(workspace.background)
    parts.append(header)
    char_count = len(header)

    for idx, item_id in enumerate(item_ids, start=1):
        item = item_map.get(item_id)
        if item is None:
            continue
        block = _render_item_block(idx, item)
        if char_count + len(block) > max_chars:
            truncated = True
            break
        parts.append(block)
        used.append(item_id)
        char_count += len(block)

    if not used:
        # 所有 item_ids 都未命中
        return ChatContext(system_prompt="", used_item_ids=[], truncated=False)

    parts.append(
        "\n回答指引：基于上述素材内容作答；引用素材时用「素材 N」标号；"
        "不要编造素材里没有的信息。"
    )
    return ChatContext(
        system_prompt="\n".join(parts),
        used_item_ids=used,
        truncated=truncated,
    )


def _render_header(bg: WorkspaceBackground) -> str:
    lines = ["你正在协助分析以下任务素材。回答时请引用具体素材内容。\n"]
    bg_lines: List[str] = []
    if bg.content_type:
        bg_lines.append(f"- 内容类型：{bg.content_type}")
    if bg.topic:
        bg_lines.append(f"- 主题：{bg.topic}")
    if bg.participants:
        bg_lines.append(f"- 参与者：{', '.join(bg.participants)}")
    if bg.glossary:
        bg_lines.append(f"- 专有名词：{', '.join(bg.glossary)}")
    if bg.purpose:
        bg_lines.append(f"- 分析目的：{bg.purpose}")
    if bg_lines:
        lines.append("【任务背景】")
        lines.extend(bg_lines)
        lines.append("")
    return "\n".join(lines)


def _render_item_block(idx: int, item: WorkspaceItem) -> str:
    lines = [f"\n【素材 {idx}】{item.name or item.item_id}（类型：{item.type}）"]

    # tags
    tag_strs = _format_tags(item.tags)
    if tag_strs:
        lines.append(f"- 标签：{', '.join(tag_strs)}")

    # results 关键字段（按 type 分支）
    result_lines = _format_results(item.type, item.results)
    lines.extend(result_lines)

    return "\n".join(lines)


def _format_tags(tags: Dict[str, Any]) -> List[str]:
    if not isinstance(tags, dict):
        return []
    out: List[str] = []
    for key in (
        "content_type",
        "subject_domain",
        "difficulty",
        "duration_band",
        "information_density",
        "emotion_tone",
    ):
        val = tags.get(key)
        if val:
            out.append(f"{key}={val}")
    custom = tags.get("custom_tags")
    if isinstance(custom, list) and custom:
        out.append(f"custom={','.join(str(c) for c in custom[:5])}")
    return out


def _format_results(item_type: str, results: Dict[str, Any]) -> List[str]:
    if not isinstance(results, dict) or not results:
        return ["- 分析结果：（暂无）"]

    lines: List[str] = []
    summary = _pick_str(results, "summary", "video_summary", "asr_summary")
    if summary:
        lines.append(f"- 摘要：{_truncate(summary, 800)}")

    transcript = _pick_str(results, "transcript", "subtitle_text", "asr_text")
    if transcript:
        lines.append(f"- 转写片段：{_truncate(transcript, 600)}")

    ocr = _pick_str(results, "ocr_text", "ocr")
    if ocr:
        lines.append(f"- OCR：{_truncate(ocr, 400)}")

    description = _pick_str(results, "description", "content_describe")
    if description:
        lines.append(f"- 描述：{_truncate(description, 400)}")

    prompts = results.get("frame_prompts") or results.get("prompts")
    if isinstance(prompts, list) and prompts:
        sample = [str(p) for p in prompts[:3] if p]
        if sample:
            lines.append(f"- 提示词样例：{' | '.join(_truncate(s, 120) for s in sample)}")

    if not lines:
        # 兜底：把整个 results dict 简短预览
        preview = ", ".join(f"{k}=..." for k in list(results.keys())[:6])
        lines.append(f"- 结果字段：{preview}")
    return lines


def _pick_str(d: Dict[str, Any], *keys: str) -> Optional[str]:
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return None


def _truncate(text: str, max_chars: int) -> str:
    text = text.strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "…"
