"""frame_placeholder 单测：占位符解析 + 最近帧查找。"""

from __future__ import annotations

import pytest

from backend.app.services.frame_placeholder import (
    _FRAME_PLACEHOLDER_RE,
    _ts_to_sec,
    find_nearest_frame,
    resolve_frame_placeholders,
)


class TestTsToSec:
    def test_mm_ss(self):
        assert _ts_to_sec("12:34") == 12 * 60 + 34

    def test_hh_mm_ss(self):
        assert _ts_to_sec("1:02:30") == 3600 + 2 * 60 + 30

    def test_zero(self):
        assert _ts_to_sec("00:00") == 0.0


class TestFindNearestFrame:
    def test_empty(self):
        assert find_nearest_frame([], 10.0) is None

    def test_exact_match(self):
        frames = [{"sec": 10.0, "image_path": "/tmp/img1.jpg"}]
        result = find_nearest_frame(frames, 10.0)
        assert result is not None
        assert result["image_path"] == "/tmp/img1.jpg"

    def test_nearest(self):
        frames = [
            {"sec": 5.0, "image_path": "/tmp/a.jpg"},
            {"sec": 15.0, "image_path": "/tmp/b.jpg"},
            {"sec": 25.0, "image_path": "/tmp/c.jpg"},
        ]
        result = find_nearest_frame(frames, 12.0)
        assert result is not None
        assert result["image_path"] == "/tmp/b.jpg"

    def test_before_first(self):
        frames = [
            {"sec": 10.0, "image_path": "/tmp/a.jpg"},
        ]
        result = find_nearest_frame(frames, 2.0)
        assert result is not None
        assert result["image_path"] == "/tmp/a.jpg"


class TestPlaceholderRegex:
    def test_matches_standard(self):
        m = _FRAME_PLACEHOLDER_RE.search("![配图](*FRAME-[12:34])")
        assert m is not None
        assert m.group(2) == "12:34"

    def test_matches_hh_mm_ss(self):
        m = _FRAME_PLACEHOLDER_RE.search("![screenshot](*FRAME-[1:02:30])")
        assert m is not None
        assert m.group(2) == "1:02:30"

    def test_does_not_match_normal_image(self):
        m = _FRAME_PLACEHOLDER_RE.search("![正常图片](/static/img.png)")
        assert m is None


class TestResolveFramePlaceholders:
    def test_replaces_with_static_url(self, monkeypatch, tmp_path):
        """占位符被替换为 /static/... URL"""
        from shared.config import DATA_DIR
        # 使用 monkeypatch 模拟 _to_static_url 的数据路径
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        img = data_dir / "frames" / "img1.jpg"
        img.parent.mkdir(parents=True)
        img.write_text("fake")

        frames = [
            {"sec": 750.0, "image_path": str(img)},
        ]

        monkeypatch.setattr(
            "shared.config.DATA_DIR",
            data_dir,
        )

        result = resolve_frame_placeholders(
            "## 开始\n![配图](*FRAME-[12:30])\n正文",
            frames,
        )
        assert "/static/" in result
        assert "*FRAME-" not in result

    def test_clears_placeholder_when_no_frames(self):
        """无 frames 时占位符被清除"""
        result = resolve_frame_placeholders(
            "## 章节\n![配图](*FRAME-[05:00])\n内容",
            [],
        )
        assert "*FRAME-" not in result

    def test_clears_placeholder_when_frame_not_found(self, monkeypatch, tmp_path):
        """时间戳不匹配任何帧 → 占位符被清除"""
        data_dir = tmp_path / "data"
        data_dir.mkdir()

        frames = [{"sec": 9999.0, "image_path": str(data_dir / "distant.jpg")}]

        result = resolve_frame_placeholders(
            "![配图](*FRAME-[00:10])",
            frames,
        )
        # 占位符应被清除（图片不存在或找不到匹配帧）
        assert "*FRAME-" not in result

    def test_no_content_returns_empty(self):
        assert resolve_frame_placeholders("", []) == ""
