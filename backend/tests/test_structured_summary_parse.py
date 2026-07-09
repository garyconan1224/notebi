"""_parse_structured_summary char 级定位校验测试。"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from backend.app.services.pipeline_tasks import _parse_structured_summary


@pytest.fixture
def log() -> MagicMock:
    return MagicMock()


# ── 金句 substring 校验 ─────────────────────────────────────────


class TestGoldenQuotes:
    def test_exact_match_has_char_range(self, log: MagicMock) -> None:
        content = "这是第一段原文。\n\n这是第二段，包含一句金句在这里。"
        raw = '{"abstract":"摘要","key_points":[],"golden_quotes":[{"quote_text":"包含一句金句在这里"}]}'
        result = _parse_structured_summary(raw, content, log)
        quotes = result["golden_quotes"]
        assert len(quotes) == 1
        q = quotes[0]
        assert q["quote_text"] == "包含一句金句在这里"
        assert q["char_start"] == content.find("包含一句金句在这里")
        assert q["char_end"] == q["char_start"] + len("包含一句金句在这里")
        # 核心校验：原文[char_start:char_end] == quote_text
        assert content[q["char_start"]: q["char_end"]] == q["quote_text"]

    def test_no_match_discarded(self, log: MagicMock) -> None:
        content = "原文内容在这里。"
        raw = '{"abstract":"摘要","key_points":[],"golden_quotes":[{"quote_text":"不存在的金句"}]}'
        result = _parse_structured_summary(raw, content, log)
        assert result["golden_quotes"] == []
        log.assert_called()  # 应有丢弃日志

    def test_multiple_quotes_all_verified(self, log: MagicMock) -> None:
        content = "第一段金句A。\n\n第二段金句B在这里。"
        raw = (
            '{"abstract":"摘要","key_points":[],"golden_quotes":'
            '[{"quote_text":"金句A"},{"quote_text":"金句B在这里"}]}'
        )
        result = _parse_structured_summary(raw, content, log)
        assert len(result["golden_quotes"]) == 2
        for q in result["golden_quotes"]:
            assert content[q["char_start"]: q["char_end"]] == q["quote_text"]

    def test_para_index_correct(self, log: MagicMock) -> None:
        content = "段落零。\n\n段落一有金句在此。"
        raw = '{"abstract":"","key_points":[],"golden_quotes":[{"quote_text":"金句在此"}]}'
        result = _parse_structured_summary(raw, content, log)
        assert result["golden_quotes"][0]["para_index"] == 1

    def test_mixed_valid_and_invalid(self, log: MagicMock) -> None:
        content = "存在金句。"
        raw = (
            '{"abstract":"","key_points":[],"golden_quotes":'
            '[{"quote_text":"存在金句"},{"quote_text":"不存在"}]}'
        )
        result = _parse_structured_summary(raw, content, log)
        assert len(result["golden_quotes"]) == 1
        assert result["golden_quotes"][0]["quote_text"] == "存在金句"


# ── 要点 source_excerpt 校验 ─────────────────────────────────────


class TestKeyPoints:
    def test_excerpt_verified_has_char_range(self, log: MagicMock) -> None:
        content = "第一段。\n\n要点对应原文片段在这里。"
        raw = '{"abstract":"","key_points":[{"text":"归纳要点","source_excerpt":"原文片段在这里"}],"golden_quotes":[]}'
        result = _parse_structured_summary(raw, content, log)
        kps = result["key_points"]
        assert len(kps) == 1
        kp = kps[0]
        assert kp["source_excerpt"] == "原文片段在这里"
        assert content[kp["char_start"]: kp["char_end"]] == kp["source_excerpt"]

    def test_excerpt_not_found_discarded(self, log: MagicMock) -> None:
        content = "原文内容。"
        raw = '{"abstract":"","key_points":[{"text":"要点","source_excerpt":"不存在的片段"}],"golden_quotes":[]}'
        result = _parse_structured_summary(raw, content, log)
        assert result["key_points"] == []

    def test_no_excerpt_kept_without_char_range(self, log: MagicMock) -> None:
        content = "原文。"
        raw = '{"abstract":"","key_points":[{"text":"无来源要点"}],"golden_quotes":[]}'
        result = _parse_structured_summary(raw, content, log)
        assert len(result["key_points"]) == 1
        assert result["key_points"][0]["text"] == "无来源要点"
        assert "char_start" not in result["key_points"][0]

    def test_para_index_from_excerpt(self, log: MagicMock) -> None:
        content = "段零。\n\n段一含原文片段。"
        raw = '{"abstract":"","key_points":[{"text":"要点","source_excerpt":"原文片段"}],"golden_quotes":[]}'
        result = _parse_structured_summary(raw, content, log)
        assert result["key_points"][0]["para_index"] == 1


# ── 边界情况 ─────────────────────────────────────────────────────


class TestEdgeCases:
    def test_invalid_json_returns_raw_as_abstract(self, log: MagicMock) -> None:
        raw = "这不是 JSON"
        result = _parse_structured_summary(raw, "原文", log)
        assert result["abstract"] == raw
        assert result["key_points"] == []
        assert result["golden_quotes"] == []

    def test_json_with_code_block_wrapper(self, log: MagicMock) -> None:
        content = "原文金句在此。"
        raw = '```json\n{"abstract":"摘要","key_points":[],"golden_quotes":[{"quote_text":"金句在此"}]}\n```'
        result = _parse_structured_summary(raw, content, log)
        assert len(result["golden_quotes"]) == 1
        assert content[result["golden_quotes"][0]["char_start"]: result["golden_quotes"][0]["char_end"]] == "金句在此"

    def test_empty_content(self, log: MagicMock) -> None:
        raw = '{"abstract":"","key_points":[],"golden_quotes":[]}'
        result = _parse_structured_summary(raw, "", log)
        assert result == {"abstract": "", "key_points": [], "golden_quotes": []}
