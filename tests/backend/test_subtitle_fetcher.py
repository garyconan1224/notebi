from __future__ import annotations

import sys
import types

from backend.app.services import subtitle_fetcher


def test_parse_standard_vtt_without_hour_component() -> None:
    segments = subtitle_fetcher._parse_vtt(
        "WEBVTT\n\n00:01.250 --> 00:03.500\n第一句\n\n00:04.000 --> 00:05.000\n第二句"
    )

    assert segments == [
        {"start": 1.25, "end": 3.5, "text": "第一句"},
        {"start": 4.0, "end": 5.0, "text": "第二句"},
    ]


def test_fetch_prefers_manual_chinese_subtitle(monkeypatch) -> None:
    class Response:
        def read(self):
            return b"1\n00:00:01,000 --> 00:00:02,000\nmanual zh\n"

    class YDL:
        def __init__(self, opts):
            assert opts["skip_download"] is True

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def extract_info(self, _url, download=False):
            assert download is False
            return {
                "subtitles": {"zh": [{"ext": "srt", "url": "manual"}]},
                "automatic_captions": {"zh": [{"ext": "srt", "url": "auto"}]},
            }

        def urlopen(self, url):
            assert url == "manual"
            return Response()

    fake_yt_dlp = types.ModuleType("yt_dlp")
    fake_yt_dlp.YoutubeDL = YDL  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "yt_dlp", fake_yt_dlp)

    result = subtitle_fetcher.fetch_best_subtitle("https://example.com/video")

    assert result is not None
    transcript, segments, meta = result
    assert transcript == "manual zh"
    assert segments[0]["start"] == 1.0
    assert meta == {"lang": "zh", "source": "manual"}
