"""mlx-whisper download progress regression tests."""

from __future__ import annotations

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


def test_long_audio_reports_real_chunk_progress(
    tmp_path: Path, monkeypatch,
) -> None:
    audio_path = tmp_path / "long.m4a"
    audio_path.write_bytes(b"fixture")
    chunk_seconds = asr_mlx_whisper.MLX_TRANSCRIBE_CHUNK_SECONDS
    sample_rate = 16_000
    waveform = np.zeros(sample_rate * (chunk_seconds * 2 + 30), dtype=np.float32)
    calls: list[int] = []
    progress: list[tuple[float, str]] = []

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
