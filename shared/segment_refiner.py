"""引擎无关字幕切分层（Track K segment_refiner）。

把 ASR 输出的过长字幕段，在原时间区间内按标点/字数切成 ≤max_chars 的短段。
时间按字符比例分配，零全局漂移。

用法：
    from shared.segment_refiner import refine_segments
    fine_segments = refine_segments(coarse_segments)

数据流位置：
    ASR 引擎 → [{start, end, text}]
      → refine_segments()          ← 本模块
      → 存入 results["transcript_segments"]
"""

from __future__ import annotations

import re
from typing import List, Dict

# ── 字数计算 ─────────────────────────────────────────────────

_CJK_RE = re.compile(
    r"[一-鿿㐀-䶿豈-﫿"
    r"\U00020000-\U0002a6df\U0002a700-\U0002b73f"
    r"\U0002b740-\U0002b81f\U0002b820-\U0002ceaf"
    r"　-〿＀-￯]"
)
_WORD_RE = re.compile(r"[^\s一-鿿㐀-䶿豈-﫿\U00020000-\U0002ceaf　-〿＀-￯]+")


def _char_len(text: str) -> int:
    """计算字数：CJK 每字算 1，连续 ASCII 串（单词/数字）整体算 1，标点算 1。

    与 wdkns subtitle-refine 口径对齐：英文单词视为一个字。
    """
    if not text:
        return 0
    count = 0
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch.isspace():
            i += 1
            continue
        if _CJK_RE.match(ch):
            count += 1
            i += 1
            continue
        # ASCII 字母/数字/标点等：连续非空白非CJK 串算 1
        j = i + 1
        while j < n:
            c = text[j]
            if c.isspace() or _CJK_RE.match(c):
                break
            j += 1
        count += 1
        i = j
    return count


# ── 文本切分（三级） ─────────────────────────────────────────

_SENTENCE_END = re.compile(r"[。！？!?…]+")
_CLAUSE_BREAK = re.compile(r"[，、；,;：:]")


def _split_text(text: str, max_chars: int, min_chars: int) -> List[str]:
    """三级切分：句末→句中→字数硬切，再合并碎片。"""
    text = text.strip()
    if not text:
        return []
    if _char_len(text) <= max_chars:
        return [text]

    # 1. 句末优先切
    pieces = _split_by_pattern(text, _SENTENCE_END)
    # 2. 对仍超长的子段，句中次之切
    expanded: List[str] = []
    for piece in pieces:
        if _char_len(piece) > max_chars:
            expanded.extend(_split_by_pattern(piece, _CLAUSE_BREAK))
        else:
            expanded.append(piece)
    # 3. 字数硬切兜底
    final: List[str] = []
    for piece in expanded:
        if _char_len(piece) > max_chars:
            final.extend(_hard_split(piece, max_chars))
        else:
            final.append(piece)
    # 4. 合并碎片
    return _merge_fragments(final, min_chars)


def _split_by_pattern(text: str, pattern: re.Pattern) -> List[str]:
    """在 pattern 匹配的位置断开，标点保留在前段末尾。"""
    parts: List[str] = []
    last = 0
    for m in pattern.finditer(text):
        end = m.end()  # 标点之后断开
        segment = text[last:end].strip()
        if segment:
            parts.append(segment)
        last = end
    tail = text[last:].strip()
    if tail:
        parts.append(tail)
    return parts if parts else [text.strip()]


def _hard_split(text: str, max_chars: int) -> List[str]:
    """按字数硬切，不切断 CJK 字、不切断 ASCII 单词。"""
    parts: List[str] = []
    current = ""
    current_len = 0
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch.isspace():
            current += ch
            i += 1
            continue
        if _CJK_RE.match(ch):
            char_w = 1
            token = ch
        else:
            # 找到整个 ASCII token
            j = i + 1
            while j < n:
                c = text[j]
                if c.isspace() or _CJK_RE.match(c):
                    break
                j += 1
            token = text[i:j]
            char_w = 1
        if current_len + char_w > max_chars and current.strip():
            parts.append(current.strip())
            current = ""
            current_len = 0
        current += token
        current_len += char_w
        i += len(token)
    if current.strip():
        parts.append(current.strip())
    return parts if parts else [text]


