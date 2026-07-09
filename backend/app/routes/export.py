from __future__ import annotations

"""Phase 1I — 复刻工作包 zip 导出（最简版）。

接口（挂在 /workspaces prefix 下）:
- GET /{workspace_id}/items/{item_id}/export  返回 application/zip

MVP 只导 4 样东西：
  reference_frames/   帧截图（真图片或占位 .txt）
  prompts.json        提示词数据
  subtitles.srt       字幕文件（视频有，图片空）
  README.md           使用说明
"""

import io
import json
import zipfile
from datetime import date, datetime
from typing import Any, Dict, List
from urllib.parse import quote

from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from shared.audio_analyzer import export_srt, export_vtt, export_ass
from backend.app.models.workspace import ItemType, WorkspaceItem, WorkspaceRecord
from backend.app.services.video_result_demo import build_demo_video_result
from backend.app.routes.workspaces import _store, _sync_item_with_tasks
from backend.app.routes.pipeline import _runner as _pipeline_runner
from shared.config import get_workspace_root

router = APIRouter(prefix="/workspaces", tags=["export"])


def _find_item(rec: WorkspaceRecord, item_id: str) -> WorkspaceItem:
    target = next((it for it in rec.items if it.item_id == item_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"item not found: {item_id}")
    return target


def _video_result_has_real_data(results: Dict[str, Any]) -> bool:
    if not isinstance(results, dict):
        return False
    frames = results.get("frames")
    transcript = results.get("transcript")
    return bool(frames) and isinstance(frames, list) and isinstance(transcript, list)


def _get_video_data(item: WorkspaceItem) -> Dict[str, Any]:
    """获取视频结果数据（真数据或 demo fixture）。"""
    if _video_result_has_real_data(item.results):
        payload = dict(item.results)
        payload.setdefault("source", "item_results")
        return payload
    return build_demo_video_result(item.item_id, item.name)


def _get_image_data(item: WorkspaceItem) -> Dict[str, Any]:
    """获取图片结果数据（真数据或 demo fixture）。"""
    results = item.results or {}
    has_real = isinstance(results, dict) and results.get("description") and results.get("prompts")
    if has_real:
        payload = dict(results)
        payload.setdefault("source", "item_results")
        return payload
    # 简单 demo fixture
    return {
        "source": "demo_fixture",
        "image": {"item_id": item.item_id, "title": item.name, "image_url": ""},
        "description": "（示例）图片内容描述",
        "ocr_text": "",
        "exif": {"time": "", "location": ""},
        "prompts": {"mj": "", "sd": {"positive": "", "negative": ""}, "json": ""},
        "tags": {},
    }


def _get_audio_data(item: WorkspaceItem) -> Dict[str, Any]:
    """获取音频结果数据（真数据或 demo 提示）。"""
    results = item.results or {}
    has_real = isinstance(results, dict) and (results.get("transcript") or results.get("summary"))
    if has_real:
        payload = dict(results)
        payload.setdefault("source", "item_results")
        # 统一字段名：transcript_segments → segments
        if "transcript_segments" in payload and "segments" not in payload:
            payload["segments"] = payload["transcript_segments"]
        return payload
    return {
        "source": "demo_hint",
        "transcript": "",
        "summary": "（示例）尚未完成音频分析，请先对本条音频执行分析任务。",
        "segments": [],
    }


def _get_text_data(item: WorkspaceItem) -> Dict[str, Any]:
    """获取文本结果数据（真数据或 demo 提示）。"""
    results = item.results or {}
    has_real = isinstance(results, dict) and (results.get("content") or results.get("markdown") or results.get("summary"))
    if has_real:
        payload = dict(results)
        payload.setdefault("source", "item_results")
        return payload
    return {
        "source": "demo_hint",
        "markdown": "",
        "summary": "（示例）尚未完成文本分析，请先对本条文本执行分析任务。",
        "title": item.name,
    }


def _build_transcript_txt(transcript: Any) -> str:
    """把 transcript 转为纯文本字幕。

    transcript 可以是字符串（直接返回）或列表（每行带时间戳）。
    """
    if isinstance(transcript, str):
        return transcript
    lines: list[str] = []
    for entry in transcript:
        t_sec = entry.get("t_sec", 0)
        text = entry.get("edited_text") or entry.get("text") or ""
        m, s = divmod(int(t_sec), 60)
        lines.append(f"[{m:02d}:{s:02d}] {text}")
    return "\n".join(lines)


def _build_srt(transcript: List[Dict[str, Any]]) -> str:
    """把 transcript 列表转为 SRT 格式字符串。"""
    lines: list[str] = []
    for i, entry in enumerate(transcript, start=1):
        t_sec = entry.get("t_sec", 0)
        text = entry.get("edited_text") or entry.get("text") or ""
        # SRT 时间格式: HH:MM:SS,mmm --> HH:MM:SS,mmm
        h = t_sec // 3600
        m = (t_sec % 3600) // 60
        s = t_sec % 60
        start_ts = f"{h:02d}:{m:02d}:{s:02d},000"
        # 结束时间 = 开始 + 3 秒（粗略）
        end_sec = t_sec + 3
        eh = end_sec // 3600
        em = (end_sec % 3600) // 60
        es = end_sec % 60
        end_ts = f"{eh:02d}:{em:02d}:{es:02d},000"
        lines.append(f"{i}\n{start_ts} --> {end_ts}\n{text}\n")
    return "\n".join(lines)


def _sanitize_zip_prefix(name: str) -> str:
    """清洗 zip 子目录名，防止 path traversal（如 ../escape）。"""
    # 只保留文件名部分，去掉任何路径分隔符
    name = name.replace("\\", "/")
    parts = [p for p in name.split("/") if p and p != ".."]
    safe = parts[-1] if parts else "unnamed"
    # 去掉前导点号（防止隐藏文件）
    safe = safe.lstrip(".")
    return safe or "unnamed"


def _build_prompts_json_video(frames: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """从视频帧提取提示词数据。"""
    out: list[Dict[str, Any]] = []
    for f in frames:
        out.append({
            "idx": f.get("idx"),
            "ts": f.get("ts", ""),
            "shot_type": f.get("shot_type", ""),
            "title": f.get("title", ""),
            "prompt_mj": f.get("prompt_mj", ""),
            "prompt_sd": f.get("prompt_sd", {}),
            "prompt_video": f.get("prompt_video", ""),
        })
    return out


def _build_prompts_json_image(data: Dict[str, Any]) -> Dict[str, Any]:
    """从图片结果提取提示词数据。"""
    return {
        "title": data.get("image", {}).get("title", ""),
        "description": data.get("description", ""),
        "prompt_mj": data.get("prompts", {}).get("mj", ""),
        "prompt_sd": data.get("prompts", {}).get("sd", {}),
        "tags": data.get("tags", {}),
    }


def _build_prompts_json_audio(data: Dict[str, Any]) -> Dict[str, Any]:
    """从音频结果提取 prompts 数据。"""
    return {
        "summary": data.get("summary", ""),
        "segments_count": len(data.get("segments", [])),
    }


def _build_prompts_json_text(data: Dict[str, Any]) -> Dict[str, Any]:
    """从文本结果提取 prompts 数据。"""
    return {
        "title": data.get("title", ""),
        "summary": data.get("summary", ""),
        "prompts": data.get("prompts", {}),
    }


def _build_readme(title: str, item_type: str) -> str:
    if item_type == "音频":
        return f"""# 复刻工作包

## 基本信息
- 素材名称：{title}
- 素材类型：音频
- 导出日期：{date.today().isoformat()}

## 包内文件说明

### transcript.txt
纯文本字幕，按时间顺序排列。

### summary.md
音频内容摘要。

### segments.json
带时间戳的分段数据，可用于：
- 定位特定片段
- 按章节浏览内容

### prompts.json
元数据信息（摘要、分段数等）。

## 使用建议
1. 先看 summary.md 了解整体内容
2. 用 segments.json 定位感兴趣的片段
3. 结合 transcript.txt 做进一步编辑

---
由 Nibi 自动生成
"""
    if item_type == "文本":
        return f"""# 复刻工作包

## 基本信息
- 素材名称：{title}
- 素材类型：文本
- 导出日期：{date.today().isoformat()}

## 包内文件说明

### source.md
原始文本内容。

### summary.md
文本内容摘要。

### prompts.json
分析结果元数据（标题、摘要、提示词等）。

## 使用建议
1. 先看 summary.md 了解整体内容
2. 需要原文时查阅 source.md
3. 根据 prompts.json 中的提示词进行二次创作

---
由 Nibi 自动生成
"""
    return f"""# 复刻工作包

## 基本信息
- 素材名称：{title}
- 素材类型：{item_type}
- 导出日期：{date.today().isoformat()}

## 包内文件说明

### reference_frames/
参考帧截图。每张图片的文件名包含时间戳和镜头类型，可用于：
- 作为 AI 图片/视频生成的参考图
- 分析构图、光影、色调

### prompts.json
所有提示词数据，按时间顺序排列。包含：
- `prompt_mj`：Midjourney 格式提示词
- `prompt_sd`：Stable Diffusion 格式（positive + negative）
- `prompt_video`：视频生成提示词（仅视频素材）

### subtitles.srt
字幕文件（SRT 格式），仅视频素材包含内容。
可导入剪辑软件用于字幕对齐。

## 使用建议
1. 先浏览 reference_frames/ 找到你喜欢的镜头
2. 打开 prompts.json 查看对应提示词
3. 将提示词粘贴到 Midjourney / Stable Diffusion / 可灵等工具中生成
4. 根据需要微调提示词中的关键词

---
由 Nibi 自动生成
"""


@router.get("/{workspace_id}/items/{item_id}/export")
def export_workspace_item(workspace_id: str, item_id: str) -> StreamingResponse:
    """导出复刻工作包 zip（Phase 1I 最简版）。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    # 同步 task 产物到 item.results（X.1 状态桥拉模式）
    overlay = _sync_item_with_tasks(item)
    if overlay and overlay.get("results") and not item.results:
        item.results = overlay["results"]

    item_type = item.type

    # 获取结果数据
    if item_type == ItemType.VIDEO.value:
        data = _get_video_data(item)
        frames = data.get("frames", [])
        transcript = data.get("transcript", [])
        title = data.get("video", {}).get("title", item.name)
        prompts_data: Any = _build_prompts_json_video(frames)
        srt_content = _build_srt(transcript)
    elif item_type == ItemType.IMAGE.value:
        data = _get_image_data(item)
        frames = []
        transcript = []
        title = data.get("image", {}).get("title", item.name)
        prompts_data = _build_prompts_json_image(data)
        srt_content = ""
    elif item_type == ItemType.AUDIO.value:
        data = _get_audio_data(item)
        frames = []
        transcript = data.get("transcript", [])
        title = item.name
        prompts_data = _build_prompts_json_audio(data)
        srt_content = ""
    elif item_type == ItemType.TEXT.value:
        data = _get_text_data(item)
        frames = []
        transcript = []
        title = data.get("title", item.name) or item.name
        prompts_data = _build_prompts_json_text(data)
        srt_content = ""
    else:
        raise HTTPException(
            status_code=400,
            detail=f"item type {item_type!r} not supported for export",
        )

    # 在内存中构建 zip
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if item_type == ItemType.VIDEO.value:
            # video: reference_frames/
            if frames:
                for f in frames:
                    ts = f.get("ts", "00-00").replace(":", "-")
                    shot = f.get("shot_type", "frame")
                    fname = f"reference_frames/frame_{ts}_{shot}.txt"
                    content = (
                        f"镜头: {f.get('title', '')}\n"
                        f"时间: {f.get('ts', '')}\n"
                        f"类型: {f.get('shot_type', '')}\n"
                        f"描述: {f.get('description', '')}\n"
                        f"\nMidjourney 提示词:\n{f.get('prompt_mj', '')}\n"
                    )
                    zf.writestr(fname, content)
            zf.writestr("subtitles.srt", srt_content)
            zf.writestr("prompts.json", json.dumps(prompts_data, ensure_ascii=False, indent=2))

        elif item_type == ItemType.IMAGE.value:
            # image: reference_frames/ + subtitles.srt（空）
            img_url = data.get("image", {}).get("image_url", "")
            zf.writestr(
                "reference_frames/source_image.txt",
                f"原始图片 URL: {img_url}\n标题: {title}\n",
            )
            zf.writestr("prompts.json", json.dumps(prompts_data, ensure_ascii=False, indent=2))
            zf.writestr("subtitles.srt", srt_content)

        elif item_type == ItemType.AUDIO.value:
            # audio: transcript.txt + summary.md + segments.json
            zf.writestr("transcript.txt", _build_transcript_txt(transcript))
            zf.writestr("summary.md", data.get("summary", ""))
            zf.writestr("segments.json", json.dumps(data.get("segments", []), ensure_ascii=False, indent=2))
            zf.writestr("prompts.json", json.dumps(prompts_data, ensure_ascii=False, indent=2))

        elif item_type == ItemType.TEXT.value:
            # text: source.md + summary.md + prompts.json
            zf.writestr("source.md", data.get("content") or data.get("markdown", ""))
            zf.writestr("summary.md", data.get("summary", ""))
            zf.writestr("prompts.json", json.dumps(prompts_data, ensure_ascii=False, indent=2))

        # README.md（所有类型通用）
        item_type_str = {"video": "视频", "image": "图片", "audio": "音频", "text": "文本"}.get(item_type, item_type)
        zf.writestr("README.md", _build_readme(title, item_type_str))

    buf.seek(0)

    # 文件名：复刻工作包_{title}_{YYYY-MM-DD}.zip
    safe_title = title.replace("/", "_").replace("\\", "_").replace(" ", "_")[:50]
    today = date.today().isoformat()
    filename = f"复刻工作包_{safe_title}_{today}.zip"
    # RFC5987 编码
    filename_star = f"UTF-8''{quote(filename)}"

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*= {filename_star}",
        },
    )


# ── I2.2 批量导出 ──────────────────────────────────────────


class BatchExportRequest(BaseModel):
    item_ids: List[str]


@router.post("/{workspace_id}/items/batch-export")
def batch_export_items(workspace_id: str, req: BatchExportRequest) -> StreamingResponse:
    """批量导出多个素材为一个 zip，每个素材一个子目录。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")

    item_map = {it.item_id: it for it in rec.items}
    buf = io.BytesIO()
    exported = 0

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item_id in req.item_ids:
            item = item_map.get(item_id)
            if item is None:
                continue

            # 同步 task 产物
            overlay = _sync_item_with_tasks(item)
            if overlay and overlay.get("results") and not item.results:
                item.results = overlay["results"]

            item_type = item.type
            prefix = _sanitize_zip_prefix(item.name or item_id[:8])

            if item_type == ItemType.IMAGE.value:
                data = _get_image_data(item)
                title = data.get("image", {}).get("title", item.name)
                prompts_data = _build_prompts_json_image(data)
                img_url = data.get("image", {}).get("image_url", "")
                zf.writestr(
                    f"{prefix}/reference_frames/source_image.txt",
                    f"原始图片 URL: {img_url}\n标题: {title}\n",
                )
                zf.writestr(f"{prefix}/prompts.json", json.dumps(prompts_data, ensure_ascii=False, indent=2))
            elif item_type == ItemType.VIDEO.value:
                data = _get_video_data(item)
                frames = data.get("frames", [])
                transcript = data.get("transcript", [])
                title = data.get("video", {}).get("title", item.name)
                prompts_data = _build_prompts_json_video(data.get("frames", []))
                srt_content = _build_srt(transcript)
                if frames:
                    for f in frames:
                        ts = f.get("ts", "00-00").replace(":", "-")
                        shot = f.get("shot_type", "frame")
                        fname = f"{prefix}/reference_frames/frame_{ts}_{shot}.txt"
                        content = (
                            f"镜头: {f.get('title', '')}\n"
                            f"时间: {f.get('ts', '')}\n"
                            f"类型: {f.get('shot_type', '')}\n"
                            f"描述: {f.get('description', '')}\n"
                            f"\nMidjourney 提示词:\n{f.get('prompt_mj', '')}\n"
                        )
                        zf.writestr(fname, content)
                zf.writestr(f"{prefix}/subtitles.srt", srt_content)
                zf.writestr(f"{prefix}/prompts.json", json.dumps(prompts_data, ensure_ascii=False, indent=2))
            elif item_type == ItemType.TEXT.value:
                data = _get_text_data(item)
                title = data.get("title", item.name) or item.name
                prompts_data = _build_prompts_json_text(data)
                zf.writestr(f"{prefix}/source.md", data.get("content") or data.get("markdown", ""))
                zf.writestr(f"{prefix}/summary.md", data.get("summary", ""))
                zf.writestr(f"{prefix}/prompts.json", json.dumps(prompts_data, ensure_ascii=False, indent=2))
            elif item_type == ItemType.AUDIO.value:
                data = _get_audio_data(item)
                transcript = data.get("transcript", [])
                prompts_data = _build_prompts_json_audio(data)
                zf.writestr(f"{prefix}/transcript.txt", _build_transcript_txt(transcript))
                zf.writestr(f"{prefix}/summary.md", data.get("summary", ""))
                zf.writestr(f"{prefix}/segments.json", json.dumps(data.get("segments", []), ensure_ascii=False, indent=2))
                zf.writestr(f"{prefix}/prompts.json", json.dumps(prompts_data, ensure_ascii=False, indent=2))
            else:
                continue

            exported += 1

    if exported == 0:
        raise HTTPException(status_code=400, detail="no valid items to export")

    buf.seek(0)
    today = date.today().isoformat()
    filename = f"批量导出_{workspace_id[:8]}_{today}.zip"
    filename_star = f"UTF-8''{quote(filename)}"

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*= {filename_star}",
        },
    )


