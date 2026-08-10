"""mlx-whisper download progress regression tests."""

from __future__ import annotations

import sys
import types
from pathlib import Path

import numpy as np
from tqdm.contrib.concurrent import thread_map

from backend.app.services import asr_mlx_whisper
from backend.app.services.asr_mlx_whisper import (
    _DownloadProgressAggregator,
    _FileProgress,
    transcribe_file_with_mlx_whisper,
)


def test_file_progress_is_compatible_with_snapshot_download_thread_map() -> None:
    """snapshot_download passes tqdm_class to thread_map, not per-file downloads."""
    progress: list[tuple[float, str]] = []
    logs: list[str] = []

    _DownloadProgressAggregator.reset(
        lambda ratio, msg: progress.append((ratio, msg)),
        logs.append,
    )

    result = thread_map(
        lambda value: value * 2,
        [1, 2, 3],
        desc="Fetching 3 files",
        max_workers=1,
        tqdm_class=_FileProgress,
    )

    assert result == [2, 4, 6]
    assert logs == ["📥 开始下载模型文件..."]
    assert progress[-1] == (1.0, "📥 下载模型 | 3/3 files")


def _install_fake_mlx_whisper(monkeypatch) -> None:
    """把最小假 mlx_whisper / mlx_whisper.audio 注入 sys.modules。

    生产代码在函数体内 import 这两个模块；本测试的目标是未安装 mlx-whisper
    的 Linux CI 上也能执行真实的三分块进度断言，而不是 skip，因此这里
    显式伪造模块导入。
    """
    fake_audio = types.ModuleType("mlx_whisper.audio")
    fake_audio.load_audio = lambda *_args, **_kwargs: np.zeros(
        asr_mlx_whisper.MLX_WHISPER_SAMPLE_RATE
        * (asr_mlx_whisper.MLX_TRANSCRIBE_CHUNK_SECONDS * 2 + 30),
        dtype=np.float32,
    )
    fake_whisper = types.ModuleType("mlx_whisper")
    fake_whisper.__path__ = []
    fake_whisper.audio = fake_audio
    fake_whisper.transcribe = lambda *_args, **_kwargs: {
        "text": "chunk",
        "segments": [],
        "language": "zh",
    }
    monkeypatch.setitem(sys.modules, "mlx_whisper", fake_whisper)
    monkeypatch.setitem(sys.modules, "mlx_whisper.audio", fake_audio)


def test_long_audio_reports_real_chunk_progress(
    tmp_path: Path, monkeypatch,
) -> None:
    audio_path = tmp_path / "long.m4a"
    audio_path.write_bytes(b"fixture")
    chunk_seconds = asr_mlx_whisper.MLX_TRANSCRIBE_CHUNK_SECONDS
    sample_rate = asr_mlx_whisper.MLX_WHISPER_SAMPLE_RATE
    waveform = np.zeros(sample_rate * (chunk_seconds * 2 + 30), dtype=np.float32)
    calls: list[int] = []
    progress: list[tuple[float, str]] = []

    _install_fake_mlx_whisper(monkeypatch)
    monkeypatch.setattr(asr_mlx_whisper, "_ensure_model_downloaded", lambda *args, **kwargs: None)
    monkeypatch.setattr("mlx_whisper.audio.load_audio", lambda *_args, **_kwargs: waveform)

    def fake_transcribe(audio, **_kwargs):
        calls.append(len(audio))
        duration = len(audio) / sample_rate
        return {
            "text": f"chunk-{len(calls)}",
            "segments": [{"start": 0.0, "end": duration, "text": f"第{len(calls)}段"}],
            "language": "zh",
        }

    monkeypatch.setattr("mlx_whisper.transcribe", fake_transcribe)

    text, segments, duration = transcribe_file_with_mlx_whisper(
        audio_path,
        model_name="medium",
        progress_callback=lambda ratio, message: progress.append((ratio, message)),
        return_segments=True,
    )

    assert len(calls) == 3
    assert text == "第1段\n第2段\n第3段"
    assert segments[1]["start"] == chunk_seconds
    assert duration == chunk_seconds * 2 + 30
    assert any(0 < ratio < 1 for ratio, _ in progress)
    assert any("2/3" in message for _, message in progress)
    assert [ratio for ratio, _ in progress] == sorted(ratio for ratio, _ in progress)
