from __future__ import annotations

"""Phase 2C.2 — 提示词版本栈 API 测试。

验证：
  happy path  — 加 v1 → 加 v2 → list 返回 [v1, v2]
  error path  — item 不存在 → 404
  backward compat — 老 workspace 无 prompt_versions 字段 → list 返回 []
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch

from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path):
    """每个测试用独立临时目录的 WorkspaceStore。"""
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")

    mock_runner = MagicMock()
    mock_runner.store.get.return_value = None

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", isolated_store),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            yield c


def _create_ws_with_item(client: TestClient) -> tuple[str, str]:
    """创建一个 workspace + text item，返回 (ws_id, item_id)。"""
    resp = client.post("/workspaces", json={"name": "测试空间"})
    assert resp.status_code == 200
    ws_id = resp.json()["workspace_id"]

    resp = client.post(
        f"/workspaces/{ws_id}/items",
        json={
            "type": "text",
            "source": "url",
            "source_value": "https://example.com/article",
        },
    )
    assert resp.status_code == 200
    item_id = resp.json()["items"][0]["item_id"]
    return ws_id, item_id


# ── Happy path ────────────────────────────────────────────────────────────────


def test_add_and_list_prompt_versions(client: TestClient) -> None:
    """加 v1 → 加 v2 → list 返回 [v1, v2]，version 自增。"""
    ws_id, item_id = _create_ws_with_item(client)
    base = f"/workspaces/{ws_id}/items/{item_id}/prompts/versions"

    # 加 v1
    resp = client.post(base, json={"content": "提示词 v1"})
    assert resp.status_code == 200
    v1 = resp.json()
    assert v1["version"] == 1
    assert v1["content"] == "提示词 v1"

    # 加 v2
    resp = client.post(base, json={"content": "提示词 v2"})
    assert resp.status_code == 200
    v2 = resp.json()
    assert v2["version"] == 2

    # list
    resp = client.get(base)
    assert resp.status_code == 200
    versions = resp.json()
    assert len(versions) == 2
    assert versions[0]["content"] == "提示词 v1"
    assert versions[1]["content"] == "提示词 v2"


# ── Error path ────────────────────────────────────────────────────────────────


def test_prompt_versions_item_not_found(client: TestClient) -> None:
    """item 不存在时 POST 和 GET 都返回 404。"""
    ws_id, _ = _create_ws_with_item(client)
    fake_item = "nonexistent-item-id"
    base = f"/workspaces/{ws_id}/items/{fake_item}/prompts/versions"

    resp = client.post(base, json={"content": "test"})
    assert resp.status_code == 404

    resp = client.get(base)
    assert resp.status_code == 404


def test_prompt_versions_workspace_not_found(client: TestClient) -> None:
    """workspace 不存在时返回 404。"""
    fake_ws = "nonexistent-ws-id"
    fake_item = "nonexistent-item-id"
    base = f"/workspaces/{fake_ws}/items/{fake_item}/prompts/versions"

    resp = client.post(base, json={"content": "test"})
    assert resp.status_code == 404

    resp = client.get(base)
    assert resp.status_code == 404


# ── Backward compat ───────────────────────────────────────────────────────────


def test_prompt_versions_empty_for_new_workspace(client: TestClient) -> None:
    """新创建的 workspace（无 prompt_versions 数据）list 返回空数组。"""
    ws_id, item_id = _create_ws_with_item(client)
    base = f"/workspaces/{ws_id}/items/{item_id}/prompts/versions"

    resp = client.get(base)
    assert resp.status_code == 200
    assert resp.json() == []
