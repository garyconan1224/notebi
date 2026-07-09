"""R3.7: _extract_bvid + _find_visual_json_paths_for_videos 单元测试。

验证 BV 号匹配优先、safe-name 回退、多视频不串台。
"""
import pytest
from pathlib import Path

from backend.app.services.pipeline_tasks import (
    _extract_bvid,
    _find_visual_json_paths_for_videos,
)


# ── _extract_bvid ──────────────────────────────────────────────

class TestExtractBvid:
    def test_standard_bvid(self):
        assert _extract_bvid("BV1i57D62EBM.mp4") == "BV1i57D62EBM"

    def test_bvid_with_prefix(self):
        assert _extract_bvid("用Codex行业_提示词给你_BV1i57D62EBM.mp4") == "BV1i57D62EBM"

    def test_bvid_in_visual_json(self):
        assert _extract_bvid("用Codex行业_提示词给你_BV1i57D62EBM_视觉数据.json") == "BV1i57D62EBM"

    def test_no_bvid(self):
        assert _extract_bvid("本地视频.mp4") == ""

    def test_empty(self):
        assert _extract_bvid("") == ""

    def test_bvid_case_sensitive(self):
        # BV 号是大小写混合的（如 BV1i57D62EBM），不应丢失大小写
        assert _extract_bvid("test_BV1AbCdEfGHi.mp4") == "BV1AbCdEfGHi"


# ── _find_visual_json_paths_for_videos ─────────────────────────

class TestFindVisualJsonPaths:
    """用 tmp_path 创建模拟的 JSON 文件来测试匹配逻辑。"""

    @pytest.fixture
    def json_dir(self, tmp_path):
        """创建包含视觉 JSON 的临时目录。"""
        d = tmp_path / "json"
        d.mkdir()
        return d

    def _touch(self, directory: Path, name: str) -> Path:
        p = directory / name
        p.write_text("{}")
        return p

    # ── BV 号匹配 ──

    def test_bvid_match_chinese_comma(self, json_dir):
        """根因场景：视频名含中文逗号，safe-name 不一致，但 BV 号能对上。"""
        # 视频文件名（含中文逗号和连字符）
        video = Path("/fake/用Codex…行业，提示词给你-BV1i57D62EBM.mp4")
        # 视觉 JSON 文件名（用下划线）
        expected_json = self._touch(json_dir, "用Codex_行业_提示词给你_BV1i57D62EBM_视觉数据.json")

        result = _find_visual_json_paths_for_videos(json_dir, [video])
        assert result == [expected_json]

    def test_bvid_match_simple(self, json_dir):
        """标准 BV 号匹配。"""
        video = Path("/fake/test_BV1234567890.mp4")
        expected_json = self._touch(json_dir, "some_prefix_BV1234567890_视觉数据.json")

        result = _find_visual_json_paths_for_videos(json_dir, [video])
        assert result == [expected_json]

    # ── safe-name 回退 ──

    def test_fallback_safe_name(self, json_dir):
        """无 BV 号时回退 safe-name 匹配（本地视频场景）。"""
        video = Path("/fake/本地教程.mp4")
        # 需要 get_safe_name 返回值，这里直接创建一个符合 sanitize 结果的文件
        # get_safe_name 对本地文件最终走 sanitize_filename(extract_product_name(stem))
        # "本地教程" → sanitize 后仍然是 "本地教程"（全是中文字符，\w 包含中文）
        expected_json = self._touch(json_dir, "本地教程_视觉数据.json")

        result = _find_visual_json_paths_for_videos(json_dir, [video])
        assert result == [expected_json]

    # ── 多视频不串台 ──

    def test_multi_video_no_cross_contamination(self, json_dir):
        """两个不同 BV 号的视频，各自只匹配自己的 JSON。"""
        video_a = Path("/fake/tutorial_A_BV1111111111.mp4")
        video_b = Path("/fake/tutorial_B_BV2222222222.mp4")

        json_a = self._touch(json_dir, "tutorial_A_BV1111111111_视觉数据.json")
        json_b = self._touch(json_dir, "tutorial_B_BV2222222222_视觉数据.json")
        # 额外的无关 JSON
        self._touch(json_dir, "other_video_BV9999999999_视觉数据.json")

        result_a = _find_visual_json_paths_for_videos(json_dir, [video_a])
        result_b = _find_visual_json_paths_for_videos(json_dir, [video_b])

        assert result_a == [json_a]
        assert result_b == [json_b]

    def test_mixed_bvid_and_local(self, json_dir):
        """混合场景：一个 BV 视频 + 一个本地视频，各自匹配。"""
        video_bv = Path("/fake/教程_BV1i57D62EBM.mp4")
        video_local = Path("/fake/本地演示.mp4")

        json_bv = self._touch(json_dir, "教程_BV1i57D62EBM_视觉数据.json")
        json_local = self._touch(json_dir, "本地演示_视觉数据.json")

        result = _find_visual_json_paths_for_videos(json_dir, [video_bv, video_local])
        assert json_bv in result
        assert json_local in result
        assert len(result) == 2

    # ── 边界情况 ──

    def test_no_videos(self, json_dir):
        """空视频列表返回空。"""
        assert _find_visual_json_paths_for_videos(json_dir, []) == []

    def test_no_json_files(self, tmp_path):
        """没有视觉 JSON 文件时返回空。"""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        video = Path("/fake/BV1234567890.mp4")
        assert _find_visual_json_paths_for_videos(empty_dir, [video]) == []

    def test_no_match_returns_empty(self, json_dir):
        """JSON 文件存在但 BV 号不匹配时返回空。"""
        video = Path("/fake/BV1111111111.mp4")
        self._touch(json_dir, "other_BV2222222222_视觉数据.json")

        result = _find_visual_json_paths_for_videos(json_dir, [video])
        assert result == []
