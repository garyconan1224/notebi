"""真实音频波形峰值计算测试。"""

from __future__ import annotations

import io
import struct
from pathlib import Path

from backend.app.services import pipeline_tasks


class _FakeProcess:
    def __init__(self, samples: list[int]) -> None:
        self.stdout = io.BytesIO(b"".join(struct.pack("<h", sample) for sample in samples))
        self.stderr = io.BytesIO()

    def wait(self, timeout: int = 0) -> int:
        return 0

    def kill(self) -> None:
        return None


def test_extract_waveform_peaks_aggregates_real_pcm(
    tmp_path: Path, monkeypatch,
) -> None:
    audio_path = tmp_path / "sample.mp3"
    audio_path.write_bytes(b"fixture")

    monkeypatch.setattr(
        pipeline_tasks.subprocess,
        "Popen",
        lambda *args, **kwargs: _FakeProcess([1000, 1000, 5000, 5000]),
    )

    peaks = pipeline_tasks._extract_waveform_peaks(
        audio_path,
        duration_sec=1,
        bars=2,
        sample_rate=4,
    )

    assert peaks == [0.2, 1.0]
