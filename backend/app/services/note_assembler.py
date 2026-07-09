"""Note Assembler — R0.1 核心（纯函数 + 落盘，不接任何现有流程）。

把 WorkspaceItem（results / tags / summaries）按 schema v1 序列化成
source.md + note.md（frontmatter + 正文）+ summaries/<template>/v<n>.md，
落盘到 <workspace_root>/notes/<item_id>/，assets/ 建空目录占位。

不调 LLM、不改 summary/RAG/导出/现有结果页。
组装失败 best-effort（try/except + 日志），绝不阻断 item 分析主流程。
"""

from __future__ import annotations

import json
import logging
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml  # PyYAML，项目已有依赖

from backend.app.models.workspace import ItemSummary, WorkspaceItem
from shared.config import DATA_DIR, get_workspace_root

logger = logging.getLogger(__name__)


def _fmt_ts_short(sec: float) -> str:
    """秒 → 'MM:SS' 时间码。"""
    total = max(0, int(sec))
    m, s = divmod(total, 60)
    return f"{m:02d}:{s:02d}"


def normalize_transcript(raw: Any) -> List[Dict[str, Any]]:
    """把任意 transcript 形态统一规范成前端要的 [{t_sec, t_str, text, speaker?}]。

    兼容三种格式：
      - [{start, end, text}]（transcriber 段格式）→ start 映射成 t_sec
      - [{t_sec, t_str, text}]（已规范，含落盘 transcript.json）→ 原样保留
      - 纯字符串 → 单行 t_sec=0

    VN5：若 segment 含 speaker（diarization 跑过、assign_speakers_to_segments 写回），
    透传 speaker 字段供前端「说话人模式」；无 speaker 则不带该键（条件式 UI）。
    """
    if isinstance(raw, str):
        text = raw.strip()
        return [{"t_sec": 0.0, "t_str": "00:00", "text": text}] if text else []
    if not isinstance(raw, list):
        return []
    lines: List[Dict[str, Any]] = []
    for seg in raw:
        if not isinstance(seg, dict):
            continue
        # edited_text 优先（R2：字幕编辑后三处一致生效的显示层）
        text = str(seg.get("edited_text") or seg.get("text", "")).strip()
        if not text:
            continue
        if "t_sec" in seg:
            t_sec = float(seg.get("t_sec") or 0)
            t_str = str(seg.get("t_str") or _fmt_ts_short(t_sec))
        else:
            # transcriber 段格式：start/end
            t_sec = float(seg.get("start") or 0)
            t_str = _fmt_ts_short(t_sec)
        line: Dict[str, Any] = {"t_sec": t_sec, "t_str": t_str, "text": text}
        speaker = seg.get("speaker")
        if speaker:
            line["speaker"] = str(speaker)
        lines.append(line)
    return lines


def extract_transcript_from_results(results: Dict[str, Any]) -> List[Dict[str, Any]]:
    """从 results 取 transcript（segments 优先），规范成 [{t_sec, t_str, text}]。"""
    raw = results.get("transcript_segments") or results.get("transcript") or []
    return normalize_transcript(raw)

# ── 常量 ──────────────────────────────────────────────────────────
_SCHEMA_VERSION = 1
_NOTE_VERSION = 1  # R0 固定 1，R2 起递增


# ── 公共路径 ──────────────────────────────────────────────────────
def note_dir(workspace_id: str, item_id: str) -> Path:
    """返回 <workspace_root>/notes/<item_id>/ 的绝对路径（不创建）。"""
    return get_workspace_root(workspace_id) / "notes" / item_id


def _to_static_url(path: str) -> str:
    """本地绝对路径 → /static/... URL（与 summary_generator._to_static_url 同逻辑）。

    兼容规则：
    - /static/...：原样返回
    - DATA_DIR 下绝对路径：转 /static/...
    - 普通相对路径或外部 URL：返回原始 path（不吞掉）
    """
    if not path:
        return ""
    if path.startswith("/static/"):
        return path
    try:
        p = Path(path).resolve()
        data_resolved = DATA_DIR.resolve()
        if str(p).startswith(str(data_resolved)):
            rel = p.relative_to(data_resolved)
            return f"/static/{rel.as_posix()}"
    except (ValueError, OSError):
        pass
    return path


