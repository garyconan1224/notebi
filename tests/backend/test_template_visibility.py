"""Q5 / 反馈 #12：模板「新建可见」show_in_create 持久化与回读。

- GET /templates 每个模板带 show_in_create（缺省 true，旧数据兼容）；
- PATCH /templates/{id}/visibility 写入后 GET 回读一致；
- 内置模板同样可设置可见性。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

import shared.template_store as template_store_module
from backend.app.routes.templates import router as templates_router


@pytest.fixture
def client(tmp_path: Path, monkeypatch: MonkeyPatch) -> TestClient:
    store_dir = tmp_path / ".local"
    monkeypatch.setattr(template_store_module, "STORE_DIR", store_dir)
    monkeypatch.setattr(
        template_store_module, "STORE_PATH", store_dir / "video_templates.json"
    )
    monkeypatch.setattr(
        template_store_module, "VISIBILITY_PATH", store_dir / "template_visibility.json"
    )

    app = FastAPI()
    app.include_router(templates_router)
    return TestClient(app)


def test_templates_default_show_in_create_true(client: TestClient) -> None:
    resp = client.get("/templates", params={"category": "style_video_with_frames"})
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) > 0
    assert all(item.get("show_in_create") is True for item in items)


def test_patch_visibility_then_readback(client: TestClient) -> None:
    listing = client.get("/templates", params={"category": "style_video_with_frames"}).json()
    target = listing[0]

    resp = client.patch(
        f"/templates/{target['template_id']}/visibility",
        json={"show_in_create": False},
    )
    assert resp.status_code == 200
    assert resp.json().get("show_in_create") is False

    # GET 回读一致（含内置模板场景：id 不在自定义文件里也生效）
    after = client.get("/templates", params={"category": "style_video_with_frames"}).json()
    updated = next(t for t in after if t["template_id"] == target["template_id"])
    assert updated["show_in_create"] is False
    # 其他模板不受影响
    others = [t for t in after if t["template_id"] != target["template_id"]]
    assert all(t["show_in_create"] is True for t in others)


def test_patch_visibility_rejects_unknown_template(client: TestClient) -> None:
    resp = client.patch(
        "/templates/not-exist-id/visibility",
        json={"show_in_create": False},
    )
    assert resp.status_code == 404
