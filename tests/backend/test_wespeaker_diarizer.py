"""WeSpeaker adapter contract tests without downloading the model."""

from __future__ import annotations

import sys
import types
from pathlib import Path

import numpy as np

from shared.wespeaker_diarizer import (
    SpeakerSegment,
    _merge_labeled_windows,
    _merge_small_clusters,
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

def test_merge_adjacent_same_speaker_within_gap() -> None:
    windows = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0)]
    merged = _merge_labeled_windows(windows, [0, 0, 0])
    assert [(s.start, s.end) for s in merged] == [(0.0, 3.0)]


def test_short_alternating_turn_is_preserved() -> None:
    windows = [(0.0, 3.0), (3.0, 4.0), (4.0, 5.0)]
    merged = _merge_labeled_windows(windows, [0, 1, 0])
    assert [(s.start, s.end, s.speaker) for s in merged] == [
        (0.0, 3.0, "SPEAKER_00"),
        (3.0, 4.0, "SPEAKER_01"),
        (4.0, 5.0, "SPEAKER_00"),
    ]


def test_short_boundary_turn_is_preserved() -> None:
    windows = [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0)]
    merged = _merge_labeled_windows(windows, [0, 1, 0])
    assert [(s.start, s.end, s.speaker) for s in merged] == [
        (0.0, 1.0, "SPEAKER_00"),
        (1.0, 2.0, "SPEAKER_01"),
        (2.0, 3.0, "SPEAKER_00"),
    ]


def test_merge_small_clusters_absorbs_fragmented_cluster() -> None:
    """碎簇(总占比 < 8%)应并入时间最近邻簇,保留真实说话人轮次。"""
    # 3 个说话人,其中 cluster 2 只有 1 个短窗口(占 ~5%),应并入邻簇
    windows = [
        (0.0, 10.0), (10.0, 20.0), (20.0, 30.0),  # cluster 0: 30s
        (30.0, 40.0), (40.0, 50.0), (50.0, 60.0),  # cluster 1: 30s
        (60.0, 62.0),  # cluster 2: 2s (占比 2/62 ≈ 3.2% < 8%)
    ]
    labels = [0, 0, 0, 1, 1, 1, 2]
    merged = _merge_small_clusters(windows, labels, min_ratio=0.08)
    # 碎簇 2 被并入,最终只剩 2 个簇
    assert len(set(merged.tolist())) == 2
    # 碎簇窗口并入的是时间最近的 cluster 1
    assert merged[-1] == 1


def test_merge_small_clusters_keeps_balanced_clusters() -> None:
    """各簇占比都 ≥ 阈值时,不合并(保持原标签)。"""
    windows = [
        (0.0, 10.0), (10.0, 20.0), (20.0, 30.0),  # cluster 0: 30s
        (30.0, 40.0), (40.0, 50.0), (50.0, 60.0),  # cluster 1: 30s
        (60.0, 70.0), (70.0, 80.0), (80.0, 90.0),  # cluster 2: 30s
    ]
    labels = [0, 0, 0, 1, 1, 1, 2, 2, 2]
    merged = _merge_small_clusters(windows, labels, min_ratio=0.08)
    assert len(set(merged.tolist())) == 3


def test_merge_small_clusters_skips_when_few_windows() -> None:
    """窗口数不足时不合并。"""
    windows = [(0.0, 5.0)]
    labels = [0]
    merged = _merge_small_clusters(windows, labels, min_ratio=0.08)
    assert merged.tolist() == [0]

