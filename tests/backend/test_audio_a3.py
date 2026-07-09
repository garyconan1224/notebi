"""A3 无人声切音乐模式 — 单元测试。

覆盖：
- VAD 无人声 → AWAITING_CONFIRM
- VAD 有人声 → 正常 ASR
- music_mode_confirmed → 跳过 ASR / 跑音乐分析
- confirm-music 端点（200 / 409）
- segment_audio 分段逻辑
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.app.models.tasks import TaskRecord, TaskStatus
from shared.audio_analyzer import MusicSegment, VadResult, segment_audio


# ── A3.1: VAD 无人声触发 AWAITING_CONFIRM ──────────────────────

def test_audio_no_speech_triggers_awaiting_confirm(tmp_path: Path) -> None:
    """VAD 返回 0% 语音且 music 未启用 → 状态 AWAITING_CONFIRM + 提前返回。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "music.mp3"
    audio_file.write_bytes(b"fake-music-data")

    runner = MagicMock()
    record = TaskRecord(
        task_id="audio-no-speech",
        project_id="default_project",
        task_type="audio",
        payload={"source": str(audio_file), "source_type": "local"},
    )

    with (
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=False, total_speech_duration=0.0, total_duration=180.0)),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
    ):
        result = handle_audio_task(record, runner)

    # 断言提前返回，状态已被设为 AWAITING_CONFIRM
    assert result.get("awaiting_confirm") is True
    assert result["speech_ratio"] == 0.0
    assert result["total_duration"] == 180.0
    # 验证 runner.store.update 被调用了（具体参数由 runner 内部决定）
    assert runner.store.update.called


def test_audio_no_speech_but_music_enabled_no_awaiting(tmp_path: Path) -> None:
    """VAD 无人声但用户已勾音乐分析 → 不弹窗，直接走音乐路径。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "music.mp3"
    audio_file.write_bytes(b"fake-music-data")

    runner = MagicMock()
    record = TaskRecord(
        task_id="audio-music-on",
        project_id="default_project",
        task_type="audio",
        payload={
            "source": str(audio_file),
            "source_type": "local",
            "music": {"enabled": True},
        },
    )

    with (
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=False, total_speech_duration=0.0, total_duration=180.0)),
        patch("backend.app.services.pipeline_tasks.analyze_music", return_value=None),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch("urllib.request.urlopen") as urlopen,
    ):
        result = handle_audio_task(record, runner)

    # 不应该进入 AWAITING_CONFIRM
    assert result.get("awaiting_confirm") is None
    assert result.get("music_mode") is False  # music_enabled but not music_mode_confirmed
    urlopen.assert_not_called()


def test_audio_with_speech_no_awaiting(tmp_path: Path) -> None:
    """VAD 有人声 → 正常走 ASR，不触发 AWAITING_CONFIRM。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "speech.mp3"
    audio_file.write_bytes(b"fake-speech-data")

    runner = MagicMock()
    record = TaskRecord(
        task_id="audio-speech",
        project_id="default_project",
        task_type="audio",
        payload={"source": str(audio_file), "source_type": "local"},
    )

    mock_settings = MagicMock(
        openai_api_key="",
        openai_base_url="https://example.com/v1",
        transcriber=MagicMock(whisper_model_size="base", device="cpu", language="", initial_prompt=""),
    )

    with (
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=True, total_speech_duration=150.0, total_duration=180.0)),
        patch("backend.app.services.pipeline_tasks.load_settings", return_value=mock_settings),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch("backend.app.services.asr_router.run_local_asr_with_fallback",
              return_value=("hello world", [{"text": "hello world", "start": 0.0, "end": 1.0}], 1.0, "remote")),
    ):
        result = handle_audio_task(record, runner)

    assert result.get("awaiting_confirm") is None


# ── A3.2: music_mode_confirmed 重跑 ─────────────────────────────

def test_music_confirmed_skips_asr_runs_music(tmp_path: Path) -> None:
    """music_mode_confirmed=True → 跳过 ASR，跑音乐分析，结果含 music_mode=True。"""
    from backend.app.services.pipeline_tasks import handle_audio_task

    audio_file = tmp_path / "music.mp3"
    audio_file.write_bytes(b"fake-music-data")

    runner = MagicMock()
    record = TaskRecord(
        task_id="audio-confirmed",
        project_id="default_project",
        task_type="audio",
        payload={
            "source": str(audio_file),
            "source_type": "local",
            "music_mode_confirmed": True,
        },
    )

    mock_music = MagicMock()
    mock_music.bpm = 120.0
    mock_music.key = "C major"
    mock_music.duration = 180.0
    mock_music.energy_mean = 0.05
    mock_music.spectral_centroid_mean = 1200.0
    mock_music.music_prompt = ""
    mock_music.similar_references = []
    mock_music.scenarios = []
    mock_music.to_dict.return_value = {"bpm": 120.0, "key": "C major", "music_mode": True}

    with (
        patch("backend.app.services.pipeline_tasks.run_vad",
              return_value=VadResult(has_speech=False, total_speech_duration=0.0, total_duration=180.0)),
        patch("backend.app.services.pipeline_tasks.analyze_music", return_value=mock_music),
        patch("backend.app.services.pipeline_tasks.load_settings",
              return_value=MagicMock(openai_api_key="", openai_base_url="")),
        patch("shared.config.get_workspace_root", return_value=tmp_path / "workspace"),
        patch("urllib.request.urlopen") as urlopen,
    ):
        result = handle_audio_task(record, runner)

    urlopen.assert_not_called()  # 没调 URL open = 没走 ASR
    assert result.get("music_mode") is True
    runner.append_log.assert_any_call(
        "audio-confirmed", "⏭️  跳过 ASR（无人声或未启用）"
    )


