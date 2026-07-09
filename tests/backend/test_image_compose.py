"""NI.3 — 图文语境合成测试。

用例：
  1. LLM 合成成功 → 输出 markdown 含 ![](/static/...) 图引用
  2. LLM 返回空 → fallback 到原逻辑（描述堆末尾）
  3. 无 api_key → 跳过合成，fallback
  4. LLM 异常 → fallback，不阻断
  5. _img_to_static_url 路径转换
"""

from __future__ import annotations

import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from backend.app.services.pipeline_tasks import (
    _compose_images_with_llm,
    _generate_image_text_learning_note,
    _img_to_static_url,
)


# ── _img_to_static_url ─────────────────────────────────────────

class TestImgToStaticUrl:
    def test_absolute_path_under_data_dir(self, tmp_path: Path):
        img = tmp_path / "workspaces" / "ws1" / "img" / "photo.jpg"
        img.parent.mkdir(parents=True)
        img.write_bytes(b"\xff\xd8")
        assert _img_to_static_url(str(img), tmp_path) == "/static/workspaces/ws1/img/photo.jpg"

    def test_already_static_prefix(self):
        assert _img_to_static_url("/static/foo/bar.png", Path("/data")) == "/static/foo/bar.png"

    def test_path_outside_data_dir(self, tmp_path: Path):
        other = tmp_path.parent / "other_img.jpg"
        other.write_bytes(b"\xff\xd8")
        assert _img_to_static_url(str(other), tmp_path) == ""

    def test_empty_path(self):
        assert _img_to_static_url("", Path("/data")) == ""


# ── _compose_images_with_llm ────────────────────────────────────

_IMAGE_INFOS = [
    {"idx": 1, "description": "一杯拿铁咖啡", "ocr_text": "拿铁 ¥28", "static_url": "/static/ws/img1.jpg"},
    {"idx": 2, "description": "菜单截图", "ocr_text": "美式 ¥22 拿铁 ¥28", "static_url": "/static/ws/img2.jpg"},
]


