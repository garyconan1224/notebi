"""Phase N8 — shared/audio_analyzer.py 单元测试。

主要覆盖不需要跑真模型的部分：
- export_srt / export_txt 纯字符串生成
- assign_speakers_to_segments 时间重叠映射
- _parse_music_prompt_json 容错解析
- run_diarization 使用 pyannote 4 API，并对不可用状态抛出结构化错误
- VAD 用合成静音 wav 验证（silero-vad 已装时跑真模型）
"""

from __future__ import annotations

import os
import sys
import types
import wave
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from shared.audio_analyzer import (
    DiarizationError,
    DiarizationResult,
    SpeakerSegment,
    VadSegment,
    _parse_music_prompt_json,
    assign_speakers_to_segments,
    export_srt,
    export_txt,
    run_diarization,
    run_vad,
)


# ── 字幕导出 ──────────────────────────────────────────────────


def test_export_srt_basic():
    segments = [
        {"start": 0.0, "end": 2.5, "text": "Hello world."},
        {"start": 2.5, "end": 5.0, "text": "测试一下。"},
    ]
    srt = export_srt(segments)
    assert "1\n00:00:00,000 --> 00:00:02,500\nHello world." in srt
    assert "2\n00:00:02,500 --> 00:00:05,000\n测试一下。" in srt


def test_export_srt_with_speaker_field():
    segments = [
        {"start": 0.0, "end": 2.0, "text": "你好", "speaker": "SPEAKER_00"},
        {"start": 2.0, "end": 4.0, "text": "hi", "speaker": "SPEAKER_01"},
    ]
    srt = export_srt(segments)
    assert "[SPEAKER_00] 你好" in srt
    assert "[SPEAKER_01] hi" in srt


def test_export_srt_skips_empty_text():
    segments = [
        {"start": 0.0, "end": 1.0, "text": ""},
        {"start": 1.0, "end": 2.0, "text": "real"},
    ]
    srt = export_srt(segments)
    assert "real" in srt
    # 编号沿用源 segments 索引（空段被 continue 跳过但编号不重排）
    assert "2\n00:00:01,000 --> 00:00:02,000\nreal" in srt


def test_export_txt_with_and_without_speaker():
    segments = [
        {"text": "first", "speaker": "S0"},
        {"text": "second"},
    ]
    plain = export_txt(segments, with_speaker=False)
    assert plain == "first\nsecond"
    tagged = export_txt(segments, with_speaker=True)
    assert tagged.startswith("[S0] first")


# ── speaker 映射 ──────────────────────────────────────────────


def test_assign_speakers_max_overlap():
    transcript = [
        {"start": 0.0, "end": 5.0, "text": "段 1"},
        {"start": 5.0, "end": 10.0, "text": "段 2"},
    ]
    diar = DiarizationResult(
        num_speakers=2,
        segments=[
            SpeakerSegment(start=0.0, end=4.5, speaker="A"),
            SpeakerSegment(start=4.5, end=10.0, speaker="B"),
        ],
    )
    out = assign_speakers_to_segments(transcript, diar)
    assert out[0]["speaker"] == "A"  # 0-5 vs A(0-4.5)=4.5s overlap vs B(4.5-5)=0.5s → A
    assert out[1]["speaker"] == "B"


def test_assign_speakers_unknown_segments_passthrough():
    """没有重叠的 transcript segment 不应崩溃，也不强加 speaker。"""
    transcript = [{"start": 100.0, "end": 110.0, "text": "孤立段"}]
    diar = DiarizationResult(
        num_speakers=1,
        segments=[SpeakerSegment(start=0.0, end=5.0, speaker="A")],
    )
    out = assign_speakers_to_segments(transcript, diar)
    assert "speaker" not in out[0]


# ── 音乐提示词 JSON 解析 ──────────────────────────────────────


def test_parse_music_prompt_json_extracts_block():
    raw = """
Here is the result:
{"music_prompt": "indie folk, 92 bpm", "similar_references": ["Bon Iver"], "scenarios": ["vlog"]}
done.
"""
    parsed = _parse_music_prompt_json(raw)
    assert parsed is not None
    assert parsed["music_prompt"] == "indie folk, 92 bpm"
    assert parsed["similar_references"] == ["Bon Iver"]


def test_parse_music_prompt_json_returns_none_on_garbage():
    assert _parse_music_prompt_json("no json here") is None
    assert _parse_music_prompt_json("") is None


# ── diarization engine contract ───────────────────────────────


def test_run_diarization_raises_structured_error_without_token(monkeypatch, tmp_path):
    monkeypatch.setenv("NOTEBI_DIARIZATION_ENGINE", "pyannote")
    for key in ("HF_TOKEN", "HUGGINGFACE_TOKEN", "HUGGING_FACE_HUB_TOKEN"):
        monkeypatch.delenv(key, raising=False)
    with pytest.raises(RuntimeError) as exc:
        run_diarization(tmp_path / "nope.wav")
    assert getattr(exc.value, "code", "") == "missing_token"
    assert getattr(exc.value, "engine", "") == "pyannote"


