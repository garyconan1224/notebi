"""音频分析工具集（N8，SPEC §5）。

提供给 `handle_audio_task` 的可独立测试的纯函数 / 数据类：
- VAD：silero-vad 检测人声片段
- 说话人分离：sherpa-onnx 跨平台离线优先，pyannote.audio 可回退
- 音乐分析：librosa BPM / 调性 / 能量曲线
- 音乐提示词：LLM 根据特征生成 Suno/Udio 通用格式
- 字幕导出：transcript_segments → .srt / .txt

所有重模型都 lazy import，让导入本模块不会触发 torch 启动。
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ── 数据类 ────────────────────────────────────────────────────


@dataclass
class VadSegment:
    start: float  # 秒
    end: float


@dataclass
class VadResult:
    has_speech: bool
    segments: List[VadSegment] = field(default_factory=list)
    total_speech_duration: float = 0.0
    total_duration: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "has_speech": self.has_speech,
            "segments": [{"start": s.start, "end": s.end} for s in self.segments],
            "total_speech_duration": round(self.total_speech_duration, 2),
            "total_duration": round(self.total_duration, 2),
        }


@dataclass
class SpeakerSegment:
    start: float
    end: float
    speaker: str  # e.g. "SPEAKER_00"


@dataclass
class DiarizationResult:
    num_speakers: int
    segments: List[SpeakerSegment] = field(default_factory=list)
    engine: str = ""
    model: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "num_speakers": self.num_speakers,
            "engine": self.engine,
            "model": self.model,
            "segments": [
                {"start": s.start, "end": s.end, "speaker": s.speaker}
                for s in self.segments
            ],
        }


class DiarizationError(RuntimeError):
    """说话人分析引擎无法完成时返回的结构化错误。"""

    def __init__(self, code: str, message: str, *, engine: str, model: str) -> None:
        super().__init__(message)
        self.code = code
        self.engine = engine
        self.model = model

    def to_dict(self) -> Dict[str, str]:
        return {
            "stage": "diarization",
            "code": self.code,
            "message": str(self),
            "engine": self.engine,
            "model": self.model,
        }


@dataclass
class MusicAnalysis:
    duration: float
    bpm: float
    key: str  # e.g. "C major"
    energy_mean: float  # RMS 均值
    spectral_centroid_mean: float  # 大致音色亮度
    music_prompt: str = ""
    similar_references: List[str] = field(default_factory=list)
    scenarios: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "duration": round(self.duration, 2),
            "bpm": round(self.bpm, 1),
            "key": self.key,
            "energy_mean": round(self.energy_mean, 4),
            "spectral_centroid_mean": round(self.spectral_centroid_mean, 1),
            "music_prompt": self.music_prompt,
            "similar_references": list(self.similar_references),
            "scenarios": list(self.scenarios),
        }


# ── VAD ───────────────────────────────────────────────────────


def run_vad(audio_path: Path, sampling_rate: int = 16000) -> VadResult:
    """silero-vad 跑人声活动检测。

    没装 silero-vad 时返回 has_speech=True（保守假设，不阻塞 ASR）。
    """
    try:
        from silero_vad import get_speech_timestamps, load_silero_vad, read_audio
    except ImportError:
        logger.warning("silero-vad 未安装，跳过 VAD 检测，按有人声继续")
        return VadResult(has_speech=True, total_duration=0.0)

    try:
        model = load_silero_vad()
        wav = read_audio(str(audio_path), sampling_rate=sampling_rate)
        total = float(len(wav)) / sampling_rate
        ts = get_speech_timestamps(wav, model, sampling_rate=sampling_rate)
    except Exception as err:
        logger.warning(f"silero-vad 调用失败：{err}；按有人声继续")
        return VadResult(has_speech=True, total_duration=0.0)

    segments = [
        VadSegment(start=t["start"] / sampling_rate, end=t["end"] / sampling_rate)
        for t in ts
    ]
    speech_dur = sum(s.end - s.start for s in segments)
    return VadResult(
        has_speech=bool(segments),
        segments=segments,
        total_speech_duration=speech_dur,
        total_duration=total,
    )


# ── 说话人分离 ────────────────────────────────────────────────


def _run_pyannote_diarization(
    audio_path: Path,
    *,
    num_speakers: Optional[int] = None,
) -> DiarizationResult:
    """通过 pyannote Community-1 生成引擎无关的说话人时间段。"""
    engine = "pyannote"
    model = "pyannote/speaker-diarization-community-1"
    token = (
        os.environ.get("HF_TOKEN")
        or os.environ.get("HUGGINGFACE_TOKEN")
        or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    )
    if not token:
        raise DiarizationError(
            "missing_token",
            "未检测到 Hugging Face Token，无法执行说话人分析。",
            engine=engine,
            model=model,
        )

    try:
        from pyannote.audio import Pipeline  # type: ignore
    except ImportError as err:
        raise DiarizationError(
            "engine_unavailable",
            "pyannote.audio 未安装，无法执行说话人分析。",
            engine=engine,
            model=model,
        ) from err

    try:
        pipeline = Pipeline.from_pretrained(
            model,
            token=token,
        )
        call_options = {"num_speakers": num_speakers} if num_speakers else {}
        output = pipeline(str(audio_path), **call_options)
    except Exception as err:
        raise DiarizationError(
            "inference_failed",
            f"pyannote 模型加载或推理失败：{err}",
            engine=engine,
            model=model,
        ) from err

    segments: List[SpeakerSegment] = []
    speakers = set()
    diarization = getattr(output, "speaker_diarization", output)
    if hasattr(diarization, "itertracks"):
        entries = ((turn, speaker) for turn, _, speaker in diarization.itertracks(yield_label=True))
    else:
        entries = iter(diarization)
    try:
        for turn, speaker in entries:
            speaker_id = str(speaker)
            segments.append(
                SpeakerSegment(start=float(turn.start), end=float(turn.end), speaker=speaker_id)
            )
            speakers.add(speaker_id)
    except Exception as err:
        raise DiarizationError(
            "invalid_output",
            f"pyannote 返回了无法解析的说话人结果：{err}",
            engine=engine,
            model=model,
        ) from err
    return DiarizationResult(
        num_speakers=len(speakers),
        segments=segments,
        engine=engine,
        model=model,
    )


def run_sherpa_diarization(
    audio_path: Path,
    *,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    num_speakers: Optional[int] = None,
) -> DiarizationResult:
    """Lazy bridge keeps the heavyweight sherpa runtime out of module import."""
    from shared.sherpa_diarizer import run_sherpa_diarization as run

    return run(
        audio_path,
        progress_callback=progress_callback,
        num_speakers=num_speakers,
    )


def run_diarization(
    audio_path: Path,
    *,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    num_speakers: Optional[int] = None,
) -> DiarizationResult:
    """Run WeSpeaker first, then sherpa-onnx/pyannote fallback in auto mode."""
    engine = os.environ.get("NOTEBI_DIARIZATION_ENGINE", "auto").strip().lower() or "auto"
    if engine not in {"auto", "wespeaker", "sherpa", "sherpa-onnx", "pyannote"}:
        raise DiarizationError(
            "invalid_engine",
            f"未知说话人分析引擎：{engine}",
            engine=engine,
            model="",
        )
    if engine == "pyannote":
        return _run_pyannote_diarization(audio_path, num_speakers=num_speakers)

    if engine in {"auto", "wespeaker"}:
        try:
            from shared.wespeaker_diarizer import run_wespeaker_diarization

            return run_wespeaker_diarization(
                audio_path,
                progress_callback=progress_callback,
                num_speakers=num_speakers,
            )
        except DiarizationError as wespeaker_error:
            if engine == "wespeaker":
                raise
            logger.warning("WeSpeaker 不可用，回退 sherpa-onnx：%s", wespeaker_error)

    try:
        return run_sherpa_diarization(
            audio_path,
            progress_callback=progress_callback,
            num_speakers=num_speakers,
        )
    except DiarizationError as sherpa_error:
        if engine != "auto":
            raise
        has_hf_token = any(
            os.environ.get(key)
            for key in ("HF_TOKEN", "HUGGINGFACE_TOKEN", "HUGGING_FACE_HUB_TOKEN")
        )
        if not has_hf_token:
            raise
        logger.warning("sherpa-onnx 不可用，回退 pyannote：%s", sherpa_error)
        return _run_pyannote_diarization(audio_path, num_speakers=num_speakers)


# ── 音乐分析 ──────────────────────────────────────────────────


_KEY_PROFILES = [
    # Krumhansl-Schmuckler key 估计的简化版（major / minor）
    "C major", "C# major", "D major", "D# major", "E major", "F major",
    "F# major", "G major", "G# major", "A major", "A# major", "B major",
    "C minor", "C# minor", "D minor", "D# minor", "E minor", "F minor",
    "F# minor", "G minor", "G# minor", "A minor", "A# minor", "B minor",
]


def analyze_music(audio_path: Path) -> Optional[MusicAnalysis]:
    """librosa 跑基础音乐特征。

    没装 librosa 时返回 None。
    """
    try:
        import librosa  # type: ignore
        import numpy as np
    except ImportError:
        logger.warning("librosa 未安装，跳过音乐分析")
        return None

    try:
        y, sr = librosa.load(str(audio_path), sr=None, mono=True)
        duration = float(librosa.get_duration(y=y, sr=sr))
        tempo_raw, _ = librosa.beat.beat_track(y=y, sr=sr)
        tempo = float(np.atleast_1d(tempo_raw)[0])
        rms = float(np.mean(librosa.feature.rms(y=y)))
        centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
        # 调性估计：chroma + 简单匹配
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = chroma.mean(axis=1)
        key_idx = int(np.argmax(chroma_mean))
        # major / minor 简化判定：相对小调位置（key - 3）能量是否更高
        minor_idx = (key_idx - 3) % 12
        is_minor = chroma_mean[minor_idx] > chroma_mean[key_idx] * 0.95
        key_name = _KEY_PROFILES[key_idx + (12 if is_minor else 0)]
    except Exception as err:
        logger.warning(f"librosa 音乐分析失败：{err}")
        return None

    return MusicAnalysis(
        duration=duration,
        bpm=tempo,
        key=key_name,
        energy_mean=rms,
        spectral_centroid_mean=centroid,
    )


# ── LLM 生成音乐提示词 ────────────────────────────────────────


def generate_music_prompt(
    features: MusicAnalysis,
    llm_caller: Any,  # 形如 (system, user) -> str
) -> MusicAnalysis:
    """让 LLM 根据 librosa 特征生成 Suno/Udio 通用提示词 + 相似曲风 + 适用场景。

    llm_caller 必须是可调用对象 (system: str, user: str) -> str；调用方决定怎么接 SDK。
    """
    system = (
        "You are a music director who writes Suno/Udio-compatible music generation prompts. "
        "Given basic acoustic features, infer style/mood and produce: (1) one-line music prompt "
        "in English (genre, instruments, mood, bpm, key), (2) 2-3 similar reference artists, "
        "(3) 2-3 typical usage scenarios in Chinese."
    )
    user = (
        f"Features:\n"
        f"- duration: {features.duration:.1f}s\n"
        f"- bpm: {features.bpm:.1f}\n"
        f"- key: {features.key}\n"
        f"- energy(RMS mean): {features.energy_mean:.4f}\n"
        f"- spectral_centroid(brightness): {features.spectral_centroid_mean:.1f}\n\n"
        f"Output JSON only with keys: music_prompt, similar_references (list), scenarios (list)."
    )
    try:
        raw = llm_caller(system, user)
        parsed = _parse_music_prompt_json(raw)
        if parsed:
            features.music_prompt = str(parsed.get("music_prompt") or "")
            features.similar_references = list(parsed.get("similar_references") or [])
            features.scenarios = list(parsed.get("scenarios") or [])
    except Exception as err:
        logger.warning(f"音乐提示词 LLM 调用失败：{err}")
    return features


def _parse_music_prompt_json(text: str) -> Optional[Dict[str, Any]]:
    """容错 JSON 解析：抓第一个 {...} 块。"""
    import json
    import re

    text = (text or "").strip()
    if not text:
        return None
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


# ── 字幕导出 ──────────────────────────────────────────────────


def export_srt(
    segments: List[Dict[str, Any]],
    speaker_map: Optional[Dict[Tuple[float, float], str]] = None,
) -> str:
    """transcript_segments → .srt 字符串。

    每个 segment 必须含 start / end / text；可选 speaker。speaker_map 用 (start,end) 元组覆盖。
    """
    lines: List[str] = []
    for i, seg in enumerate(segments, start=1):
        try:
            start = float(seg.get("start") or 0.0)
            end = float(seg.get("end") or start)
        except (TypeError, ValueError):
            continue
        text = str(seg.get("edited_text") or seg.get("text") or "").strip()
        if not text:
            continue
        speaker = None
        if speaker_map is not None:
            speaker = speaker_map.get((start, end))
        if speaker is None:
            speaker = seg.get("speaker")
        line_text = f"[{speaker}] {text}" if speaker else text
        lines.append(str(i))
        lines.append(f"{_fmt_srt_time(start)} --> {_fmt_srt_time(end)}")
        lines.append(line_text)
        lines.append("")
    return "\n".join(lines)


def export_txt(
    segments: List[Dict[str, Any]],
    with_speaker: bool = False,
) -> str:
    lines: List[str] = []
    for seg in segments:
        text = str(seg.get("edited_text") or seg.get("text") or "").strip()
        if not text:
            continue
        if with_speaker and seg.get("speaker"):
            lines.append(f"[{seg['speaker']}] {text}")
        else:
            lines.append(text)
    return "\n".join(lines)


def _join_transcript_units(units: List[str]) -> str:
    text = ""
    for unit in units:
        cleaned = unit.strip()
        if not cleaned:
            continue
        needs_space = bool(
            text
            and text[-1].isascii()
            and text[-1].isalnum()
            and cleaned[0].isascii()
            and cleaned[0].isalnum()
        )
        text += (" " if needs_space else "") + cleaned
    return text


def _transcript_paragraphs(
    units: List[str],
    paragraph_chars: int,
) -> str:
    paragraphs: List[str] = []
    current: List[str] = []
    current_chars = 0
    limit = max(1, paragraph_chars)
    for unit in units:
        cleaned = unit.strip()
        if not cleaned:
            continue
        current.append(cleaned)
        current_chars += len(cleaned)
        if current_chars >= limit:
            paragraphs.append(_join_transcript_units(current))
            current = []
            current_chars = 0
    if current:
        paragraphs.append(_join_transcript_units(current))
    return "\n\n".join(paragraph for paragraph in paragraphs if paragraph)


def export_transcript_article(
    segments: List[Dict[str, Any]],
    paragraph_chars: int = 480,
) -> str:
    """将转写按原顺序整理成无时间轴文章，edited_text 优先且不改写内容。"""
    units = [
        str(seg.get("edited_text") or seg.get("text") or "").strip()
        for seg in segments
        if str(seg.get("edited_text") or seg.get("text") or "").strip()
    ]
    return _transcript_paragraphs(units, paragraph_chars)


def export_transcript_by_speaker(
    segments: List[Dict[str, Any]],
    speaker_map: Optional[Dict[str, str]] = None,
    paragraph_chars: int = 480,
) -> str:
    """按说话人首次出现顺序归组，输出无时间轴、无技术 speaker ID 的文章。"""
    groups: Dict[str, List[str]] = {}
    names = speaker_map or {}
    for seg in segments:
        text = str(seg.get("edited_text") or seg.get("text") or "").strip()
        if not text:
            continue
        speaker_id = str(seg.get("speaker") or "").strip()
        display_name = str(names.get(speaker_id) or "").strip()
        if not display_name:
            display_name = speaker_id if speaker_id and not speaker_id.startswith("SPEAKER_") else "未识别说话人"
        groups.setdefault(display_name, []).append(text)
    return "\n\n".join(
        f"【{speaker}】\n{_transcript_paragraphs(units, paragraph_chars)}"
        for speaker, units in groups.items()
    )


def export_vtt(
    segments: List[Dict[str, Any]],
    speaker_map: Optional[Dict[Tuple[float, float], str]] = None,
) -> str:
    """transcript_segments → WebVTT 字符串。"""
    lines: List[str] = ["WEBVTT", ""]
    for seg in segments:
        try:
            start = float(seg.get("start") or 0.0)
            end = float(seg.get("end") or start)
        except (TypeError, ValueError):
            continue
        text = str(seg.get("edited_text") or seg.get("text") or "").strip()
        if not text:
            continue
        speaker = None
        if speaker_map is not None:
            speaker = speaker_map.get((start, end))
        if speaker is None:
            speaker = seg.get("speaker")
        line_text = f"<v {speaker}>{text}</v>" if speaker else text
        lines.append(f"{_fmt_vtt_time(start)} --> {_fmt_vtt_time(end)}")
        lines.append(line_text)
        lines.append("")
    return "\n".join(lines)


def export_ass(
    segments: List[Dict[str, Any]],
    title: str = "Nibi Export",
    speaker_map: Optional[Dict[Tuple[float, float], str]] = None,
) -> str:
    """transcript_segments → ASS (Advanced SubStation Alpha) 字符串。"""
    header = _ASS_HEADER.format(title=title)
    lines: List[str] = [header]
    for seg in segments:
        try:
            start = float(seg.get("start") or 0.0)
            end = float(seg.get("end") or start)
        except (TypeError, ValueError):
            continue
        text = str(seg.get("edited_text") or seg.get("text") or "").strip()
        if not text:
            continue
        speaker = None
        if speaker_map is not None:
            speaker = speaker_map.get((start, end))
        if speaker is None:
            speaker = seg.get("speaker")
        line_text = f"{speaker}: {text}" if speaker else text
        lines.append(f"Dialogue: 0,{_fmt_ass_time(start)},{_fmt_ass_time(end)},Default,,0,0,0,,{line_text}")
    return "\n".join(lines)


_ASS_HEADER = """[Script Info]
Title: {title}
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 384
PlayResY: 288

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"""


def _fmt_srt_time(sec: float) -> str:
    if sec < 0:
        sec = 0.0
    ms = int(round((sec - int(sec)) * 1000))
    s_total = int(sec)
    h = s_total // 3600
    m = (s_total % 3600) // 60
    s = s_total % 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _fmt_vtt_time(sec: float) -> str:
    if sec < 0:
        sec = 0.0
    ms = int(round((sec - int(sec)) * 1000))
    s_total = int(sec)
    h = s_total // 3600
    m = (s_total % 3600) // 60
    s = s_total % 60
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def _fmt_ass_time(sec: float) -> str:
    if sec < 0:
        sec = 0.0
    cs = int(round((sec - int(sec)) * 100))
    s_total = int(sec)
    h = s_total // 3600
    m = (s_total % 3600) // 60
    s = s_total % 60
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


# ── 把说话人 segments 映射到 transcript segments ──────────────


def assign_speakers_to_segments(
    transcript_segments: List[Dict[str, Any]],
    diarization: DiarizationResult,
) -> List[Dict[str, Any]]:
    """给每条 transcript_segment 标 speaker（按最大时间重叠）。

    返回新 list（不修改原 segments）。
    """
    enriched: List[Dict[str, Any]] = []
    for seg in transcript_segments:
        try:
            s = float(seg.get("start") or 0.0)
            e = float(seg.get("end") or s)
        except (TypeError, ValueError):
            enriched.append(dict(seg))
            continue
        best: Tuple[float, str] = (0.0, "")
        for sp in diarization.segments:
            overlap = max(0.0, min(e, sp.end) - max(s, sp.start))
            if overlap > best[0]:
                best = (overlap, sp.speaker)
        out = dict(seg)
        if best[1]:
            out["speaker"] = best[1]
        enriched.append(out)
    return enriched


# ── A3.3: 多段音乐 6 维度切分 ─────────────────────────────────


@dataclass
class MusicSegment:
    """A3.3: 单个音乐片段的 6 维度分析结果。"""
    start: float
    end: float
    bpm: float
    key: str
    energy_mean: float
    spectral_centroid_mean: float
    # 6 维度（4 个 LLM 推断 + 2 个声学）
    genre: str = ""           # 风格
    mood: str = ""            # 情绪
    instruments: List[str] = field(default_factory=list)  # 乐器
    atmosphere: str = ""      # 氛围
    # 生成类输出
    music_prompt: str = ""
    similar_references: List[str] = field(default_factory=list)
    scenarios: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "start": round(self.start, 2),
            "end": round(self.end, 2),
            "bpm": round(self.bpm, 1),
            "key": self.key,
            "energy_mean": round(self.energy_mean, 4),
            "spectral_centroid_mean": round(self.spectral_centroid_mean, 1),
            "genre": self.genre,
            "mood": self.mood,
            "instruments": list(self.instruments),
            "atmosphere": self.atmosphere,
            "music_prompt": self.music_prompt,
            "similar_references": list(self.similar_references),
            "scenarios": list(self.scenarios),
        }


def segment_audio(
    audio_path: str,
    min_duration: float = 30.0,
    fallback_duration: float = 90.0,
) -> List[Tuple[float, float]]:
    """用 librosa onset + RMS 能量变化做音频分段。

    返回 (start_sec, end_sec) 列表，覆盖 0 到总时长。
    检测不到显著边界时回退固定 90 秒窗。
    """
    try:
        import librosa  # type: ignore
        import numpy as np
    except ImportError:
        logger.warning("librosa 未安装，无法分段")
        return []

    try:
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        total = float(librosa.get_duration(y=y, sr=sr))
    except Exception as err:
        logger.warning(f"音频加载失败，无法分段：{err}")
        return []

    if total < min_duration:
        return [(0.0, total)]

    try:
        # onset 检测 → 候选边界时间
        onset_frames = librosa.onset.onset_detect(
            y=y, sr=sr, backtrack=True, units="frames"
        )
        onset_times = librosa.frames_to_time(onset_frames, sr=sr).tolist()

        # RMS 能量 → 找能量显著变化的点
        rms = librosa.feature.rms(y=y)[0]
        rms_times = librosa.frames_to_time(range(len(rms)), sr=sr)
        # 能量变化率 > 30% 的位置作为候选边界
        rms_diff = np.abs(np.diff(rms) / np.maximum(rms[:-1], 1e-8))
        threshold = 0.3
        energy_boundary_idx = np.where(rms_diff > threshold)[0]
        energy_boundary_times = rms_times[energy_boundary_idx + 1].tolist()

        # 合并两类候选边界
        candidates = sorted(set(
            round(t, 1) for t in onset_times + energy_boundary_times
            if min_duration < t < total - min_duration
        ))
    except Exception as err:
        logger.warning(f"边界检测失败：{err}")
        candidates = []

    # 构造分段
    if len(candidates) < 1:
        # 回退：固定时长窗
        boundaries: List[float] = []
        t = 0.0
        while t + fallback_duration < total:
            t += fallback_duration
            boundaries.append(t)
    else:
        # 合并过短的相邻段（< min_duration）
        boundaries = [candidates[0]]
        for c in candidates[1:]:
            if c - boundaries[-1] < min_duration:
                boundaries[-1] = c  # 合并：用新边界替代旧边界
            else:
                boundaries.append(c)

    segments: List[Tuple[float, float]] = []
    prev = 0.0
    for b in boundaries:
        if b - prev >= min_duration:
            segments.append((prev, b))
            prev = b
    if total - prev > 1.0:  # 收尾残留 > 1s
        segments.append((prev, total))
    elif segments:
        # 尾端短残留合并到最后一段
        segments[-1] = (segments[-1][0], total)

    if not segments:
        segments.append((0.0, total))

    return segments


def analyze_music_segments(
    audio_path: str,
    boundaries: List[Tuple[float, float]],
) -> List[MusicSegment]:
    """对每个分段切片跑 librosa 声学分析（不含 LLM）。

    返回 MusicSegment 列表，仅声学字段有值；
    风格/情绪/乐器/氛围 留作后续 LLM enrich（A3.3b）。
    """
    try:
        import librosa  # type: ignore
        import numpy as np
    except ImportError:
        logger.warning("librosa 未安装，跳过多段分析")
        return []

    segments: List[MusicSegment] = []
    for start, end in boundaries:
        try:
            y, sr = librosa.load(audio_path, sr=None, mono=True, offset=start, duration=end - start)
            dur = float(end - start)
            tempo_raw, _ = librosa.beat.beat_track(y=y, sr=sr)
            tempo = float(np.atleast_1d(tempo_raw)[0])
            rms_val = float(np.mean(librosa.feature.rms(y=y)))
            centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
            # 调性估计
            key_name = ""
            try:
                chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
                chroma_mean = chroma.mean(axis=1)
                key_idx = int(np.argmax(chroma_mean))
                minor_idx = (key_idx - 3) % 12
                is_minor = chroma_mean[minor_idx] > chroma_mean[key_idx] * 0.95
                key_name = _KEY_PROFILES[key_idx + (12 if is_minor else 0)]
            except Exception:
                key_name = "unknown"

            segments.append(MusicSegment(
                start=start, end=end,
                bpm=tempo, key=key_name,
                energy_mean=rms_val,
                spectral_centroid_mean=centroid,
            ))
        except Exception as err:
            logger.warning(f"片段 [{start:.1f}-{end:.1f}] 分析失败：{err}")
            continue

    return segments
