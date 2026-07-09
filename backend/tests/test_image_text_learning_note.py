"""图文笔记学习总结生成测试 — _fallback_learning_note + _generate_image_text_learning_note 断言。"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from backend.app.services.pipeline_tasks import _fallback_learning_note


def _log(msg: str) -> None:
    pass


class TestFallbackLearningNote:
    """_fallback_learning_note：无 LLM 时的纯文本兜底。"""

    def test_basic_structure(self) -> None:
        """生成的笔记应包含「核心内容」标题。"""
        source = "这是第一段内容。\n\n这是第二段内容，包含更多细节。\n\n这是第三段。"
        result = _fallback_learning_note(source_text=source, title="测试标题", log=_log)
        assert "核心内容" in result
        assert "测试标题" in result

    def test_skips_image_description_paragraphs(self) -> None:
        """含「【图片 N】」标记的段落应被跳过。"""
        source = (
            "重要学习内容第一段。\n\n"
            "【图片 1】主体: 卡片；描述: 一张信息图\n\n"
            "【图片 2】OCR文字: 某段文字\n\n"
            "重要学习内容第二段。"
        )
        result = _fallback_learning_note(source_text=source, title="测试", log=_log)
        assert "重要学习内容" in result
        assert "【图片" not in result

    def test_empty_source_returns_empty(self) -> None:
        """空文本应返回空字符串。"""
        result = _fallback_learning_note(source_text="", title="测试", log=_log)
        assert result == ""

    def test_short_source_returns_empty(self) -> None:
        """过短文本应返回空字符串。"""
        result = _fallback_learning_note(source_text="短", title="测试", log=_log)
        assert result == ""

    def test_no_title(self) -> None:
        """无标题时应使用默认标题。"""
        source = "这是一段足够长的测试文本内容，用于验证无标题时的处理逻辑是否正确。"
        result = _fallback_learning_note(source_text=source, title="", log=_log)
        assert "学习笔记" in result

    def test_no_image_description_fields_in_output(self) -> None:
        """输出不应包含逐图描述字段（主体/场景/色调/构图/风格/细节）。"""
        source = "这是一段足够长的测试文本内容，用于验证输出中不包含图片描述字段。" * 3
        result = _fallback_learning_note(source_text=source, title="测试", log=_log)
        bad_fields = ["主体:", "场景:", "色调:", "构图:", "风格:", "细节:"]
        for field in bad_fields:
            assert field not in result, f"输出不应包含「{field}」"