# ── frontmatter ──────────────────────────────────────────────────
def build_frontmatter(item: WorkspaceItem, workspace_id: str) -> Dict[str, Any]:
    """按 §3.4 schema v1 构建 frontmatter dict（不含 YAML 序列化）。"""

    # media 尽力从 results 提取，拿不到留空
    media: Dict[str, Any] = {}
    results = item.results or {}
    item_type = item.type

    if item_type == "image":
        # 优先用 results["images"]（本地路径列表），转为 /static/ URL；兜底 image_path
        raw_images = results.get("images", [])
        if raw_images:
            media["images"] = [_to_static_url(p) for p in raw_images]
        else:
            img_path = results.get("image_path", "")
            media["images"] = [_to_static_url(img_path)] if img_path else []
        # image_infos 直接透传（内含 static_url，由后端 pipeline 写入）
        if results.get("image_infos"):
            media["image_infos"] = results["image_infos"]
    elif item_type == "video":
        video_url = results.get("video_file") or results.get("video_url") or ""
        duration = results.get("duration")
        if video_url or duration is not None:
            media["video"] = {}
            if video_url:
                media["video"]["url"] = video_url
            if duration is not None:
                media["video"]["duration"] = duration
        frames = results.get("frames", [])
        if frames:
            media["frames"] = [
                {"sec": f.get("sec", 0), "path": f.get("image_path") or f.get("frame_image_path") or ""}
                for f in frames
                if isinstance(f, dict)
            ]
    elif item_type == "audio":
        audio_path = results.get("audio_path", "")
        if audio_path:
            media["audio"] = audio_path

    # layers：记录各层相对路径
    summaries_paths = [
        f"summaries/{s.template}/v{s.version}.md"
        for s in (item.summaries or [])
    ]
    layers: Dict[str, Any] = {
        "source": "source.md",
        "note": "note.md",
        "summaries": summaries_paths,
    }

    # source_url：仅当 source == "url" 时填充
    source_url = ""
    if (item.source or "") == "url":
        source_url = item.source_value or ""

    # tags：直接序列化 item.tags
    tags = item.tags if isinstance(item.tags, dict) else {}

    return {
        "schema_version": _SCHEMA_VERSION,
        "id": item.item_id,
        "workspace_id": workspace_id,
        "type": item_type,
        "title": item.name or "",
        "source_url": source_url,
        "created_at": item.created_at or "",
        "tags": tags,
        "media": media,
        "layers": layers,
        "exports": {"html": "note.html"},  # R5 才真正生成，R0 仅占位
        "version": _NOTE_VERSION,
    }


# ── source.md / note.md 正文 ─────────────────────────────────────
def _build_body(item: WorkspaceItem) -> str:
    """按 item.type 取 results 中的主体文本，返回 markdown 正文。

    text    = content（纯文本内容）
    audio   = transcript 可读拼接 + transcript_segments 拼接
    video   = transcript 可读拼接（segments 或 frames 带 transcript 字段）
    image   = ocr_text / description
    """
    results = item.results or {}
    item_type = item.type

    if item_type == "text":
        # NI.1: note task 产出 results["markdown"]，优先使用
        return results.get("markdown") or results.get("content", "") or results.get("summary", "")

    if item_type in ("audio", "video"):
        # 优先用 transcript_segments（含 edited_text 优先，R2 字幕编辑同步），
        # 再兜底 transcript（str 或 list），最后 summary
        segments = results.get("transcript_segments")
        if isinstance(segments, list) and segments:
            lines = []
            for seg in segments:
                if isinstance(seg, dict):
                    start = seg.get("start", "")
                    text = str(seg.get("edited_text") or seg.get("text", ""))
                    if start != "":
                        lines.append(f"**[{_fmt_ts_short(float(start))}]** {text}")
                    else:
                        lines.append(text)
            joined = "\n\n".join(lines)
            if joined.strip():
                return joined
        # 兜底：transcript（str 或 list）
        transcript = results.get("transcript")
        if isinstance(transcript, str) and transcript.strip():
            return transcript
        if isinstance(transcript, list) and transcript:
            lines = []
            for seg in transcript:
                if isinstance(seg, dict):
                    text = str(seg.get("edited_text") or seg.get("text", ""))
                    start = seg.get("start", "")
                    if start != "":
                        lines.append(f"**[{_fmt_ts_short(float(start))}]** {text}")
                    else:
                        lines.append(text)
                elif isinstance(seg, str):
                    lines.append(seg)
            joined = "\n\n".join(lines)
            if joined.strip():
                return joined
            joined = "\n\n".join(lines)
            if joined.strip():
                return joined
        # 最终兜底：summary
        return results.get("summary", "")

    if item_type == "image":
        # R3.5: note_body 优先（学习笔记），由 build_note_md 处理；
        # 此处用于 source.md，优先取原始文本（source_md_raw），不受图文混排合成覆盖。
        source_raw = results.get("source_md_raw", "")
        if source_raw:
            return source_raw
        # NI.1: note task 产出 results["markdown"]（含图集描述），优先使用
        md = results.get("markdown", "")
        if md:
            return md
        parts = []
        ocr = results.get("ocr_text", "")
        if ocr:
            parts.append("## OCR 文本\n\n" + ocr)
        desc = results.get("description", "")
        if desc:
            parts.append("## 图片描述\n\n" + desc)
        return "\n\n".join(parts) if parts else ""

    return ""


