"""
模型 id 启发式分类（无 Streamlit 依赖，可供 CLI 自检使用）。
"""

from __future__ import annotations

from typing import List, Sequence, Tuple


def split_chat_models(ids: Sequence[str]) -> Tuple[List[str], List[str]]:
    """将 sub_type=chat 的模型 id 粗分为「文本」与「多模态/视觉」两类。"""
    text: List[str] = []
    vision: List[str] = []
    for mid in ids:
        low = mid.lower()
        is_vision = any(
            p in low
            for p in (
                "-vl",
                "/vl",
                "vl-",
                "vl2",
                "omni",
                "vision",
                "glm-4v",
                "glm4v",
                "internvl",
                "deepseek-vl",
                "paddleocr",
                "qwen3-vl",
            )
        )
        if is_vision:
            vision.append(mid)
        else:
            text.append(mid)
    if not vision:
        vision = list(dict.fromkeys(ids))
    if not text:
        text = list(dict.fromkeys(ids))
    return sorted(set(text)), sorted(set(vision))
