"""S1 Task 3: 智能路由测试。

验证：
- 国内域名直连
- 海外域名走代理
- 三种 routing_mode
- 三种 override
- 无代理时的行为
"""

from __future__ import annotations

import pytest

from shared.network_routing import explain_routing, resolve_proxy
from shared.settings_store import NetworkConfig


# ── Task 3.1: 路由矩阵 ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("url", "mode", "proxy", "override", "expected"),
    [
        # smart 模式：国内直连
        ("https://www.bilibili.com/video/BV1xx", "smart", "http://proxy:7890", "inherit", None),
        ("https://www.douyin.com/video/1", "smart", "http://proxy:7890", "inherit", None),
        ("https://www.xiaohongshu.com/explore", "smart", "http://proxy:7890", "inherit", None),
        # smart 模式：海外走代理
        ("https://www.youtube.com/watch?v=x", "smart", "http://proxy:7890", "inherit", "http://proxy:7890"),
        ("https://youtu.be/abc", "smart", "http://proxy:7890", "inherit", "http://proxy:7890"),
        # smart 模式：未知域名直连
        ("https://example.com/file.mp4", "smart", "http://proxy:7890", "inherit", None),
        # direct 模式：全部直连
        ("https://www.youtube.com/watch?v=x", "direct", "http://proxy:7890", "inherit", None),
        ("https://www.bilibili.com/video/BV1xx", "direct", "http://proxy:7890", "inherit", None),
        # proxy 模式：全部走代理
        ("https://www.bilibili.com/video/BV1xx", "proxy", "http://proxy:7890", "inherit", "http://proxy:7890"),
        ("https://example.com/file.mp4", "proxy", "http://proxy:7890", "inherit", "http://proxy:7890"),
        # override=direct 强制直连
        ("https://www.youtube.com/watch?v=x", "proxy", "http://proxy:7890", "direct", None),
        # override=proxy 强制代理
        ("https://www.bilibili.com/video/BV1xx", "direct", "http://proxy:7890", "proxy", "http://proxy:7890"),
        # 无代理时海外直连
        ("https://www.youtube.com/watch?v=x", "smart", "", "inherit", None),
    ],
)
def test_resolve_proxy_matrix(
    url: str, mode: str, proxy: str, override: str, expected: str | None
) -> None:
    """路由矩阵测试。"""
    config = NetworkConfig(routing_mode=mode, global_proxy=proxy)  # type: ignore[arg-type]
    assert resolve_proxy(url, config, override) == expected


# ── Task 3.2: 国内域名识别 ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "https://www.bilibili.com/video/BV1xx",
        "https://b23.tv/abc123",
        "https://www.douyin.com/video/123",
        "https://www.xiaohongshu.com/explore/123",
        "https://v.qq.com/x/cover/abc.html",
        "https://www.iqiyi.com/v_abc.html",
    ],
)
def test_domestic_urls_direct(url: str) -> None:
    """国内域名在 smart 模式下直连。"""
    config = NetworkConfig(routing_mode="smart", global_proxy="http://proxy:7890")
    assert resolve_proxy(url, config) is None


# ── Task 3.3: 海外域名识别 ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=x",
        "https://youtu.be/abc",
        "https://m.youtube.com/watch?v=x",
        "https://twitter.com/user/status/123",
        "https://x.com/user/status/123",
        "https://www.tiktok.com/@user/video/123",
    ],
)
def test_overseas_urls_use_proxy(url: str) -> None:
    """海外域名在 smart 模式下走代理。"""
    config = NetworkConfig(routing_mode="smart", global_proxy="http://proxy:7890")
    assert resolve_proxy(url, config) == "http://proxy:7890"


# ── Task 3.4: 路由解释 ───────────────────────────────────────────────────────


def test_explain_routing_domestic() -> None:
    """国内域名解释。"""
    config = NetworkConfig(routing_mode="smart", global_proxy="http://proxy:7890")
    explanation = explain_routing("https://www.bilibili.com/video/BV1xx", config)
    assert "国内" in explanation
    assert "直连" in explanation


def test_explain_routing_overseas() -> None:
    """海外域名解释。"""
    config = NetworkConfig(routing_mode="smart", global_proxy="http://proxy:7890")
    explanation = explain_routing("https://www.youtube.com/watch?v=x", config)
    assert "海外" in explanation
    assert "proxy:7890" in explanation


def test_explain_routing_no_proxy() -> None:
    """无代理时的解释。"""
    config = NetworkConfig(routing_mode="smart", global_proxy="")
    explanation = explain_routing("https://www.youtube.com/watch?v=x", config)
    assert "未配置" in explanation or "直连" in explanation
