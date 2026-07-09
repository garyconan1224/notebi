"""run_ytdlp_download 格式降级重试 单元测试。

覆盖：
- 首选格式成功（无需降级）
- 首选格式失败 → 第一个 fallback 成功
- 所有格式都失败 → 错误信息保留完整链路
"""
from __future__ import annotations

import builtins
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ── 模块级夹具：记录原始 __import__ ────────────────────────────────
_orig_import = builtins.__import__


# ── Mock 辅助 ──────────────────────────────────────────────────────────

def _make_ydl_mock(download_fn=None):
    """创建一个 fake yt_dlp 模块 mock，YoutubeDL 的行为由 download_fn 控制。"""
    fake_module = MagicMock(name="yt_dlp")

    def _ydl_factory(opts):
        """根据 opts 创建 YoutubeDL 实例。"""
        mock = MagicMock(name="YoutubeDL")
        mock.__enter__ = MagicMock(return_value=mock)
        mock.__exit__ = MagicMock(return_value=False)
        if download_fn:
            mock.download = MagicMock(side_effect=download_fn(opts))
        else:
            mock.download = MagicMock(return_value=None)
        return mock

    fake_module.YoutubeDL = MagicMock(side_effect=_ydl_factory)
    return fake_module


def _raise_on_format(fail_formats: set[str], msg: str = "requested format is not available"):
    """返回 download_fn，对 fail_formats 中的格式抛异常，其他成功。"""
    def _fn(opts):
        fmt = opts.get("format", "")
        if fmt in fail_formats:
            raise Exception(msg)
        return None
    return _fn


def _raise_all_with_msgs(format_msgs: dict[str, str]):
    """返回 download_fn，每种格式抛各自的错误信息。"""
    def _fn(opts):
        fmt = opts.get("format", "")
        msg = format_msgs.get(fmt, "unknown error")
        raise Exception(msg)
    return _fn


# ── 测试：格式降级链 ──────────────────────────────────────────────────

