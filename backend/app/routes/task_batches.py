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
from backend.app.services.task_batch_service import TaskBatchService
from backend.app.services.task_batch_store import get_default_batch_store
from shared.settings_store import load_settings

router = APIRouter(prefix="/pipeline/batches", tags=["batches"])
_services: Dict[int, TaskBatchService] = {}


def get_batch_service() -> TaskBatchService:
    """返回与当前批次 store 绑定的生命周期服务。"""
    store = get_default_batch_store()
    key = id(store)
    service = _services.get(key)
    if service is None:
        from backend.app.routes.pipeline import _runner

        service = TaskBatchService(
            batch_store=store,
            runner=_runner,
            concurrency_limit=lambda: load_settings().download.concurrency_limit,
        )
        _services[key] = service
    return service


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

    items = [
        BatchItem(
            batch_item_id=item.get("batch_item_id", str(uuid.uuid4())[:8]),
            source_url=item.get("source_url", ""),
            action=item.get("action", "process"),
        )
        for item in req.items
    ]

    batch = get_batch_service().create_batch(
        name=req.name,
        target_workspace_id=req.workspace_id,
        items=items,
        settings_snapshot={**req.settings, "idempotency_key": req.idempotency_key},
    )

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
