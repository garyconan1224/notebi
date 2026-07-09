"""IP.7.1 — POST /workspaces/auto-create 测试。

验证：
  happy path  — LLM 返回合法名称，workspace 创建成功
  fallback    — LLM 抛异常，用 hostname + 时间 fallback 名称
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

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


def test_auto_create_happy_path(client: TestClient) -> None:
    """LLM 正常返回名称时，workspace 创建成功且 name 非空。"""
    with patch.object(ws_module, "_generate_workspace_name", return_value="人工智能科普视频"):
        resp = client.post("/workspaces/auto-create", json={
            "hint_url": "https://www.bilibili.com/video/BV1xx411c7mD",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["workspace_id"]
    assert data["name"] == "人工智能科普视频"


def test_auto_create_llm_fallback(client: TestClient) -> None:
    """LLM 抛异常时，fallback 到 hostname + 时间格式。"""
    # 不 mock _generate_workspace_name，而是让内部 LLM 调用失败走 fallback
    mock_reg = MagicMock()
    mock_reg.resolve_default_profile.side_effect = RuntimeError("no provider")

    with patch("src.vidmirror.core.providers.registry.create_default_registry", return_value=mock_reg):
        resp = client.post("/workspaces/auto-create", json={
            "hint_url": "https://www.bilibili.com/video/BV1xx411c7mD",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["workspace_id"]
    assert "Bilibili" in data["name"] or "工作空间" in data["name"]
