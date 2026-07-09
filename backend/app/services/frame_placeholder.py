"""占位符解析器：LLM 输出的 *FRAME-[mm:ss] → 真实截图 URL。

约定占位符格式：![配图](*FRAME-[mm:ss])
- 本身是合法 markdown 图片语法，LLM 不易写歪
- *FRAME- 前缀便于正则识别
- mm:ss 取自转写分段真实时间戳
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

# 匹配 ![配图](*FRAME-12:34) 或 ![...](*FRAME-1:02:30)
_FRAME_PLACEHOLDER_RE = re.compile(
    r"!\[([^\]]*)\]\(\*FRAME-\[(\d{1,2}:\d{2}(?::\d{2})?)\]\)"
)


def find_nearest_frame(
    frames: List[Dict[str, Any]],
    target_sec: float,
) -> Optional[Dict[str, Any]]:
    """在 frames 列表中找秒数最接近 target_sec 的那一帧。

    frames 应包含 "sec" 或 "timestamp" 字段。
    找不到返回 None。
    """
    if not frames:
        return None
    best: Optional[Dict[str, Any]] = None
    best_dist = float("inf")
    for fr in frames:
        sec = float(fr.get("sec") or 0)
        dist = abs(sec - target_sec)
        if dist < best_dist:
            best_dist = dist
            best = fr
    return best


def _ts_to_sec(ts: str) -> float:
    """hh:mm:ss 或 mm:ss → 秒数。"""
    parts = ts.strip().split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    elif len(parts) == 2:
        return int(parts[0]) * 60 + int(parts[1])
    return 0.0


def _to_static_url(path: str) -> str:
    """本地绝对路径 → /static/... URL（与 summary_generator._to_static_url 一致）。"""
    from shared.config import DATA_DIR

    if not path:
        return ""
    if path.startswith("/static/"):
        return path
    try:
        p = Path(path).resolve()
        data_resolved = DATA_DIR.resolve()
        if str(p).startswith(str(data_resolved)):
            rel = p.relative_to(data_resolved)
            return f"/static/{rel.as_posix()}"
    except (ValueError, OSError):
        pass
    return ""


def resolve_frame_placeholders(
    content_md: str,
    frames: List[Dict[str, Any]],
) -> str:
    """扫描 content_md 中的 *FRAME-[mm:ss] 占位符，替换为真实截图 URL。

    找不到帧则删除该占位符行（不留断图）。
    无 frames 时直接清除所有占位符。
    """
    if not content_md:
        return content_md

    def _replace(m: re.Match[str]) -> str:
        alt_text = m.group(1) or "配图"
        ts = m.group(2)
        target_sec = _ts_to_sec(ts)

        if not frames:
            return ""  # 无帧数据，清除占位符

        nearest = find_nearest_frame(frames, target_sec)
        if nearest is None:
            return ""

        img_path = str(nearest.get("image_path") or nearest.get("frame_image_path") or "")
        static_url = _to_static_url(img_path)
        if not static_url:
            return ""

        return f"![{alt_text}]({static_url})"

    # Step 1: 替换占位符
    result = _FRAME_PLACEHOLDER_RE.sub(_replace, content_md)

    # Step 2: 清理可能产生的空行（占位符被删除后留的空行）
    # 将连续 ≥3 个空行压缩为 2 个
    result = re.sub(r"\n{4,}", "\n\n\n", result)

    return result
