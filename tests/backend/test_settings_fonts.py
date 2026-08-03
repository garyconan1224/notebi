"""Q6 / D6：字体上传安全边界。

- 仅 WOFF2/WOFF/TTF/OTF（扩展名 + 文件签名双校验）；
- 单文件 ≤20MB；
- 存 data/fonts/<id>/，以生成 id 提供，不用用户文件名拼路径；
- 被使用字体不可直接删除（先回退槽位）。
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

import shared.appearance_store as appearance_store_module
import backend.app.routes.settings as settings_route
from backend.app.routes.settings import router as settings_router

WOFF2_MAGIC = b"wOF2"
WOFF_MAGIC = b"wOFF"
OTTO_MAGIC = b"OTTO"
TTF_MAGIC = b"\x00\x01\x00\x00"


@pytest.fixture
def client(tmp_path: Path, monkeypatch: MonkeyPatch) -> TestClient:
    store_dir = tmp_path / ".local"
    fonts_dir = tmp_path / "data" / "fonts"
    monkeypatch.setattr(
        appearance_store_module, "SETTINGS_PATH", store_dir / "appearance_settings.json"
    )
    monkeypatch.setattr(appearance_store_module, "STORE_DIR", store_dir)
    monkeypatch.setattr(settings_route, "FONTS_ROOT", fonts_dir)

    app = FastAPI()
    app.include_router(settings_router)
    return TestClient(app)


def _font_file(magic: bytes, name: str = "font.woff2") -> dict:
    payload = magic + b"\x00" * 64
    return {"file": (name, io.BytesIO(payload), "application/octet-stream")}


def test_upload_woff2_success_stores_under_generated_id(client: TestClient) -> None:
    resp = client.post("/settings/fonts", files=_font_file(WOFF2_MAGIC, "my font.woff2"))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    font_id = body["id"]
    family = body["family"]
    assert font_id and family

    # 落盘在 fonts/<id>/ 下，文件名不含用户原始文件名
    saved = list((settings_route.FONTS_ROOT / font_id).iterdir())
    assert len(saved) == 1
    assert "my font" not in saved[0].name

    # GET 回读包含已上传字体
    settings = client.get("/settings").json()
    uploaded = settings.get("uploaded_fonts") or []
    assert any(entry["id"] == font_id for entry in uploaded)


@pytest.mark.parametrize(
    "magic,name",
    [
        (WOFF_MAGIC, "a.woff"),
        (OTTO_MAGIC, "a.otf"),
        (TTF_MAGIC, "a.ttf"),
    ],
)
def test_upload_other_allowed_formats(client: TestClient, magic: bytes, name: str) -> None:
    resp = client.post("/settings/fonts", files=_font_file(magic, name))
    assert resp.status_code == 201, resp.text


def test_upload_rejects_bad_extension(client: TestClient) -> None:
    resp = client.post("/settings/fonts", files=_font_file(WOFF2_MAGIC, "evil.exe"))
    assert resp.status_code == 422


def test_upload_rejects_bad_signature(client: TestClient) -> None:
    # 扩展名是 woff2 但内容不是字体
    resp = client.post(
        "/settings/fonts",
        files={"file": ("fake.woff2", io.BytesIO(b"MZ\x90\x00not-a-font"), "application/octet-stream")},
    )
    assert resp.status_code == 422


def test_upload_rejects_oversize(client: TestClient) -> None:
    big = WOFF2_MAGIC + b"\x00" * (20 * 1024 * 1024 + 1)
    resp = client.post(
        "/settings/fonts",
        files={"file": ("big.woff2", io.BytesIO(big), "application/octet-stream")},
    )
    assert resp.status_code == 413


def test_delete_unused_font_ok(client: TestClient) -> None:
    created = client.post("/settings/fonts", files=_font_file(WOFF2_MAGIC)).json()
    resp = client.delete(f"/settings/fonts/{created['id']}")
    assert resp.status_code == 204
    settings = client.get("/settings").json()
    assert all(entry["id"] != created["id"] for entry in settings.get("uploaded_fonts", []))
    assert not (settings_route.FONTS_ROOT / created["id"]).exists()


def test_delete_in_use_font_rejected(client: TestClient) -> None:
    created = client.post("/settings/fonts", files=_font_file(WOFF2_MAGIC)).json()
    family = created["family"]
    # 把该字体用到字幕槽
    client.patch("/settings", json={"fonts": {"cap": family}})

    resp = client.delete(f"/settings/fonts/{created['id']}")
    assert resp.status_code == 409
    # 未被删除
    assert (settings_route.FONTS_ROOT / created["id"]).exists()

    # 先回退槽位再删 → 成功
    client.patch("/settings", json={"fonts": {"cap": None}})
    assert client.delete(f"/settings/fonts/{created['id']}").status_code == 204
