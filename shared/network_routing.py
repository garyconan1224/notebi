"""智能网络路由：根据 URL 和配置决定代理策略。

S1 冻结契约：
- resolve_proxy(url, network_config, override) 返回代理 URL 或 None
- 国内域名表：Bilibili、抖音、小红书
- 海外默认走全局代理

路由规则：
- routing_mode=smart: 国内直连，海外走代理
- routing_mode=direct: 全部直连
- routing_mode=proxy: 全部走代理
- override=inherit: 使用网络页策略
- override=direct: 强制直连
- override=proxy: 强制代理
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import urlparse

if TYPE_CHECKING:
    from shared.settings_store import NetworkConfig

# 国内域名表（直连）
_DOMESTIC_DOMAINS: frozenset[str] = frozenset(
    {
        "bilibili.com",
        "www.bilibili.com",
        "b23.tv",
        "douyin.com",
        "www.douyin.com",
        "iesdouyin.com",
        "xiaohongshu.com",
        "www.xiaohongshu.com",
        "xhslink.com",
        # 通用国内
        "qq.com",
        "v.qq.com",
        "youku.com",
        "v.youku.com",
        "iqiyi.com",
        "www.iqiyi.com",
    }
)

# 海外域名（smart 模式下走代理）
_OVERSEAS_DOMAINS: frozenset[str] = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
        "m.youtube.com",
        "googlevideo.com",
        "twitter.com",
        "x.com",
        "instagram.com",
        "facebook.com",
        "tiktok.com",
        "www.tiktok.com",
    }
)


def _is_domestic(url: str) -> bool:
    """判断 URL 是否属于国内域名。"""
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return False
    host = host.lower()
    # 精确匹配或子域名匹配
    for domain in _DOMESTIC_DOMAINS:
        if host == domain or host.endswith("." + domain):
            return True
    return False


def _is_overseas(url: str) -> bool:
    """判断 URL 是否属于海外域名。"""
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return False
    host = host.lower()
    for domain in _OVERSEAS_DOMAINS:
        if host == domain or host.endswith("." + domain):
            return True
    return False


def resolve_proxy(
    url: str,
    network: "NetworkConfig",
    override: str = "inherit",
) -> str | None:
    """根据 URL 和配置决定代理。

    Args:
        url: 目标 URL
        network: 网络配置
        override: 下载页覆盖策略（inherit/direct/proxy）

    Returns:
        代理 URL 或 None（直连）
    """
    # 下载页强制覆盖
    if override == "direct":
        return None
    if override == "proxy":
        return network.global_proxy or None

    # 使用网络页策略
    mode = network.routing_mode

    if mode == "direct":
        return None

    if mode == "proxy":
        return network.global_proxy or None

    # smart 模式
    if _is_domestic(url):
        return None

    if _is_overseas(url):
        # 海外走代理；没有配置代理时返回 None（直连）
        return network.global_proxy or None

    # 未知域名：smart 模式下默认直连
    return None


def explain_routing(url: str, network: "NetworkConfig", override: str = "inherit") -> str:
    """返回人类可读的路由解释。"""
    proxy = resolve_proxy(url, network, override)

    if override == "direct":
        return "下载页强制直连"
    if override == "proxy":
        if proxy:
            return f"下载页强制代理 → {proxy}"
        return "下载页强制代理，但未配置全局代理"

    mode = network.routing_mode

    if mode == "direct":
        return "全局直连模式"
    if mode == "proxy":
        if proxy:
            return f"全局代理模式 → {proxy}"
        return "全局代理模式，但未配置全局代理"

    # smart
    if _is_domestic(url):
        return "智能路由：国内站点直连"
    if _is_overseas(url):
        if proxy:
            return f"智能路由：海外站点走代理 → {proxy}"
        return "智能路由：海外站点，但未配置全局代理，将直连"
    return "智能路由：未知域名，默认直连"