def test_run_diarization_uses_sherpa_by_default(monkeypatch, tmp_path):
    captured = {}

    def fake_sherpa(audio_path, *, progress_callback=None, num_speakers=None):
        captured["audio_path"] = audio_path
        captured["progress_callback"] = progress_callback
        captured["num_speakers"] = num_speakers
        return DiarizationResult(
            num_speakers=1,
            segments=[SpeakerSegment(start=0.0, end=1.0, speaker="SPEAKER_00")],
            engine="sherpa-onnx",
            model="pyannote-segmentation-3.0+3D-Speaker",
        )

    monkeypatch.delenv("NOTEBI_DIARIZATION_ENGINE", raising=False)
    monkeypatch.setattr("shared.audio_analyzer.run_sherpa_diarization", fake_sherpa)
    progress = lambda ratio, message: None
    audio_path = tmp_path / "interview.m4a"

    result = run_diarization(audio_path, progress_callback=progress, num_speakers=2)

    assert result.engine == "sherpa-onnx"
    assert captured == {
        "audio_path": audio_path,
        "progress_callback": progress,
        "num_speakers": 2,
    }


def test_run_diarization_auto_prefers_wespeaker(monkeypatch, tmp_path):
    captured = {}

    def fake_wespeaker(audio_path, *, progress_callback=None, num_speakers=None):
        captured.update(audio_path=audio_path, num_speakers=num_speakers)
        return DiarizationResult(
            num_speakers=2,
            segments=[SpeakerSegment(start=0.0, end=1.0, speaker="SPEAKER_00")],
            engine="wespeaker",
            model="test-model",
        )

    monkeypatch.setenv("NOTEBI_DIARIZATION_ENGINE", "auto")
    monkeypatch.setattr("shared.wespeaker_diarizer.run_wespeaker_diarization", fake_wespeaker)
    result = run_diarization(tmp_path / "interview.m4a", num_speakers=2)

    assert result.engine == "wespeaker"
    assert captured["num_speakers"] == 2


def test_run_diarization_auto_falls_back_to_pyannote(monkeypatch, tmp_path):
    class FakePipeline:
        @classmethod
        def from_pretrained(cls, checkpoint, **kwargs):
            return cls()

        def __call__(self, audio_path):
            return SimpleNamespace(
                speaker_diarization=[
                    (SimpleNamespace(start=0.0, end=1.0), "SPEAKER_00"),
                ]
            )

    def unavailable_sherpa(audio_path, *, progress_callback=None, num_speakers=None):
        raise DiarizationError(
            "engine_unavailable",
            "sherpa-onnx unavailable",
            engine="sherpa-onnx",
            model="test-model",
        )

    fake_audio_module = types.ModuleType("pyannote.audio")
    fake_audio_module.Pipeline = FakePipeline
    monkeypatch.setitem(sys.modules, "pyannote.audio", fake_audio_module)
    monkeypatch.setenv("NOTEBI_DIARIZATION_ENGINE", "auto")
    monkeypatch.setenv("HF_TOKEN", "test-token")
    monkeypatch.setattr("shared.audio_analyzer.run_sherpa_diarization", unavailable_sherpa)

    result = run_diarization(tmp_path / "interview.wav")

    assert result.engine == "pyannote"


def test_run_diarization_uses_pyannote_4_community_output(monkeypatch, tmp_path):
    captured = {}

    class FakePipeline:
        @classmethod
        def from_pretrained(cls, checkpoint, **kwargs):
            captured["checkpoint"] = checkpoint
            captured["kwargs"] = kwargs
            return cls()

        def __call__(self, audio_path):
            captured["audio_path"] = audio_path
            return SimpleNamespace(
                speaker_diarization=[
                    (SimpleNamespace(start=0.25, end=1.5), "SPEAKER_00"),
                    (SimpleNamespace(start=1.75, end=3.0), "SPEAKER_01"),
                ]
            )

    fake_audio_module = types.ModuleType("pyannote.audio")
    fake_audio_module.Pipeline = FakePipeline
    monkeypatch.setitem(sys.modules, "pyannote.audio", fake_audio_module)
    monkeypatch.setenv("NOTEBI_DIARIZATION_ENGINE", "pyannote")
    monkeypatch.setenv("HF_TOKEN", "test-token")

    audio_path = tmp_path / "interview.wav"
    result = run_diarization(audio_path)

    assert captured == {
        "checkpoint": "pyannote/speaker-diarization-community-1",
        "kwargs": {"token": "test-token"},
        "audio_path": str(audio_path),
    }
    assert result.engine == "pyannote"
    assert result.model == "pyannote/speaker-diarization-community-1"
    assert result.num_speakers == 2
    assert [segment.speaker for segment in result.segments] == ["SPEAKER_00", "SPEAKER_01"]


# ── VAD 烟雾测试（silero 已装则跑真模型）──────────────────────


def _write_silence_wav(path: Path, duration_sec: float = 1.0, sr: int = 16000) -> Path:
    """合成纯静音 PCM 16-bit mono wav。"""
    n = int(sr * duration_sec)
    pcm = np.zeros(n, dtype=np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())
    return path


@pytest.mark.skipif(
    not os.environ.get("RUN_AUDIO_MODEL_TESTS"),
    reason=(
        "需加载 silero-vad（torch 模型）会污染后续测试的 asyncio loop。"
        "设 RUN_AUDIO_MODEL_TESTS=1 单独跑此用例。"
    ),
)
def test_run_vad_silence_returns_no_speech(tmp_path: Path):
    pytest.importorskip("silero_vad")
    wav = _write_silence_wav(tmp_path / "silence.wav", duration_sec=2.0)
    result = run_vad(wav)
    assert result.has_speech is False
    assert result.total_duration > 0
