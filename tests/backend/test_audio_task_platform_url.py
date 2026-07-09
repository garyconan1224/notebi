"""R10.0 — audio_task 平台 URL 走 yt-dlp 抽取 bestaudio 测试。

覆盖：
- B 站 URL → yt-dlp bestaudio（不调 urllib）
- 直链 mp3 → urllib（不调 yt-dlp）
- yt-dlp 失败 → 任务 FAILED
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.app.models.tasks import TaskRecord, TaskStatus
from shared.audio_analyzer import VadResult
from shared.video_download_ytdlp import is_platform_url


# ── helper ──────────────────────────────────────────────────────

def _make_record(source: str, source_type: str = "url") -> TaskRecord:
    return TaskRecord(
        task_id="audio-test-001",
        project_id="default_project",
        task_type="audio",
        payload={"source": source, "source_type": source_type},
    )


# ── is_platform_url 单元测试 ─────────────────────────────────────

def test_is_platform_url_bilibili() -> None:
    assert is_platform_url("https://www.bilibili.com/video/BV1xx") is True


def test_is_platform_url_youtube() -> None:
    assert is_platform_url("https://www.youtube.com/watch?v=abc123") is True


def test_is_platform_url_douyin() -> None:
    assert is_platform_url("https://www.douyin.com/video/7123456") is True


def test_is_platform_url_direct_mp3() -> None:
    assert is_platform_url("https://example.com/audio/foo.mp3") is False


def test_is_platform_url_empty() -> None:
    assert is_platform_url("") is False
    assert is_platform_url(None) is False  # type: ignore[arg-type]


# ── integration: B 站 URL → yt-dlp ─────────────────────────────

def test_audio_platform_url_uses_ytdlp(tmp_path: Path) -> None:
    """B 站 URL 提交 audio 任务 → yt-dlp 被调，urllib 不被调。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "workspace" / "audio" / "audio-test-001_bilibili.m4a"
    audio_file.parent.mkdir(parents=True, exist_ok=True)
    audio_file.write_bytes(b"fake-audio-data")

    runner = MagicMock()
    record = _make_record("https://www.bilibili.com/video/BV1xx1234")

    with (
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=False, total_speech_duration=0.0, total_duration=180.0)),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch("backend.app.services.pipeline_tasks.run_ytdlp_download",
              return_value={"ok": True, "save_path": str(audio_file)}) as mock_ytdlp,
        patch("urllib.request.urlopen") as mock_urlopen,
    ):
        result = handle_audio_task(record, runner)

    mock_ytdlp.assert_called_once()
    mock_urlopen.assert_not_called()
    assert result.get("awaiting_confirm") is True


def test_audio_platform_url_preserves_metadata_and_asr_status(tmp_path: Path) -> None:
    """平台音频任务完成后保留标题/封面，并用 ASR 状态驱动转写阶段 UI。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "workspace" / "audio" / "audio-test-001_bilibili.m4a"
    audio_file.parent.mkdir(parents=True, exist_ok=True)
    audio_file.write_bytes(b"fake-audio-data")

    runner = MagicMock()
    record = _make_record("https://www.bilibili.com/video/BV1xx1234")
    meta = {
        "title": "Codex 10个必装插件！实战演示",
        "duration": 26.8,
        "uploader": "vlm",
        "thumbnail_url": "https://example.com/cover.jpg",
    }
    mock_settings = MagicMock(
        openai_api_key="",
        openai_base_url="https://example.com/v1",
        transcriber=MagicMock(
            whisper_model_size="base",
            initial_prompt="",
        ),
    )

    with (
        patch("backend.app.services.pipeline_tasks.fetch_ytdlp_metadata", return_value=meta),
        patch("backend.app.services.pipeline_tasks.run_ytdlp_download",
              return_value={"ok": True, "save_path": str(audio_file), **meta}),
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=True, total_speech_duration=20.0, total_duration=26.8)),
        patch("backend.app.services.pipeline_tasks.load_settings", return_value=mock_settings),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch("backend.app.services.asr_router.run_local_asr_with_fallback",
              return_value=("hello world", [{"text": "hello world", "start": 0.0, "end": 1.0}], 26.8, "mlx-whisper")),
    ):
        result = handle_audio_task(record, runner)

    assert result["video_title"] == meta["title"]
    assert result["video_thumbnail_url"] == meta["thumbnail_url"]
    assert result["video_uploader"] == meta["uploader"]
    assert result["duration_sec"] == meta["duration"]
    assert result["audio"]["title"] == meta["title"]
    assert result["audio"]["duration_sec"] == meta["duration"]

    statuses = [
        call.kwargs["status"]
        for call in runner.store.update.call_args_list
        if "status" in call.kwargs
    ]
    assert TaskStatus.DOWNLOAD.value in statuses
    assert TaskStatus.PROBE.value in statuses
    assert TaskStatus.ASR.value in statuses
    assert TaskStatus.SUM.value in statuses
    assert TaskStatus.STORE.value in statuses
    assert TaskStatus.VLM.value not in statuses


# ── integration: 直链 mp3 → urllib ──────────────────────────────

def test_audio_direct_url_uses_urllib(tmp_path: Path) -> None:
    """直链 mp3 提交 audio 任务 → urllib 被调，yt-dlp 不被调。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    runner = MagicMock()
    record = _make_record("https://example.com/audio/foo.mp3")

    mock_resp = MagicMock()
    mock_resp.read.return_value = b"fake-mp3-data"
    mock_resp.headers = {"Content-Type": "audio/mpeg"}
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)

    with (
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=False, total_speech_duration=0.0, total_duration=180.0)),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch("backend.app.services.pipeline_tasks.run_ytdlp_download") as mock_ytdlp,
        patch("urllib.request.urlopen", return_value=mock_resp) as mock_urlopen,
    ):
        result = handle_audio_task(record, runner)

    mock_urlopen.assert_called_once()
    mock_ytdlp.assert_not_called()
    assert result.get("awaiting_confirm") is True


# ── integration: yt-dlp 失败 ────────────────────────────────────

def test_audio_platform_url_ytdlp_fails(tmp_path: Path) -> None:
    """yt-dlp 返回失败 → 抛出 RuntimeError（任务 FAILED）。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    runner = MagicMock()
    record = _make_record("https://www.bilibili.com/video/BV1xx1234")

    with (
        patch("backend.app.services.pipeline_tasks.run_vad") as mock_vad,
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch("backend.app.services.pipeline_tasks.run_ytdlp_download",
              return_value={"ok": False, "error": "412 Precondition Failed"}),
    ):
        with pytest.raises(RuntimeError, match="yt-dlp"):
            handle_audio_task(record, runner)

    mock_vad.assert_not_called()
