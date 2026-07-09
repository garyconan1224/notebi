from __future__ import annotations

"""Phase 2C.2 — 文本结果页 API 测试。

验证：
  happy path — text item 有 task 结果时 GET text_result 返回正文 + 摘要 + prompt_versions
  error path — text 任务未跑完时 404
  error path — 非 text item 调 text_result 返回 400
"""

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch

from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path):
    """每个测试用独立临时目录的 WorkspaceStore + 项目目录。"""
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")

    mock_runner = MagicMock()
    mock_runner.store.get.return_value = None

    app = FastAPI()
    with (
        patch.object(ws_module, "_store", isolated_store),
        patch.object(ws_module, "_pipeline_runner", mock_runner),
        patch.object(ws_module, "DATA_DIR", tmp_path),
    ):
        app.include_router(ws_module.router)
        with TestClient(app) as c:
            yield c


def _create_ws_with_text_item(client: TestClient) -> tuple[str, str, str]:
    """创建 workspace + text item，返回 (ws_id, item_id, project_id)。"""
    resp = client.post("/workspaces", json={"name": "测试空间", "project_id": "proj1"})
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
    return ws_id, item_id, "proj1"


# ── Happy path ────────────────────────────────────────────────────────────────


def test_text_result_from_task_result(client: TestClient, tmp_path: Path) -> None:
    """text item 的 task 有结果时，GET text_result 返回完整数据。"""
    ws_id, item_id, project_id = _create_ws_with_text_item(client)

    # 模拟 task_runner.store.get 返回有 result 的 task
    mock_task = MagicMock()
    mock_task.result = {
        "title": "测试文章",
        "content": "这是一篇测试文章的正文。",
        "summary": "这是摘要。",
        "char_count": 20,
        "source_type": "url",
        "source": "https://example.com/article",
        "meta": {},
    }

    # 先把 task_id 写入 item.related_task_ids
    ws_module._store.update_item(
        ws_id, item_id, related_task_ids=["task-001"]
    )
    ws_module._pipeline_runner.store.get.return_value = mock_task

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/text_result")
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "测试文章"
    assert data["content"] == "这是一篇测试文章的正文。"
    assert data["summary"] == "这是摘要。"
    assert "prompt_versions" in data


def test_text_result_with_prompt_versions(client: TestClient) -> None:
    """text result 应包含 prompt_versions。"""
    ws_id, item_id, _ = _create_ws_with_text_item(client)

    # 加两个提示词版本
    base = f"/workspaces/{ws_id}/items/{item_id}/prompts/versions"
    client.post(base, json={"content": "提示词 v1"})
    client.post(base, json={"content": "提示词 v2"})

    # 模拟 task result
    mock_task = MagicMock()
    mock_task.result = {
        "title": "文章",
        "content": "正文",
        "summary": "",
        "char_count": 2,
        "source_type": "url",
        "source": "https://example.com",
        "meta": {},
    }
    ws_module._store.update_item(ws_id, item_id, related_task_ids=["task-002"])
    ws_module._pipeline_runner.store.get.return_value = mock_task

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/text_result")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["prompt_versions"]) == 2
    assert data["prompt_versions"][0]["content"] == "提示词 v1"


# ── Error path ────────────────────────────────────────────────────────────────


def test_text_result_not_ready(client: TestClient) -> None:
    """text 任务未跑完时 GET text_result 返回 404。"""
    ws_id, item_id, _ = _create_ws_with_text_item(client)

    # 没有 related_task_ids，也没有 task result
    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/text_result")
    assert resp.status_code == 404


def test_text_result_wrong_item_type(client: TestClient) -> None:
    """非 text item 调 text_result 返回 400。"""
    resp = client.post("/workspaces", json={"name": "空间"})
    ws_id = resp.json()["workspace_id"]

    resp = client.post(
        f"/workspaces/{ws_id}/items",
        json={"type": "video", "source": "url", "source_value": "https://example.com/v.mp4"},
    )
    video_item_id = resp.json()["items"][0]["item_id"]

    resp = client.get(f"/workspaces/{ws_id}/items/{video_item_id}/text_result")
    assert resp.status_code == 400
