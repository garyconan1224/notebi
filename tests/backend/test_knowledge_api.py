from __future__ import annotations

from pathlib import Path

import pytest

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services import global_knowledge as gk
from backend.app.services import workspace_knowledge as wk
from backend.app.services import workspace_search_service as wss
from backend.app.services.workspace_store import WorkspaceStore
from shared import knowledge_base as kb
from shared.settings_store import AppSettings


def _make_store(tmp_path: Path) -> WorkspaceStore:
    store = WorkspaceStore(root=tmp_path / "workspaces")
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
        )
    ]
    store.create(rec)
    return store


def test_global_knowledge_status_rebuild_and_ask(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = _make_store(tmp_path)
    settings = AppSettings(openai_api_key="fake-key", text_model="gpt-x")

    monkeypatch.setattr(wk, "CACHE_DIR", tmp_path / "embeddings_cache")
    monkeypatch.setattr(gk, "load_settings", lambda: settings)
    monkeypatch.setattr(wss, "load_settings", lambda: settings)
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
    monkeypatch.setattr(
        wss,
        "rerank_documents",
        lambda api_key, model, query, documents, top_n: [
            {"index": i, "relevance_score": 0.9 - i * 0.1} for i in range(len(documents))
        ],
    )
    monkeypatch.setattr(gk, "_llm_answer", lambda query, context: f"answer for: {query[:20]}")

    initial = gk.get_global_status(store=store)
    assert initial["item_count"] == 1
    assert initial["ready"] is False

    gk._run_rebuild(
        force=False,
        store=store,
        task_store=None,
        api_key="fake-key",
        embedding_model="BAAI/bge-m3",
    )
    ready = gk.get_global_status(store=store)
    assert ready["ready"] is True
    assert ready["indexed_item_count"] == 1
    assert ready["rebuild"]["error"] is None

    res = gk.ask_global(question="产品特写", store=store)
    assert res["answer"].startswith("answer for:")
    assert res["sources"][0]["workspace_id"] == "ws_a"
    assert res["status"]["ready"] is True


def test_global_knowledge_short_cache_ready(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = _make_store(tmp_path)
    settings = AppSettings(openai_api_key="fake-key", text_model="gpt-x")

    monkeypatch.setattr(wk, "CACHE_DIR", tmp_path / "embeddings_cache")
    monkeypatch.setattr(gk, "load_settings", lambda: settings)
    monkeypatch.setattr(wss, "load_settings", lambda: settings)
    monkeypatch.setattr(gk, "_llm_answer", lambda query, context: f"short answer for: {query[:20]}")

    gk._run_rebuild(
        force=False,
        store=store,
        task_store=None,
        api_key="fake-key",
        embedding_model="BAAI/bge-m3",
    )

    ready = gk.get_global_status(store=store)
    assert ready["ready"] is True
    assert ready["indexed_item_count"] == 1

    res = gk.ask_global(question="产品特写", store=store)
    assert res["answer"].startswith("short answer for:")
    assert res["sources"][0]["workspace_id"] == "ws_a"