_SUBTITLE_MIME: dict[str, str] = {
    "srt": "text/plain; charset=utf-8",
    "vtt": "text/vtt; charset=utf-8",
    "ass": "text/plain; charset=utf-8",
}


def _normalize_segments(raw: Any) -> list[dict[str, Any]]:
    """归一化 transcript segments：兼容 display (t_sec) / whisper (start/end) 两种格式。

    display 格式缺 end 时用下一段的 start 推算；最后一段默认 +5s。
    """
    if isinstance(raw, str) or not raw:
        return []
    if not (isinstance(raw, list) and raw and isinstance(raw[0], dict)):
        return []

    # 第一遍：收集所有有效 segment 的 start + text
    entries: list[dict[str, Any]] = []
    for seg in raw:
        if not isinstance(seg, dict):
            continue
        start = float(seg.get("start") if "start" in seg else seg.get("t_sec", 0))
        text = str(seg.get("edited_text") or seg.get("text") or "").strip()
        if not text:
            continue
        entry: dict[str, Any] = {"start": start, "text": text}
        if seg.get("edited_text"):
            entry["edited_text"] = seg["edited_text"]
        # whisper 格式自带 end，先用上
        if "end" in seg:
            entry["end"] = float(seg["end"])
        if seg.get("speaker"):
            entry["speaker"] = seg["speaker"]
        entries.append(entry)

    # 第二遍：补 end（缺 end 的用下一段 start 推算）
    for i, entry in enumerate(entries):
        if "end" not in entry:
            if i + 1 < len(entries):
                entry["end"] = entries[i + 1]["start"]
            else:
                entry["end"] = entry["start"] + 5.0  # 最后一段默认 5s

    return entries


