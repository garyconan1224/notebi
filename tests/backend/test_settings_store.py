"""S1 Task 1: 设置模型冻结和兼容迁移测试。

验证：
- 旧 JSON 含 po_token、visitor_data、cookie_base_dirs 时能加载，但重新保存不再序列化这些字段。
- 新配置默认值为智能路由、继承网络代理、浏览器 Cookie、并发 2、重试 2、超时 30 秒。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest


# ── 辅助：创建隔离的 SettingsStore ─────────────────────────────────────────────


@pytest.fixture()
def settings_path(tmp_path: Path) -> Path:
    return tmp_path / "settings.json"


# ── Task 1.1: 旧字段兼容读取但不写入 ──────────────────────────────────────────


def test_legacy_download_secrets_are_read_but_not_written(settings_path: Path) -> None:
    """旧 JSON 含 po_token、visitor_data、cookie_base_dirs 时能加载，但重新保存不再序列化。"""
    from shared.settings_store import SettingsStore

    settings_path.write_text(
        json.dumps(
            {
                "download": {
                    "po_token": "old-po-token",
                    "visitor_data": "old-visitor-data",
                    "cookie_base_dirs": ["/tmp/cookies"],
                    "output_dir": "/videos",
                    "concurrency_limit": 3,
                }
            }
        ),
        encoding="utf-8",
    )

    store = SettingsStore(settings_path)
    loaded = store.load()

    # 旧值能读取（兼容期）
    assert loaded.download.output_dir == "/videos"
    assert loaded.download.concurrency_limit == 3

    # 重新保存
    store.save(loaded)
    saved = json.loads(settings_path.read_text(encoding="utf-8"))

    # 废弃字段不再序列化
    assert "po_token" not in saved.get("download", {})
    assert "visitor_data" not in saved.get("download", {})
    assert "cookie_base_dirs" not in saved.get("download", {})


# ── Task 1.2: 新配置默认值 ────────────────────────────────────────────────────


def test_network_config_defaults(settings_path: Path) -> None:
    """NetworkConfig 默认值为智能路由、空代理。"""
    from shared.settings_store import NetworkConfig, SettingsStore

    store = SettingsStore(settings_path)
    settings = store.load()

    assert settings.network.routing_mode == "smart"
    assert settings.network.global_proxy == ""


def test_download_config_defaults(settings_path: Path) -> None:
    """DownloadConfig 默认值为继承代理、浏览器 Cookie、并发 2、重试 2、超时 30。"""
    from shared.settings_store import SettingsStore

    store = SettingsStore(settings_path)
    settings = store.load()

    assert settings.download.proxy_mode == "inherit"
    assert settings.download.cookie_mode == "browser"
    assert settings.download.cookie_browser == "chrome"
    assert settings.download.cookie_profile == ""
    assert settings.download.cookie_file_path == ""
    assert settings.download.concurrency_limit == 2
    assert settings.download.retry_count == 2
    assert settings.download.socket_timeout == 30


# ── Task 1.3: NetworkConfig 模型 ─────────────────────────────────────────────


def test_network_config_round_trip(settings_path: Path) -> None:
    """NetworkConfig 保存后能读回。"""
    from shared.settings_store import NetworkConfig, SettingsStore

    store = SettingsStore(settings_path)
    settings = store.load()

    new_network = NetworkConfig(routing_mode="proxy", global_proxy="http://127.0.0.1:7890")
    from dataclasses import replace

    store.save(replace(settings, network=new_network))

    reloaded = store.load()
    assert reloaded.network.routing_mode == "proxy"
    assert reloaded.network.global_proxy == "http://127.0.0.1:7890"


# ── Task 1.4: DownloadConfig 新字段 ──────────────────────────────────────────


def test_download_config_new_fields_round_trip(settings_path: Path) -> None:
    """DownloadConfig 新字段保存后能读回。"""
    from dataclasses import replace

    from shared.settings_store import DownloadConfig, SettingsStore

    store = SettingsStore(settings_path)
    settings = store.load()

    new_download = DownloadConfig(
        output_dir="/custom/videos",
        filename_template="%(title)s.%(ext)s",
        proxy_mode="direct",
        cookie_mode="file",
        cookie_browser="firefox",
        cookie_profile="Profile 1",
        cookie_file_path="/home/user/cookies.txt",
        concurrency_limit=4,
        retry_count=5,
        socket_timeout=60,
    )
    store.save(replace(settings, download=new_download))

    reloaded = store.load()
    assert reloaded.download.proxy_mode == "direct"
    assert reloaded.download.cookie_mode == "file"
    assert reloaded.download.cookie_browser == "firefox"
    assert reloaded.download.cookie_profile == "Profile 1"
    assert reloaded.download.cookie_file_path == "/home/user/cookies.txt"
    assert reloaded.download.concurrency_limit == 4
    assert reloaded.download.retry_count == 5
    assert reloaded.download.socket_timeout == 60


# ── Task 1.5: 无效枚举值回退默认 ─────────────────────────────────────────────


def test_invalid_routing_mode_falls_back_to_smart(settings_path: Path) -> None:
    """无效 routing_mode 回退到 smart。"""
    from shared.settings_store import SettingsStore

    settings_path.write_text(
        json.dumps({"network": {"routing_mode": "invalid_mode"}}),
        encoding="utf-8",
    )

    store = SettingsStore(settings_path)
    settings = store.load()
    assert settings.network.routing_mode == "smart"


def test_invalid_proxy_mode_falls_back_to_inherit(settings_path: Path) -> None:
    """无效 proxy_mode 回退到 inherit。"""
    from shared.settings_store import SettingsStore

    settings_path.write_text(
        json.dumps({"download": {"proxy_mode": "invalid_mode"}}),
        encoding="utf-8",
    )

    store = SettingsStore(settings_path)
    settings = store.load()
    assert settings.download.proxy_mode == "inherit"


def test_invalid_cookie_mode_falls_back_to_browser(settings_path: Path) -> None:
    """无效 cookie_mode 回退到 browser。"""
    from shared.settings_store import SettingsStore

    settings_path.write_text(
        json.dumps({"download": {"cookie_mode": "invalid_mode"}}),
        encoding="utf-8",
    )

    store = SettingsStore(settings_path)
    settings = store.load()
    assert settings.download.cookie_mode == "browser"