def _merge_fragments(pieces: List[str], min_chars: int) -> List[str]:
    """把 < min_chars 的碎片向前合并（前面没有则向后）。"""
    if not pieces:
        return pieces
    merged: List[str] = []
    for piece in pieces:
        if merged and _char_len(piece) < min_chars:
            merged[-1] = merged[-1] + piece
        elif merged and _char_len(merged[-1]) < min_chars:
            merged[-1] = merged[-1] + piece
        else:
            merged.append(piece)
    # 最后一段如果太短，合并进前一段
    if len(merged) >= 2 and _char_len(merged[-1]) < min_chars:
        merged[-2] = merged[-2] + merged[-1]
        merged.pop()
    return merged


# ── 时间分配（零漂移） ───────────────────────────────────────

def _allocate_time(
    pieces: List[str],
    start: float,
    end: float,
    *,
    min_dur: float = 0.8,
) -> List[Dict[str, object]]:
    """按字符比例分配时间，强制首尾对齐（零漂移）。"""
    if not pieces:
        return []
    if len(pieces) == 1:
        return [{"start": start, "end": end, "text": pieces[0]}]

    dur = end - start
    weights = [_char_len(p) for p in pieces]
    w_total = sum(weights) or 1

    # 初步按比例分配
    segs: List[Dict[str, object]] = []
    t = start
    for i, piece in enumerate(pieces):
        if i == len(pieces) - 1:
            # 最后一段：直接收尾，消除浮点累积误差
            seg_dur = end - t
        else:
            seg_dur = dur * (weights[i] / w_total)
        segs.append({"start": t, "end": t + seg_dur, "text": piece})
        t += seg_dur

    # 强制收尾：最后一段 end == 原 end
    segs[-1]["end"] = end  # type: ignore[assignment]

    # min_dur 兜底：极短段向前合并
    if min_dur > 0:
        segs = _merge_short_segments(segs, min_dur)

    return segs


def _merge_short_segments(
    segs: List[Dict[str, object]],
    min_dur: float,
) -> List[Dict[str, object]]:
    """把时长 < min_dur 的段向前合并。"""
    if len(segs) <= 1:
        return segs
    merged: List[Dict[str, object]] = [segs[0]]
    for seg in segs[1:]:
        dur = float(seg["end"]) - float(seg["start"])  # type: ignore[arg-type]
        if dur < min_dur:
            # 合并进前一段
            prev = merged[-1]
            prev["end"] = seg["end"]
            prev["text"] = str(prev["text"]) + str(seg["text"])
        else:
            merged.append(seg)
    # 如果最后一段被合并后变太短（理论上不会，但防御）
    if len(merged) >= 2:
        last_dur = float(merged[-1]["end"]) - float(merged[-1]["start"])  # type: ignore[arg-type]
        if last_dur < min_dur:
            prev = merged[-2]
            prev["end"] = merged[-1]["end"]
            prev["text"] = str(prev["text"]) + str(merged[-1]["text"])
            merged.pop()
    return merged


# ── 公开 API ─────────────────────────────────────────────────

def refine_segments(
    segments: List[Dict[str, object]],
    *,
    max_chars: int = 16,
    min_chars: int = 4,
    min_dur: float = 0.8,
) -> List[Dict[str, object]]:
    """把过长 segments 按标点/字数切细，时间在原区间内按字符比例分配。

    输入/输出都是 [{"start": float, "end": float, "text": str}]。
    - 段 <= max_chars：原样保留（仅 strip text）。
    - 段 > max_chars：三级切分（句末→句中→字数硬切），子段时间按字符比例分配，
      子段首尾衔接、总覆盖时长 == 原段 (end-start)，无全局漂移。
    - 空 text 段跳过。
    引擎无关：mlx/faster/remote/gemini 的输出都吃这一个格式。
    """
    result: List[Dict[str, object]] = []
    for seg in segments:
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        start = float(seg.get("start") or 0)
        end = float(seg.get("end") or start)
        if _char_len(text) <= max_chars:
            result.append({"start": start, "end": end, "text": text})
            continue
        pieces = _split_text(text, max_chars, min_chars)
        if len(pieces) <= 1:
            result.append({"start": start, "end": end, "text": text})
            continue
        result.extend(_allocate_time(pieces, start, end, min_dur=min_dur))
    return result
