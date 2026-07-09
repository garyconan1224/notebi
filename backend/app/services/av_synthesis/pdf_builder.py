"""R20: PDF 导出 — Jinja2 HTML 模板 + playwright chromium 渲染。

图片以 base64 data URI 内嵌 HTML，避免文件路径问题。
playwright chromium 将 HTML 渲染为 A4 PDF。
"""

from __future__ import annotations

import base64
import io
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi.responses import StreamingResponse
from jinja2 import Environment, FileSystemLoader

_TEMPLATE_DIR = Path(__file__).parent / "templates"


def _image_to_data_uri(ws_root: Path, rel_path: str) -> str:
    """将相对路径图片转为 base64 data URI。找不到则返回空串。"""
    if not rel_path:
        return ""
    full = ws_root / rel_path.lstrip("./")
    if not full.exists():
        return ""
    mime = mimetypes.guess_type(str(full))[0] or "image/jpeg"
    data = full.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _prepare_template_ctx(notes: Any, ws_root: Path) -> dict:
    """将 ParsedNotes 转为 HTML 模板需要的上下文（图片→data URI）。"""
    gallery_rows = []
    for row in notes.gallery_rows:
        gallery_rows.append({
            "timestamp_display": row.timestamp_display,
            "image_data_uri": _image_to_data_uri(ws_root, row.image_path),
            "scene_description": row.scene_description,
        })

    chapters = []
    for ch in notes.chapters:
        chapters.append({
            "title": ch.title,
            "time_range": ch.time_range,
            "frame_data_uri": _image_to_data_uri(ws_root, ch.frame_path),
            "transcript_excerpt": ch.transcript_excerpt,
            "highlights": ch.highlights,
        })

    return {
        "title": notes.title,
        "platform": notes.platform,
        "author": notes.author,
        "duration_display": notes.duration_display,
        "date_added": notes.date_added,
        "cover_data_uri": _image_to_data_uri(ws_root, notes.cover_path),
        "summary": notes.summary,
        "gallery_rows": gallery_rows,
        "chapters": chapters,
        "full_transcript": notes.full_transcript,
        "final_synthesis": notes.final_synthesis,
    }


def build_pdf(notes: Any, ws_root: Path) -> StreamingResponse:
    """生成 PDF 并返回 StreamingResponse。"""
    ctx = _prepare_template_ctx(notes, ws_root)

    # 渲染 HTML
    env = Environment(loader=FileSystemLoader(str(_TEMPLATE_DIR)))
    template = env.get_template("lecture.html.j2")
    html = template.render(ctx=ctx)

    # playwright chromium → PDF
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="playwright 未安装，请运行: pip install playwright && playwright install chromium")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.set_content(html, wait_until="networkidle")
            pdf_bytes = page.pdf(format="A4", print_background=True, margin={
                "top": "20mm", "bottom": "20mm", "left": "16mm", "right": "16mm",
            })
            browser.close()
    except Exception as e:
        from fastapi import HTTPException
        msg = str(e)
        if "Executable doesn't exist" in msg or "chromium" in msg.lower():
            raise HTTPException(
                status_code=500,
                detail="PDF 渲染需要 chromium，请先运行: playwright install chromium",
            )
        raise HTTPException(status_code=500, detail=f"PDF 渲染失败: {msg}")

    from urllib.parse import quote
    safe_title = (notes.title or "笔记").replace("/", "_").replace("\\", "_")[:50]
    filename = f"{safe_title}.pdf"
    filename_star = f"UTF-8''{quote(filename)}"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*= {filename_star}",
        },
    )
