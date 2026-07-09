"""LLM 驱动的章节拆分、全局摘要、最终综合。"""

from __future__ import annotations

import json
from typing import Any

from backend.app.services.av_synthesis.align import AlignedFrame
from backend.app.services.av_synthesis.render import Chapter
from src.vidmirror.core.providers import ChatRequest
from src.vidmirror.core.providers.registry import create_default_registry
from shared.settings_store import load_settings


def _call_llm(prompt: str, api_key: str, *, max_tokens: int = 4000, temperature: float = 0.3) -> str:
    """同步调用 LLM chat。"""
    settings = load_settings()
    registry = create_default_registry()
    profile = registry.resolve_default_profile(settings, "chat")
    provider = registry.build(profile)
    chat_model = str(
        (profile.default_models or {}).get("chat") or ""
    ).strip()
    if not chat_model:
        raise RuntimeError("未配置 chat model")
    return provider.chat(ChatRequest(
        model=chat_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
        max_tokens=max_tokens,
    ))


def _format_aligned_for_llm(aligned: list[AlignedFrame]) -> str:
    """把对齐数据格式化为 LLM 可读的文本。"""
    lines: list[str] = []
    for i, af in enumerate(aligned):
        ts_min = int(af.frame.timestamp // 60)
        ts_sec = int(af.frame.timestamp % 60)
        ts_str = f"{ts_min:02d}:{ts_sec:02d}"
        desc = af.frame.scene_description or "(无描述)"
        snippets = "; ".join(af.transcript_snippets[:3]) if af.transcript_snippets else "(无转写)"
        lines.append(f"[{ts_str}] 帧{i}: {desc} | 转写: {snippets}")
    return "\n".join(lines)


def llm_split_chapters(
    aligned: list[AlignedFrame],
    metadata: dict[str, Any],
    api_key: str,
) -> list[Chapter]:
    """用 LLM 把对齐后的帧+转写拆成章节。

    返回 Chapter 列表（title, time_range, frame_path, transcript_excerpt）。
    """
    title = metadata.get("title") or metadata.get("video_title") or "未命名视频"
    aligned_text = _format_aligned_for_llm(aligned)

    prompt = f"""你是一个教学视频章节拆分助手。请根据以下关键帧和转写数据，将视频拆分为 3~8 个章节。

视频标题：{title}

帧数据（按时间顺序）：
{aligned_text}

请以 JSON 数组格式输出，每个元素包含：
- title: 章节标题（简短，10字以内）
- start_ts: 开始时间（秒数，float）
- end_ts: 结束时间（秒数，float）
- frame_indices: 关联的帧索引列表（0-based）
- transcript_indices: 关联的转写片段索引列表（0-based）

只输出 JSON 数组，不要其他文字。"""

    raw = _call_llm(prompt, api_key, max_tokens=2000, temperature=0.2)

    # 提取 JSON
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    try:
        items = json.loads(text)
    except json.JSONDecodeError:
        # 兜底：整段作为一个章节
        return [Chapter(
            title="全文",
            time_range="00:00~end",
            frame_path=aligned[0].frame.image_path if aligned else "",
            transcript_excerpt="; ".join(af.transcript_snippets[0] for af in aligned if af.transcript_snippets)[:200],
        )]

    chapters: list[Chapter] = []
    for item in items:
        start_sec = float(item.get("start_ts", 0))
        end_sec = float(item.get("end_ts", 0))
        frame_indices = item.get("frame_indices", [])

        # 取第一个关联帧的图片路径
        frame_path = ""
        if frame_indices and aligned:
            idx = frame_indices[0] if isinstance(frame_indices[0], int) else 0
            if 0 <= idx < len(aligned):
                frame_path = aligned[idx].frame.image_path

        # 取关联帧的转写摘选
        transcript_excerpt = ""
        if frame_indices and aligned:
            snippets: list[str] = []
            for fi in frame_indices:
                if isinstance(fi, int) and 0 <= fi < len(aligned):
                    snippets.extend(aligned[fi].transcript_snippets[:2])
            transcript_excerpt = "; ".join(snippets[:4])

        def _fmt_ts(sec: float) -> str:
            m, s = divmod(int(sec), 60)
            return f"{m:02d}:{s:02d}"

        chapters.append(Chapter(
            title=str(item.get("title", "未命名")),
            time_range=f"{_fmt_ts(start_sec)}~{_fmt_ts(end_sec)}",
            frame_path=frame_path,
            transcript_excerpt=transcript_excerpt[:300],
        ))

    return chapters or [Chapter(title="全文", time_range="00:00~end")]


def llm_global_summary(transcript_text: str, api_key: str) -> str:
    """用 LLM 生成全局摘要。"""
    truncated = transcript_text[:8000]
    prompt = f"""请将以下视频转写内容总结为 150-300 字的中文教学摘要，突出核心知识点和学习要点：

{truncated}

只输出摘要文本，不要标题或格式。"""

    return _call_llm(prompt, api_key, max_tokens=1500, temperature=0.3).strip()


def llm_final_synthesis(
    aligned: list[AlignedFrame],
    chapters: list[Chapter],
    api_key: str,
) -> str:
    """用 LLM 生成最终综合分析。"""
    chapter_summary = "\n".join(
        f"- {ch.title}（{ch.time_range}）: {ch.highlights or ch.transcript_excerpt[:50]}"
        for ch in chapters
    )
    aligned_text = _format_aligned_for_llm(aligned)[:4000]

    prompt = f"""你是一个教学视频分析助手。请根据以下章节结构和帧数据，写一段 200-400 字的综合分析。
分析应涵盖：视频的核心主题、知识结构、关键要点、适合的受众。

章节结构：
{chapter_summary}

帧数据摘要：
{aligned_text}

只输出分析文本，不要标题或格式。"""

    return _call_llm(prompt, api_key, max_tokens=2000, temperature=0.4).strip()