@router.get("/{workspace_id}/items/{item_id}/subtitles")
def export_subtitles(
    workspace_id: str,
    item_id: str,
    format: str = "srt",
) -> StreamingResponse:
    """导出字幕文件（独立 .srt / .vtt / .ass 下载）。"""
    if format not in ("srt", "vtt", "ass"):
        raise HTTPException(status_code=400, detail=f"unsupported format: {format!r}, use srt/vtt/ass")

    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    # 使用与 video_result / audio_result 一致的 overlay 优先模式
    # X.1 bridge: 任务产物可能还没写回 item.results
    overlay = _sync_item_with_tasks(item)
    results = (
        dict(overlay.get("results", {}))
        if overlay and overlay.get("results")
        else dict(item.results or {})
    )

    # 直接在 results dict 上做三级降级查找 + 归一化
    raw = results.get("segments") or results.get("transcript_segments") or results.get("transcript") or []
    segments = _normalize_segments(raw)

    # A2：应用说话人名称映射
    raw_speaker_map = results.get("speaker_map") or {}
    if raw_speaker_map:
        for seg in segments:
            original = seg.get("speaker", "")
            if original and original in raw_speaker_map:
                seg["speaker"] = raw_speaker_map[original]

    # 无 transcript 时返回空 SRT（不走 demo fixture，避免 visual_only 路径数据串扰）
    if not segments:
        empty_srt = "1\n00:00:00,000 --> 00:00:00,000\n\n"
        return StreamingResponse(
            io.BytesIO(empty_srt.encode("utf-8")),
            media_type=_SUBTITLE_MIME[format],
            headers={
                "Content-Disposition": f'attachment; filename*=UTF-8\'\'{quote("empty.srt")}',
                "X-Subtitle-Status": "empty",
            },
        )

    title = item.name or "untitled"

    if format == "srt":
        content = export_srt(segments)
        ext = "srt"
    elif format == "vtt":
        content = export_vtt(segments)
        ext = "vtt"
    else:
        content = export_ass(segments, title=title)
        ext = "ass"

    safe_title = title.replace("/", "_").replace("\\", "_").replace(" ", "_")[:50]
    filename = f"{safe_title}.{ext}"

    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type=_SUBTITLE_MIME[format],
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        },
    )


