"""RP1-C0 视频结果物化回归测试。

测试 _materialize_video_results_from_analyze 函数的正确性：
- raw frames + json_outputs：输出结构化 frames
- image_prompt_en 能正确进入 prompt_mj
- raw absolute frame_image_path 能转成 /static/... image_path
- summary_path=subtitle 不被错误物化
- 多 json_outputs 时 preferred_basenames 仍能选中正确视觉 JSON
"""

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.app.routes.workspaces import (
    _is_target_frame_format,
    _convert_absolute_to_static_url,
    _materialize_video_results_from_analyze,
)


def _create_visual_json(tmp_path: Path, stem: str, frames_data: list) -> Path:
    """创建视觉 JSON 文件并返回路径。同时创建 frames 目录以满足 _locate_analyze_report_dir。"""
    visual_data = {
        "video_title": f"{stem}-test",
        "global_visual_summary": "测试总结",
        "frames": frames_data,
    }
    json_file = tmp_path / f"{stem}_视觉数据.json"
    json_file.write_text(json.dumps(visual_data, ensure_ascii=False), encoding="utf-8")
    # _locate_analyze_report_dir 需要 frames 目录或 _分析报告 目录
    (tmp_path / "frames").mkdir(exist_ok=True)
    return json_file


class TestIsTargetFrameFormat:
    """测试 _is_target_frame_format 函数。"""

    def test_empty_frames(self):
        assert _is_target_frame_format([]) is False

    def test_none_frames(self):
        assert _is_target_frame_format(None) is False

    def test_missing_required_fields(self):
        """只有 frame_image/frame_image_path 的 raw frames 不是目标格式。"""
        frames = [
            {"frame_image": "http://example.com/img.jpg", "frame_image_path": "/abs/path/img.jpg"}
        ]
        assert _is_target_frame_format(frames) is False

    def test_partial_required_fields(self):
        """部分目标字段存在，不算目标格式。"""
        frames = [
            {"image_path": "/static/path.jpg", "sec": 1.0, "ts": "00:00:01"}
        ]
        assert _is_target_frame_format(frames) is False

    def test_target_format(self):
        """完整目标格式。"""
        frames = [
            {
                "image_path": "/static/path.jpg",
                "sec": 1.0,
                "ts": "00:00:01",
                "prompt_mj": "test prompt",
            }
        ]
        assert _is_target_frame_format(frames) is True

    def test_target_format_with_extra_fields(self):
        """目标格式可以有额外字段。"""
        frames = [
            {
                "idx": 0,
                "sec": 0.0,
                "ts": "00:00:00",
                "timestamp": "00:00:00",
                "description": "test",
                "frame_image_path": "/static/path.jpg",
                "image_path": "/static/path.jpg",
                "shot_type": "",
                "title": "",
                "subtitle": "",
                "prompt_mj": "test prompt",
                "prompt_sd": {"positive": "test", "negative": ""},
                "prompt_video": "test prompt",
                "tags": {},
            }
        ]
        assert _is_target_frame_format(frames) is True


class TestConvertAbsoluteToStaticUrl:
    """测试 _convert_absolute_to_static_url 函数。"""

    def test_empty_path(self):
        data_root = Path("/data")
        assert _convert_absolute_to_static_url("", data_root) == ""

    def test_already_static_url(self):
        data_root = Path("/data")
        assert _convert_absolute_to_static_url("/static/workspaces/ws/img.jpg", data_root) == "/static/workspaces/ws/img.jpg"

    def test_relative_path(self):
        """相对路径无法转换，返回原值。"""
        data_root = Path("/data")
        assert _convert_absolute_to_static_url("relative/path.jpg", data_root) == "relative/path.jpg"


