"""WeSpeaker adapter contract tests without downloading the model."""

from __future__ import annotations

import sys
import types
from pathlib import Path

import numpy as np

from shared.wespeaker_diarizer import (
    SpeakerSegment,
    _absorb_short_segments,
    _merge_labeled_windows,
    run_wespeaker_diarization,
)


def test_wespeaker_maps_embeddings_to_timeline(monkeypatch, tmp_path: Path) -> None:
    audio_path = tmp_path / "interview.m4a"
    audio_path.write_bytes(b"placeholder")
    captured = {}

    class FakeSpeaker:
        def __init__(self, **kwargs):
            captured["model"] = kwargs

        def extract_embedding(self, path: str):
            captured.setdefault("paths", []).append(path)
            return np.ones((1, 4), dtype=np.float32)

    fake_module = types.ModuleType("wespeakerruntime")
    fake_module.Speaker = FakeSpeaker
    monkeypatch.setitem(sys.modules, "wespeakerruntime", fake_module)
    monkeypatch.setattr(
        "shared.wespeaker_diarizer._load_audio",
        lambda path: np.zeros(16_000 * 3, dtype=np.float32),
    )
    monkeypatch.setattr(
        "shared.wespeaker_diarizer._speech_ranges",
        lambda audio: [(0.0, 1.8), (1.8, 3.0)],
    )
    monkeypatch.setattr(
        "shared.wespeaker_diarizer._cluster",
        lambda embeddings, num_speakers: np.array([0, 0, 1, 1], dtype=int),
    )
    progress = []

    result = run_wespeaker_diarization(
        audio_path,
        progress_callback=lambda ratio, message: progress.append((ratio, message)),
        num_speakers=2,
    )

    assert result.engine == "wespeaker"
    assert result.num_speakers == 2
    assert [segment.speaker for segment in result.segments] == ["SPEAKER_00", "SPEAKER_01"]
    assert captured["model"]["lang"] == "chs"
    assert progress[-1][0] == 1.0


def test_wespeaker_requires_audio_file(tmp_path: Path) -> None:
    import pytest

    with pytest.raises(RuntimeError) as exc:
        run_wespeaker_diarization(tmp_path / "missing.m4a")
    assert getattr(exc.value, "code", "") == "audio_missing"


def _seg(start: float, end: float, speaker: str) -> SpeakerSegment:
    return SpeakerSegment(start, end, speaker)


def test_merge_adjacent_same_speaker_within_gap() -> None:
    windows = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0)]
    merged = _merge_labeled_windows(windows, [0, 0, 0])
    assert [(s.start, s.end) for s in merged] == [(0.0, 3.0)]


def test_absorb_short_segment_into_nearest_neighbor() -> None:
    segments = [
        _seg(0.0, 3.0, "SPEAKER_00"),
        _seg(3.0, 4.0, "SPEAKER_01"),
        _seg(4.0, 5.0, "SPEAKER_00"),
    ]
    _absorb_short_segments(segments)
    assert [(s.start, s.end, s.speaker) for s in segments] == [
        (0.0, 5.0, "SPEAKER_00"),
    ]


def test_absorb_keeps_boundary_segments() -> None:
    segments = [
        _seg(0.0, 1.0, "SPEAKER_00"),
        _seg(1.0, 3.5, "SPEAKER_01"),
        _seg(3.5, 4.0, "SPEAKER_00"),
    ]
    _absorb_short_segments(segments)
    assert [(s.start, s.end, s.speaker) for s in segments] == [
        (0.0, 1.0, "SPEAKER_00"),
        (1.0, 3.5, "SPEAKER_01"),
        (3.5, 4.0, "SPEAKER_00"),
    ]
