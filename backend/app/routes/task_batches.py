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

from backend.app.models.task_batch import BatchItem, BatchStatus, TaskBatch
from backend.app.services.task_batch_store import get_default_batch_store

router = APIRouter(prefix="/pipeline/batches", tags=["batches"])


# ── 请求/响应模型 ─────────────────────────────────────────────────────────────


class BatchPreviewRequest(BaseModel):
    """预览请求。"""

    urls: List[str] = Field(default_factory=list)
    workspace_id: str = ""


class BatchPreviewItem(BaseModel):
    """预览项。"""

    batch_item_id: str
    source_url: str
    status: str  # new / exists_in_target / exists_elsewhere
    existing_workspace_id: str = ""
    suggested_action: str = "process"  # process / skip / copy


class BatchPreviewResponse(BaseModel):
    """预览响应。"""

    items: List[BatchPreviewItem]
    total: int


class BatchCreateRequest(BaseModel):
    """创建批次请求。"""

    name: str
    items: List[Dict[str, Any]]  # [{batch_item_id, source_url, action}]
    workspace_id: str = ""
    settings: Dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = ""


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
    items: List[Dict[str, Any]] = []
    for url in req.urls:
        item_id = str(uuid.uuid4())[:8]
        items.append({
            "batch_item_id": item_id,
            "source_url": url,
            "status": "new",
            "existing_workspace_id": "",
            "suggested_action": "process",
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

    batch_id = str(uuid.uuid4())
    items = [
        BatchItem(
            batch_item_id=item.get("batch_item_id", str(uuid.uuid4())[:8]),
            source_url=item.get("source_url", ""),
            action=item.get("action", "process"),
        )
        for item in req.items
    ]

    batch = TaskBatch(
        batch_id=batch_id,
        name=req.name,
        target_workspace_id=req.workspace_id,
        items=items,
        settings_snapshot={**req.settings, "idempotency_key": req.idempotency_key},
        total_count=len(items),
    )
    batch.update_status()
    store.save(batch)

    return batch.to_dict()


@router.get("")
def list_batches(
    status: Optional[str] = Query(None),
    workspace_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Dict[str, Any]:
    """列出批次。"""
    store = get_default_batch_store()
    batches = store.list(status=status, workspace_id=workspace_id, limit=limit, offset=offset)
    return {
        "batches": [b.to_dict() for b in batches],
        "total": store.count(),
    }


@router.get("/{batch_id}")
def get_batch(batch_id: str) -> Dict[str, Any]:
    """获取批次详情。"""
    store = get_default_batch_store()
    batch = store.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")
    return batch.to_dict()


@router.post("/{batch_id}/pause")
def pause_batch(batch_id: str) -> Dict[str, Any]:
    """暂停批次。"""
    store = get_default_batch_store()
    batch = store.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")
    if batch.status in ("completed", "failed", "cancelled", "partial_cancelled"):
        raise HTTPException(status_code=409, detail="批次已终态，无法暂停")

    batch.pause_requested = True
    batch.update_status()
    store.save(batch)
    return batch.to_dict()


@router.post("/{batch_id}/resume")
def resume_batch(batch_id: str) -> Dict[str, Any]:
    """恢复批次。"""
    store = get_default_batch_store()
    batch = store.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")
    if batch.status != "paused":
        raise HTTPException(status_code=409, detail="批次未暂停")

    batch.pause_requested = False
    batch.update_status()
    store.save(batch)
    return batch.to_dict()


@router.post("/{batch_id}/cancel")
def cancel_batch(batch_id: str) -> Dict[str, Any]:
    """取消批次。"""
    store = get_default_batch_store()
    batch = store.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")
    if batch.status in ("completed", "failed", "cancelled", "partial_cancelled"):
        raise HTTPException(status_code=409, detail="批次已终态，无法取消")

    batch.cancel_requested = True
    # 取消等待中的项
    for item in batch.items:
        if item.status == "pending":
            item.status = "cancelled"
    batch.update_status()
    store.save(batch)
    return batch.to_dict()


@router.post("/{batch_id}/retry-failed")
def retry_failed(batch_id: str) -> Dict[str, Any]:
    """重试失败项。"""
    store = get_default_batch_store()
    batch = store.get(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批次不存在")
    if batch.status not in ("partial", "failed", "partial_cancelled"):
        raise HTTPException(status_code=409, detail="无失败项可重试")

    failed_items = [item for item in batch.items if item.status == "failed"]
    if not failed_items:
        raise HTTPException(status_code=409, detail="无失败项")

    # 重置失败项状态
    for item in failed_items:
        item.status = "pending"
        item.attempt_no += 1
        item.error = ""

    batch.cancel_requested = False
    batch.pause_requested = False
    batch.completed_at = ""
    batch.update_status()
    store.save(batch)
    return batch.to_dict()


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
