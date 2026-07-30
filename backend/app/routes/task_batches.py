"""S3 Task 7: 批次 API 契约。

冻结契约：
POST /pipeline/batches/preview
POST /pipeline/batches
GET  /pipeline/batches
GET  /pipeline/batches/{batch_id}
POST /pipeline/batches/{batch_id}/pause
POST /pipeline/batches/{batch_id}/resume
POST /pipeline/batches/{batch_id}/cancel
POST /pipeline/batches/{batch_id}/retry-failed
DELETE /pipeline/batches/{batch_id}
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.models.task_batch import BatchItem
from backend.app.models.tasks import TaskRecord
from backend.app.models.workspace import (
    ItemStatus,
    ItemType,
    PreflightConfig,
    WorkspaceItem,
    WorkspaceRecord,
)
from backend.app.services.batch_source_resolver import (
    normalize_batch_source,
    resolve_batch_sources,
    stable_batch_item_id,
)
from backend.app.services.task_batch_service import TaskBatchService
from backend.app.services.task_batch_store import get_default_batch_store
from shared.settings_store import load_settings

router = APIRouter(prefix="/pipeline/batches", tags=["batches"])
_services: Dict[int, TaskBatchService] = {}
_APPROVED_SOURCE_TYPES = {
    "urls",
    "local_files",
    "bilibili_collection",
    "bilibili_favorites",
    "bilibili_uploader",
    "bilibili_parts",
    "youtube_playlist",
}


def get_workspace_store():
    from backend.app.routes.workspaces import _store

    return _store


def _copy_existing_item(
    source_workspace_id: str,
    source_item_id: str,
    target_workspace_id: str,
) -> None:
    from backend.app.routes.workspaces import (
        BatchAddToWorkspaceRequest,
        batch_add_items_to_workspace,
    )

    result = batch_add_items_to_workspace(
        BatchAddToWorkspaceRequest(
            target_workspace_id=target_workspace_id,
            items=[{"workspace_id": source_workspace_id, "item_id": source_item_id}],
        )
    )
    if result.get("added") != 1 and result.get("skipped") != 1:
        failures = result.get("failures") or []
        reason = failures[0].get("reason") if failures else "copy failed"
        raise ValueError(str(reason))


def _link_created_task_to_workspace(
    _batch,
    _batch_item,
    task: TaskRecord,
) -> None:
    """在 worker 启动前把真实 task_id 关联到目标素材。"""
    workspace_id = str(task.payload.get("workspace_id") or task.project_id)
    item_id = str(task.payload.get("item_id") or "")
    if not workspace_id or not item_id:
        return
    store = get_workspace_store()
    workspace = store.get(workspace_id)
    if workspace is None:
        raise KeyError(f"workspace not found: {workspace_id}")
    item = next((candidate for candidate in workspace.items if candidate.item_id == item_id), None)
    if item is None:
        raise KeyError(f"item not found: {item_id}")
    related_task_ids = list(item.related_task_ids)
    if task.task_id not in related_task_ids:
        related_task_ids.append(task.task_id)
    store.update_item(
        workspace_id,
        item_id,
        related_task_ids=related_task_ids,
        status=ItemStatus.PROCESSING.value,
    )


def _batch_task_detail(task: TaskRecord) -> Dict[str, Any]:
    """Build a concise, user-visible task state for batch details.

    The batch page intentionally shows progress messages and generated output,
    rather than private model reasoning.  It remains transparent about the
    actual pipeline stage and failures without adding one HTTP request per
    task.
    """
    result = dict(task.result or {})
    summary = result.get("summary") or result.get("note_summary")
    if isinstance(summary, dict):
        summary = summary.get("content_md") or summary.get("content") or ""
    summary_preview = str(summary or "").strip()
    if len(summary_preview) > 1200:
        summary_preview = summary_preview[:1200] + "…"

    visible_events = [
        str(entry.message).strip()
        for entry in task.log[-8:]
        if str(entry.message).strip()
    ]
    task_status = str(getattr(task.status, "value", task.status))
    fallback_stage = {
        "PENDING": "等待处理",
        "DOWNLOAD": "下载或读取素材",
        "ASR": "转录与说话人分析",
        "FRAMES": "分析视频画面",
        "ANALYZE": "整理内容",
        "STORE": "保存笔记",
        "SUCCESS": "处理完成",
        "PARTIAL": "部分完成，需要留意",
        "FAILED": "处理失败",
        "CANCELLED": "已取消",
    }.get(task_status, "处理中")
    task_payload = dict(task.payload or {})
    return {
        "task_id": task.task_id,
        "status": task_status,
        "progress": max(0.0, min(float(task.progress or 0.0), 1.0)),
        "stage": visible_events[-1] if visible_events else fallback_stage,
        "visible_events": visible_events,
        "summary_preview": summary_preview,
        "error": str(task.error or ""),
        "workspace_id": str(task_payload.get("workspace_id") or result.get("workspace_id") or ""),
        "item_id": str(task_payload.get("item_id") or result.get("item_id") or ""),
    }


def get_batch_service() -> TaskBatchService:
    """返回与当前批次 store 绑定的生命周期服务。"""
    store = get_default_batch_store()
    key = id(store)
    service = _services.get(key)
    if service is None:
        from backend.app.routes.pipeline import _runner
        from backend.app.services.runtime_log_store import get_default_store

        service = TaskBatchService(
            batch_store=store,
            runner=_runner,
            concurrency_limit=lambda: load_settings().download.concurrency_limit,
            copy_item=_copy_existing_item,
            task_created=_link_created_task_to_workspace,
            event_sink=get_default_store(),
        )
        _services[key] = service
    return service


# ── 请求/响应模型 ─────────────────────────────────────────────────────────────


class BatchPreviewRequest(BaseModel):
    """预览请求。"""

    source_type: str = "urls"
    urls: List[str] = Field(default_factory=list)
    local_files: List[str] = Field(default_factory=list)
    workspace_id: str = ""


class BatchPreviewItem(BaseModel):
    """预览项。"""

    batch_item_id: str
    source_url: str
    source_title: str = ""
    external_id: str = ""
    lineage_id: str = ""
    status: str  # new / exists_in_target / exists_elsewhere
    existing_workspace_id: str = ""
    existing_item_id: str = ""
    suggested_action: str = "process"  # process / skip / copy
    allowed_actions: List[str] = Field(default_factory=lambda: ["process"])


class BatchPreviewResponse(BaseModel):
    """预览响应。"""

    items: List[BatchPreviewItem]
    total: int


class BatchCreateRequest(BaseModel):
    """创建批次请求。"""

    name: str
    items: List[Dict[str, Any]]  # [{batch_item_id, source_url, action}]
    workspace_id: str = ""
    source_type: str = "urls"
    settings: Dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = ""
    start: bool = True


class BatchResponse(BaseModel):
    """批次响应。"""

    batch_id: str
    name: str
    status: str
    total_count: int
    completed_count: int
    failed_count: int
    created_at: str


# ── API 端点 ──────────────────────────────────────────────────────────────────


@router.post("/preview")
def preview_batch(req: BatchPreviewRequest) -> Dict[str, Any]:
    """预览批量任务，检查重复项。"""
    if req.source_type not in _APPROVED_SOURCE_TYPES:
        raise HTTPException(status_code=422, detail="不支持的批量来源类型")

    try:
        resolved = resolve_batch_sources(
            source_type=req.source_type,
            urls=req.urls,
            local_files=req.local_files,
        )
    except HTTPException:
        raise
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    workspace_store = get_workspace_store()
    existing: list[tuple[str, Any]] = [
        (workspace.workspace_id, item)
        for workspace in workspace_store.list_all()
        for item in workspace.items
    ]
    items: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for source in resolved:
        url = str(source.get("source_url") or "").strip()
        external_id = str(source.get("external_id") or "").strip()
        normalized = normalize_batch_source(url)
        identity = external_id or normalized
        if not identity or identity in seen:
            continue
        seen.add(identity)
        lineage_id = str(source.get("lineage_id") or "")
        matches: list[tuple[str, Any]] = []
        for workspace_id, existing_item in existing:
            existing_meta = (
                existing_item.results.get("batch_source", {})
                if isinstance(existing_item.results, dict)
                else {}
            )
            existing_external_id = (
                str(existing_meta.get("external_id") or "")
                if isinstance(existing_meta, dict)
                else ""
            )
            if (
                (lineage_id and existing_item.lineage_id == lineage_id)
                or (
                    external_id
                    and existing_external_id
                    and external_id == existing_external_id
                )
                or normalize_batch_source(existing_item.source_value) == normalized
            ):
                matches.append((workspace_id, existing_item))
        matches.sort(key=lambda match: match[0] != req.workspace_id)
        match = matches[0] if matches else None
        in_target = bool(match and match[0] == req.workspace_id)
        status = "exists_in_target" if in_target else "exists_elsewhere" if match else "new"
        suggested_action = "skip" if in_target else "copy" if match else "process"
        items.append({
            "batch_item_id": stable_batch_item_id(url, external_id),
            "source_url": url,
            "source_title": str(source.get("source_title") or ""),
            "external_id": external_id,
            "lineage_id": lineage_id or (match[1].lineage_id if match else ""),
            "status": status,
            "existing_workspace_id": match[0] if match else "",
            "existing_item_id": match[1].item_id if match else "",
            "suggested_action": suggested_action,
            "allowed_actions": (
                ["skip", "copy", "process"] if match and not in_target
                else ["skip", "process"] if in_target
                else ["process"]
            ),
        })
    return {"items": items, "total": len(items)}


@router.post("")
def create_batch(req: BatchCreateRequest) -> Dict[str, Any]:
    """创建批次任务。"""
    store = get_default_batch_store()

    # 幂等性检查
    if req.idempotency_key:
        for batch in store.list(limit=100):
            if batch.settings_snapshot.get("idempotency_key") == req.idempotency_key:
                return batch.to_dict()

    if req.source_type not in _APPROVED_SOURCE_TYPES:
        raise HTTPException(status_code=422, detail="不支持的批量来源类型")

    for item in req.items:
        action = str(item.get("action") or "process")
        if action not in {"process", "skip", "copy"}:
            raise HTTPException(status_code=422, detail=f"不支持的批次动作: {action}")
    saved_defaults = load_settings().task_defaults
    effective_settings: dict[str, Any] = {
        "task_type": "note",
        "note_style": saved_defaults.summary_template,
        "note_type": "auto",
        "diarize": saved_defaults.diarize,
        "frame_analysis": saved_defaults.video_frame_analysis,
        "frame_interval": saved_defaults.frame_interval_sec,
        "speaker_count": saved_defaults.speaker_count,
        **req.settings,
    }
    try:
        frame_interval = int(effective_settings.get("frame_interval") or 5)
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail="frame_interval 必须是整数") from error
    if not 1 <= frame_interval <= 3600:
        raise HTTPException(status_code=422, detail="frame_interval 必须在 1 到 3600 秒之间")

    workspace_store = get_workspace_store()
    target_workspace_id = req.workspace_id.strip()
    if not target_workspace_id:
        target_workspace_id = str(uuid.uuid4())
        workspace_store.create(
            WorkspaceRecord(
                workspace_id=target_workspace_id,
                name=req.name.strip() or "新批量笔记",
                source=req.source_type
                if req.source_type in {
                    "multi_url",
                    "youtube_playlist",
                    "bilibili_favorites",
                    "bilibili_multipart",
                    "bilibili_uploader",
                }
                else "manual",
            )
        )
    elif workspace_store.get(target_workspace_id) is None:
        raise HTTPException(status_code=404, detail="目标合集不存在")

    items: list[BatchItem] = []
    item_payloads: dict[str, dict[str, Any]] = {}
    for item in req.items:
        action = str(item.get("action") or "process")
        batch_item_id = str(
            item.get("batch_item_id")
            or stable_batch_item_id(
                str(item.get("source_url") or ""),
                str(item.get("external_id") or ""),
            )
        )
        if action == "process":
            source_url = str(item.get("source_url") or "")
            workspace_item_id = str(uuid.uuid4())
            source_title = str(item.get("source_title") or "").strip() or source_url
            frame_analysis = bool(effective_settings.get("frame_analysis", True))
            summary_template = str(effective_settings.get("note_style") or "standard")
            note_type = str(effective_settings.get("note_type") or "auto")
            diarize = bool(effective_settings.get("diarize", False))
            summary_mode = (
                str(effective_settings.get("summary_mode") or "general")
                if "summary_mode" in req.settings
                else ("speaker_aware" if diarize else "general")
            )
            preflight = {
                "embed_frames": frame_analysis,
                "image_mode": "vision",
                "frame_prompt": {
                    "mode": "interval",
                    "interval_sec": frame_interval,
                },
                "intent": "note",
            }
            workspace_item_kwargs: dict[str, Any] = {}
            lineage_id = str(item.get("lineage_id") or "")
            if lineage_id:
                workspace_item_kwargs["lineage_id"] = lineage_id
            workspace_store.add_item(
                target_workspace_id,
                WorkspaceItem(
                    item_id=workspace_item_id,
                    type=ItemType.VIDEO.value,
                    source="local" if req.source_type == "local_files" else "url",
                    source_value=source_url,
                    name=source_title,
                    status=ItemStatus.PENDING.value,
                    preflight=PreflightConfig(
                        intent="note",
                        tasks={
                            "summary": {
                                "embed_frames": frame_analysis,
                                "summary_template": summary_template,
                                "diarize": diarize,
                            }
                        },
                    ),
                    results={
                        "video_title": source_title,
                        "video_thumbnail_url": item.get("thumbnail"),
                        "cover_thumbnail": item.get("thumbnail"),
                        "duration_sec": item.get("duration_seconds"),
                        "batch_source": {
                            "source_type": req.source_type,
                            "platform": str(item.get("platform") or ""),
                            "index": item.get("index"),
                            "external_id": str(item.get("external_id") or ""),
                        },
                    },
                    tags={"custom_tags": ["批量导入"]},
                    **workspace_item_kwargs,
                ),
            )
            item_payloads[batch_item_id] = {
                "workspace_id": target_workspace_id,
                "item_id": workspace_item_id,
                "title": source_title,
                "video_title": source_title,
                "preflight": preflight,
                "intent": "note",
                "note_media_kind": note_type,
                "source_type": "local" if req.source_type == "local_files" else "link",
                "kind_hint": ItemType.VIDEO.value,
                "summary_template": summary_template,
                "diarize": diarize,
                "summary_mode": summary_mode,
                "speaker_count": (
                    effective_settings.get("speaker_count") if diarize else None
                ),
                "vision_model": str(effective_settings.get("vision_model") or ""),
                "user_notes": str(effective_settings.get("user_notes") or ""),
            }
        items.append(
            BatchItem(
                batch_item_id=batch_item_id,
                source_url=str(item.get("source_url") or ""),
                source_title=str(item.get("source_title") or ""),
                external_id=str(item.get("external_id") or ""),
                lineage_id=str(item.get("lineage_id") or ""),
                existing_workspace_id=str(item.get("existing_workspace_id") or ""),
                existing_item_id=str(item.get("existing_item_id") or ""),
                action=action,
            )
        )

    settings_snapshot = {
        **effective_settings,
        "task_type": "note",
        "idempotency_key": req.idempotency_key,
        "item_payloads": item_payloads,
    }

    batch = get_batch_service().create_batch(
        name=req.name,
        target_workspace_id=target_workspace_id,
        items=items,
        settings_snapshot=settings_snapshot,
        source_type=req.source_type,
        start_paused=not req.start,
    )

    return batch.to_dict()


@router.get("")
def list_batches(
    status: Optional[str] = Query(None),
    workspace_id: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None, alias="source"),
    keyword: Optional[str] = Query(None),
    created_from: Optional[str] = Query(None),
    created_to: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Dict[str, Any]:
    """列出批次。"""
    store = get_default_batch_store()
    filters = {
        "status": status,
        "workspace_id": workspace_id,
        "source_type": source_type,
        "keyword": keyword,
        "created_from": created_from,
        "created_to": created_to,
    }
    batches = store.list(**filters, limit=limit, offset=offset)
    return {
        "batches": [b.to_dict() for b in batches],
        "total": store.count(**filters),
    }


@router.get("/{batch_id}")
def get_batch(batch_id: str) -> Dict[str, Any]:
    """获取批次详情。"""
    service = get_batch_service()
    batch = service.batch_store.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")
    payload = batch.to_dict()
    task_details: Dict[str, Dict[str, Any]] = {}
    for item in batch.items:
        for task_id in item.task_ids:
            task = service.runner.store.get(task_id)
            if task is not None:
                task_details[task_id] = _batch_task_detail(task)
    payload["task_details"] = task_details
    return payload


@router.post("/{batch_id}/pause")
def pause_batch(batch_id: str) -> Dict[str, Any]:
    """暂停批次。"""
    try:
        return get_batch_service().pause(batch_id).to_dict()
    except KeyError as error:
        raise HTTPException(status_code=404, detail="批次不存在") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{batch_id}/resume")
def resume_batch(batch_id: str) -> Dict[str, Any]:
    """恢复批次。"""
    try:
        return get_batch_service().resume(batch_id).to_dict()
    except KeyError as error:
        raise HTTPException(status_code=404, detail="批次不存在") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{batch_id}/cancel")
def cancel_batch(batch_id: str) -> Dict[str, Any]:
    """取消批次。"""
    try:
        return get_batch_service().cancel(batch_id).to_dict()
    except KeyError as error:
        raise HTTPException(status_code=404, detail="批次不存在") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{batch_id}/retry-failed")
def retry_failed(batch_id: str) -> Dict[str, Any]:
    """重试失败项。"""
    try:
        return get_batch_service().retry_failed(batch_id).to_dict()
    except KeyError as error:
        raise HTTPException(status_code=404, detail="批次不存在") from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.delete("/{batch_id}")
def delete_batch(batch_id: str) -> Dict[str, Any]:
    """删除批次记录（仅终态）。"""
    store = get_default_batch_store()
    batch = store.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")

    if not store.delete(batch_id):
        raise HTTPException(status_code=409, detail="运行中批次不能删除")

    return {"deleted": True, "batch_id": batch_id}
