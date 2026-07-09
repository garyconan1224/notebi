"""PaddleOCR 文字提取服务（N9 图片分支）。

提供轻量封装：懒加载 PaddleOCR 引擎，提取图片中的文字。
首次调用会下载模型（~100MB），后续调用复用全局实例。
"""

from __future__ import annotations

import logging
from typing import List

logger = logging.getLogger(__name__)

_ocr_engine = None


def _get_engine():
    """懒加载 PaddleOCR 全局实例（中英双语，方向分类开）。"""
    global _ocr_engine
    if _ocr_engine is None:
        try:
            from paddleocr import PaddleOCR

            _ocr_engine = PaddleOCR(use_textline_orientation=True, lang="ch", show_log=False)
            logger.info("PaddleOCR engine initialized (lang=ch, angle_cls=True)")
        except ImportError:
            raise RuntimeError(
                "paddleocr 未安装，请运行: pip3 install paddleocr paddlepaddle"
            )
        except Exception as exc:
            raise RuntimeError(f"PaddleOCR 初始化失败: {exc}") from exc
    return _ocr_engine


def extract_text(image_bytes: bytes, *, min_confidence: float = 0.5) -> str:
    """从图片字节流提取文字。

    Args:
        image_bytes: 图片原始字节（PNG/JPEG/WEBP 均可）。
        min_confidence: 最低置信度阈值，低于此值的行会被过滤。

    Returns:
        提取到的文字，按行拼接（高置信度行优先）。
    """
    import tempfile
    from pathlib import Path

    engine = _get_engine()

    # PaddleOCR 需要文件路径或 numpy array，写临时文件
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(image_bytes)
        tmp_path = tmp.name

    try:
        result = engine.ocr(tmp_path, cls=True)
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    if not result or not result[0]:
        return ""

    lines: List[str] = []
    for line_info in result[0]:
        # line_info: [[box coords], (text, confidence)]
        if not isinstance(line_info, (list, tuple)) or len(line_info) < 2:
            continue
        text_part = line_info[1]
        if isinstance(text_part, (list, tuple)) and len(text_part) >= 2:
            text, confidence = text_part[0], text_part[1]
        elif isinstance(text_part, str):
            text, confidence = text_part, 1.0
        else:
            continue
        if confidence >= min_confidence and text.strip():
            lines.append(text.strip())

    return "\n".join(lines)

def extract_text_from_array(img: "numpy.ndarray", *, min_confidence: float = 0.5) -> str:
    """从 numpy 图片数组中提取文字。"""
    engine = _get_engine()
    result = engine.ocr(img, cls=True)

    if not result or not result[0]:
        return ""

    lines = []
    for line_info in result[0]:
        if not isinstance(line_info, (list, tuple)) or len(line_info) < 2:
            continue
        text_part = line_info[1]
        if isinstance(text_part, (list, tuple)) and len(text_part) >= 2:
            text, confidence = text_part[0], text_part[1]
        elif isinstance(text_part, str):
            text, confidence = text_part, 1.0
        else:
            continue
        if confidence >= min_confidence and text.strip():
            lines.append(text.strip())

    return "\n".join(lines)
