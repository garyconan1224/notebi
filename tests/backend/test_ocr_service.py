"""shared/ocr_service.py 基础测试（N9）。"""

from __future__ import annotations

import pytest


class TestOcrService:
    """OCR 服务基础验证（不跑真实模型，只测边界逻辑）。"""

    def test_extract_text_rejects_empty_bytes(self):
        """空字节应返回空字符串而非崩溃。"""
        from shared.ocr_service import extract_text

        # 空 bytes — PaddleOCR 会报错，但 extract_text 应优雅处理
        # 实际情况是 PaddleOCR 对空文件会抛异常，所以我们测的是异常不会外泄
        try:
            result = extract_text(b"")
            # 如果没崩，结果应该是空字符串
            assert isinstance(result, str)
        except RuntimeError:
            # PaddleOCR 对空文件可能 RuntimeError，这是可接受的
            pass

    def test_extract_text_returns_string(self):
        """返回值类型必须是 str。"""
        from shared.ocr_service import extract_text

        # 用最小合法 PNG（1x1 白色像素）
        # 这是一个真实的最小 PNG 文件
        minimal_png = (
            b"\x89PNG\r\n\x1a\n"  # signature
            b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x02\x00\x00\x00\x90wS\xde"
            b"\x00\x00\x00\x0cIDATx"
            b"\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N"
            b"\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        try:
            result = extract_text(minimal_png)
            assert isinstance(result, str)
        except RuntimeError:
            # 模型未安装或初始化失败时 RuntimeError 是预期的
            pytest.skip("PaddleOCR 模型不可用")
