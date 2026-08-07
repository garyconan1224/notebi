"""AI 产物更新端点：行动项打勾持久化 + 仅思维导图/行动项可原地更新。"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """每个测试用独立 data 目录。"""
    store = WorkspaceStore(root=tmp_path / "workspaces")
    monkeypatch.setattr(ws_module, "_store", store)
    app = FastAPI()
    app.include_router(ws_module.router)
    with TestClient(app) as c:
        yield c


def _create_ws_and_item(client: TestClient) -> tuple[str, str]:
    ws = client.post("/workspaces", json={"name": "artifact-update-test"}).json()
    ws_id = ws["workspace_id"]
    resp = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "source": "local",
            "source_value": "/tmp/test.txt",
            "type": "text",
            "name": "测试笔记",
        },
    )
    items = resp.json()["items"]
    return ws_id, items[-1]["item_id"]


def _seed_artifact(
    client: TestClient,
    ws_id: str,
    item_id: str,
    kind: str,
    content_json: dict,
    artifact_id: str = "artifact-1",
) -> None:
    ws_module._store.append_item_result(
        ws_id,
        item_id,
        "ai_artifacts",
        {
            "artifact_id": artifact_id,
            "kind": kind,
            "title": kind,
            "content_md": "",
            "source_scope": "full_note",
            "original_text": "",
            "model_used": "m",
            "created_at": "2026-08-07T00:00:00Z",
            "content_json": content_json,
        },
    )


def test_action_items_toggle_persists(client: TestClient) -> None:
    """行动项打勾：PUT 后读回，done 状态被持久化。"""
    ws_id, item_id = _create_ws_and_item(client)
    _seed_artifact(
        client,
        ws_id,
        item_id,
        "action_items",
        {"items": [{"id": "a0", "text": "写周报", "done": False}]},
    )

    resp = client.put(
        f"/workspaces/{ws_id}/items/{item_id}/artifacts/artifact-1",
        json={"content_json": {"items": [{"id": "a0", "text": "写周报", "done": True}]}},
    )
    assert resp.status_code == 200

    artifacts = client.get(f"/workspaces/{ws_id}/items/{item_id}/artifacts").json()
    entry = next(a for a in artifacts if a["artifact_id"] == "artifact-1")
    assert entry["content_json"]["items"][0]["done"] is True


def test_action_items_invalid_shape_rejected(client: TestClient) -> None:
    """行动项校验：done 非布尔或缺少 text/id 时 400。"""
    ws_id, item_id = _create_ws_and_item(client)
    _seed_artifact(client, ws_id, item_id, "action_items", {"items": []})

    resp = client.put(
        f"/workspaces/{ws_id}/items/{item_id}/artifacts/artifact-1",
        json={"content_json": {"items": [{"id": "a0", "text": "x", "done": "yes"}]}},
    )
    assert resp.status_code == 400


def test_unsupported_kind_update_rejected(client: TestClient) -> None:
    """非思维导图/行动项产物不允许原地更新。"""
    ws_id, item_id = _create_ws_and_item(client)
    _seed_artifact(client, ws_id, item_id, "key_cards", {"cards": []})

    resp = client.put(
        f"/workspaces/{ws_id}/items/{item_id}/artifacts/artifact-1",
        json={"content_json": {"cards": []}},
    )
    assert resp.status_code == 400
