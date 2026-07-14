"""sherpa-onnx 说话人后端的窄接口测试。"""

from __future__ import annotations

import sys
import types
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from shared.sherpa_diarizer import SherpaModelPaths, run_sherpa_diarization


def test_run_sherpa_diarization_maps_result_and_progress(monkeypatch, tmp_path: Path) -> None:
    segmentation = tmp_path / "segmentation.onnx"
    embedding = tmp_path / "embedding.onnx"
    segmentation.touch()
    embedding.touch()
    model_paths = SherpaModelPaths(segmentation=segmentation, embedding=embedding)
    captured = {}

    class FakeConfig:
        def __init__(self, **kwargs):
            captured["config"] = kwargs

        def validate(self):
            return True

    class FakeResult(list):
        def sort_by_start_time(self):
            return self

    class FakeDiarizer:
        sample_rate = 16000

        def __init__(self, config):
            captured["diarizer_config"] = config

        def process(self, audio, callback=None):
            captured["audio"] = audio
            assert callback is not None
            callback(1, 4)
            callback(4, 4)
            return FakeResult([
                SimpleNamespace(start=0.25, end=1.5, speaker=0),
                SimpleNamespace(start=1.75, end=3.0, speaker=1),
            ])

    fake_sherpa = types.ModuleType("sherpa_onnx")
    fake_sherpa.OfflineSpeakerDiarizationConfig = FakeConfig
    fake_sherpa.OfflineSpeakerSegmentationModelConfig = lambda **kwargs: kwargs
    fake_sherpa.OfflineSpeakerSegmentationPyannoteModelConfig = lambda **kwargs: kwargs
    fake_sherpa.SpeakerEmbeddingExtractorConfig = lambda **kwargs: kwargs
    fake_sherpa.FastClusteringConfig = lambda **kwargs: kwargs
    fake_sherpa.OfflineSpeakerDiarization = FakeDiarizer
    monkeypatch.setitem(sys.modules, "sherpa_onnx", fake_sherpa)
    monkeypatch.setattr(
        "shared.sherpa_diarizer.ensure_sherpa_models",
        lambda progress_callback=None: model_paths,
    )
    monkeypatch.setattr(
        "shared.sherpa_diarizer._load_audio_mono",
        lambda audio_path, target_sample_rate: np.zeros(16000, dtype=np.float32),
    )
    progress = []

    result = run_sherpa_diarization(
        tmp_path / "interview.m4a",
        progress_callback=lambda ratio, message: progress.append((ratio, message)),
        num_speakers=2,
    )

    assert result.engine == "sherpa-onnx"
    assert result.num_speakers == 2
    assert [segment.speaker for segment in result.segments] == ["SPEAKER_00", "SPEAKER_01"]
    assert progress[-1][0] == 1.0
    assert captured["audio"].dtype == np.float32
    assert captured["config"]["clustering"]["num_clusters"] == 2