def _looks_like_markdown_heading(text: str) -> bool:
    stripped = text.lstrip()
    return stripped.startswith("# ") or stripped.startswith("## ") or stripped.startswith("### ")


def _build_audio_note_body(item: WorkspaceItem) -> str:
    """音频主笔记优先展示 AI 总结；逐字稿留在 source.md / 字幕区。"""
    results = item.results or {}
    summary = results.get("note_body") or results.get("summary") or results.get("llm_summary") or ""
    if isinstance(summary, str) and summary.strip():
        body = summary.strip()
        if _looks_like_markdown_heading(body):
            return body
        return f"## AI 总结\n\n{body}"
    transcript_body = _build_body(item).strip()
    if transcript_body:
        return f"## 转写正文\n\n{transcript_body}"
    return ""


def build_source_md(item: WorkspaceItem) -> str:
    """生成 source.md 内容（原始依据）。"""
    body = _build_body(item)
    # R2：视频类型加「视频信息」头（链接/标题/作者/时长/发布日 + 简介）
    if item.type == "video":
        results = item.results or {}
        source_url = item.source_value or ""
        title = results.get("video_title", "")
        author = results.get("video_uploader", "")
        duration = results.get("video_duration", "")
        upload_date = results.get("video_upload_date", "")
        description = results.get("video_description", "")
        # 格式化时长（秒 → mm:ss 或 hh:mm:ss）
        duration_str = ""
        if duration:
            try:
                secs = int(float(duration))
                if secs >= 3600:
                    duration_str = f"{secs // 3600}:{(secs % 3600) // 60:02d}:{secs % 60:02d}"
                else:
                    duration_str = f"{secs // 60}:{secs % 60:02d}"
            except (ValueError, TypeError):
                duration_str = str(duration)
        header_lines = ["## 视频信息", ""]
        if source_url:
            header_lines.append(f"- 链接：{source_url}")
        if title:
            header_lines.append(f"- 标题：{title}")
        if author:
            header_lines.append(f"- 作者：{author}")
        time_parts = []
        if duration_str:
            time_parts.append(f"时长：{duration_str}")
        if upload_date:
            time_parts.append(f"发布：{upload_date}")
        if time_parts:
            header_lines.append(f"- {' / '.join(time_parts)}")
        if description:
            header_lines.append("")
            # 截断过长简介
            desc_short = description[:500]
            if len(description) > 500:
                desc_short += "…"
            header_lines.append(f"> {desc_short}")
        header_lines.extend(["", "## 转写正文", ""])
        body = "\n".join(header_lines) + body

        # R3.9/R3.18: 画面分析段追加在转写正文之后（视频信息 → 转写正文 → 画面分析）。
        # R3.18: 图文化 — 逐帧加截图 ![]() + 价值闸门 + 相邻去重 + 上限保护，让
        #        source.md 成为「图文并列的画面库」（对齐用户「文字带图片」诉求）。
        #        复用 summary_generator 的找图/闸门/去重逻辑，保持与富文本配图一致。
        from backend.app.services.summary_generator import (
            _find_frame_image,
            _frames_too_similar,
            _is_low_value_frame,
            _to_static_url,
        )
        json_outputs = results.get("json_outputs", []) or []
        visual_parts: list[str] = []
        for jp_str in json_outputs:
            try:
                jp = Path(jp_str)
                if not jp.exists():
                    continue
                vdata = json.loads(jp.read_text(encoding="utf-8"))
                gvs = str(vdata.get("global_visual_summary") or "").strip()
                raw_frames = vdata.get("frames") or []
                if not gvs and not raw_frames:
                    continue
                visual_parts.append("## 画面分析")
                visual_parts.append("")
                if gvs:
                    visual_parts.append("### 全局概览")
                    visual_parts.append("")
                    visual_parts.append(gvs)
                    visual_parts.append("")
                if raw_frames:
                    visual_parts.append("### 逐帧画面")
                    visual_parts.append("")
                    prev_desc = ""
                    shown = 0
                    for i, fr in enumerate(raw_frames):
                        if shown >= 60:  # 上限保护（视频可能数百帧）
                            break
                        ts = str(fr.get("timestamp") or "")
                        content = str(
                            fr.get("content_zh") or fr.get("description_zh") or ""
                        ).strip()
                        # 价值闸门：滤纯色过渡/黑屏/极短描述
                        if not content or _is_low_value_frame(content):
                            continue
                        # 相邻去重：连续相似画面只留一张
                        if prev_desc and _frames_too_similar(content, prev_desc):
                            continue
                        prev_desc = content
                        visual_parts.append(f"**[{ts}]** {content}")
                        visual_parts.append("")
                        img_url = _to_static_url(_find_frame_image(str(jp), i))
                        if img_url:
                            safe_url = urllib.parse.quote(img_url, safe="/:")
                            safe_alt = content[:60].replace("[", "\\[").replace("]", "\\]").replace("\n", " ").replace("\r", " ")
                            visual_parts.append(f"![{safe_alt}]({safe_url})")
                            visual_parts.append("")
                        shown += 1
            except Exception:
                continue
        if visual_parts:
            body += "\n\n" + "\n".join(visual_parts)

    return body


