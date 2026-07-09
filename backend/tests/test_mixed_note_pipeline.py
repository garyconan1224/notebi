"""混合笔记 pipeline 的轻量契约测试。"""

from __future__ import annotations

from pathlib import Path

from backend.app.services.pipeline_tasks import (
    _image_intermediate_patch,
    _probe_note_source,
    _steps_for_note_kind,
)


def test_probe_preserves_mixed_when_video_and_images_present() -> None:
    """mixed 素材同时保留视频链路和图文素材。"""
    probe = _probe_note_source(
        {
            "kind_hint": "video",
            "title": "混合素材",
            "content": "图文正文",
            "images": ["/tmp/1.jpg", "/tmp/2.jpg"],
            "video_file": "/tmp/demo.mp4",
        },
        {
            "note_media_kind": "mixed",
            "steps": ["download", "transcribe", "analyze", "note"],
        },
    )

    assert probe["note_kind"] == "mixed"
    assert probe["images"] == ["/tmp/1.jpg", "/tmp/2.jpg"]
    assert probe["video_file"] == "/tmp/demo.mp4"
    assert probe["steps"] == ["download", "transcribe", "analyze", "note"]


def test_mixed_steps_keep_video_processing() -> None:
    """mixed 需要视频转写/截帧，不能按 image_text 裁剪。"""
    steps = _steps_for_note_kind("mixed", ["download", "transcribe", "analyze", "note"])
    assert steps == ["download", "transcribe", "analyze", "note"]


def test_mixed_intermediate_keeps_image_cover(tmp_path: Path) -> None:
    """mixed 的图片也应进入处理中封面/图片数量回显。"""
    cover = tmp_path / "cover.jpg"
    cover.write_bytes(b"fake-image")

    patch = _image_intermediate_patch("mixed", [str(cover)], tmp_path)
    assert patch["cover_thumbnail"] == "/static/cover.jpg"
    assert patch["image_count"] == 1