class TestComposeImagesWithLlm:
    """LLM 合成图文 markdown。"""

    @patch("backend.app.services.pipeline_tasks.create_default_registry")
    def test_compose_success_has_image_refs(self, mock_registry_fn):
        """LLM 输出应含 ![](/static/...) 图引用。"""
        composed_md = (
            "# 咖啡店笔记\n\n"
            "今天去了咖啡店，![一杯拿铁咖啡](/static/ws/img1.jpg) 看起来很不错。\n\n"
            "菜单上写着：美式 ¥22，拿铁 ¥28。\n\n"
            "![菜单截图](/static/ws/img2.jpg)"
        )
        mock_provider = MagicMock()
        mock_provider.chat.return_value = composed_md
        mock_profile = MagicMock()
        mock_profile.default_models.get.return_value = "gpt-4o"
        mock_registry_fn.return_value.resolve_default_profile.return_value = mock_profile
        mock_registry_fn.return_value.build.return_value = mock_provider

        settings = SimpleNamespace(openai_api_key="sk-test", text_model="gpt-4o")
        result = _compose_images_with_llm(
            source_text="今天去了咖啡店。拿铁 ¥28。",
            image_infos=_IMAGE_INFOS,
            settings=settings,
            payload={},
            log=lambda _m: None,
        )

        assert result == composed_md
        assert "![一杯拿铁咖啡](/static/ws/img1.jpg)" in result
        assert "![菜单截图](/static/ws/img2.jpg)" in result
        # 图不应全堆在末尾——LLM 输出中图分散在段落间
        lines = result.strip().split("\n")
        img_lines = [i for i, l in enumerate(lines) if "![" in l]
        assert len(img_lines) >= 2
        assert img_lines[-1] - img_lines[0] > 1  # 图之间至少隔了一行

    @patch("backend.app.services.pipeline_tasks.create_default_registry")
    def test_compose_llm_returns_empty_fallback(self, mock_registry_fn):
        """LLM 返回空串 → fallback，返回空串。"""
        mock_provider = MagicMock()
        mock_provider.chat.return_value = ""
        mock_profile = MagicMock()
        mock_profile.default_models.get.return_value = "gpt-4o"
        mock_registry_fn.return_value.resolve_default_profile.return_value = mock_profile
        mock_registry_fn.return_value.build.return_value = mock_provider

        settings = SimpleNamespace(openai_api_key="sk-test", text_model="gpt-4o")
        result = _compose_images_with_llm(
            source_text="正文",
            image_infos=_IMAGE_INFOS,
            settings=settings,
            payload={},
            log=lambda _m: None,
        )
        assert result == ""

    def test_no_api_key_returns_empty(self):
        """无 api_key → 跳过合成，返回空串。"""
        settings = SimpleNamespace(openai_api_key="", text_model="gpt-4o")
        result = _compose_images_with_llm(
            source_text="正文",
            image_infos=_IMAGE_INFOS,
            settings=settings,
            payload={},
            log=lambda _m: None,
        )
        assert result == ""

    @patch("backend.app.services.pipeline_tasks.create_default_registry")
    def test_llm_exception_returns_empty(self, mock_registry_fn):
        """LLM 抛异常 → 不阻断，返回空串。"""
        mock_provider = MagicMock()
        mock_provider.chat.side_effect = RuntimeError("API 限流")
        mock_profile = MagicMock()
        mock_profile.default_models.get.return_value = "gpt-4o"
        mock_registry_fn.return_value.resolve_default_profile.return_value = mock_profile
        mock_registry_fn.return_value.build.return_value = mock_provider

        settings = SimpleNamespace(openai_api_key="sk-test", text_model="gpt-4o")
        result = _compose_images_with_llm(
            source_text="正文",
            image_infos=_IMAGE_INFOS,
            settings=settings,
            payload={},
            log=lambda _m: None,
        )
        assert result == ""

    @patch("backend.app.services.pipeline_tasks.create_default_registry")
    def test_llm_returns_text_without_image_refs_fallback(self, mock_registry_fn):
        """LLM 返回非空纯文字但漏掉图片引用 → 视为合成失败，走兜底。"""
        mock_provider = MagicMock()
        mock_provider.chat.return_value = "# 咖啡店笔记\n\n今天去了咖啡店，拿铁很好喝。"
        mock_profile = MagicMock()
        mock_profile.default_models.get.return_value = "gpt-4o"
        mock_registry_fn.return_value.resolve_default_profile.return_value = mock_profile
        mock_registry_fn.return_value.build.return_value = mock_provider

        settings = SimpleNamespace(openai_api_key="sk-test", text_model="gpt-4o")
        result = _compose_images_with_llm(
            source_text="正文",
            image_infos=_IMAGE_INFOS,
            settings=settings,
            payload={},
            log=lambda _m: None,
        )
        assert result == ""  # 无 /static/ 引用 → fallback

    @patch("backend.app.services.pipeline_tasks.create_default_registry")
    def test_compose_timeout_returns_empty(self, mock_registry_fn):
        """LLM 长时间无响应 → 触发任务级超时，返回空串让调用方兜底。"""
        logs: list[str] = []
        mock_provider = MagicMock()

        def _slow_chat(_req):
            time.sleep(0.05)
            return "too late"

        mock_provider.chat.side_effect = _slow_chat
        mock_profile = MagicMock()
        mock_profile.default_models.get.return_value = "gpt-4o"
        mock_registry_fn.return_value.resolve_default_profile.return_value = mock_profile
        mock_registry_fn.return_value.build.return_value = mock_provider

        settings = SimpleNamespace(openai_api_key="sk-test", text_model="gpt-4o")
        result = _compose_images_with_llm(
            source_text="正文",
            image_infos=_IMAGE_INFOS,
            settings=settings,
            payload={"image_text_llm_timeout_sec": 0.01},
            log=logs.append,
        )

        assert result == ""
        assert any("超时" in msg for msg in logs)


class TestGenerateImageTextLearningNote:
    """图文学习笔记生成。"""

    @patch("backend.app.services.pipeline_tasks.create_default_registry")
    def test_learning_note_timeout_falls_back(self, mock_registry_fn):
        """学习笔记 LLM 超时 → 返回纯文本兜底笔记，不阻断任务。"""
        logs: list[str] = []
        mock_provider = MagicMock()

        def _slow_chat(_req):
            time.sleep(0.05)
            return "# 太晚返回的笔记"

        mock_provider.chat.side_effect = _slow_chat
        mock_profile = MagicMock()
        mock_profile.default_models.get.return_value = "gpt-4o"
        mock_registry_fn.return_value.resolve_default_profile.return_value = mock_profile
        mock_registry_fn.return_value.build.return_value = mock_provider

        settings = SimpleNamespace(openai_api_key="sk-test", text_model="gpt-4o")
        result = _generate_image_text_learning_note(
            source_md="这是一段足够长的图文原始内容，用于验证超时后仍然可以生成兜底学习笔记。",
            title="图文标题",
            settings=settings,
            payload={"image_text_llm_timeout_sec": 0.01},
            log=logs.append,
        )

        assert "图文标题" in result
        assert "核心内容" in result
        assert any("超时" in msg for msg in logs)
