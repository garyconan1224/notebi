"""验证字幕导出优先使用 edited_text 字段。"""

from backend.app.routes.export import _build_srt
from shared.audio_analyzer import export_srt, export_txt, export_vtt, export_ass


def _seg(text: str, edited: str | None = None, start: float = 0.0, end: float = 3.0) -> dict:
    d = {"start": start, "end": end, "text": text}
    if edited is not None:
        d["edited_text"] = edited
    return d


class TestEditedTextExport:
    """edited_text 存在时，导出内容应使用 edited_text 而非 text。"""

    def test_build_srt_uses_edited_text(self):
        segs = [_seg("原文", edited="修改后")]
        result = _build_srt(segs)
        assert "修改后" in result
        assert "原文" not in result

    def test_export_srt_uses_edited_text(self):
        segs = [_seg("原文", edited="修改后")]
        result = export_srt(segs)
        assert "修改后" in result
        assert "原文" not in result

    def test_export_txt_uses_edited_text(self):
        segs = [_seg("原文", edited="修改后")]
        result = export_txt(segs)
        assert "修改后" in result
        assert "原文" not in result

    def test_export_vtt_uses_edited_text(self):
        segs = [_seg("原文", edited="修改后")]
        result = export_vtt(segs)
        assert "修改后" in result
        assert "原文" not in result

    def test_export_ass_uses_edited_text(self):
        segs = [_seg("原文", edited="修改后")]
        result = export_ass(segs)
        assert "修改后" in result
        assert "原文" not in result

    def test_fallback_to_text_when_no_edited(self):
        segs = [_seg("原文")]
        result = export_srt(segs)
        assert "原文" in result

    def test_normalize_segments_preserves_edited_text(self):
        from backend.app.routes.export import _normalize_segments

        raw = [{"start": 0.0, "end": 3.0, "text": "原文", "edited_text": "修改后"}]
        result = _normalize_segments(raw)
        assert len(result) == 1
        assert result[0]["text"] == "修改后"
        assert result[0]["edited_text"] == "修改后"
