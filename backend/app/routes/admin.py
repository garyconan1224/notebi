from __future__ import annotations

"""运维管理端点（M4 部署监控）。

冻结契约见 docs/SETTINGS_REPLICA_PLAN.md §M4：
- GET /admin/system/stats 返回当前宿主机 CPU / 内存 / 磁盘实时指标

本路由仅做只读观测，不涉及任何写操作；所有指标均来自 psutil。
"""

from typing import Any, Dict

import psutil
from fastapi import APIRouter

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

