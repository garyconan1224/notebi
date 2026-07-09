"""Phase N7 — CaptureParams.from_dict 单元测试。

覆盖：
- 老 boolean / None / 缺失字段 → 全部走默认
- N5 新形状（capture_mode + interval_sec + max_frames + scene_frames_per_shot）→ 解析正确
- 异常输入（非法 mode / 非法 frames_per_shot / 字符串数字）→ 兜底默认
"""

from __future__ import annotations

from shared.video_analyzer import CaptureParams


def test_defaults_when_data_missing():
    p = CaptureParams.from_dict(None)
    assert p.mode == "scene"
    assert p.interval_sec == 5
    assert p.max_frames == 100
    assert p.frames_per_shot == 3


def test_defaults_when_data_is_boolean():
    # N5 之前的老形状：tasks.frame_prompts = true
    p = CaptureParams.from_dict(True)
    assert p.mode == "scene"
    assert p.frames_per_shot == 3


def test_parse_n5_shape_interval_mode():
    p = CaptureParams.from_dict(
        {
            "enabled": True,
            "capture_mode": "interval",
            "interval_sec": 3,
            "max_frames": 50,
            "scene_frames_per_shot": 2,
            "format": "mj",
            "lang": "en",
        }
    )
    assert p.mode == "interval"
    assert p.interval_sec == 3
    assert p.max_frames == 50
    assert p.frames_per_shot == 2


def test_parse_n5_shape_scene_mode():
    p = CaptureParams.from_dict(
        {"enabled": True, "capture_mode": "scene", "scene_frames_per_shot": 3}
    )
    assert p.mode == "scene"
    assert p.frames_per_shot == 3


def test_illegal_mode_fallbacks_to_scene():
    p = CaptureParams.from_dict({"capture_mode": "wat", "scene_frames_per_shot": 5})
    assert p.mode == "scene"
    # frames_per_shot 非 2/3 → 兜底 3
    assert p.frames_per_shot == 3


def test_string_numbers_are_coerced():
    p = CaptureParams.from_dict(
        {"capture_mode": "interval", "interval_sec": "7", "max_frames": "200"}
    )
    assert p.interval_sec == 7
    assert p.max_frames == 200


def test_negative_or_zero_clamped_to_min_one():
    p = CaptureParams.from_dict(
        {"capture_mode": "interval", "interval_sec": 0, "max_frames": -5}
    )
    assert p.interval_sec >= 1
    assert p.max_frames >= 1
