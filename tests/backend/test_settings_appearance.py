"""Q6 / D6：外观设置后端持久化（theme/mode/fonts 三槽位）。

链路硬约束：写入 → GET/readback → 从回读值更新 UI；不能只写 localStorage。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

import shared.appearance_store as appearance_store_module
from backend.app.routes.settings import router as settings_router


@pytest.fixture
def client(tmp_path: Path, monkeypatch: MonkeyPatch) -> TestClient:
    store_dir = tmp_path / ".local"
    monkeypatch.setattr(
        appearance_store_module, "SETTINGS_PATH", store_dir / "appearance_settings.json"
    )
    monkeypatch.setattr(appearance_store_module, "STORE_DIR", store_dir)

    app = FastAPI()
    app.include_router(settings_router)
    return TestClient(app)


def test_get_settings_returns_defaults(client: TestClient) -> None:
    resp = client.get("/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["theme"] == "paper"
    assert data["mode"] == "system"
    assert data["fonts"] == {"ui": None, "cap": None, "sum": None}


def test_patch_theme_and_mode_then_readback(client: TestClient) -> None:
    resp = client.patch("/settings", json={"theme": "midnight", "mode": "dark"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["theme"] == "midnight"
    assert body["mode"] == "dark"

    # GET 回读一致（持久化，不只是内存态）
    again = client.get("/settings").json()
    assert again["theme"] == "midnight"
    assert again["mode"] == "dark"


def test_patch_fonts_slots_then_readback(client: TestClient) -> None:
    resp = client.patch(
        "/settings",
        json={"fonts": {"cap": "Noto Serif SC"}},
    )
    assert resp.status_code == 200
    again = client.get("/settings").json()
    assert again["fonts"]["cap"] == "Noto Serif SC"
    # 未 PATCH 的槽位保持默认
    assert again["fonts"]["ui"] is None
    assert again["fonts"]["sum"] is None


def test_patch_rejects_unknown_theme_or_mode(client: TestClient) -> None:
    assert client.patch("/settings", json={"theme": "neon"}).status_code == 422
    assert client.patch("/settings", json={"mode": "auto"}).status_code == 422
    # 拒绝后原值不变
    data = client.get("/settings").json()
    assert data["theme"] == "paper"
    assert data["mode"] == "system"