# ── R19: 综合笔记 (av_synthesis) 导出 ─────────────────────────


@router.get("/{workspace_id}/av-synthesis")
def get_av_synthesis_markdown(workspace_id: str):
    """返回综合笔记 markdown 原文（供前端页面渲染）。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")

    md_path = get_workspace_root(workspace_id) / "av_synthesis.md"
    if not md_path.exists():
        raise HTTPException(status_code=404, detail="综合笔记尚未生成")

    content = md_path.read_text(encoding="utf-8")
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="text/markdown; charset=utf-8",
    )


@router.get("/{workspace_id}/export/av-synthesis.md")
def export_av_synthesis_md(workspace_id: str):
    """下载综合笔记 .md 文件。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")

    md_path = get_workspace_root(workspace_id) / "av_synthesis.md"
    if not md_path.exists():
        raise HTTPException(status_code=404, detail="综合笔记尚未生成")

    content = md_path.read_text(encoding="utf-8")
    filename = "综合笔记.md"
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        },
    )


# ── 学习笔记 (ln.md) ──────────────────────────────────


@router.get("/{workspace_id}/ln")
def get_ln_markdown(workspace_id: str):
    """返回学习笔记 markdown 原文（供 LearningNotesPage 渲染）。

    优先级：
    1. {ws}/ln.md（用户编辑覆盖层）
    2. video item.results.summary（pipeline 产出的学习总结 md）
    3. 都没有 → 404
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")

    # 优先级 1：用户编辑层 ln.md
    md_path = get_workspace_root(workspace_id) / "ln.md"
    if md_path.exists():
        content = md_path.read_text(encoding="utf-8")
        return StreamingResponse(
            io.BytesIO(content.encode("utf-8")),
            media_type="text/markdown; charset=utf-8",
        )

    # 优先级 2：从 video item.results.summary 取学习总结
    video_item = next((it for it in rec.items if it.type == "video"), None)
    if video_item is not None:
        overlay = _sync_item_with_tasks(video_item)
        results = dict(overlay.get("results", {})) if overlay and overlay.get("results") else dict(video_item.results or {})
        summary = results.get("summary") or results.get("markdown")
        if summary and isinstance(summary, str) and summary.strip():
            return StreamingResponse(
                io.BytesIO(summary.encode("utf-8")),
                media_type="text/markdown; charset=utf-8",
            )

    # 优先级 3：都没有
    raise HTTPException(status_code=404, detail="学习笔记尚未生成")


class LnPatchRequest(BaseModel):
    markdown: str


@router.patch("/{workspace_id}/ln")
def patch_ln_markdown(workspace_id: str, body: LnPatchRequest):
    """保存学习笔记 markdown（覆盖写 + bump version）。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")

    md_path = get_workspace_root(workspace_id) / "ln.md"
    md_path.write_text(body.markdown, encoding="utf-8")

    # bump ln_version（存在 video item 的 results 里）
    video_item = next((it for it in rec.items if it.type == "video"), None)
    if video_item is not None:
        results = dict(video_item.results or {})
        results["ln_version"] = results.get("ln_version", 0) + 1
        _store.update_item(workspace_id, video_item.item_id, results=results)
        version = results["ln_version"]
    else:
        version = 0

    return {"saved_at": datetime.now().isoformat(), "version": version}