class TestMaterializeVideoResultsFromAnalyze:
    """测试 _materialize_video_results_from_analyze 函数。"""

    def test_non_dict_input(self):
        """非 dict 输入直接返回。"""
        assert _materialize_video_results_from_analyze(None) is None
        assert _materialize_video_results_from_analyze([]) == []
        assert _materialize_video_results_from_analyze("string") == "string"

    def test_target_format_frames_skip(self):
        """已是目标格式的 frames 直接返回，不重新物化。"""
        frames = [
            {
                "image_path": "/static/path.jpg",
                "sec": 1.0,
                "ts": "00:00:01",
                "prompt_mj": "test prompt",
            }
        ]
        results = {"frames": frames, "json_outputs": ["/some/path.json"]}
        returned = _materialize_video_results_from_analyze(results)
        assert returned["frames"] is frames  # 同一对象引用，没有重新物化

    def test_raw_frames_with_json_outputs(self, tmp_path):
        """raw frames + json_outputs：输出结构化 frames。"""
        frames_data = [
            {
                "timestamp": "00:00:00",
                "description_zh": "第一帧描述",
                "image_prompt_en": "first frame prompt",
            },
            {
                "timestamp": "00:00:05",
                "description_zh": "第二帧描述",
                "image_prompt_en": "second frame prompt",
            },
        ]
        json_file = _create_visual_json(tmp_path, "test_video", frames_data)

        # raw frames 只有 frame_image/frame_image_path
        raw_frames = [
            {"frame_image": "img1.jpg", "frame_image_path": "/abs/path/img1.jpg"},
            {"frame_image": "img2.jpg", "frame_image_path": "/abs/path/img2.jpg"},
        ]
        results = {
            "frames": raw_frames,
            "json_outputs": [str(json_file)],
        }

        with patch("backend.app.routes.workspaces._ROOT_DIR", tmp_path):
            returned = _materialize_video_results_from_analyze(results)

        assert len(returned["frames"]) == 2
        assert returned["frames"][0]["description"] == "第一帧描述"
        assert returned["frames"][1]["description"] == "第二帧描述"

    def test_image_prompt_en_maps_to_prompt_mj(self, tmp_path):
        """image_prompt_en 能正确进入 prompt_mj。"""
        frames_data = [
            {
                "timestamp": "00:00:00",
                "description_zh": "desc",
                "image_prompt_en": "MJ style prompt from visual json",
            },
        ]
        json_file = _create_visual_json(tmp_path, "test", frames_data)

        results = {"frames": [], "json_outputs": [str(json_file)]}

        with patch("backend.app.routes.workspaces._ROOT_DIR", tmp_path):
            returned = _materialize_video_results_from_analyze(results)

        assert returned["frames"][0]["prompt_mj"] == "MJ style prompt from visual json"

    def test_prompt_sd_prompt_video_fallback(self, tmp_path):
        """prompt_sd/prompt_video 没有源字段时用 image_prompt_en 兜底。"""
        frames_data = [
            {
                "timestamp": "00:00:00",
                "description_zh": "desc",
                "image_prompt_en": "fallback prompt",
            },
        ]
        json_file = _create_visual_json(tmp_path, "test", frames_data)

        results = {"frames": [], "json_outputs": [str(json_file)]}

        with patch("backend.app.routes.workspaces._ROOT_DIR", tmp_path):
            returned = _materialize_video_results_from_analyze(results)

        frame = returned["frames"][0]
        assert frame["prompt_sd"] == {"positive": "fallback prompt", "negative": ""}
        assert frame["prompt_video"] == "fallback prompt"

    def test_raw_absolute_path_converted_to_static(self, tmp_path):
        """raw absolute frame_image_path 能转成 /static/... image_path。"""
        # 创建 data 子目录结构
        data_dir = tmp_path / "data" / "workspaces" / "ws1" / "frames"
        data_dir.mkdir(parents=True)
        img_file = data_dir / "frame_0.jpg"
        img_file.write_bytes(b"fake image")

        frames_data = [
            {
                "timestamp": "00:00:00",
                "description_zh": "desc",
                "image_prompt_en": "prompt",
            },
        ]
        json_file = _create_visual_json(tmp_path, "test", frames_data)

        # raw frame 有绝对路径
        raw_frames = [{"frame_image_path": str(img_file)}]
        results = {
            "frames": raw_frames,
            "json_outputs": [str(json_file)],
        }

        with patch("backend.app.routes.workspaces._ROOT_DIR", tmp_path):
            returned = _materialize_video_results_from_analyze(results)

        # 应该转成 /static/... 路径
        assert returned["frames"][0]["image_path"].startswith("/static/")
        assert "workspaces/ws1/frames/frame_0.jpg" in returned["frames"][0]["image_path"]

    def test_summary_path_subtitle_not_affected(self, tmp_path):
        """summary_path=subtitle 不被错误物化。"""
        frames_data = [
            {"timestamp": "00:00:00", "description_zh": "desc", "image_prompt_en": "prompt"},
        ]
        json_file = _create_visual_json(tmp_path, "test", frames_data)

        results = {
            "frames": [],
            "json_outputs": [str(json_file)],
            "summary_path": "subtitle",
            "transcript": [{"t_sec": 0, "t_str": "00:00", "text": "original transcript"}],
        }

        with patch("backend.app.routes.workspaces._ROOT_DIR", tmp_path):
            returned = _materialize_video_results_from_analyze(results)

        # summary_path=subtitle 的 transcript 不应被覆盖
        assert returned["transcript"][0]["text"] == "original transcript"
        # frames 应该还是空的（subtitle 模式不需要 frames）
        assert returned["frames"] == []

    def test_preferred_basenames_selects_correct_json(self, tmp_path):
        """多 json_outputs 时 preferred_basenames 仍能选中正确视觉 JSON。"""
        # 创建两个视觉 JSON
        visual1 = {"frames": [{"timestamp": "00:00:00", "description_zh": "video1", "image_prompt_en": "prompt1"}]}
        visual2 = {"frames": [{"timestamp": "00:00:00", "description_zh": "video2", "image_prompt_en": "prompt2"}]}

        json1 = tmp_path / "BV1234567890_视觉数据.json"
        json2 = tmp_path / "BV9876543210_视觉数据.json"
        json1.write_text(json.dumps(visual1, ensure_ascii=False), encoding="utf-8")
        json2.write_text(json.dumps(visual2, ensure_ascii=False), encoding="utf-8")
        # 创建 frames 目录以满足 _locate_analyze_report_dir
        (tmp_path / "frames").mkdir(exist_ok=True)

        results = {
            "frames": [],
            "json_outputs": [str(json1), str(json2)],
        }

        with patch("backend.app.routes.workspaces._ROOT_DIR", tmp_path):
            # 优先选 BV9876543210
            returned = _materialize_video_results_from_analyze(
                results, preferred_basenames=["BV9876543210"]
            )

        assert returned["frames"][0]["description"] == "video2"

    def test_frame_count_matches_visual_json(self, tmp_path):
        """物化后的 frames 数量应来自视觉 JSON，不是 raw frames。"""
        frames_data = [
            {"timestamp": f"00:00:{i:02d}", "description_zh": f"frame {i}", "image_prompt_en": f"prompt {i}"}
            for i in range(21)
        ]
        json_file = _create_visual_json(tmp_path, "test", frames_data)

        # raw frames 只有 1 个
        raw_frames = [{"frame_image_path": "/abs/path/img.jpg"}]
        results = {
            "frames": raw_frames,
            "json_outputs": [str(json_file)],
        }

        with patch("backend.app.routes.workspaces._ROOT_DIR", tmp_path):
            returned = _materialize_video_results_from_analyze(results)

        # 应该是 21 帧（来自视觉 JSON），不是 1 帧（来自 raw frames）
        assert len(returned["frames"]) == 21

    def test_frame_has_all_required_fields(self, tmp_path):
        """frame[0] 至少包含 idx、sec、ts、timestamp、description、image_path、prompt_mj、prompt_sd、prompt_video、tags。"""
        frames_data = [
            {
                "timestamp": "00:00:00",
                "description_zh": "test desc",
                "image_prompt_en": "test prompt",
            },
        ]
        json_file = _create_visual_json(tmp_path, "test", frames_data)

        results = {"frames": [], "json_outputs": [str(json_file)]}

        with patch("backend.app.routes.workspaces._ROOT_DIR", tmp_path):
            returned = _materialize_video_results_from_analyze(results)

        frame = returned["frames"][0]
        required_fields = ["idx", "sec", "ts", "timestamp", "description", "image_path", "prompt_mj", "prompt_sd", "prompt_video", "tags"]
        for field in required_fields:
            assert field in frame, f"Missing required field: {field}"

    def test_frames_dir_uses_timestamp_not_idx(self, tmp_path):
        """C-0.1: frames_dir 兜底用 timestamp/sec 拼文件名，不用 idx。timestamp=00:00:03, idx=2 时也能找到 *_00_00_03.jpg。"""
        # 创建 data 子目录结构（_ROOT_DIR / "data" 的路径）
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        frames_data = [
            {"timestamp": "00:00:00", "description_zh": "f0", "image_prompt_en": "p0"},
            {"timestamp": "00:00:01", "description_zh": "f1", "image_prompt_en": "p1"},
            {"timestamp": "00:00:03", "description_zh": "f2", "image_prompt_en": "p2"},  # idx=2, ts=3
        ]
        # 在 data 目录下创建视觉 JSON 和 frames 目录
        json_file = data_dir / "BVTest_视觉数据.json"
        json_file.write_text(json.dumps({"frames": frames_data}, ensure_ascii=False), encoding="utf-8")
        frames_dir = data_dir / "frames"
        frames_dir.mkdir()
        (frames_dir / "BVTest_00_00_03.jpg").write_bytes(b"fake")

        results = {"frames": [], "json_outputs": [str(json_file)]}

        with patch("backend.app.routes.workspaces._ROOT_DIR", tmp_path):
            returned = _materialize_video_results_from_analyze(results)

        assert len(returned["frames"]) == 3
        # idx=0, ts=00:00:00 → 无对应 jpg
        assert returned["frames"][0]["image_path"] == ""
        # idx=1, ts=00:00:01 → 无对应 jpg
        assert returned["frames"][1]["image_path"] == ""
        # idx=2, ts=00:00:03 → 有 BVTest_00_00_03.jpg
        assert returned["frames"][2]["image_path"].startswith("/static/")
        assert "BVTest_00_00_03.jpg" in returned["frames"][2]["image_path"]

    def test_duplicate_timestamp_reuses_same_jpg(self, tmp_path):
        """C-0.1: 重复 timestamp 的多条 frame 复用同一个 jpg。"""
        # 创建 data 子目录结构
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        frames_data = [
            {"timestamp": "00:00:05", "description_zh": "f0", "image_prompt_en": "p0"},
            {"timestamp": "00:00:05", "description_zh": "f1", "image_prompt_en": "p1"},  # 同 timestamp
            {"timestamp": "00:00:05", "description_zh": "f2", "image_prompt_en": "p2"},  # 同 timestamp
        ]
        json_file = data_dir / "BVTest_视觉数据.json"
        json_file.write_text(json.dumps({"frames": frames_data}, ensure_ascii=False), encoding="utf-8")
        frames_dir = data_dir / "frames"
        frames_dir.mkdir()
        (frames_dir / "BVTest_00_00_05.jpg").write_bytes(b"fake")

        results = {"frames": [], "json_outputs": [str(json_file)]}

        with patch("backend.app.routes.workspaces._ROOT_DIR", tmp_path):
            returned = _materialize_video_results_from_analyze(results)

        assert len(returned["frames"]) == 3
        # 三帧都应有相同的 image_path
        for i in range(3):
            assert "BVTest_00_00_05.jpg" in returned["frames"][i]["image_path"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
