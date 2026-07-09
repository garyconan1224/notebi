"""用 Jinja2 模板渲染 AV 综合笔记 Markdown。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

_TEMPLATE_DIR = Path(__file__).parent / "templates"


@dataclass
class Chapter:
    """一个章节：标题 + 时间范围 + 关联帧 + 转写摘选 + LLM 提炼的重点。"""

    title: str
    time_range: str  # 如 "00:00~01:20"
    frame_path: str = ""
    transcript_excerpt: str = ""
    highlights: str = ""


@dataclass
class GalleryRow:
    """关键帧画廊的一行。"""

    timestamp_display: str  # 如 "00:12"
    image_path: str
    scene_description: str = ""


@dataclass
class AVSynthesisContext:
    """渲染综合笔记所需的全部数据。"""

    title: str
    platform: str = ""
    author: str = ""
    duration_display: str = ""
    date_added: str = ""
    cover_path: str = "cover.jpg"
    summary: str = ""
    gallery_rows: list[GalleryRow] = field(default_factory=list)
    chapters: list[Chapter] = field(default_factory=list)
    full_transcript: str = ""
    final_synthesis: str = ""


def render_av_synthesis_md(
    ctx: AVSynthesisContext,
    template_name: str = "lecture.md.j2",
) -> str:
    """渲染综合笔记 Markdown 字符串。"""
    env = Environment(
        loader=FileSystemLoader(str(_TEMPLATE_DIR)),
        keep_trailing_newline=True,
    )
    template = env.get_template(template_name)
    return template.render(ctx=ctx)