class TestFormatFallback:
    """格式降级重试行为测试。"""

    def test_primary_format_succeeds_no_fallback(self, tmp_path):
        """首选格式成功时不会触发降级。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        fake_ytdlp = _make_ydl_mock(download_fn=_raise_on_format(set()))

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            result = run_ytdlp_download(
                url="https://example.com/video.mp4",
                output_dir=output_dir,
                format_selector="best",
            )

        assert result["ok"] is True
        assert result["error"] == ""

    def test_primary_format_fails_fallback_succeeds(self, tmp_path):
        """首选格式 'best' 不可用时，降级到 'bv*+ba/b' 成功。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        logs: list[str] = []
        fake_ytdlp = _make_ydl_mock(download_fn=_raise_on_format({"best"}))

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            result = run_ytdlp_download(
                url="https://example.com/video.mp4",
                output_dir=output_dir,
                format_selector="best",
                log=logs.append,
            )

        assert result["ok"] is True
        assert result["error"] == ""
        fallback_logs = [m for m in logs if "格式降级" in m]
        assert len(fallback_logs) >= 1, f"未找到降级日志，日志: {logs}"

    def test_primary_format_fails_second_fallback_succeeds(self, tmp_path):
        """前两个格式都不可用，第三个格式成功。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        logs: list[str] = []
        fake_ytdlp = _make_ydl_mock(download_fn=_raise_on_format({"best", "bv*+ba/b"}))

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            result = run_ytdlp_download(
                url="https://example.com/video.mp4",
                output_dir=output_dir,
                format_selector="best",
                log=logs.append,
            )

        assert result["ok"] is True
        fallback_logs = [m for m in logs if "格式降级" in m]
        assert len(fallback_logs) >= 2, f"应有 2 次降级日志，日志: {logs}"

    def test_all_formats_fail_preserves_errors(self, tmp_path):
        """所有格式都失败时，error_full 包含每个格式的错误信息。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        logs: list[str] = []
        fake_ytdlp = _make_ydl_mock(download_fn=_raise_all_with_msgs({
            "best": "requested format is not available",
            "bv*+ba/b": "HTTP Error 403: Forbidden",
            "bestvideo+bestaudio/best": "Unable to download webpage",
            "worst": "connection reset by peer",
        }))

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            result = run_ytdlp_download(
                url="https://example.com/video.mp4",
                output_dir=output_dir,
                format_selector="best",
                log=logs.append,
            )

        assert result["ok"] is False
        error_full = result["error_full"]
        assert "best:" in error_full
        assert "bv*+ba/b:" in error_full
        assert "requested format is not available" in error_full
        assert "403" in error_full
        fallback_logs = [m for m in logs if "格式降级" in m]
        assert len(fallback_logs) == 3

    def test_fallback_chain_does_not_duplicate_primary(self, tmp_path):
        """当首选格式就是 fallback 链中的值时，fallback 不重复该格式。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        logs: list[str] = []

        # 首选格式是 chain 的第一个 fallback "bv*+ba/b"
        # 正确链：["bv*+ba/b", "bestvideo+bestaudio/best", "worst"]（3 个）
        # 错误链：["bv*+ba/b", "bv*+ba/b", "bestvideo+bestaudio/best", "worst"]（4 个）
        fail_formats = {"bv*+ba/b", "bestvideo+bestaudio/best"}
        fake_ytdlp = _make_ydl_mock(download_fn=_raise_on_format(fail_formats))

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            result = run_ytdlp_download(
                url="https://example.com/video.mp4",
                output_dir=output_dir,
                format_selector="bv*+ba/b",
                log=logs.append,
            )

        assert result["ok"] is True  # "worst" 成功
        fallback_logs = [m for m in logs if "格式降级" in m]
        # 恰好 2 次降级：bv*+ba/b → bestvideo+bestaudio/best → worst
        # 如果 bv*+ba/b 重复，会有 3 次降级日志
        assert len(fallback_logs) == 2, f"应有 2 次降级，实际 {len(fallback_logs)}，日志: {logs}"

    def test_non_retryable_error_triggers_format_fallback(self, tmp_path):
        """非可重试错误（如 500 Internal Server Error）也应触发格式降级。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        logs: list[str] = []

        def _fn(opts):
            fmt = opts.get("format", "")
            if fmt == "best":
                raise Exception("HTTP Error 500: Internal Server Error")
            return None

        fake_ytdlp = _make_ydl_mock(download_fn=_fn)

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            result = run_ytdlp_download(
                url="https://example.com/video.mp4",
                output_dir=output_dir,
                format_selector="best",
                log=logs.append,
            )

        # HTTP 500 不是可重试错误，会 break 退出当前格式 → 触发格式降级
        assert result["ok"] is True
        fallback_logs = [m for m in logs if "格式降级" in m]
        assert len(fallback_logs) >= 1


# ── 抖音 no-cookie fallback 集成测试 ─────────────────────────────

