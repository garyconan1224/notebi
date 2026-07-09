"""R20: Obsidian Vault 导出 — zip 含 markdown + frames/。

纯 zipfile，无额外依赖。
markdown 含 YAML frontmatter + [[wiki链接]]。
"""

from __future__ import annotations

import io
import zipfile
from datetime import date
from pathlib import Path
from typing import Any

from fastapi.responses import StreamingResponse


def _build_obsidian_md(notes: Any) -> str:
    """构建 Obsidian 风格 markdown（含 YAML frontmatter + wiki 链接）。"""
    lines: list[str] = []

    # YAML frontmatter
    lines.append("---")
    safe_title_yaml = (notes.title or "").replace('"', '\\"')
    lines.append(f'title: "{safe_title_yaml}"')
    if notes.date_added:
        lines.append(f"created: {notes.date_added}")
    else:
        lines.append(f"created: {date.today().isoformat()}")
    lines.append("tags:")
    lines.append("  - nibi")
    lines.append("  - av-synthesis")
    if notes.platform:
        lines.append(f"  - {notes.platform}")
    lines.append("---")
    lines.append("")

    # 标题
    lines.append(f"# {notes.title}")
    lines.append("")

    # 元信息
    meta_parts = []
    if notes.platform:
        meta_parts.append(notes.platform)
    if notes.author:
        meta_parts.append(notes.author)
    if notes.duration_display:
        meta_parts.append(notes.duration_display)
    if meta_parts:
        lines.append(f"> {' · '.join(meta_parts)}")
        lines.append("")

    # 封面
    if notes.cover_path:
        lines.append(f"![[{notes.cover_path}]]")
        lines.append("")

    # 全局摘要
    lines.append("## 全局摘要")
    lines.append("")
    if notes.summary:
        lines.append(notes.summary)
        lines.append("")

    # 关键帧画廊
    if notes.gallery_rows:
        lines.append("## 关键帧画廊")
        lines.append("")
        lines.append("| 时刻 | 画面 | 场景描述 |")
        lines.append("|---|---|---|")
        for row in notes.gallery_rows:
            img = f"![[{row.image_path}]]" if row.image_path else "-"
            lines.append(f"| {row.timestamp_display} | {img} | {row.scene_description} |")
        lines.append("")

    # 章节正文
    if notes.chapters:
        lines.append("## 章节正文")
        lines.append("")
        for i, ch in enumerate(notes.chapters, 1):
            lines.append(f"### {i}. {ch.title}（{ch.time_range}）")
            lines.append("")
            if ch.frame_path:
                lines.append(f"![[{ch.frame_path}]]")
                lines.append("")
            if ch.transcript_excerpt:
                lines.append(f"> {ch.transcript_excerpt}")
                lines.append("")
            if ch.highlights:
                lines.append(f"**重点**：{ch.highlights}")
                lines.append("")

    # 字幕原文
    if notes.full_transcript:
        lines.append("## 字幕原文")
        lines.append("")
        lines.append("```")
        lines.append(notes.full_transcript)
        lines.append("```")
        lines.append("")

    # 最终综合
    if notes.final_synthesis:
        lines.append("## 最终综合")
        lines.append("")
        lines.append(notes.final_synthesis)
        lines.append("")

    return "\n".join(lines)


def build_obsidian_zip(notes: Any, ws_root: Path) -> StreamingResponse:
    """生成 Obsidian Vault zip：笔记.md + frames/ 帧图目录。"""
    md_content = _build_obsidian_md(notes)

    # 收集所有需要打包的图片路径
    image_paths: set[str] = set()
    if notes.cover_path:
        image_paths.add(notes.cover_path.lstrip("./"))
    for row in notes.gallery_rows:
        if row.image_path:
            image_paths.add(row.image_path.lstrip("./"))
    for ch in notes.chapters:
        if ch.frame_path:
            image_paths.add(ch.frame_path.lstrip("./"))

    # 构建 zip
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 笔记 markdown
        safe_title = (notes.title or "笔记").replace("/", "_").replace("\\", "_")[:50]
        zf.writestr(f"{safe_title}.md", md_content)

        # 帧图
        for img_rel in sorted(image_paths):
            img_full = ws_root / img_rel
            if img_full.exists():
                zf.write(img_full, img_rel)

    buf.seek(0)
    from urllib.parse import quote
    filename = f"{safe_title}_obsidian.zip"
    filename_star = f"UTF-8''{quote(filename)}"

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*= {filename_star}",
        },
    )
