"""Q3 / D4：媒体导出服务（原视频流式 / 软字幕打包 / 烧录任务）。"""

from __future__ import annotations

import zipfile
import io
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.app.services.media_export import (
    MediaExportError,
    build_softsub_zip,
    build_subtitle_content,
    collect_segments,
    resolve_local_media_from_url,
    resolve_local_media_path,
)


def _item(results):
    return SimpleNamespace(results=results)


def test_resolve_static_url_to_local_path(tmp_path: Path) -> None:
    media = tmp_path / "workspaces" / "ws" / "videos" / "a.mp4"
    media.parent.mkdir(parents=True)
    media.write_bytes(b"video-bytes")

    got = resolve_local_media_from_url("/static/workspaces/ws/videos/a.mp4", tmp_path)
    assert got == media.resolve()


def test_resolve_rejects_path_traversal_and_missing(tmp_path: Path) -> None:
    (tmp_path / "inside.txt").write_text("x")
    # 越界：试图跳出 data 根
    assert resolve_local_media_from_url("/static/../outside.mp4", tmp_path) is None
    # 不存在
    assert resolve_local_media_from_url("/static/nope.mp4", tmp_path) is None
    assert resolve_local_media_from_url("", tmp_path) is None


def test_resolve_from_item_video_url(tmp_path: Path) -> None:
    media = tmp_path / "v.mp4"
    media.write_bytes(b"v")
    item = _item({"media": {"video": {"url": "/static/v.mp4"}}})
    assert resolve_local_media_path(item, tmp_path) == media.resolve()

    item_audio = _item({"media": {"audio": "/static/v.mp4"}})
    assert resolve_local_media_path(item_audio, tmp_path) == media.resolve()

    assert resolve_local_media_path(_item({}), tmp_path) is None


def test_collect_segments_normalizes_display_and_whisper() -> None:
    display = [
        {"t_sec": 0, "text": "第一句", "speaker": "SPEAKER_00"},
        {"t_sec": 3, "text": "第二句"},
    ]
    segs = collect_segments({"transcript": display})
    assert len(segs) == 2
    assert segs[0]["start"] == 0 and segs[0]["text"] == "第一句"
    assert segs[0]["speaker"] == "SPEAKER_00"
    # 第一段 end 用下一段 start 推算
    assert segs[0]["end"] == 3

    whisper = [{"start": 1.0, "end": 2.5, "text": "w"}]
    segs2 = collect_segments({"segments": whisper})
    assert segs2[0]["start"] == 1.0 and segs2[0]["end"] == 2.5

    # 空文本被丢弃
    assert collect_segments({"transcript": [{"t_sec": 0, "text": "  "}]}) == []
    assert collect_segments({}) == []
    assert collect_segments({"transcript": "plain string"}) == []


def test_build_subtitle_content_formats() -> None:
    segs = [{"start": 0, "end": 2, "text": "你好", "speaker": ""}]
    srt = build_subtitle_content(segs, "srt", "t")
    assert "00:00:00" in srt and "你好" in srt
    vtt = build_subtitle_content(segs, "vtt", "t")
    assert vtt.startswith("WEBVTT")
    ass = build_subtitle_content(segs, "ass", "t")
    assert "[Script Info]" in ass or "Dialogue" in ass

    with pytest.raises(MediaExportError):
        build_subtitle_content(segs, "mp4", "t")


def test_build_softsub_zip_contains_media_and_subtitle(tmp_path: Path) -> None:
    media = tmp_path / "movie.mp4"
    media.write_bytes(b"FAKE-VIDEO-BYTES")
    segs = [{"start": 0, "end": 1, "text": "hi", "speaker": ""}]
    content = build_subtitle_content(segs, "srt", "movie")

    blob = build_softsub_zip(media, content, "srt", "movie")
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = zf.namelist()
        assert any(n.endswith(".mp4") for n in names)
        assert any(n.endswith(".srt") for n in names)
        assert zf.read(next(n for n in names if n.endswith(".mp4"))) == b"FAKE-VIDEO-BYTES"
