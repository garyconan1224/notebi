from __future__ import annotations

"""Phase 1G+ — /prompt_formats_config 端点测试。

覆盖：
  GET 首次返回种子（12 条）
  POST 整体覆盖 formats + active ids，幂等读回
  POST 校验：重复 id 400 / 非法 category 400
  POST /reset 恢复默认
  active_*_ids 含未知 id 时被静默过滤
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import prompt_formats as pf_module
from shared import settings_store as ss_module


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """每个测试用独立 .local/settings.json，避免污染真实配置。"""
    fake_dir = tmp_path / ".local"
    monkeypatch.setattr(ss_module, "SETTINGS_DIR", fake_dir)
    monkeypatch.setattr(ss_module, "SETTINGS_PATH", fake_dir / "settings.json")
    app = FastAPI()
    app.include_router(pf_module.router)
    with TestClient(app) as c:
        yield c


def test_get_returns_seed_when_empty(client: TestClient) -> None:
    resp = client.get("/prompt_formats_config")
    assert resp.status_code == 200
    body = resp.json()
    # 12 条种子：图片 5 + 视频 7
    assert len(body["formats"]) == 12
    cats = {f["category"] for f in body["formats"]}
    assert cats == {"image", "video"}
    assert body["active_image_ids"] == ["mj", "nano_banana", "gpt_image"]
    assert body["active_video_ids"] == ["kling_3", "jimeng_2", "veo_3_1"]
    mj = next(f for f in body["formats"] if f["id"] == "mj")
    assert "--ar 16:9" in mj["template"]
    assert mj["is_default"] is True


def test_post_overwrites_and_persists(client: TestClient) -> None:
    payload = {
        "formats": [
            {"id": "mj", "name": "Midjourney 改", "category": "image", "template": "X", "description": "", "is_default": True},
            {"id": "custom1", "name": "我的格式", "category": "image", "template": "{description}", "description": "", "is_default": False},
        ],
        "active_image_ids": ["mj", "custom1"],
        "active_video_ids": [],
    }
    resp = client.post("/prompt_formats_config", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["formats"]) == 2
    assert body["active_image_ids"] == ["mj", "custom1"]

    # 再 GET 验证落库
    body2 = client.get("/prompt_formats_config").json()
    assert [f["id"] for f in body2["formats"]] == ["mj", "custom1"]


def test_post_rejects_duplicate_id(client: TestClient) -> None:
    payload = {
        "formats": [
            {"id": "mj", "name": "A", "category": "image", "template": "", "description": "", "is_default": False},
            {"id": "mj", "name": "B", "category": "image", "template": "", "description": "", "is_default": False},
        ],
    }
    resp = client.post("/prompt_formats_config", json=payload)
    assert resp.status_code == 400
    assert "duplicate" in resp.json()["detail"].lower()


def test_post_rejects_invalid_category(client: TestClient) -> None:
    payload = {
        "formats": [
            {"id": "x", "name": "X", "category": "audio", "template": "", "description": "", "is_default": False},
        ],
    }
    resp = client.post("/prompt_formats_config", json=payload)
    assert resp.status_code == 400
    assert "invalid category" in resp.json()["detail"].lower()


def test_active_ids_unknown_silently_filtered(client: TestClient) -> None:
    payload = {
        "formats": [
            {"id": "only_one", "name": "唯一", "category": "image", "template": "", "description": "", "is_default": False},
        ],
        "active_image_ids": ["only_one", "ghost"],
    }
    resp = client.post("/prompt_formats_config", json=payload)
    assert resp.status_code == 200
    assert resp.json()["active_image_ids"] == ["only_one"]


def test_reset_restores_seed(client: TestClient) -> None:
    # 先污染
    client.post(
        "/prompt_formats_config",
        json={"formats": [{"id": "only", "name": "x", "category": "image", "template": "", "description": "", "is_default": False}]},
    )
    # 重置
    resp = client.post("/prompt_formats_config/reset")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["formats"]) == 12
    assert body["active_image_ids"] == ["mj", "nano_banana", "gpt_image"]