class TestDouyinFallback:
    """抖音 URL 时优先走 douyin_mobile_share，失败再回落 yt-dlp。"""

    def test_douyin_url_triggers_fallback_and_succeeds(self, tmp_path):
        """抖音 URL 时 mobile share 成功，yt-dlp 不被调用。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        logs: list[str] = []
        fake_ytdlp = _make_ydl_mock()
        fake_dy_result = {
            "ok": True,
            "save_path": os.path.join(output_dir, "test.mp4"),
            "file_name": "test.mp4",
            "error": "",
            "error_full": "",
            "percent": 100.0,
        }

        # 创建一个空的 mp4 文件让 save_path 校验通过
        Path(fake_dy_result["save_path"]).write_bytes(b"fake_mp4_data")

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            with patch(
                "shared.douyin_mobile_share.run_douyin_mobile_download",
                return_value=fake_dy_result,
            ):
                result = run_ytdlp_download(
                    url="https://v.douyin.com/iJvcK8CLC_o/",
                    output_dir=output_dir,
                    log=logs.append,
                )

        assert result["ok"] is True
        assert "检测到抖音链接" in " ".join(logs)
        # yt-dlp 的 YoutubeDL 没有被调用
        fake_ytdlp.YoutubeDL.assert_not_called()

    def test_douyin_fallback_fails_then_ytdlp(self, tmp_path):
        """抖音 mobile share 失败时，继续走 yt-dlp。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        logs: list[str] = []
        fake_ytdlp = _make_ydl_mock()
        fake_dy_result = {
            "ok": False,
            "save_path": "",
            "file_name": "",
            "error": "解析失败",
            "error_full": "解析失败",
            "percent": 0.0,
        }

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            with patch(
                "shared.douyin_mobile_share.run_douyin_mobile_download",
                return_value=fake_dy_result,
            ):
                result = run_ytdlp_download(
                    url="https://v.douyin.com/iJvcK8CLC_o/",
                    output_dir=output_dir,
                    log=logs.append,
                )

        assert result["ok"] is True
        assert any("回落" in m or "yt-dlp" in m.lower() for m in logs)
        fake_ytdlp.YoutubeDL.assert_called()

    def test_bilibili_url_not_affected(self, tmp_path):
        """B站 URL 不触发抖音路径。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        logs: list[str] = []
        fake_ytdlp = _make_ydl_mock()

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            result = run_ytdlp_download(
                url="https://www.bilibili.com/video/BV1xx",
                output_dir=output_dir,
                log=logs.append,
            )

        assert result["ok"] is True
        assert not any("抖音" in m for m in logs)
        fake_ytdlp.YoutubeDL.assert_called()

    def test_youtube_url_not_affected(self, tmp_path):
        """YouTube URL 不触发抖音路径。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        logs: list[str] = []
        fake_ytdlp = _make_ydl_mock()

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            result = run_ytdlp_download(
                url="https://www.youtube.com/watch?v=abc123",
                output_dir=output_dir,
                log=logs.append,
            )

        assert result["ok"] is True
        assert not any("抖音" in m for m in logs)

    def test_douyin_fallback_receives_progress_callback(self, tmp_path):
        """run_ytdlp_download 把 progress_callback 透传给 Douyin helper。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        logs: list[str] = []
        fake_ytdlp = _make_ydl_mock()
        fake_dy_result = {
            "ok": True,
            "save_path": os.path.join(output_dir, "test.mp4"),
            "file_name": "test.mp4",
            "error": "",
            "error_full": "",
            "percent": 100.0,
        }
        Path(fake_dy_result["save_path"]).write_bytes(b"fake_mp4_data")

        captured_callbacks: dict[str, list] = {"progress": [], "speed": []}

        def _fake_douyin_download(*, url_or_text, output_dir, log, progress_callback, speed_callback, **kw):
            if progress_callback:
                progress_callback(0.5, "50%")
                captured_callbacks["progress"].append(True)
            if speed_callback:
                speed_callback("2.5MiB/s")
                captured_callbacks["speed"].append(True)
            return fake_dy_result

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            with patch(
                "shared.douyin_mobile_share.run_douyin_mobile_download",
                side_effect=_fake_douyin_download,
            ):
                result = run_ytdlp_download(
                    url="https://v.douyin.com/iJvcK8CLC_o/",
                    output_dir=output_dir,
                    log=logs.append,
                    progress_callback=lambda r, s: captured_callbacks["progress"].append((r, s)),
                    speed_callback=lambda s: captured_callbacks["speed"].append(s),
                )

        assert result["ok"] is True
        assert len(captured_callbacks["progress"]) >= 1
        assert len(captured_callbacks["speed"]) >= 1

    def test_douyin_fallback_import_error_graceful(self, tmp_path):
        """douyin_mobile_share 模块导入失败时静默回落 yt-dlp。"""
        from shared.video_download_ytdlp import run_ytdlp_download

        output_dir = str(tmp_path)
        logs: list[str] = []
        fake_ytdlp = _make_ydl_mock()

        # 让 lazy import 的 from shared.douyin_mobile_share import ... 失败
        sys.modules.pop("shared.douyin_mobile_share", None)

        def _block_import(name, *a, **kw):
            if name == "shared.douyin_mobile_share":
                raise ImportError("test: no such module")
            return _orig_import(name, *a, **kw)

        with patch.dict(sys.modules, {"yt_dlp": fake_ytdlp}):
            with patch("builtins.__import__", side_effect=_block_import):
                result = run_ytdlp_download(
                    url="https://v.douyin.com/iJvcK8CLC_o/",
                    output_dir=output_dir,
                    log=logs.append,
                )

        assert result["ok"] is True
        assert any("无法导入" in m or "douyin_mobile_share" in m for m in logs)
        fake_ytdlp.YoutubeDL.assert_called()
