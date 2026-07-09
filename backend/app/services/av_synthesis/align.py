"""将关键帧时间戳对齐到字幕段落。"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Frame:
    """一条关键帧记录。"""

    timestamp: float  # 秒
    image_path: str  # 相对路径，如 frames/001.jpg
    scene_description: str = ""


@dataclass(frozen=True)
class TranscriptSegment:
    """一段字幕/转写。"""

    start: float  # 秒
    end: float  # 秒
    text: str


@dataclass(frozen=True)
class AlignedFrame:
    """对齐后的关键帧：帧信息 + 附近的转写片段。"""

    frame: Frame
    transcript_snippets: list[str]


def align_frames_to_transcript(
    frames: list[Frame],
    segments: list[TranscriptSegment],
    window_seconds: float = 5.0,
) -> list[AlignedFrame]:
    """把每个关键帧对齐到 ±window_seconds 内的字幕段落。

    返回的列表与 frames 等长、顺序一致。
    每个 AlignedFrame.transcript_snippets 去重且保持时间顺序。
    """
    if not frames:
        return []

    sorted_segments = sorted(segments, key=lambda s: s.start)
    result: list[AlignedFrame] = []

    for frame in frames:
        lo = frame.timestamp - window_seconds
        hi = frame.timestamp + window_seconds
        snippets: list[str] = []
        seen: set[str] = set()
        for seg in sorted_segments:
            if seg.end < lo:
                continue
            if seg.start > hi:
                break
            if seg.text not in seen:
                snippets.append(seg.text)
                seen.add(seg.text)
        result.append(AlignedFrame(frame=frame, transcript_snippets=snippets))

    return result
