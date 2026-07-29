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
import time
from typing import Any, Dict, Literal, Optional
from urllib.parse import urlparse
from urllib.request import ProxyHandler, Request, build_opener

from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from shared.settings_store import (
    NetworkConfig,
    load_settings,
    save_settings,
)
from shared.network_routing import explain_routing, resolve_proxy

router = APIRouter(tags=["network"])


class NetworkConfigUpdateRequest(BaseModel):
    """PATCH /network_config 请求体。"""

    routing_mode: Optional[Literal["smart", "direct", "proxy"]] = None
    global_proxy: Optional[str] = None

    @field_validator("global_proxy")
    @classmethod
    def validate_global_proxy(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return value
        if urlparse(value).scheme not in {"http", "https", "socks5"}:
            raise ValueError("代理地址仅支持 http://、https:// 或 socks5://")
        return value


class NetworkTestRequest(BaseModel):
    target: str

    @field_validator("target")
    @classmethod
    def validate_target(cls, value: str) -> str:
        if urlparse(value).scheme not in {"http", "https"}:
            raise ValueError("测试目标必须是 HTTP/HTTPS 地址")
        return value


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
        routing_mode = req.routing_mode

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


def _probe_url(target: str, proxy: str | None) -> tuple[bool, str]:
    handlers = []
    if proxy:
        handlers.append(ProxyHandler({"http": proxy, "https": proxy}))
    else:
        handlers.append(ProxyHandler({}))
    opener = build_opener(*handlers)
    request = Request(target, method="HEAD", headers={"User-Agent": "NoteBi/0.3"})
    try:
        with opener.open(request, timeout=8) as response:
            status = int(getattr(response, "status", 200))
        return status < 500, f"HTTP {status}"
    except Exception as exc:
        return False, f"连接失败：{type(exc).__name__}"


@router.post("/network_config/test")
def test_network_config(req: NetworkTestRequest) -> Dict[str, Any]:
    settings = load_settings()
    proxy = resolve_proxy(req.target, settings.network)
    route = explain_routing(req.target, settings.network)
    # explain_routing 会包含配置值；测试响应只说明是否走代理，绝不回显凭据。
    if proxy:
        route = route.split(" →", 1)[0]
    started = time.monotonic()
    ok, message = _probe_url(req.target, proxy)
    elapsed_ms = round((time.monotonic() - started) * 1000)
    return {
        "target": req.target,
        "route": route,
        "proxy_used": bool(proxy),
        "elapsed_ms": elapsed_ms,
        "ok": ok,
        "message": message,
    }
