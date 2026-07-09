"""R23 性能档位测试覆盖。

覆盖：
- PerformanceConfig 档位映射（三档 model/interval/max_frames）
- recommend_tier 内存推荐（边界值）
- from_dict 非法值 fallback
- GET /performance_tier 默认返回
- POST /performance_tier 持久化 + 同步 transcriber
- POST 非法 tier 422
- _tier_capture_params() 读取档位默认截帧参数
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from shared.settings_store import (
    AppSettings,
    PerformanceConfig,
    TranscriberConfig,
    load_settings,
    save_settings,
    replace,
)


# ── PerformanceConfig 纯逻辑 ─────────────────────────────────


class TestPerformanceConfigMapping:
    """三档映射到 whisper model + 截帧参数。"""

    def test_low_tier(self):
        cfg = PerformanceConfig(tier="low")
        assert cfg.whisper_model_size == "base"
        assert cfg.interval_sec == 8
        assert cfg.max_frames == 30

    def test_medium_tier(self):
        cfg = PerformanceConfig(tier="medium")
        assert cfg.whisper_model_size == "medium"
        assert cfg.interval_sec == 5
        assert cfg.max_frames == 60

    def test_high_tier(self):
        cfg = PerformanceConfig(tier="high")
        assert cfg.whisper_model_size == "large-v3"
        assert cfg.interval_sec == 3
        assert cfg.max_frames == 100


class TestRecommendTier:
    """内存推荐边界值。"""

    def test_4gb_or_less_is_low(self):
        assert PerformanceConfig.recommend_tier(4.0) == "low"
        assert PerformanceConfig.recommend_tier(2.0) == "low"

    def test_5gb_is_low(self):
        assert PerformanceConfig.recommend_tier(5.0) == "low"

    def test_6gb_is_medium(self):
        assert PerformanceConfig.recommend_tier(6.0) == "medium"

    def test_8gb_is_medium(self):
        assert PerformanceConfig.recommend_tier(8.0) == "medium"

    def test_12gb_is_medium(self):
        assert PerformanceConfig.recommend_tier(12.0) == "medium"

    def test_16gb_is_high(self):
        assert PerformanceConfig.recommend_tier(16.0) == "high"

    def test_32gb_is_high(self):
        assert PerformanceConfig.recommend_tier(32.0) == "high"


class TestPerformanceConfigFromDict:
    """from_dict 安全构造。"""

    def test_none_returns_medium(self):
        assert PerformanceConfig.from_dict(None).tier == "medium"

    def test_empty_dict_returns_medium(self):
        assert PerformanceConfig.from_dict({}).tier == "medium"

    def test_valid_low(self):
        assert PerformanceConfig.from_dict({"tier": "low"}).tier == "low"

    def test_valid_high(self):
        assert PerformanceConfig.from_dict({"tier": "high"}).tier == "high"

    def test_invalid_tier_falls_back_to_medium(self):
        assert PerformanceConfig.from_dict({"tier": "ultra"}).tier == "medium"
        assert PerformanceConfig.from_dict({"tier": ""}).tier == "medium"


# ── API 端点 ─────────────────────────────────────────────────


@pytest.fixture()
def client(tmp_path: Path, monkeypatch):
    """隔离的 TestClient，settings 写到临时目录。"""
    settings_file = tmp_path / "settings.json"

    def _load():
        if not settings_file.is_file():
            return AppSettings()
        data = json.loads(settings_file.read_text())
        return AppSettings.from_dict(data)

    def _save(s: AppSettings):
        settings_file.parent.mkdir(parents=True, exist_ok=True)
        settings_file.write_text(json.dumps(asdict(s), ensure_ascii=False))

    monkeypatch.setattr("shared.settings_store.load_settings", _load)
    monkeypatch.setattr("shared.settings_store.save_settings", _save)
    # performance_tier 路由也 import 了 load/save_settings
    monkeypatch.setattr("backend.app.routes.performance_tier.load_settings", _load)
    monkeypatch.setattr("backend.app.routes.performance_tier.save_settings", _save)

    from backend.app.main import app

    return TestClient(app)


class TestGetPerformanceTier:
    """GET /performance_tier 默认返回。"""

    def test_default_tier_is_medium(self, client):
        resp = client.get("/performance_tier")
        assert resp.status_code == 200
        body = resp.json()
        assert body["tier"] == "medium"
        assert body["whisper_model_size"] == "medium"
        assert body["interval_sec"] == 5
        assert body["max_frames"] == 60

    def test_response_has_recommended_and_ram(self, client):
        body = client.get("/performance_tier").json()
        assert "recommended_tier" in body
        assert body["recommended_tier"] in ("low", "medium", "high")
        assert isinstance(body["total_ram_gb"], (int, float))
        assert body["total_ram_gb"] > 0


class TestPostPerformanceTier:
    """POST /performance_tier 持久化 + 同步 transcriber。"""

    def test_save_low_tier(self, client):
        resp = client.post("/performance_tier", json={"tier": "low"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["tier"] == "low"
        assert body["whisper_model_size"] == "base"
        assert body["interval_sec"] == 8
        assert body["max_frames"] == 30

    def test_persists_across_get(self, client):
        client.post("/performance_tier", json={"tier": "high"})
        body = client.get("/performance_tier").json()
        assert body["tier"] == "high"
        assert body["whisper_model_size"] == "large-v3"

    def test_syncs_transcriber_whisper_model_size(self, client):
        """POST 档位后，transcriber.whisper_model_size 应同步更新。"""
        client.post("/performance_tier", json={"tier": "low"})
        # 直接读 settings 验证 transcriber 被同步
        from backend.app.routes.performance_tier import load_settings

        settings = load_settings()
        assert settings.transcriber.whisper_model_size == "base"

        client.post("/performance_tier", json={"tier": "high"})
        settings = load_settings()
        assert settings.transcriber.whisper_model_size == "large-v3"

    def test_preserves_other_transcriber_fields(self, client):
        """同步 whisper_model_size 时不应覆盖其他 transcriber 字段。"""
        # 先手动设一个 language
        from backend.app.routes.performance_tier import load_settings, save_settings

        settings = load_settings()
        save_settings(
            replace(settings, transcriber=replace(settings.transcriber, language="en", device="mps"))
        )

        client.post("/performance_tier", json={"tier": "low"})
        settings = load_settings()
        assert settings.transcriber.whisper_model_size == "base"
        assert settings.transcriber.language == "en"
        assert settings.transcriber.device == "mps"


class TestPostInvalidTier:
    """POST 非法 tier 应返回 422。"""

    def test_invalid_tier_string(self, client):
        resp = client.post("/performance_tier", json={"tier": "ultra"})
        assert resp.status_code == 422

    def test_empty_tier_string(self, client):
        resp = client.post("/performance_tier", json={"tier": ""})
        assert resp.status_code == 422

    def test_missing_tier_field(self, client):
        """缺 tier 字段 → None → 用当前值（不报错）。"""
        resp = client.post("/performance_tier", json={})
        assert resp.status_code == 200


# ── _tier_capture_params 集成 ─────────────────────────────────


class TestTierCaptureParams:
    """_tier_capture_params() 读取档位默认截帧参数。"""

    def test_reads_low_tier_params(self, monkeypatch):
        monkeypatch.setattr(
            "backend.app.services.pipeline_tasks.load_settings",
            lambda: AppSettings(performance=PerformanceConfig(tier="low")),
        )
        from backend.app.services.pipeline_tasks import _tier_capture_params

        params = _tier_capture_params()
        assert params.mode == "interval"
        assert params.interval_sec == 8
        assert params.max_frames == 30
        assert params.frames_per_shot == 3

    def test_reads_high_tier_params(self, monkeypatch):
        monkeypatch.setattr(
            "backend.app.services.pipeline_tasks.load_settings",
            lambda: AppSettings(performance=PerformanceConfig(tier="high")),
        )
        from backend.app.services.pipeline_tasks import _tier_capture_params

        params = _tier_capture_params()
        assert params.interval_sec == 3
        assert params.max_frames == 100

    def test_reads_medium_tier_params(self, monkeypatch):
        monkeypatch.setattr(
            "backend.app.services.pipeline_tasks.load_settings",
            lambda: AppSettings(performance=PerformanceConfig(tier="medium")),
        )
        from backend.app.services.pipeline_tasks import _tier_capture_params

        params = _tier_capture_params()
        assert params.interval_sec == 5
        assert params.max_frames == 60
