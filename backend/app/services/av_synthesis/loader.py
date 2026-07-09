"""从 workspace 加载帧数据和转写数据。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.app.services.av_synthesis.align import Frame, TranscriptSegment


def _ts_to_seconds(ts: str) -> float:
    """把 'MM:SS' 或 'HH:MM:SS' 转成秒数。"""
    parts = ts.strip().split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + int(parts[1])
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    return 0.0


def load_frames_manifest(frames_dir: Path) -> list[Frame]:
    """从视频分析产物目录加载关键帧列表。

    期望目录结构：
      frames_dir/
        *_视觉数据.json   ← 视频分析器输出
        *.jpg / *.png     ← 帧图片

    Frame.image_path 使用相对于 workspace 根目录的路径（如 "json_data/xxx/frames/001.jpg"），
    这样渲染时可以直接引用。
    """
    json_files = list(frames_dir.glob("*_视觉数据.json"))
    if not json_files:
        return []

    json_path = json_files[0]
    data = json.loads(json_path.read_text(encoding="utf-8"))

    frames: list[Frame] = []
    for fr in data.get("frames", []):
        ts_str = str(fr.get("timestamp", "0:00"))
        img_file = str(fr.get("frame_image") or "")
        desc = str(fr.get("description_zh") or fr.get("scene_description") or "")

        # 构造图片相对路径
        if img_file:
            image_path = str(frames_dir / img_file)
        else:
            image_path = ""

        frames.append(Frame(
            timestamp=_ts_to_seconds(ts_str),
            image_path=image_path,
            scene_description=desc,
        ))

    return frames


def load_transcript(transcript_path: Path) -> list[TranscriptSegment]:
    """从 audio 任务产物 JSON 加载转写段落。

    期望 JSON 结构：
      { "transcript_segments": [{ "start": 0.5, "end": 3.2, "text": "..." }, ...] }
    """
    if not transcript_path.exists():
        return []

    data = json.loads(transcript_path.read_text(encoding="utf-8"))

    segments: list[TranscriptSegment] = []
    for seg in data.get("transcript_segments", []):
        start = float(seg.get("start", 0))
        end = float(seg.get("end", 0))
        text = str(seg.get("text", ""))
        if text.strip():
            segments.append(TranscriptSegment(start=start, end=end, text=text))

    return segments
