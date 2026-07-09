"""从 av_synthesis.md 提取结构化数据，供 PDF/DOCX 导出使用。

av_synthesis.md 由 lecture.md.j2 模板渲染，格式固定：
  # Title
  > platform · author · duration · date
  ![封面](cover.jpg)
  ## 全局摘要
  ...
  ## 关键帧画廊
  | 时刻 | 画面 | 场景描述 |
  |---|---|---|
  | 00:12 | ![](frames/001.jpg) | 描述 |
  ## 章节正文
  ### 1. 标题（00:00~01:20）
  ![](frames/002.jpg)
  > 转写摘选
  **重点**：要点
  ## 字幕原文
  <details>...</details>
  ## 最终综合
  ...
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class ParsedGalleryRow:
    timestamp_display: str
    image_path: str
    scene_description: str = ""


@dataclass
class ParsedChapter:
    title: str
    time_range: str
    frame_path: str = ""
    transcript_excerpt: str = ""
    highlights: str = ""


@dataclass
class ParsedNotes:
    """从 av_synthesis.md 解析出的结构化数据。"""
    title: str = ""
    platform: str = ""
    author: str = ""
    duration_display: str = ""
    date_added: str = ""
    cover_path: str = ""
    summary: str = ""
    gallery_rows: list[ParsedGalleryRow] = field(default_factory=list)
    chapters: list[ParsedChapter] = field(default_factory=list)
    full_transcript: str = ""
    final_synthesis: str = ""


def parse_av_synthesis_md(content: str) -> ParsedNotes:
    """从 av_synthesis.md 原文解析出结构化数据。"""
    notes = ParsedNotes()
    lines = content.split("\n")

    # ── 1. 标题（第一个 # 开头的行）────────────────
    for line in lines:
        if line.startswith("# ") and not line.startswith("## "):
            notes.title = line[2:].strip()
            break

    # ── 2. 元信息行（> platform · author · duration · date）──
    for line in lines:
        if line.startswith("> ") and "·" in line:
            parts = [p.strip() for p in line[2:].split("·")]
            if len(parts) >= 1:
                notes.platform = parts[0]
            if len(parts) >= 2:
                notes.author = parts[1]
            if len(parts) >= 3:
                notes.duration_display = parts[2]
            if len(parts) >= 4:
                notes.date_added = parts[3]
            break

    # ── 3. 封面图 ────────────────────────────────
    for line in lines:
        m = re.match(r"!\[.*?\]\((.+?)\)", line)
        if m and "cover" in m.group(1).lower():
            notes.cover_path = m.group(1)
            break

    # ── 分段处理 ─────────────────────────────────
    sections = _split_sections(lines)

    # ── 4. 全局摘要 ──────────────────────────────
    notes.summary = sections.get("全局摘要", "").strip()

    # ── 5. 关键帧画廊（表格）──────────────────────
    gallery_text = sections.get("关键帧画廊", "")
    notes.gallery_rows = _parse_gallery_table(gallery_text)

    # ── 6. 章节正文 ──────────────────────────────
    chapters_text = sections.get("章节正文", "")
    notes.chapters = _parse_chapters(chapters_text)

    # ── 7. 字幕原文 ──────────────────────────────
    transcript_text = sections.get("字幕原文", "")
    m = re.search(r"<details>\s*<summary>.*?</summary>\s*(.*?)\s*</details>", transcript_text, re.DOTALL)
    if m:
        notes.full_transcript = m.group(1).strip()

    # ── 8. 最终综合 ──────────────────────────────
    notes.final_synthesis = sections.get("最终综合", "").strip()

    return notes


def _split_sections(lines: list[str]) -> dict[str, str]:
    """按 ## 标题拆分文档为 {section_name: body} 字典。"""
    sections: dict[str, str] = {}
    current_name: str | None = None
    current_lines: list[str] = []

    for line in lines:
        m = re.match(r"^## (.+)$", line)
        if m:
            if current_name is not None:
                sections[current_name] = "\n".join(current_lines)
            current_name = m.group(1).strip()
            current_lines = []
        elif current_name is not None:
            current_lines.append(line)

    if current_name is not None:
        sections[current_name] = "\n".join(current_lines)

    return sections


def _parse_gallery_table(text: str) -> list[ParsedGalleryRow]:
    """解析关键帧画廊的 markdown 表格。"""
    rows: list[ParsedGalleryRow] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.split("|")[1:-1]]
        if len(cells) < 3:
            continue
        # 跳过分隔行
        if all(set(c) <= set("-: ") for c in cells):
            continue
        # 跳过表头
        if cells[0] == "时刻":
            continue

        image_path = ""
        img_match = re.search(r"!\[.*?\]\((.+?)\)", cells[1])
        if img_match:
            image_path = img_match.group(1)

        rows.append(ParsedGalleryRow(
            timestamp_display=cells[0],
            image_path=image_path,
            scene_description=cells[2],
        ))

    return rows


def _parse_chapters(text: str) -> list[ParsedChapter]:
    """解析章节正文（### N. 标题（时间范围））。"""
    chapters: list[ParsedChapter] = []
    # 按 ### 分割
    parts = re.split(r"(?=^### )", text, flags=re.MULTILINE)

    for part in parts:
        part = part.strip()
        if not part.startswith("### "):
            continue

        # 提取标题和时间范围
        header_match = re.match(r"### \d+\.\s*(.+?)（(.+?)）", part)
        if not header_match:
            continue

        title = header_match.group(1).strip()
        time_range = header_match.group(2).strip()
        body = part[header_match.end():].strip()

        # 提取帧图路径
        frame_path = ""
        img_match = re.search(r"!\[.*?\]\((.+?)\)", body)
        if img_match:
            frame_path = img_match.group(1)

        # 提取转写摘选（> 开头的行）
        transcript_lines = []
        for line in body.split("\n"):
            if line.startswith("> "):
                transcript_lines.append(line[2:])
        transcript_excerpt = "\n".join(transcript_lines).strip()

        # 提取重点
        highlights = ""
        hl_match = re.search(r"\*\*重点\*\*[:：]\s*(.+)", body)
        if hl_match:
            highlights = hl_match.group(1).strip()

        chapters.append(ParsedChapter(
            title=title,
            time_range=time_range,
            frame_path=frame_path,
            transcript_excerpt=transcript_excerpt,
            highlights=highlights,
        ))

    return chapters
