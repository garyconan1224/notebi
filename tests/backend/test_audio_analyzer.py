"""Phase N8 — shared/audio_analyzer.py 单元测试。

主要覆盖不需要跑真模型的部分：
- export_srt / export_txt 纯字符串生成
- assign_speakers_to_segments 时间重叠映射
- run_diarization 委托给 WeSpeaker 引擎
- VAD 用合成静音 wav 验证（silero-vad 已装时跑真模型）
"""

from __future__ import annotations

import os
import wave
from pathlib import Path

import numpy as np
import pytest

from shared.audio_analyzer import (
    DiarizationError,
    DiarizationResult,
    SpeakerSegment,
    VadSegment,
    assign_speakers_to_segments,
    export_srt,
    export_transcript_article,
    export_transcript_by_speaker,
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


def test_export_transcript_article_is_timeline_free_and_lossless():
    segments = [
        {"start": 0, "text": "大家好，", "speaker": "SPEAKER_00"},
        {"start": 3, "text": "原始内容", "edited_text": "欢迎参加今天的访谈。", "speaker": "SPEAKER_00"},
        {"start": 3661, "text": "后半程内容不能丢。", "speaker": "SPEAKER_01"},
    ]

    article = export_transcript_article(segments, paragraph_chars=12)

    assert "00:00" not in article
    assert "SPEAKER_" not in article
    assert article.count("大家好，") == 1
    assert article.count("欢迎参加今天的访谈。") == 1
    assert article.count("后半程内容不能丢。") == 1
    assert "原始内容" not in article
    assert "\n\n" in article


def test_export_transcript_by_speaker_groups_renamed_speakers():
    segments = [
        {"start": 0, "text": "主持人开场。", "speaker": "SPEAKER_00"},
        {"start": 2, "text": "嘉宾回答一。", "speaker": "SPEAKER_01"},
        {"start": 4, "text": "主持人追问。", "speaker": "SPEAKER_00"},
        {"start": 6, "text": "未标记内容。"},
    ]

    grouped = export_transcript_by_speaker(
        segments,
        speaker_map={"SPEAKER_00": "主持人", "SPEAKER_01": "姚顺宇"},
    )

    assert grouped.index("【主持人】") < grouped.index("【姚顺宇】")
    assert "主持人开场。主持人追问。" in grouped
    assert "【姚顺宇】\n嘉宾回答一。" in grouped
    assert "【未识别说话人】\n未标记内容。" in grouped
    assert "SPEAKER_" not in grouped
    assert "00:0" not in grouped


def test_export_transcript_by_speaker_keeps_unrenamed_speakers_separate():
    """没有 speaker_map 时，也不能把不同的 diarization speaker 合并。"""
    grouped = export_transcript_by_speaker([
        {"text": "甲方发言。", "speaker": "SPEAKER_00"},
        {"text": "乙方发言。", "speaker": "SPEAKER_01"},
        {"text": "甲方补充。", "speaker": "SPEAKER_00"},
    ])

    assert grouped.count("【说话人") == 2
    assert "甲方发言。甲方补充。" in grouped
    assert "乙方发言。" in grouped
    assert "SPEAKER_" not in grouped


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


# ── diarization engine contract ───────────────────────────────


def test_run_diarization_uses_wespeaker(monkeypatch, tmp_path):
    captured = {}

    def fake_wespeaker(audio_path, *, progress_callback=None, num_speakers=None):
        captured.update(audio_path=audio_path, progress_callback=progress_callback, num_speakers=num_speakers)
        return DiarizationResult(
            num_speakers=2,
            segments=[SpeakerSegment(start=0.0, end=1.0, speaker="SPEAKER_00")],
            engine="wespeaker",
            model="test-model",
        )

    monkeypatch.delenv("NOTEBI_DIARIZATION_ENGINE", raising=False)
    monkeypatch.setattr("shared.wespeaker_diarizer.run_wespeaker_diarization", fake_wespeaker)
    progress = lambda ratio, message: None
    audio_path = tmp_path / "interview.m4a"

    result = run_diarization(audio_path, progress_callback=progress, num_speakers=2)

    assert result.engine == "wespeaker"
    assert captured == {
        "audio_path": audio_path,
        "progress_callback": progress,
        "num_speakers": 2,
    }


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
