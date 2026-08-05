"""Q3 / D4：媒体导出路由（原视频 / 软字幕 / 烧录字幕）。

错误一律可操作：说明缺什么 + 替代路径（spec §5.3）。
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

import io

from backend.app.routes.workspaces import _store, _sync_item_with_tasks
from backend.app.routes.pipeline import _runner as _pipeline_runner
from backend.app.models.tasks import TaskRecord, TaskStatus
from backend.app.services.diagnostic_events import (
    DiagnosticAggregator,
    classify_task_failure,
    emit_diagnostic_event,
)
from backend.app.services.media_export import (
    BurnTask,
    MediaExportError,
    build_softsub_zip,
    build_subtitle_content,
    collect_segments,
    is_ffmpeg_available,
    burn_registry,
    resolve_local_media_from_url,
    run_burn_subtitles,
)
from shared.config import DATA_DIR
from backend.app.services.runtime_log_store import get_default_store

router = APIRouter(prefix="/workspaces", tags=["media-export"])
_diagnostic_sink = get_default_store()
_burn_diagnostic_aggregator = DiagnosticAggregator()


def _sync_burn_task_to_pipeline(final: BurnTask, output_path: Path) -> None:
    """同步烧录终态；任务中心的取消请求优先于后台线程完成结果。"""
    current = _pipeline_runner.store.get(final.task_id)
    was_cancelled = bool(
        current
        and (
            current.cancel_requested
            or current.status == TaskStatus.CANCELLED.value
        )
    )
    if was_cancelled:
        burn_registry.cancel(final.task_id)
        final.status = "cancelled"
        final.output_url = ""
        if output_path.exists():
            try:
                output_path.unlink()
            except OSError:
                pass

    status_map = {
        "done": TaskStatus.SUCCESS.value,
        "failed": TaskStatus.FAILED.value,
        "cancelled": TaskStatus.CANCELLED.value,
        "running": TaskStatus.VLM.value,
        "pending": TaskStatus.PENDING.value,
    }
    _pipeline_runner.store.update(
        final.task_id,
        status=status_map.get(final.status, TaskStatus.FAILED.value),
        progress=final.progress,
        error=final.error,
        result={"output_path": str(output_path) if final.status == "done" else ""},
    )
    if final.status == "failed":
        emit_diagnostic_event(
            _diagnostic_sink,
            classify_task_failure(current or final, stage="BURN", error=final.error),
            task_id=final.task_id,
            workspace_id=final.workspace_id,
            stage="BURN",
            component="burn_subtitle",
            technical_detail=final.error,
            aggregator=_burn_diagnostic_aggregator,
        )


def _get_item_or_404(workspace_id: str, item_id: str):
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    for item in rec.items:
        if item.item_id == item_id:
            return item
    raise HTTPException(status_code=404, detail=f"item not found: {item_id}")


def _item_media_url(item) -> str:
    results = dict(item.results or {})
    media = results.get("media") or {}
    video = media.get("video") or {}
    if isinstance(video, dict) and video.get("url"):
        return str(video["url"])
    if media.get("audio"):
        return str(media["audio"])
    # 与 note payload 相同的提取口径兜底
    overlay = _sync_item_with_tasks(item)
    if overlay:
        o_results = overlay.get("results") or {}
        o_media = o_results.get("media") or {}
        o_video = o_media.get("video") or {}
        if isinstance(o_video, dict) and o_video.get("url"):
            return str(o_video["url"])
        if o_media.get("audio"):
            return str(o_media["audio"])
    return ""


def _require_local_media(item):
    url = _item_media_url(item)
    path = resolve_local_media_from_url(url, DATA_DIR) if url else None
    if path is None:
        raise HTTPException(
            status_code=409,
            detail=(
                "本地媒体文件不存在：该素材可能尚未下载或文件已被移动。"
                "可先在任务里重新下载，或仅导出笔记/字幕。"
            ),
        )
    return path


def _item_segments(item):
    overlay = _sync_item_with_tasks(item)
    results = (
        dict(overlay.get("results", {}))
        if overlay and overlay.get("results")
        else dict(item.results or {})
    )
    segments = collect_segments(results)
    speaker_map = results.get("speaker_map") or {}
    if isinstance(speaker_map, dict) and speaker_map:
        for seg in segments:
            original = seg.get("speaker", "")
            if original and original in speaker_map:
                seg["speaker"] = speaker_map[original]
    return segments


@router.get("/{workspace_id}/items/{item_id}/media-export")
def media_export(
    workspace_id: str,
    item_id: str,
    kind: Literal["original", "softsub"] = "original",
    subtitle_format: Literal["srt", "vtt", "ass"] = "srt",
    language: Literal["bilingual", "translation", "source"] = "bilingual",
):
    """kind=original：流式复制本地媒体（绝不重编码）。
    kind=softsub：媒体 + 字幕打包 zip。"""
    item = _get_item_or_404(workspace_id, item_id)
    media_path = _require_local_media(item)
    base_name = (item.name or "media").replace("/", "_").replace("\\", "_")[:60] or "media"

    if kind == "original":
        return FileResponse(
            path=str(media_path),
            filename=f"{base_name}{media_path.suffix}",
            media_type="application/octet-stream",
        )

    # softsub
    segments = _item_segments(item)
    if not segments:
        raise HTTPException(
            status_code=409,
            detail="没有可用字幕：该素材尚未完成转写。可先跑转写，或仅导出原视频。",
        )
    try:
        content = build_subtitle_content(
            segments,
            subtitle_format,
            item.name or "media",
            language=language,
        )
    except MediaExportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    blob = build_softsub_zip(media_path, content, subtitle_format, base_name)
    filename = f"{base_name}-softsub.zip"
    return StreamingResponse(
        io.BytesIO(blob),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


class BurnRequest(BaseModel):
    subtitle_format: Literal["srt", "ass"] = "srt"
    font_name: str = Field(default="", max_length=120)
    font_size: int = Field(default=0, ge=0, le=200)
    language: Literal["bilingual", "translation", "source"] = "bilingual"


@router.post("/{workspace_id}/items/{item_id}/media-export/burn", status_code=202)
def start_burn(workspace_id: str, item_id: str, body: BurnRequest):
    """烧录字幕：后台 ffmpeg 任务，立即返回 task_id。"""
    item = _get_item_or_404(workspace_id, item_id)
    if not is_ffmpeg_available():
        raise HTTPException(
            status_code=409,
            detail="未检测到 ffmpeg：无法烧录字幕。请安装 ffmpeg，或改用「软字幕」打包导出。",
        )
    media_path = _require_local_media(item)
    segments = _item_segments(item)
    if not segments:
        raise HTTPException(
            status_code=409,
            detail="没有可用字幕：该素材尚未完成转写，无法烧录。可先跑转写，或仅导出原视频。",
        )

    task = burn_registry.create(item_id, workspace_id)
    duration = 0.0
    results = dict(item.results or {})
    media = results.get("media") or {}
    video = media.get("video") or {}
    if isinstance(video, dict) and video.get("duration"):
        try:
            duration = float(video["duration"])
        except (TypeError, ValueError):
            duration = 0.0
    task.duration_sec = duration

    # 写一条 pipeline 任务记录，任务中心可见
    record = TaskRecord(
        task_id=task.task_id,
        project_id=workspace_id,
        task_type="burn_subtitle",
        payload={"item_id": item_id, "subtitle_format": body.subtitle_format},
        status=TaskStatus.VLM.value,
        progress=0.0,
    )
    _pipeline_runner.store.create(record)

    srt_content = build_subtitle_content(
        segments,
        body.subtitle_format,
        item.name or "media",
        language=body.language,
    )
    suffix = ".srt" if body.subtitle_format == "srt" else ".ass"
    tmp_dir = Path(DATA_DIR) / "tmp" / "burn"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    sub_path = tmp_dir / f"{task.task_id}{suffix}"
    sub_path.write_text(srt_content, encoding="utf-8")
    output_path = tmp_dir / f"{task.task_id}-burned.mp4"

    def _finish_check():
        # 线程结束后把终态同步到 pipeline 记录
        final = burn_registry.get(task.task_id)
        if final is None:
            return
        try:
            _sync_burn_task_to_pipeline(final, output_path)
        except Exception:  # noqa: BLE001
            pass

    def _run():
        try:
            run_burn_subtitles(
                task, media_path, sub_path, output_path,
                font_name=body.font_name, font_size=body.font_size,
            )
        finally:
            if sub_path.exists():
                try:
                    sub_path.unlink()
                except OSError:
                    pass
            if task.status == "done" and output_path.exists():
                task.output_url = f"/static/tmp/burn/{output_path.name}"
            _finish_check()

    threading.Thread(target=_run, name=f"burn-{task.task_id}", daemon=True).start()
    return {"task_id": task.task_id, "status": "running"}


@router.get("/{workspace_id}/items/{item_id}/media-export/burn/{task_id}")
def burn_status(workspace_id: str, item_id: str, task_id: str):
    task = burn_registry.get(task_id)
    if task is None or task.item_id != item_id:
        raise HTTPException(status_code=404, detail="烧录任务不存在")
    return {
        "task_id": task.task_id,
        "status": task.status,
        "progress": round(task.progress, 3),
        "output_url": task.output_url,
        "error": task.error,
    }


@router.post("/{workspace_id}/items/{item_id}/media-export/burn/{task_id}/cancel")
def burn_cancel(workspace_id: str, item_id: str, task_id: str):
    task = burn_registry.get(task_id)
    if task is None or task.item_id != item_id:
        raise HTTPException(status_code=404, detail="烧录任务不存在")
    burn_registry.cancel(task_id)
    return {"task_id": task_id, "status": "cancelled"}
