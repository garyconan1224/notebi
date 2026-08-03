"""Q2：轻量故事板截帧（独立于 VLM）。

ffmpeg/cv2 定时抽帧，≤12 张，带 sec 时间戳；VLM 失败不影响故事板。
"""

from __future__ import annotations

from pathlib import Path

import pytest

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")


def _make_synthetic_video(path: Path, seconds: int = 30, fps: int = 5) -> Path:
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (64, 48),
    )
    assert writer.isOpened(), "无法创建测试视频"
    for i in range(seconds * fps):
        frame = np.full((48, 64, 3), (i * 3) % 256, dtype="uint8")
        writer.write(frame)
    writer.release()
    return path


def test_storyboard_frames_capped_at_12_with_seconds(tmp_path: Path) -> None:
    from shared.video_analyzer import extract_storyboard_frames

    video = _make_synthetic_video(tmp_path / "demo.mp4", seconds=30)
    out_dir = tmp_path / "storyboard"
    frames = extract_storyboard_frames(video, out_dir, max_frames=12)

    assert 1 <= len(frames) <= 12
    secs = [f["sec"] for f in frames]
    assert secs == sorted(secs), "sec 必须单调递增"
    assert all(Path(f["frame_image_path"]).exists() for f in frames)
    # 长视频才截满 12 张：30s / 12 → 间隔 2s，应接近上限
    assert len(frames) >= 10


def test_storyboard_frames_short_video_returns_few(tmp_path: Path) -> None:
    from shared.video_analyzer import extract_storyboard_frames

    video = _make_synthetic_video(tmp_path / "short.mp4", seconds=3)
    frames = extract_storyboard_frames(video, tmp_path / "sb", max_frames=12)

    assert 1 <= len(frames) <= 3
    assert all(Path(f["frame_image_path"]).exists() for f in frames)


def test_storyboard_frames_missing_video_returns_empty(tmp_path: Path) -> None:
    from shared.video_analyzer import extract_storyboard_frames

    frames = extract_storyboard_frames(tmp_path / "missing.mp4", tmp_path / "sb")
    assert frames == []
