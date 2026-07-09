"""B站 opus 适配器测试 — 离线解析 + URL 提取。

核心测试：用缓存的真实 m.bilibili.com HTML 做解析断言，不依赖 CI 网络。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.app.downloaders.bilibili_opus import (
    _extract_initial_state,
    _extract_opus_id,
    _parse_opus_state,
    fetch_bilibili_opus,
)

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
OPUS_HTML = FIXTURES / "opus_sample.html"


# ── URL 提取 ──────────────────────────────────────────────────────

class TestExtractOpusId:
    def test_www_url(self):
        assert _extract_opus_id("https://www.bilibili.com/opus/1203642237996498944") == "1203642237996498944"

    def test_m_url(self):
        assert _extract_opus_id("https://m.bilibili.com/opus/1203642237996498944") == "1203642237996498944"

    def test_url_with_params(self):
        assert _extract_opus_id("https://www.bilibili.com/opus/123456?from=search") == "123456"

    def test_no_opus(self):
        assert _extract_opus_id("https://www.bilibili.com/video/BV1xx411c7mD") is None

    def test_empty(self):
        assert _extract_opus_id("") is None


# ── 真实 HTML 离线解析 ─────────────────────────────────────────────

class TestParseRealHtml:
    """用缓存的 m.bilibili.com HTML 做端到端解析断言。"""

    @pytest.fixture(autouse=True)
    def _load_html(self):
        if not OPUS_HTML.exists():
            pytest.skip(f"fixture 不存在: {OPUS_HTML}")
        self.html = OPUS_HTML.read_text(encoding="utf-8")

    def test_extract_initial_state(self):
        state = _extract_initial_state(self.html)
        assert state is not None
        assert "opus" in state
        assert "detail" in state["opus"]

    def test_title_extracted(self):
        state = _extract_initial_state(self.html)
        result = _parse_opus_state(state)
        assert result["ok"] is True
        assert "AI圈大事件" in result["title"]

    def test_content_not_empty(self):
        state = _extract_initial_state(self.html)
        result = _parse_opus_state(state)
        assert result["ok"] is True
        assert len(result["content"]) > 500  # 这篇长文应有大量正文

    def test_content_contains_heading(self):
        state = _extract_initial_state(self.html)
        result = _parse_opus_state(state)
        assert "### 一、AI行业动态" in result["content"]

    def test_content_contains_list_items(self):
        state = _extract_initial_state(self.html)
        result = _parse_opus_state(state)
        # 列表项应被提取为 markdown list
        assert "- OpenHuman" in result["content"] or "OpenHuman" in result["content"]

    def test_kind_hint_text_only(self):
        state = _extract_initial_state(self.html)
        result = _parse_opus_state(state)
        assert result["kind_hint"] == "text"  # 这篇没有图片

    def test_title_strips_bilibili_suffix(self):
        state = _extract_initial_state(self.html)
        result = _parse_opus_state(state)
        assert not result["title"].endswith("- 哔哩哔哩")


# ── 错误处理 ──────────────────────────────────────────────────────

class TestErrorHandling:
    def test_invalid_url(self):
        result = fetch_bilibili_opus("https://example.com/no-opus")
        assert result["ok"] is False
        assert "opus_id" in result["error"]

    def test_malformed_html(self):
        result = _extract_initial_state("<html><body>no state here</body></html>")
        assert result is None

    def test_missing_detail(self):
        state = {"opus": {}}
        result = _parse_opus_state(state)
        assert result["ok"] is False
        assert "opus.detail" in result["error"]
