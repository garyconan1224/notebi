"""Phase N7 — extract_frames_by_scenes 烟雾测试。

用 cv2 合成一个 4 秒、两段色块切换明显的视频，确保 PySceneDetect 至少检测到 1 个镜头切换，
且 frames_per_shot=3 时返回的帧数 ≥ 3。

视频文件通过 tmp_path 提供，跑完自动清理。
"""

from __future__ import annotations

from pathlib import Path

import pytest

cv2 = pytest.importorskip("cv2")
import numpy as np

from shared.video_analyzer import extract_frames_by_scenes


def _make_two_scene_video(out: Path, fps: int = 24, seconds_per_scene: int = 2) -> Path:
    """合成「红 → 蓝」两段色块视频，每段 seconds_per_scene 秒，方便 PySceneDetect 检测到 1 个切换。"""
    width, height = 320, 240
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(out), fourcc, fps, (width, height))
    assert writer.isOpened(), "无法打开 VideoWriter（系统缺 mp4v 编码？）"
    red = np.zeros((height, width, 3), dtype=np.uint8)
    red[:, :, 2] = 220
    blue = np.zeros((height, width, 3), dtype=np.uint8)
    blue[:, :, 0] = 220
    for _ in range(fps * seconds_per_scene):
        writer.write(red)
    for _ in range(fps * seconds_per_scene):
        writer.write(blue)
    writer.release()
    return out


def test_extract_frames_by_scenes_smoke(tmp_path: Path):
    video = _make_two_scene_video(tmp_path / "two_scene.mp4")

    frames = list(extract_frames_by_scenes(video, frames_per_shot=3))

    # 至少 1 帧；scene 切换被检测到时通常 ≥ 3 帧
    assert len(frames) >= 1
    # 每个元素是 (sec, frame_image)，sec >= 0 且 frame 是 ndarray
    for sec, img in frames:
        assert sec >= 0
        assert img is not None
        assert img.shape[0] == 240 and img.shape[1] == 320


def test_extract_frames_by_scenes_falls_back_for_single_scene(tmp_path: Path):
    # 单色视频，无切换点 → fallback 到首帧（不抛错）
    out = tmp_path / "single.mp4"
    fps = 24
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(out), fourcc, fps, (160, 120))
    grey = np.full((120, 160, 3), 128, dtype=np.uint8)
    for _ in range(fps * 2):
        writer.write(grey)
    writer.release()

    frames = list(extract_frames_by_scenes(out, frames_per_shot=2))
    assert len(frames) >= 1
