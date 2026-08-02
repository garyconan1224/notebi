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


def test_task_defaults_missing_fields_keep_current_behavior(
    settings_path: Path,
) -> None:
    from shared.settings_store import SettingsStore

    settings_path.write_text("{}", encoding="utf-8")

    task_defaults = SettingsStore(settings_path).load().task_defaults

    assert task_defaults.summary_template == "standard"
    assert task_defaults.video_frame_analysis is True
    assert task_defaults.frame_interval_sec == 5
    assert task_defaults.diarize is False
    assert task_defaults.speaker_count is None


# ── Task A: 截帧间隔「任意正整数」契约（无硬编码上限）─────────────────────────


def test_task_defaults_from_dict_positive_int_contract() -> None:
    """超过 2**31 的正整数原样保留；0、负数、非数值回退默认 5。"""
    from shared.settings_store import TaskDefaultsConfig

    huge = 2**31 + 12345
    assert TaskDefaultsConfig.from_dict({"frame_interval_sec": huge}).frame_interval_sec == huge
    assert TaskDefaultsConfig.from_dict({"frame_interval_sec": 2**40}).frame_interval_sec == 2**40
    assert TaskDefaultsConfig.from_dict({"frame_interval_sec": 1}).frame_interval_sec == 1
    assert TaskDefaultsConfig.from_dict({"frame_interval_sec": 0}).frame_interval_sec == 5
    assert TaskDefaultsConfig.from_dict({"frame_interval_sec": -5}).frame_interval_sec == 5
    assert TaskDefaultsConfig.from_dict({"frame_interval_sec": "abc"}).frame_interval_sec == 5
    assert TaskDefaultsConfig.from_dict({"frame_interval_sec": None}).frame_interval_sec == 5


def test_frame_interval_beyond_32bit_round_trips_through_store(
    settings_path: Path,
) -> None:
    """超大正整数写入后读回不变（save → load round-trip）。"""
    from shared.settings_store import SettingsStore

    huge = 2**40  # 远超旧版 2**31 clamp 边界
    settings_path.write_text(
        json.dumps({"task_defaults": {"frame_interval_sec": huge}}),
        encoding="utf-8",
    )
    store = SettingsStore(settings_path)

    loaded = store.load()
    assert loaded.task_defaults.frame_interval_sec == huge

    store.save(loaded)
    assert SettingsStore(settings_path).load().task_defaults.frame_interval_sec == huge


# ── Task B: 退役转录引擎（bcut/kuaishou）兼容迁移到 auto ──────────────────────


def test_migrate_transcriber_type_is_the_single_migration_gate() -> None:
    """退役引擎与未知值统一经 migrate_transcriber_type 迁移到 auto；白名单原样保留。"""
    import inspect

    from shared.settings_store import (
        _ALLOWED_TRANSCRIBER_TYPES,
        _RETIRED_TRANSCRIBER_TYPES,
        migrate_transcriber_type,
    )

    assert _RETIRED_TRANSCRIBER_TYPES == {"bcut", "kuaishou"}
    for retired in _RETIRED_TRANSCRIBER_TYPES:
        assert migrate_transcriber_type(retired) == "auto"
    assert migrate_transcriber_type("cloud-v9") == "auto"
    assert migrate_transcriber_type("") == "auto"
    assert migrate_transcriber_type(None) == "auto"
    for valid in _ALLOWED_TRANSCRIBER_TYPES:
        assert migrate_transcriber_type(valid) == valid
    # 退役集合必须被迁移逻辑显式消费，而不只是出现在 docstring 里。
    source = inspect.getsource(migrate_transcriber_type)
    assert "_RETIRED_TRANSCRIBER_TYPES" in source.split('"""', 2)[-1]


def test_retired_transcriber_configs_migrate_to_auto_on_load(
    settings_path: Path,
) -> None:
    """已有配置文件中退役引擎读取时迁移到 auto，其他字段保留。"""
    from shared.settings_store import SettingsStore, _RETIRED_TRANSCRIBER_TYPES

    for retired in sorted(_RETIRED_TRANSCRIBER_TYPES):
        settings_path.write_text(
            json.dumps(
                {
                    "transcriber": {
                        "type": retired,
                        "whisper_model_size": "small",
                        "language": "zh",
                    }
                }
            ),
            encoding="utf-8",
        )
        loaded = SettingsStore(settings_path).load().transcriber
        assert loaded.type == "auto"
        assert loaded.whisper_model_size == "small"
