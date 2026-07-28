from __future__ import annotations

"""运维管理端点（M4 部署监控 + S2 标准日志）。

冻结契约：
- GET /admin/system/stats 返回当前宿主机 CPU / 内存 / 磁盘实时指标
- GET /admin/logs 返回统一标准日志（支持 after_id/before_id 分页）

S2 日志契约：
- 响应包含 entries, latest_id, oldest_id, has_more_older
- 支持 level/category/task_id/batch_id/workspace_id 过滤
"""

from datetime import datetime
from typing import Any, Dict, Optional

import psutil
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from backend.app.services.runtime_log_store import get_default_store
from shared.settings_store import load_settings

router = APIRouter(prefix="/admin", tags=["admin"])


def _collect_cpu() -> Dict[str, Any]:
    """CPU 使用率快照。

    `interval=None` 返回自上次调用以来的非阻塞平均；首次调用可能返回 0.0，
    前端对 /admin/system/stats 做轮询即可获得稳定读数。
    """
    return {
        "percent": psutil.cpu_percent(interval=None),
        "count_logical": psutil.cpu_count(logical=True) or 0,
        "count_physical": psutil.cpu_count(logical=False) or 0,
    }


def _collect_memory() -> Dict[str, Any]:
    """物理内存快照，单位统一为字节。"""
    vm = psutil.virtual_memory()
    return {
        "total": int(vm.total),
        "available": int(vm.available),
        "used": int(vm.used),
        "percent": float(vm.percent),
    }


def _collect_disk() -> Dict[str, Any]:
    """根分区磁盘使用率快照。

    监控页面只关注当前进程挂载根目录；对更复杂的多分区指标保留扩展空间。
    """
    usage = psutil.disk_usage("/")
    return {
        "total": int(usage.total),
        "used": int(usage.used),
        "free": int(usage.free),
        "percent": float(usage.percent),
    }


@router.get("/system/stats")
def get_system_stats() -> Dict[str, Any]:
    """返回 CPU / 内存 / 磁盘实时指标。

    响应字段（冻结契约，前端 StatCard 直接消费）：
        cpu:    { percent, count_logical, count_physical }
        memory: { total, available, used, percent }
        disk:   { total, used, free, percent }
        timestamp: 服务端采集时间（Unix 时间戳，秒）
    """
    import time

    return {
        "cpu": _collect_cpu(),
        "memory": _collect_memory(),
        "disk": _collect_disk(),
        "timestamp": time.time(),
    }


@router.get("/logs")
def get_runtime_logs(
    after_id: int = Query(0, ge=0, description="只返回 ID 大于该值的条目"),
    before_id: int = Query(0, ge=0, description="只返回 ID 小于该值的条目"),
    level: Optional[str] = Query(None, description="按日志级别过滤"),
    category: Optional[str] = Query(None, description="按类别过滤"),
    task_id: Optional[str] = Query(None, description="按任务 ID 过滤"),
    batch_id: Optional[str] = Query(None, description="按批次 ID 过滤"),
    workspace_id: Optional[str] = Query(None, description="按合集 ID 过滤"),
    limit: int = Query(200, ge=1, le=1000, description="单次返回上限"),
) -> Dict[str, Any]:
    """返回统一标准日志（只读，支持分页）。

    响应字段：
        entries:        [{ id, timestamp, level, category, message, ... }, ...]
        latest_id:      服务端当前最大日志 ID
        oldest_id:      服务端当前最小日志 ID
        has_more_older: 是否有更早记录

    日志在进入存储前已脱敏；本端点不提供任何写 / 删除能力。
    """
    if after_id and before_id:
        raise HTTPException(status_code=422, detail="after_id 和 before_id 不能同时使用")

    store = get_default_store()
    result = store.query(
        after_id=after_id,
        before_id=before_id,
        level=level,
        category=category,
        task_id=task_id,
        batch_id=batch_id,
        workspace_id=workspace_id,
        limit=limit,
    )
    return {
        "entries": [e.model_dump(mode="json") for e in result.entries],
        "latest_id": result.latest_id,
        "oldest_id": result.oldest_id,
        "has_more_older": result.has_more_older,
    }


@router.get("/logs/export")
def export_runtime_logs(
    level: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    task_id: Optional[str] = Query(None),
    batch_id: Optional[str] = Query(None),
    workspace_id: Optional[str] = Query(None),
) -> JSONResponse:
    """导出当前过滤条件下最多 5000 条、已统一脱敏的诊断信息。"""
    store = get_default_store()
    result = store.query(
        level=level,
        category=category,
        task_id=task_id,
        batch_id=batch_id,
        workspace_id=workspace_id,
        limit=5000,
    )
    settings = load_settings()
    now = datetime.now().astimezone()
    payload = {
        "generated_at": now.isoformat(),
        "system": {
            "cpu": _collect_cpu(),
            "memory": _collect_memory(),
            "disk": _collect_disk(),
        },
        "config_status": {
            "provider_count": len(settings.providers),
            "network_routing_mode": settings.network.routing_mode,
            "network_proxy_configured": bool(settings.network.global_proxy),
            "download_proxy_mode": settings.download.proxy_mode,
            "download_cookie_mode": settings.download.cookie_mode,
        },
        "entries": [event.model_dump(mode="json") for event in result.entries],
    }
    filename = now.strftime("notebi-diagnostics-%Y%m%d-%H%M%S.json")
    return JSONResponse(
        payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
