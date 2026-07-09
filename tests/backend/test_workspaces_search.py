"""Phase 3B.2：POST /workspaces/{ws}/search 检索端点测试。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.routes import workspaces as ws_module
from backend.app.services import workspace_knowledge as wk
from backend.app.services import workspace_search_service as wss
from backend.app.services.workspace_store import WorkspaceStore
from shared import knowledge_base as kb


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")
    rec = WorkspaceRecord(workspace_id="ws_a", name="A 空间")
    rec.items = [
        WorkspaceItem(
            item_id="it_v1",
            type="video",
            source="url",
            source_value="https://x/v1",
            name="发布会片段",
            results={
                "video_title": "发布会片段",
                "frames": [{"timestamp": "00:10", "description_zh": "产品特写"}],
            },
        ),
    ]
    isolated_store.create(rec)

    # 隔离 FAISS 缓存目录
    monkeypatch.setattr(wk, "CACHE_DIR", tmp_path / "embeddings_cache")

    # mock 嵌入 / rerank / settings / LLM
    monkeypatch.setattr(kb, "SHORT_MODE_MAX_CHARS", 1)
    monkeypatch.setattr(
        kb,
        "create_embeddings",
        lambda api_key, model, inputs, on_batch=None: [[0.1 + i * 0.01 for i in range(16)] for _ in inputs],
    )
    monkeypatch.setattr(
        kb,
        "rerank_documents",
        lambda api_key, model, query, documents, top_n: [{"index": 0, "relevance_score": 0.9}],
    )

    fake_settings = MagicMock()
    fake_settings.openai_api_key = "fake-key"
    fake_settings.text_model = "gpt-x"
    monkeypatch.setattr(wss, "load_settings", lambda: fake_settings)
    monkeypatch.setattr(wss, "_llm_answer", lambda query, context: f"answer for: {query[:20]}")

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


def test_workspace_search_happy_path(client: TestClient) -> None:
    resp = client.post("/workspaces/ws_a/search", json={"query": "产品特写", "top_k": 3})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "answer" in data and data["answer"].startswith("answer for:")
    assert isinstance(data["sources"], list) and len(data["sources"]) >= 1
    src = data["sources"][0]
    for k in (
        "workspace_id",
        "workspace_name",
        "item_id",
        "item_type",
        "item_title",
        "chunk_excerpt",
        "score",
        "jump_url",
    ):
        assert k in src
    assert src["workspace_id"] == "ws_a"
    assert src["item_id"] == "it_v1"
    assert src["jump_url"] == "/workspaces/ws_a/items/it_v1/video_result"


def test_workspace_search_unknown_workspace_returns_404(client: TestClient) -> None:
    resp = client.post("/workspaces/ws_missing/search", json={"query": "anything"})
    assert resp.status_code == 404
