"""AV synthesis — 将关键帧 + 字幕对齐后渲染为教学笔记 Markdown。"""

from backend.app.services.av_synthesis.align import align_frames_to_transcript
from backend.app.services.av_synthesis.llm import llm_final_synthesis, llm_global_summary, llm_split_chapters
from backend.app.services.av_synthesis.loader import load_frames_manifest, load_transcript
from backend.app.services.av_synthesis.render import render_av_synthesis_md

__all__ = [
    "align_frames_to_transcript",
    "llm_final_synthesis",
    "llm_global_summary",
    "llm_split_chapters",
    "load_frames_manifest",
    "load_transcript",
    "render_av_synthesis_md",
]
