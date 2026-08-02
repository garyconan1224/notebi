"""Generate concise, evidence-bound chapter summaries for audio and video notes."""

from __future__ import annotations

import json
from typing import Any

from backend.app.services.summary_generator import _call_llm


def _to_seconds(value: object) -> float:
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return 0.0


def _normalise_segments(raw_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for raw in raw_segments:
        text = str(raw.get("edited_text") or raw.get("text") or "").strip()
        if not text:
            continue
        segments.append({"t_sec": _to_seconds(raw.get("t_sec", raw.get("start"))), "text": text})
    return sorted(segments, key=lambda segment: segment["t_sec"])


def _sample_for_prompt(segments: list[dict[str, Any]], limit: int = 160) -> list[dict[str, Any]]:
    if len(segments) <= limit:
        return segments
    indexes = sorted({round(index * (len(segments) - 1) / (limit - 1)) for index in range(limit)})
    return [segments[index] for index in indexes]


def _strip_json_fence(value: str) -> str:
    text = value.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if "```" in text:
            text = text.rsplit("```", 1)[0]
    return text.strip()


def _nearest_time(value: object, timestamps: list[float]) -> float:
    target = _to_seconds(value)
    return min(timestamps, key=lambda timestamp: abs(timestamp - target))


def _fallback(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    text = " ".join(segment["text"] for segment in segments)
    return [{
        "start": segments[0]["t_sec"],
        "end": segments[-1]["t_sec"],
        "title": "全文内容",
        "summary": text[:100] or "暂无内容提要",
        "keywords": [],
        "source": "fallback",
    }]


def generate_chapter_summaries(
    raw_segments: list[dict[str, Any]],
    *,
    provider_id: str = "",
    model: str = "",
) -> tuple[list[dict[str, Any]], str]:
    """Generate chapters while snapping every model timestamp to a real segment.

    The model receives sampled, timestamped evidence only. Its time suggestions are
    never returned verbatim: they are snapped to the nearest real segment so every
    chapter button can seek to a defensible position in the source media.
    """
    segments = _normalise_segments(raw_segments)
    if not segments:
        raise ValueError("当前素材没有可用于生成章节的字幕")
    evidence = _sample_for_prompt(segments)
    formatted = "\n".join(
        f"[{int(segment['t_sec']) // 60:02d}:{int(segment['t_sec']) % 60:02d}] {segment['text']}"
        for segment in evidence
    )
    system = (
        "你是音视频章节编辑。只依据给出的带时间戳字幕生成章节，不得编造内容、时间或引用。"
        "每个 summary 必须是一句完整、可读的中文内容总结，不要复述逐字字幕。"
    )
    prompt = f"""请将下列字幕划为 3 到 10 个有意义的章节；短内容可少于 3 个。

字幕证据：
{formatted}

只输出 JSON 数组，每项严格包含：
- start：章节开始秒数，必须贴近给出的字幕时间
- end：章节结束秒数，必须不早于 start
- title：不超过 14 个汉字的主题标题
- summary：20 到 80 字的一句话内容总结
- keywords：1 到 4 个关键词数组
"""
    raw, model_used = _call_llm(system, prompt, provider_id=provider_id, model=model)
    try:
        candidates = json.loads(_strip_json_fence(raw))
    except json.JSONDecodeError:
        return _fallback(segments), model_used
    if not isinstance(candidates, list):
        return _fallback(segments), model_used

    timestamps = [segment["t_sec"] for segment in segments]
    chapters: list[dict[str, Any]] = []
    for candidate in candidates[:12]:
        if not isinstance(candidate, dict):
            continue
        title = str(candidate.get("title") or "未命名章节").strip()[:28]
        summary = " ".join(str(candidate.get("summary") or "").split()).strip()[:180]
        if not summary:
            continue
        start = _nearest_time(candidate.get("start"), timestamps)
        end = _nearest_time(candidate.get("end"), timestamps)
        if end < start:
            end = start
        raw_keywords = candidate.get("keywords")
        keywords = [str(keyword).strip()[:20] for keyword in raw_keywords] if isinstance(raw_keywords, list) else []
        chapters.append({
            "start": start,
            "end": end,
            "title": title,
            "summary": summary,
            "keywords": [keyword for keyword in keywords if keyword][:4],
            "source": "llm",
        })
    chapters.sort(key=lambda chapter: (chapter["start"], chapter["end"], chapter["title"]))
    return (chapters or _fallback(segments)), model_used