def build_note_md(item: WorkspaceItem, frontmatter: Dict[str, Any]) -> str:
    """生成 note.md = YAML frontmatter + 正文（含 LLM 摘要）。

    R3.5: 若 results 含 note_body（pipeline 自动生成的 standard 总结），
    直接用作全文正文；否则走旧逻辑（摘要 + 转写）。
    """
    fm_yaml = yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False, sort_keys=False)

    results = item.results or {}

    # 图文笔记主笔记需要可读总结，也需要保留图文混排语境；否则 NoteShell
    # 所见即所得只像原文摘录，看不到图片如何参与笔记。
    if item.type == "image" and results.get("note_kind") == "image_text":
        note_body = results.get("note_body", "")
        composed_md = results.get("markdown", "")
        sections: List[str] = []
        if isinstance(note_body, str) and note_body.strip():
            sections.append(note_body.strip())
        if isinstance(composed_md, str) and composed_md.strip():
            composed = composed_md.strip()
            if composed not in sections:
                if sections:
                    sections.append(f"---\n\n## 图文语境\n\n{composed}")
                else:
                    sections.append(composed)
        if sections:
            return f"---\n{fm_yaml}---\n\n" + "\n\n".join(sections)

    # R3.5 优先：note_body = pipeline 自动生成的 standard 总结
    note_body = (item.results or {}).get("note_body", "")
    if note_body and isinstance(note_body, str) and note_body.strip():
        # R26: 当存在 X 帖子正文时，将其作为前置背景拼入 note.md
        tweet_text = (item.results or {}).get("tweet_text", "")
        body = note_body.strip()
        if isinstance(tweet_text, str) and tweet_text.strip():
            body = f"## 原帖背景\n\n{tweet_text.strip()}\n\n---\n\n{body}"
        return f"---\n{fm_yaml}---\n\n{body}"

    if item.type == "audio":
        body = _build_audio_note_body(item)
        return f"---\n{fm_yaml}---\n\n{body}"

    # 兜底：旧逻辑（摘要 + 转写正文）
    body = _build_body(item)
    summary = (item.results or {}).get("llm_summary", "")
    if summary and isinstance(summary, str) and summary.strip():
        body = f"## 摘要\n\n{summary.strip()}\n\n---\n\n{body}"
    return f"---\n{fm_yaml}---\n\n{body}"


