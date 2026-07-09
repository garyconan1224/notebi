"""字幕清洗工具（F1.6，SPEC §4.3.1）。

两层清洗：
1. 规则层（零成本）：去语气词 / 合并重复 / 去空行
2. LLM 润色（可选）：修错字 + 标点 + 专有名词修正

所有函数都是纯函数，方便单测。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

# ── 语气词 / 填充词 ──────────────────────────────────────────

_FILLER_WORDS = (
    "嗯", "啊", "呃", "额", "哦", "噢", "哎", "唉",
    "这个", "那个", "就是", "就是说", "然后", "然后呢",
    "对吧", "对不对", "是不是", "你知道", "你知道吗",
    "我觉得吧", "怎么说呢", "反正", "基本上",
    "um", "uh", "like", "you know", "I mean",
    "basically", "actually", "right",
)

# 编译正则：匹配独立出现的语气词（前后是标点 / 空白 / 行首行尾）
_FILLER_RE = re.compile(
    r"(?<![一-龥a-zA-Z0-9])"
    + "|".join(re.escape(w) for w in sorted(_FILLER_WORDS, key=len, reverse=True))
    + r"(?![一-龥a-zA-Z0-9])",
)


# ── 规则层 ────────────────────────────────────────────────────


def remove_fillers(text: str) -> str:
    """去除语气词 / 填充词。"""
    return _FILLER_RE.sub("", text)


def deduplicate_lines(text: str) -> str:
    """去除连续重复行（Whisper 对同一段音频重复输出时常见）。"""
    lines = text.splitlines()
    if len(lines) <= 1:
        return text
    result: list[str] = []
    prev = ""
    for line in lines:
        stripped = line.strip()
        if stripped and stripped == prev:
            continue
        result.append(line)
        prev = stripped
    return "\n".join(result)


def merge_short_lines(text: str, min_len: int = 6) -> str:
    """将过短的行合并到下一行（Whisper 把一句话切成碎片时）。"""
    lines = text.splitlines()
    if len(lines) <= 1:
        return text
    merged: list[str] = []
    buf = ""
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if buf:
                merged.append(buf)
                buf = ""
            merged.append("")
            continue
        if len(stripped) < min_len and not _ends_with_punctuation(stripped):
            buf += stripped
            continue
        if buf:
            merged.append(buf + stripped)
            buf = ""
        else:
            merged.append(stripped)
    if buf:
        merged.append(buf)
    return "\n".join(merged)


def _ends_with_punctuation(text: str) -> bool:
    """判断文本是否以中英文句末标点结尾。"""
    return bool(re.search(r"[。！？.!?；;…]$", text.strip()))


def clean_transcript_rules(text: str) -> str:
    """规则层清洗：去语气词 → 去重复行 → 合并短句 → 清空行。"""
    if not text or not text.strip():
        return text
    result = remove_fillers(text)
    result = deduplicate_lines(result)
    result = merge_short_lines(result)
    # 去多余空行（保留单个换行）
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result.strip()


# ── LLM 润色 ──────────────────────────────────────────────────

_LLM_POLISH_PROMPT = (
    "你是一个字幕清洗助手。请对以下 ASR 转写文本做后处理：\n"
    "1. 修正明显的语音识别错误（同音字、漏字）\n"
    "2. 补全缺失的标点符号\n"
    "3. 调整断句使语义通顺\n"
    "4. 保持原意，不要添加、删减或改写内容\n"
    "{glossary_section}"
    "\n"
    "直接输出清洗后的文本，不要解释。\n\n"
    "{text}"
)

_GLOSSARY_INSTRUCTION = (
    "5. 遇到以下专有名词时优先匹配（不要用同音字替代）：\n"
    "{terms}\n"
)


def build_polish_prompt(
    text: str,
    glossary: Optional[List[str]] = None,
) -> str:
    """构建 LLM 润色 prompt。"""
    glossary_section = ""
    if glossary:
        terms = "、".join(glossary)
        glossary_section = _GLOSSARY_INSTRUCTION.format(terms=terms)
    return _LLM_POLISH_PROMPT.format(
        glossary_section=glossary_section,
        text=text,
    )


# ── 主入口 ────────────────────────────────────────────────────


def clean_transcript(
    text: str,
    glossary: Optional[List[str]] = None,
    llm_fn: Any = None,
) -> str:
    """字幕清洗主入口。

    Args:
        text: 原始 ASR 转写文本。
        glossary: 专有名词列表（注入 LLM prompt）。
        llm_fn: LLM 调用函数，签名 ``llm_fn(prompt: str) -> str``。
                传 None 则只做规则层清洗。

    Returns:
        清洗后的文本。
    """
    if not text or not text.strip():
        return text

    # 规则层
    cleaned = clean_transcript_rules(text)

    # LLM 润色（可选）
    if llm_fn and cleaned.strip():
        try:
            prompt = build_polish_prompt(cleaned, glossary)
            polished = llm_fn(prompt)
            if polished and polished.strip():
                cleaned = polished.strip()
        except Exception:
            pass  # LLM 失败时回退到规则层结果

    return cleaned