# ── confirm-music 端点 ──────────────────────────────────────────

def test_confirm_music_endpoint_200() -> None:
    """AWAITING_CONFIRM 任务调 confirm → payload 更新 + 状态重置 + 重提交。"""
    from backend.app.routes.pipeline import _store, _runner, confirm_music_mode

    store = _store
    runner = _runner

    # 造一个 AWAITING_CONFIRM 状态的任务
    rec = store.create(TaskRecord(
        task_id="audio-confirm-200",
        project_id="proj",
        task_type="audio",
        payload={"source": "/tmp/test.mp3", "source_type": "local"},
        status=TaskStatus.AWAITING_CONFIRM.value,
    ))

    with patch.object(runner, "resubmit_task") as mock_resubmit:
        result = confirm_music_mode(task_id="audio-confirm-200")

    assert result["payload"]["music"] == {"enabled": True}
    assert result["payload"]["asr"] == {"enabled": False}
    assert result["payload"]["music_mode_confirmed"] is True
    assert result["status"] == "PENDING"
    assert result["progress"] == 0.0
    mock_resubmit.assert_called_once_with("audio-confirm-200")


def test_confirm_music_endpoint_404() -> None:
    """不存在的 task → 404。"""
    from fastapi import HTTPException
    from backend.app.routes.pipeline import confirm_music_mode

    with pytest.raises(HTTPException) as exc:
        confirm_music_mode(task_id="nonexistent")
    assert exc.value.status_code == 404


def test_confirm_music_endpoint_409() -> None:
    """非 AWAITING_CONFIRM 状态 → 409。"""
    from fastapi import HTTPException
    from backend.app.routes.pipeline import _store, confirm_music_mode

    _store.create(TaskRecord(
        task_id="audio-confirm-409",
        project_id="proj",
        task_type="audio",
        payload={"source": "/tmp/test.mp3", "source_type": "local"},
        status=TaskStatus.SUCCESS.value,
    ))

    with pytest.raises(HTTPException) as exc:
        confirm_music_mode(task_id="audio-confirm-409")
    assert exc.value.status_code == 409


# ── A3.3: segment_audio 分段 ────────────────────────────────────

def test_segment_audio_short_file_returns_single_segment(tmp_path: Path) -> None:
    """短于 min_duration 的音频 → 返回单段。"""
    # segment_audio 依赖 librosa，没装则返回空 list
    try:
        import librosa  # noqa: F401
    except ImportError:
        pytest.skip("librosa not installed")

    import numpy as np
    import soundfile as sf

    sr = 22050
    duration = 20.0  # < min_duration=30
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    y = np.sin(2 * np.pi * 440 * t).astype(np.float32)

    audio_path = tmp_path / "short.wav"
    sf.write(str(audio_path), y, sr)

    boundaries = segment_audio(str(audio_path), min_duration=30.0, fallback_duration=90.0)
    assert len(boundaries) == 1
    assert boundaries[0] == (0.0, pytest.approx(duration, abs=0.5))


def test_segment_audio_long_uniform_fallback(tmp_path: Path) -> None:
    """长均匀音频 → 回退固定 90s 窗。"""
    try:
        import librosa  # noqa: F401
    except ImportError:
        pytest.skip("librosa not installed")

    import numpy as np
    import soundfile as sf

    sr = 22050
    duration = 200.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    y = (np.sin(2 * np.pi * 440 * t) * 0.5).astype(np.float32)

    audio_path = tmp_path / "uniform.wav"
    sf.write(str(audio_path), y, sr)

    boundaries = segment_audio(str(audio_path), min_duration=30.0, fallback_duration=90.0)
    # 200s / 90s → 至少 2 段
    assert len(boundaries) >= 2
    # 覆盖全时长
    assert boundaries[0][0] == 0.0
    assert boundaries[-1][1] == pytest.approx(duration, abs=1.0)


def test_segment_audio_no_librosa_returns_empty(tmp_path: Path) -> None:
    """librosa 未安装 → 返回空 list。"""
    audio_path = tmp_path / "fake.wav"
    audio_path.write_bytes(b"fake")

    with patch("shared.audio_analyzer.logger") as mock_logger:
        # 确保 import 失败
        with patch.dict("sys.modules", {"librosa": None}):
            # 需要重新导入以触发 import error
            pass

    # 因为 librosa 在函数内部 lazy import，这里模拟 ImportError
    with patch("builtins.__import__", side_effect=ImportError("no librosa")):
        boundaries = segment_audio(str(audio_path))
    assert boundaries == []


def test_music_segment_to_dict() -> None:
    """MusicSegment.to_dict() 返回正确结构。"""
    seg = MusicSegment(
        start=0.0, end=90.0,
        bpm=120.0, key="C major",
        energy_mean=0.05, spectral_centroid_mean=1200.0,
        genre="流行", mood="欢快",
        instruments=["钢琴", "吉他"],
        atmosphere="温暖治愈",
        music_prompt="pop piano, upbeat, 120bpm",
        similar_references=["Artist A", "Artist B"],
        scenarios=["Vlog 配乐", "广告背景"],
    )
    d = seg.to_dict()
    assert d["start"] == 0.0
    assert d["end"] == 90.0
    assert d["bpm"] == 120.0
    assert d["genre"] == "流行"
    assert d["instruments"] == ["钢琴", "吉他"]
    assert len(d["similar_references"]) == 2