# ── B-5: 学习笔记截图上传 ──────────────────────────────


import re as _re

_SAFE_NAME = _re.compile(r'[^\w.\-]+', flags=_re.UNICODE)


@router.post("/{workspace_id}/ln/screenshots")
async def upload_ln_screenshot(
    workspace_id: str,
    file: UploadFile = File(...),
    ts: float = Form(0.0),
):
    """接收视频截图 blob，存到 ln-screenshots/，返回可访问 URL。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="workspace not found")

    ws_root = get_workspace_root(workspace_id)
    dst_dir = ws_root / "ln-screenshots"
    dst_dir.mkdir(parents=True, exist_ok=True)

    ts_int = int(ts)
    now = datetime.now().strftime("%H%M%S")
    safe = f"shot-{ts_int:06d}-{now}.png"

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="screenshot too large")

    (dst_dir / safe).write_bytes(content)

    # /static 挂载在 data/，URL 为 /static/workspaces/{ws}/ln-screenshots/xxx.png
    rel = dst_dir.relative_to(ws_root.parent.parent)
    url = f"/static/{rel}/{safe}"
    return {"url": url, "filename": safe}


# ── 学习笔记 Obsidian zip 导出 ────────────────────────────────

import re as _re_ln


@router.get("/{workspace_id}/ln/export")
def export_ln_obsidian(workspace_id: str, format: str = "obsidian"):
    """导出学习笔记为 Obsidian zip 包。

    format=obsidian: zip 含 {标题}.md (图片语法改写为 ![[attachments/...]] + frontmatter) + attachments/*.png
    """
    if format != "obsidian":
        raise HTTPException(status_code=400, detail=f"不支持的格式: {format!r}，目前仅支持 obsidian")

    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")

    ws_root = get_workspace_root(workspace_id)

    # 取 markdown（复用 GET /ln 的优先级逻辑）
    md_path = ws_root / "ln.md"
    if md_path.exists():
        md_content = md_path.read_text(encoding="utf-8")
    else:
        video_item = next((it for it in rec.items if it.type == "video"), None)
        if video_item is not None:
            overlay = _sync_item_with_tasks(video_item)
            results = dict(overlay.get("results", {})) if overlay and overlay.get("results") else dict(video_item.results or {})
            summary = results.get("summary")
            if summary and isinstance(summary, str) and summary.strip():
                md_content = summary
            else:
                raise HTTPException(status_code=404, detail="学习笔记尚未生成")
        else:
            raise HTTPException(status_code=404, detail="学习笔记尚未生成")

    # 获取标题
    video_item = next((it for it in rec.items if it.type == "video"), None)
    title = video_item.name if video_item else "学习笔记"

    # 改写图片语法: ![alt](/static/workspaces/{ws}/ln-screenshots/FILE.png) → ![[attachments/FILE.png]]
    img_pattern = _re_ln.compile(r'!\[([^\]]*)\]\(/static/workspaces/[^/]+/ln-screenshots/([^)]+)\)')
    referenced_images = set()
    _ALLOWED_IMG_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.gif'}
    screenshots_dir = ws_root / "ln-screenshots"

    def _replace_img(match: _re_ln.Match) -> str:
        raw = match.group(2)
        # 安全：只取 basename，拒绝路径穿越
        basename = Path(raw).name
        if basename != raw:
            return match.group(0)  # 不改写，原样保留
        ext = Path(basename).suffix.lower()
        if ext not in _ALLOWED_IMG_EXT:
            return match.group(0)
        # 二次确认在截图目录内
        img_path = (screenshots_dir / basename).resolve()
        try:
            img_path.relative_to(screenshots_dir.resolve())
        except ValueError:
            return match.group(0)
        referenced_images.add(basename)
        return f'![[attachments/{basename}]]'

    md_content = img_pattern.sub(_replace_img, md_content)

    # 从 md 提取 H1 标题作为 safe_title（比 video_item.name 更友好）
    h1_match = _re_ln.search(r'^#\s+(.+)$', md_content, _re_ln.MULTILINE)
    if h1_match:
        title = h1_match.group(1).strip()
    elif not title:
        title = workspace_id
    safe_title = _SAFE_NAME.sub('_', title).strip('_') or "学习笔记"

    # 添加 frontmatter
    today = datetime.now().strftime("%Y-%m-%d")
    source = video_item.source_value if video_item and hasattr(video_item, 'source_value') and video_item.source_value else workspace_id
    frontmatter = f"""---
title: {title}
source: {source}
created: {today}
tags: [学习笔记, nibi]
---

"""
    md_content = frontmatter + md_content

    # 构建 zip
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{safe_title}.md", md_content)

        # 写入引用的图片
        for img_name in referenced_images:
            img_path = screenshots_dir / img_name
            if img_path.exists():
                zf.write(img_path, f"attachments/{img_name}")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(safe_title + '-obsidian.zip')}"},
    )


# ── 文章笔记 md / Obsidian 导出 ────────────────────────────────


def _assemble_text_note_md(data: Dict[str, Any]) -> str:
    """从 text 结果组装笔记 markdown（标题 + 结构化摘要 + 正文）。"""
    parts: list[str] = []
    title = data.get("title", "文章笔记")
    parts.append(f"# {title}\n")

    source = data.get("source_url") or data.get("source") or ""
    source_type = data.get("source_type", "")
    char_count = data.get("char_count", 0)
    meta_line = " ｜ ".join(filter(None, [
        f"来源：{source}" if source else None,
        f"类型：{source_type}" if source_type else None,
        f"{char_count} 字符" if char_count else None,
    ]))
    if meta_line:
        parts.append(f"> {meta_line}\n")

    summary = data.get("summary")
    if isinstance(summary, dict):
        abstract = summary.get("abstract", "")
        key_points = summary.get("key_points", [])
        golden_quotes = summary.get("golden_quotes", [])
        if abstract:
            parts.append(f"## 摘要\n\n{abstract}\n")
        if key_points:
            parts.append("## 要点\n")
            for i, kp in enumerate(key_points, 1):
                text = kp.get("text", "") if isinstance(kp, dict) else str(kp)
                parts.append(f"{i}. {text}")
                excerpt = kp.get("source_excerpt", "") if isinstance(kp, dict) else ""
                if excerpt:
                    parts.append(f"   > 原文：{excerpt}")
            parts.append("")
        if golden_quotes:
            parts.append("## 金句\n")
            for q in golden_quotes:
                qt = q.get("quote_text", "") if isinstance(q, dict) else str(q)
                parts.append(f"> {qt}\n")
    elif summary and isinstance(summary, str) and summary.strip():
        parts.append(f"## 摘要\n\n{summary.strip()}\n")

    associations = data.get("associations") or {}
    if associations:
        parts.append("## 联想归纳\n")
        for direction, analysis in associations.items():
            parts.append(f"### {direction}\n\n{analysis}\n")

    rewrites = data.get("rewrites") or {}
    if rewrites:
        parts.append("## 改写/润色\n")
        for style, text in rewrites.items():
            body = text.get("full_text", text) if isinstance(text, dict) else str(text)
            parts.append(f"### {style}\n\n{body}\n")

    translations = data.get("translations") or {}
    if translations:
        parts.append("## 翻译\n")
        for lang, text in translations.items():
            body = text.get("full_text", text) if isinstance(text, dict) else str(text)
            parts.append(f"### {lang}\n\n{body}\n")

    content = data.get("content", "")
    if content:
        parts.append(f"## 正文\n\n{content}\n")

    return "\n".join(parts)


@router.get("/{workspace_id}/items/{item_id}/text/export")
def export_text_note(workspace_id: str, item_id: str, format: str = "md"):
    """导出文章笔记：md（纯 markdown）或 obsidian（zip 包）。"""
    if format not in ("md", "obsidian"):
        raise HTTPException(status_code=400, detail=f"不支持的格式: {format!r}，可选 md/obsidian")

    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    # 同步 task 产物
    overlay = _sync_item_with_tasks(item)
    if overlay and overlay.get("results") and not item.results:
        item.results = overlay["results"]

    data = _get_text_data(item)
    if data.get("source") == "demo_hint":
        raise HTTPException(status_code=404, detail="文章笔记尚未生成")

    md_content = _assemble_text_note_md(data)
    title = data.get("title", "文章笔记") or "文章笔记"
    safe_title = _SAFE_NAME.sub("_", title).strip("_")[:80] or "文章笔记"

    if format == "md":
        return StreamingResponse(
            io.BytesIO(md_content.encode("utf-8")),
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(safe_title + '.md')}"},
        )

    # obsidian: frontmatter + zip
    today = datetime.now().strftime("%Y-%m-%d")
    source_url = data.get("source_url") or data.get("source") or ""
    frontmatter = f"""---
title: {title}
source: {source_url}
created: {today}
tags: [文章笔记, nibi]
---

"""
    full_md = frontmatter + md_content

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{safe_title}.md", full_md)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(safe_title + '-obsidian.zip')}"},
    )


# ── R20: 笔记多格式导出 ────────────────────────────────


class NotesExportRequest(BaseModel):
    format: str  # "pdf" | "docx" | "obsidian"


@router.post("/{workspace_id}/notes/export")
def export_notes(workspace_id: str, body: NotesExportRequest):
    """综合笔记多格式导出：PDF / Word / Obsidian Vault。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")

    ws_root = get_workspace_root(workspace_id)
    md_path = ws_root / "av_synthesis.md"
    if not md_path.exists():
        raise HTTPException(status_code=404, detail="综合笔记尚未生成")

    content = md_path.read_text(encoding="utf-8")
    from backend.app.services.av_synthesis.md_parser import parse_av_synthesis_md
    notes = parse_av_synthesis_md(content)

    fmt = body.format.lower().strip()
    if fmt == "pdf":
        return _build_notes_pdf(notes, ws_root)
    elif fmt == "docx":
        return _build_notes_docx(notes, ws_root)
    elif fmt == "obsidian":
        return _build_notes_obsidian(notes, ws_root)
    else:
        raise HTTPException(status_code=400, detail=f"不支持的导出格式: {body.format!r}，可选 pdf/docx/obsidian")


def _resolve_image(ws_root: Path, rel_path: str) -> Path | None:
    """解析图片相对路径，返回绝对路径（不存在则 None）。"""
    if not rel_path:
        return None
    full = ws_root / rel_path
    if full.exists():
        return full
    # 尝试去掉前导 ./
    full = ws_root / rel_path.lstrip("./")
    return full if full.exists() else None


def _build_notes_pdf(notes: Any, ws_root: Path) -> StreamingResponse:
    """PDF 导出：Jinja2 HTML 模板 + playwright chromium 渲染。"""
    from backend.app.services.av_synthesis.pdf_builder import build_pdf
    return build_pdf(notes, ws_root)


def _build_notes_docx(notes: Any, ws_root: Path) -> StreamingResponse:
    """Word 导出：python-docx 构建。"""
    from backend.app.services.av_synthesis.docx_builder import build_docx
    return build_docx(notes, ws_root)


def _build_notes_obsidian(notes: Any, ws_root: Path) -> StreamingResponse:
    """Obsidian Vault 导出：zip 含 markdown + frames/。"""
    from backend.app.services.av_synthesis.obsidian_builder import build_obsidian_zip
    return build_obsidian_zip(notes, ws_root)


# ── 合集级 HTML 导出（自包含单文件） ──────────────────────


def _strip_frontmatter(md: str) -> str:
    """移除 markdown 头部的 YAML frontmatter（--- 块）。"""
    if md.startswith("---\n"):
        parts = md.split("---\n", 2)
        if len(parts) >= 3:
            return parts[2].lstrip("\n")
    return md


@router.get("/{workspace_id}/export-html")
def export_collection_html(workspace_id: str) -> StreamingResponse:
    """导出合集内全部素材笔记为自包含单文件 HTML。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")

    from backend.app.services.note_assembler import note_dir  # noqa: PLC0415
    import markdown2  # noqa: PLC0415
    from jinja2 import Environment, FileSystemLoader  # noqa: PLC0415

    template_dir = Path(__file__).resolve().parents[2] / "services" / "av_synthesis" / "templates"

    notes_data: List[Dict[str, str]] = []
    type_label = {
        "video": "视频",
        "image": "图片",
        "audio": "音频",
        "text": "文本",
    }

    for item in rec.items:
        nd = note_dir(workspace_id, item.item_id)
        note_path = nd / "note.md"
        if not note_path.exists():
            continue
        raw_md = note_path.read_text(encoding="utf-8")
        md_body = _strip_frontmatter(raw_md).strip()
        if not md_body:
            continue
        html_body = markdown2.markdown(md_body, extras=["tables", "fenced-code-blocks", "break-on-newline"])
        notes_data.append({
            "title": item.name or "未命名素材",
            "item_type": type_label.get(item.type, item.type),
            "html": html_body,
        })

    ctx = {
        "title": rec.name or "Nibi 合集",
        "material_count": len(rec.items),
        "date": date.today().isoformat(),
        "notes": notes_data,
    }

    env = Environment(loader=FileSystemLoader(str(template_dir)))
    template = env.get_template("collection.html.j2")
    html_content = template.render(ctx=ctx)

    safe_title = (rec.name or "合集").replace("/", "_").replace("\\", "_").replace(" ", "_")[:50]
    today = date.today().isoformat()
    filename = f"合集_{safe_title}_{today}.html"
    filename_star = f"UTF-8''{quote(filename)}"

    return StreamingResponse(
        iter([html_content.encode("utf-8")]),
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*= {filename_star}",
        },
    )
