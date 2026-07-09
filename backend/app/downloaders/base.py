"""downloaders 基类与公共类型定义。"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class DownloadQuality(Enum):
    """下载质量档位。"""
    fast = "fast"      # 360P
    medium = "medium"  # 480P
    high = "high"      # 720P


@dataclass
class TranscriptSegment:
    """一段转写文本，含起止时间。"""
    start: float
    end: float
    text: str


@dataclass
class TranscriptResult:
    """完整转写结果。"""
    language: Optional[str] = None
    full_text: str = ""
    segments: List[TranscriptSegment] = field(default_factory=list)


@dataclass
class VideoMeta:
    """视频元信息。"""
    video_id: str = ""
    title: str = ""
    description: str = ""
    duration: int = 0
    cover_url: str = ""
    author: str = ""
    platform: str = ""
    view_count: int = 0
    upload_date: str = ""
    tags: List[str] = field(default_factory=list)
    raw_info: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AudioDownloadResult:
    """音频/视频下载结果。"""
    file_path: str = ""
    title: str = ""
    duration: int = 0
    cover_url: str = ""
    platform: str = ""
    video_id: str = ""
    raw_info: Dict[str, Any] = field(default_factory=dict)
    video_path: Optional[str] = None


class Downloader:
    """下载器基类。"""

    def __init__(self, cache_data: str = "./data/cache"):
        self.cache_data = cache_data
