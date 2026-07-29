"""音频分析工具集（N8，SPEC §5）。

提供给 `handle_audio_task` 的可独立测试的纯函数 / 数据类：
- VAD：silero-vad 检测人声片段
- 说话人分离：sherpa-onnx 跨平台离线优先，pyannote.audio 可回退
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
    fallback_names: Dict[str, str] = {}
    for seg in segments:
        text = str(seg.get("edited_text") or seg.get("text") or "").strip()
        if not text:
            continue
        speaker_id = str(seg.get("speaker") or "").strip()
        display_name = str(names.get(speaker_id) or "").strip()
        if not display_name:
            if speaker_id:
                if speaker_id not in fallback_names:
                    fallback_names[speaker_id] = f"说话人 {len(fallback_names) + 1}"
                display_name = fallback_names[speaker_id]
            else:
                display_name = "未识别说话人"
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
    title: str = "NoteBi Export",
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