# ── summaries 序列化 ─────────────────────────────────────────────
def serialize_summaries(
    item: WorkspaceItem,
    item_note_dir: Path,
) -> List[Path]:
    """把 item.summaries 逐条写成 summaries/<template>/v<n>.md，返回文件路径列表。"""
    written: List[Path] = []
    for summary in item.summaries or []:
        subdir = item_note_dir / "summaries" / summary.template
        subdir.mkdir(parents=True, exist_ok=True)
        path = subdir / f"v{summary.version}.md"
        path.write_text(summary.content_md or "", encoding="utf-8")
        written.append(path)
    return written


# ── 主组装函数 ────────────────────────────────────────────────────
def assemble_item_note(
    workspace_id: str,
    item_id: str,
    *,
    overwrite: bool = True,
    _item: Optional[WorkspaceItem] = None,
) -> Dict[str, Any]:
    """组装 + 落盘，返回各路径。

    参数：
        workspace_id: 工作空间 ID
        item_id: 素材 ID
        overwrite: True 时覆盖已有文件；False 时若 note.md 已存在则跳过
        _item: 测试注入用；生产环境通过 WorkspaceStore 查找（R0.2 接入）

    返回：
        {
            "note_dir": str,      # 目录绝对路径
            "note_md": str,       # note.md 路径
            "source_md": str,     # source.md 路径
            "summaries": [str],   # summaries/*.md 路径列表
            "skipped": bool,      # 是否因 overwrite=False 跳过
        }

    best-effort：任何异常只记日志，不向上抛。
    """
    try:
        return _assemble_inner(workspace_id, item_id, overwrite=overwrite, _item=_item)
    except Exception:
        logger.exception(
            "note_assembler: assemble_item_note 失败 ws=%s item=%s（best-effort，不阻断主流程）",
            workspace_id,
            item_id,
        )
        return {
            "note_dir": "",
            "note_md": "",
            "source_md": "",
            "summaries": [],
            "skipped": False,
            "error": True,
        }


def _assemble_inner(
    workspace_id: str,
    item_id: str,
    *,
    overwrite: bool,
    _item: Optional[WorkspaceItem],
) -> Dict[str, Any]:
    item = _item  # R0.2 接 WorkspaceStore 查找
    if item is None:
        raise ValueError(
            "assemble_item_note: _item 参数未传（R0.2 接入 WorkspaceStore 前必须显式传入）"
        )

    nd = note_dir(workspace_id, item_id)
    note_path = nd / "note.md"

    # 幂等：不覆盖时若 note.md 已存在，直接返回
    if not overwrite and note_path.exists():
        return {
            "note_dir": str(nd),
            "note_md": str(note_path),
            "source_md": str(nd / "source.md"),
            "summaries": [str(p) for p in nd.glob("summaries/**/*.md")],
            "skipped": True,
        }

    # 创建目录结构
    nd.mkdir(parents=True, exist_ok=True)
    (nd / "assets").mkdir(exist_ok=True)

    # build
    fm = build_frontmatter(item, workspace_id)
    source_content = build_source_md(item)
    note_content = build_note_md(item, fm)

    # 写文件
    source_path = nd / "source.md"
    source_path.write_text(source_content, encoding="utf-8")
    note_path.write_text(note_content, encoding="utf-8")

    # 持久化带时间码的字幕（修复"内存才有、重启即丢"——note 接口会优先读它兜底）
    try:
        segs = extract_transcript_from_results(item.results or {})
        # 只在拿到真实时间码（非单行 t_sec=0 的纯文本降级）时才落盘，避免覆盖更好的数据
        has_timed = any(float(s.get("t_sec") or 0) > 0 for s in segs)
        if segs and (has_timed or not (nd / "transcript.json").exists()):
            (nd / "transcript.json").write_text(
                json.dumps(segs, ensure_ascii=False), encoding="utf-8"
            )
    except Exception:
        logger.warning("note_assembler: 写 transcript.json 失败（best-effort）", exc_info=True)

    # summaries
    written = serialize_summaries(item, nd)

    return {
        "note_dir": str(nd),
        "note_md": str(note_path),
        "source_md": str(source_path),
        "summaries": [str(p) for p in written],
        "skipped": False,
    }
