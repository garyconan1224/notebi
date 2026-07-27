"""网络配置端点。

S1 冻结契约：
- GET   /network_config 回显当前 AppSettings.network
- PATCH /network_config 字段级 patch
- POST  /network_config/test 测试连通性

智能分流规则：
- B站、抖音、小红书：直连
- YouTube、Tavily 及海外模型：使用全局代理
"""

from __future__ import annotations

from dataclasses import asdict, replace
from typing import Any, Dict, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from shared.settings_store import (
    NetworkConfig,
    load_settings,
    save_settings,
)

router = APIRouter(tags=["network"])


class NetworkConfigUpdateRequest(BaseModel):
    """PATCH /network_config 请求体。"""

    routing_mode: Optional[str] = None
    global_proxy: Optional[str] = None


def _serialize(cfg: NetworkConfig) -> Dict[str, Any]:
    return asdict(cfg)


@router.get("/network_config")
def get_network_config() -> Dict[str, Any]:
    """回显当前网络配置。"""
    settings = load_settings()
    return _serialize(settings.network)


@router.patch("/network_config")
def update_network_config(req: NetworkConfigUpdateRequest) -> Dict[str, Any]:
    """写入网络配置并回显。"""
    settings = load_settings()
    current = settings.network

    routing_mode = current.routing_mode
    if req.routing_mode is not None:
        routing_mode = req.routing_mode if req.routing_mode in ("smart", "direct", "proxy") else "smart"  # type: ignore[assignment]

    new_cfg = NetworkConfig(
        routing_mode=routing_mode,
        global_proxy=req.global_proxy if req.global_proxy is not None else current.global_proxy,
    )

    save_settings(replace(settings, network=new_cfg))
    return _serialize(new_cfg)


# 兼容旧 POST 方法
@router.post("/network_config")
def update_network_config_post(req: NetworkConfigUpdateRequest) -> Dict[str, Any]:
    """兼容旧 POST 方法。"""
    return update_network_config(req)
