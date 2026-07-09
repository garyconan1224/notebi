"""asr_fast_whisper 单测：无音轨检测 + 跳过转写。

全用 monkeypatch / mock，不真下模型、不真跑 ffprobe（除了 _has_audio_stream 的真实 subprocess 调用用 mock 替代）。
"""

from __future__ import annotations

import pytest

from backend.app.services.asr_fast_whisper import _has_audio_stream, transcribe_file_with_fast_whisper


# ── _has_audio_stream ──────────────────────────────────────────


class TestHasAudioStream:
    """_has_audio_stream 基于 ffprobe 的音轨检测。"""

    def test_returns_true_when_audio_stream_present(self, monkeypatch):
        """ffprobe 输出非空 → 有音轨 → True"""
        import subprocess

        fake_result = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="0\n", stderr=""
        )
        monkeypatch.setattr("subprocess.run", lambda *a, **kw: fake_result)
        assert _has_audio_stream("/fake/video.mp4") is True

    def test_returns_false_when_no_audio_stream(self, monkeypatch):
        """ffprobe 输出空 → 无音轨 → False"""
        import subprocess

        fake_result = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )
        monkeypatch.setattr("subprocess.run", lambda *a, **kw: fake_result)
        assert _has_audio_stream("/fake/video_no_audio.mp4") is False

    def test_returns_true_on_ffprobe_error(self, monkeypatch):
        """ffprobe 不可用时保守返回 True（不阻塞正常转写流程）"""
        def _raise(*a, **kw):
            raise FileNotFoundError("ffprobe not found")

        monkeypatch.setattr("subprocess.run", _raise)
        assert _has_audio_stream("/fake/video.mp4") is True


# ── transcribe_file_with_fast_whisper 无音轨早退 ───────────────


class TestTranscribeNoAudioEarlyReturn:
    """transcribe_file_with_fast_whisper 遇无音轨文件应返回空、不抛异常。"""

    def test_no_audio_returns_empty_string(self, monkeypatch, tmp_path):
        """return_segments=False 时返回空字符串"""
        fake_video = tmp_path / "no_audio.mp4"
        fake_video.write_bytes(b"\x00" * 100)

        monkeypatch.setattr(
            "backend.app.services.asr_fast_whisper._has_audio_stream",
            lambda p: False,
        )
        result = transcribe_file_with_fast_whisper(str(fake_video))
        assert result == ""

    def test_no_audio_returns_empty_tuple(self, monkeypatch, tmp_path):
        """return_segments=True 时返回 ("", [], 0.0)"""
        fake_video = tmp_path / "no_audio.mp4"
        fake_video.write_bytes(b"\x00" * 100)

        monkeypatch.setattr(
            "backend.app.services.asr_fast_whisper._has_audio_stream",
            lambda p: False,
        )
        result = transcribe_file_with_fast_whisper(str(fake_video), return_segments=True)
        assert result == ("", [], 0.0)

    def test_no_audio_does_not_load_model(self, monkeypatch, tmp_path):
        """无音轨时不应加载 Whisper 模型（避免无意义的 HF 下载 / 初始化）"""
        fake_video = tmp_path / "no_audio.mp4"
        fake_video.write_bytes(b"\x00" * 100)

        monkeypatch.setattr(
            "backend.app.services.asr_fast_whisper._has_audio_stream",
            lambda p: False,
        )

        _load_called = False

        def _fake_load(*a, **kw):
            nonlocal _load_called
            _load_called = True
            raise AssertionError("不应在无音轨时加载模型")

        monkeypatch.setattr(
            "backend.app.services.asr_fast_whisper._load_model", _fake_load
        )

        transcribe_file_with_fast_whisper(str(fake_video))
        assert _load_called is False

    def test_no_audio_emits_log(self, monkeypatch, tmp_path):
        """无音轨时应通过 log_callback 输出跳过信息"""
        fake_video = tmp_path / "no_audio.mp4"
        fake_video.write_bytes(b"\x00" * 100)

        monkeypatch.setattr(
            "backend.app.services.asr_fast_whisper._has_audio_stream",
            lambda p: False,
        )

        logs: list[str] = []
        transcribe_file_with_fast_whisper(str(fake_video), log_callback=logs.append)
        assert any("无音轨" in msg for msg in logs)
