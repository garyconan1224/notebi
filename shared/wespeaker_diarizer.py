"""WeSpeaker based offline speaker diarization.

This adapter deliberately keeps ``wespeakerruntime`` optional at import time.
The runtime downloads the language model lazily to ``~/.wespeaker`` and works
on macOS, Windows and Linux without a Hugging Face token.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Callable, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from shared.audio_analyzer import DiarizationError, DiarizationResult, SpeakerSegment

logger = logging.getLogger(__name__)
ProgressCallback = Callable[[float, str], None]
SAMPLE_RATE = 16_000
WINDOW_SECONDS = 1.2
STEP_SECONDS = 0.6


def _report(callback: Optional[ProgressCallback], ratio: float, message: str) -> None:
    if callback:
        callback(max(0.0, min(1.0, ratio)), message)


def _load_audio(audio_path: Path) -> np.ndarray:
    try:
        import soundfile as sf

        audio, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=True)
        mono = audio.mean(axis=1)
    except Exception:
        try:
            import librosa

            mono, sample_rate = librosa.load(str(audio_path), sr=None, mono=True, dtype=np.float32)
        except Exception as err:
            raise RuntimeError(f"WeSpeaker 无法解码音频：{err}") from err

    if int(sample_rate) != SAMPLE_RATE:
        import librosa

        mono = librosa.resample(
            np.asarray(mono, dtype=np.float32),
            orig_sr=int(sample_rate),
            target_sr=SAMPLE_RATE,
        )
    return np.ascontiguousarray(mono, dtype=np.float32)


def _speech_ranges(audio: np.ndarray) -> List[Tuple[float, float]]:
    """Use Silero VAD when available, with an RMS fallback for minimal installs."""
    try:
        import torch
        from silero_vad import get_speech_timestamps, load_silero_vad

        model = load_silero_vad()
        timestamps = get_speech_timestamps(
            torch.from_numpy(audio),
            model,
            sampling_rate=SAMPLE_RATE,
            threshold=0.40,
            min_speech_duration_ms=250,
            min_silence_duration_ms=120,
            speech_pad_ms=80,
            return_seconds=True,
        )
        ranges = [(float(item["start"]), float(item["end"])) for item in timestamps]
        if ranges:
            return ranges
    except Exception as err:
        logger.warning("WeSpeaker VAD 不可用，改用能量门限：%s", err)

    duration = len(audio) / SAMPLE_RATE
    frame = int(SAMPLE_RATE * 0.5)
    if len(audio) == 0:
        return []
    usable = len(audio) // frame * frame
    if usable == 0:
        return [(0.0, duration)]
    rms = np.sqrt(np.mean(np.square(audio[:usable].reshape(-1, frame)), axis=1))
    threshold = max(float(np.percentile(rms, 25)) * 1.25, 1e-4)
    return [
        (idx * 0.5, min(duration, (idx + 1) * 0.5))
        for idx, value in enumerate(rms)
        if float(value) >= threshold
    ]


def _windows(ranges: Iterable[Tuple[float, float]], duration: float) -> List[Tuple[float, float]]:
    windows: List[Tuple[float, float]] = []
    for start, end in ranges:
        cursor = max(0.0, start)
        end = min(duration, end)
        while cursor + 0.45 <= end:
            window_end = min(end, cursor + WINDOW_SECONDS)
            if window_end - cursor >= 0.45:
                windows.append((cursor, window_end))
            cursor += STEP_SECONDS
    return windows


def _cluster(embeddings: np.ndarray, num_speakers: Optional[int]) -> np.ndarray:
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score
    from sklearn.preprocessing import normalize

    vectors = normalize(np.asarray(embeddings, dtype=np.float32))
    if len(vectors) < 2:
        return np.zeros(len(vectors), dtype=int)
    if num_speakers:
        k = max(1, min(int(num_speakers), len(vectors)))
    else:
        upper = min(6, max(1, len(vectors) // 20))
        if upper <= 1:
            k = 1
        else:
            candidates: List[Tuple[float, int]] = []
            for candidate in range(2, upper + 1):
                labels = KMeans(n_clusters=candidate, n_init=5, random_state=42).fit_predict(vectors)
                if len(set(labels)) > 1:
                    candidates.append((float(silhouette_score(vectors, labels, metric="cosine")), candidate))
            k = max(candidates, default=(0.0, 1))[1]
    if k == 1:
        return np.zeros(len(vectors), dtype=int)
    return KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(vectors)


def _merge_labeled_windows(
    windows: Sequence[Tuple[float, float]], labels: Sequence[int],
) -> List[SpeakerSegment]:
    if not windows:
        return []
    merged: List[SpeakerSegment] = []
    for (start, end), label in zip(windows, labels):
        speaker = f"SPEAKER_{int(label):02d}"
        if merged and merged[-1].speaker == speaker and start - merged[-1].end <= 0.7:
            previous = merged[-1]
            merged[-1] = SpeakerSegment(previous.start, max(previous.end, end), speaker)
        else:
            merged.append(SpeakerSegment(start, end, speaker))
    return merged


def run_wespeaker_diarization(
    audio_path: Path,
    *,
    progress_callback: Optional[ProgressCallback] = None,
    num_speakers: Optional[int] = None,
) -> DiarizationResult:
    engine = "wespeaker"
    model_name = "WeSpeaker ResNet34-LM (CN/EN)"
    if not audio_path.is_file():
        raise DiarizationError("audio_missing", f"音频文件不存在：{audio_path}", engine=engine, model=model_name)
    try:
        from wespeakerruntime import Speaker
    except ImportError as err:
        raise DiarizationError("engine_unavailable", "未安装 wespeakerruntime。", engine=engine, model=model_name) from err

    try:
        lang = os.environ.get("NOTEBI_WESPEAKER_LANG", "chs").strip().lower() or "chs"
        if lang not in {"chs", "en"}:
            lang = "chs"
        _report(progress_callback, 0.02, "加载 WeSpeaker 音色模型...")
        speaker_model = Speaker(lang=lang, intra_op_num_threads=max(1, int(os.environ.get("NOTEBI_WESPEAKER_THREADS", "2"))))
        _report(progress_callback, 0.16, "WeSpeaker 模型已就绪")
        audio = _load_audio(audio_path)
        duration = len(audio) / SAMPLE_RATE
        windows = _windows(_speech_ranges(audio), duration)
        if len(windows) < 2:
            raise DiarizationError("insufficient_speech", "可用于音色聚类的语音片段不足。", engine=engine, model=model_name)
        _report(progress_callback, 0.22, f"提取音色特征（{len(windows)} 个窗口）...")

        embeddings: List[np.ndarray] = []
        kept_windows: List[Tuple[float, float]] = []
        last_percent = -1
        for idx, (start, end) in enumerate(windows):
            pcm = audio[int(start * SAMPLE_RATE): int(end * SAMPLE_RATE)]
            if len(pcm) < int(0.45 * SAMPLE_RATE):
                continue
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp:
                temp_path = Path(temp.name)
            try:
                import soundfile as sf

                sf.write(str(temp_path), pcm, SAMPLE_RATE)
                embedding = np.asarray(speaker_model.extract_embedding(str(temp_path)), dtype=np.float32).reshape(-1)
                if embedding.size:
                    embeddings.append(embedding)
                    kept_windows.append((start, end))
            finally:
                temp_path.unlink(missing_ok=True)
            percent = int((idx + 1) / len(windows) * 100)
            if percent > last_percent:
                last_percent = percent
                _report(progress_callback, 0.22 + (idx + 1) / len(windows) * 0.58, f"音色特征 {percent}%")

        if len(embeddings) < 2:
            raise DiarizationError("insufficient_embeddings", "WeSpeaker 未提取到足够音色特征。", engine=engine, model=model_name)
        labels = _cluster(np.vstack(embeddings), num_speakers)
        segments = _merge_labeled_windows(kept_windows, labels)
        speakers = {segment.speaker for segment in segments}
        if len(speakers) < (num_speakers or 1):
            raise DiarizationError(
                "speaker_count_mismatch",
                f"WeSpeaker 只识别出 {len(speakers)} 人，低于期望的 {num_speakers} 人。",
                engine=engine,
                model=model_name,
            )
        _report(progress_callback, 1.0, f"说话人分析完成，共 {len(speakers)} 人（WeSpeaker）")
        return DiarizationResult(
            num_speakers=len(speakers),
            segments=segments,
            engine=engine,
            model=model_name,
        )
    except DiarizationError:
        raise
    except Exception as err:
        raise DiarizationError("inference_failed", f"WeSpeaker 音色分析失败：{err}", engine=engine, model=model_name) from err
