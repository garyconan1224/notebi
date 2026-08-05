"""导出参数单测：语言感知字幕、真实时间区间、转写多格式、烧录语言字段"""

from __future__ import annotations

from shared.audio_analyzer import export_ass, export_srt, export_vtt
from backend.app.routes.export import (
    _build_srt,
    _build_transcript_document,
    _flat_translation_lines,
)


SEGMENTS = [
    {"start": 0.0, "end": 3.5, "text": "你好", "speaker": "S1"},
    {"start": 3.5, "end": 7.0, "text": "世界", "speaker": "S1"},
]
TRANSLATIONS = ["Hello", "World"]


def test_export_srt_bilingual_merges_translation():
    content = export_srt(SEGMENTS, translations=TRANSLATIONS, language="bilingual")
    assert "你好\nHello" in content
    assert "世界\nWorld" in content


def test_export_srt_translation_falls_back_to_source_when_missing():
    content = export_srt(SEGMENTS, translations=["Hello"], language="translation")
    assert "Hello" in content
    assert "世界" in content  # 第二段缺翻译 → 回退原文


def test_export_srt_source_ignores_translations():
    content = export_srt(SEGMENTS, translations=TRANSLATIONS, language="source")
    assert "你好\nHello" not in content
    assert "你好" in content
    assert "Hello" not in content


def test_export_vtt_and_ass_respect_with_speaker():
    vtt = export_vtt(SEGMENTS, language="source", with_speaker=False)
    assert "<v S1>" not in vtt
    ass = export_ass(SEGMENTS, title="t", language="source", with_speaker=False)
    assert "S1: 你好" not in ass


def test_build_srt_uses_real_start_end():
    content = _build_srt(SEGMENTS)
    assert "00:00:00,000 --> 00:00:03,500" in content
    assert "00:00:03,500 --> 00:00:07,000" in content
    assert "00:00:03,000" not in content  # 不再出现 t_sec+3 的假结束时间


def test_build_transcript_document_markdown_with_options():
    content = _build_transcript_document(
        SEGMENTS,
        "md",
        with_speaker=True,
        with_timestamp=True,
        translations=TRANSLATIONS,
        language="bilingual",
    )
    assert "[00:00] [S1] 你好\nHello" in content
    assert "[00:03] [S1] 世界\nWorld" in content


def test_flat_translation_lines_flattens_dict():
    results = {"translations": {"zh": [{"text": "A"}, {"text": "B"}]}}
    assert _flat_translation_lines(results, 2) == ["A", "B"]


def test_burn_request_accepts_language():
    from backend.app.routes.media_export import BurnRequest

    req = BurnRequest(subtitle_format="srt", language="translation")
    assert req.language == "translation"
