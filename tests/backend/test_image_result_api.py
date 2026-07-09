from __future__ import annotations

"""Phase 1H — 图片结果页端点测试。

覆盖：
  GET happy path 返回 demo fixture（含 prompts / tags / exif）
  GET 404 workspace 不存在
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore
from backend.app.models.workspace import ItemType


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """每个测试用独立 data 目录。"""
    fake_data = tmp_path / "workspaces"
    monkeypatch.setattr(ws_module, "_store", WorkspaceStore(root=fake_data))
    app = FastAPI()
    app.include_router(ws_module.router)
    with TestClient(app) as c:
        yield c


def _create_image_workspace(client: TestClient) -> tuple[str, str]:
    """辅助：创建一个含图片素材的 workspace，返回 (ws_id, item_id)。"""
    ws = client.post("/workspaces", json={"name": "img-test"}).json()
    ws_id = ws["workspace_id"]
    rec = client.post(
        f"/workspaces/{ws_id}/items",
        json={"source": "url", "source_value": "https://example.com/photo.jpg", "name": "photo", "type": "image"},
    ).json()
    item_id = rec["items"][-1]["item_id"]
    return ws_id, item_id


def test_image_result_happy_path(client: TestClient) -> None:
    ws_id, item_id = _create_image_workspace(client)
    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/image_result")
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "demo_fixture"
    assert "image_url" in body["image"]
    assert body["image"]["item_id"] == item_id
    # prompts 结构
    assert "mj" in body["prompts"]
    assert "sd" in body["prompts"]
    assert "positive" in body["prompts"]["sd"]
    # tags 结构
    for key in ("subject", "scene", "style", "lighting", "color", "composition", "lens"):
        assert key in body["tags"]
    # exif
    assert body["exif"]["time"]
    assert body["exif"]["device"]
    assert body["exif"]["aperture"]
    assert body["exif"]["gps"]["lat"]
    # dimensions
    assert body["dimensions"]["width"] == 6000
    assert body["dimensions"]["format"] == "JPEG"
    # description / ocr_text
    assert body["description"]
    assert "ocr_text" in body


def test_image_result_404_workspace_not_found(client: TestClient) -> None:
    resp = client.get("/workspaces/nonexistent/items/anything/image_result")
    assert resp.status_code == 404
    assert "workspace not found" in resp.json()["detail"]
