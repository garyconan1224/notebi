from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import knowledge as routes
from backend.app.services.exact_search_service import ExactSearchService
from backend.app.services.retrieval_service import RetrievalService
from backend.app.services.workspace_store import WorkspaceStore


def test_knowledge_exact_route_returns_original_fields_without_llm(
    retrieval_store: WorkspaceStore,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exact = ExactSearchService(
        store=retrieval_store,
        database_path=tmp_path / "search.sqlite3",
    )
    service = RetrievalService(store=retrieval_store, exact_service=exact)
    monkeypatch.setattr(routes, "_workspace_store", retrieval_store)
    monkeypatch.setattr(routes, "_retrieval", lambda: service)
    monkeypatch.setattr(
        "backend.app.services.workspace_search_service.search_across_workspaces",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("LLM path called")),
    )
    app = FastAPI()
    app.include_router(routes.router)
    client = TestClient(app)

    response = client.get(
        "/knowledge/search",
        params={"query": "产品", "workspace_ids": "ws_alpha"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "exact"
    assert payload["answer"] == ""
    assert payload["sources"]
    assert {
        source["field"] for source in payload["sources"]
    } & {"title", "summary", "transcript"}
    assert all(source["jump_url"] for source in payload["sources"])
    assert all(source["source_id"] for source in payload["sources"])


def test_knowledge_exact_route_rejects_unknown_workspace(
    retrieval_store: WorkspaceStore,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = RetrievalService(
        store=retrieval_store,
        exact_service=ExactSearchService(
            store=retrieval_store,
            database_path=tmp_path / "search.sqlite3",
        ),
    )
    monkeypatch.setattr(routes, "_workspace_store", retrieval_store)
    monkeypatch.setattr(routes, "_retrieval", lambda: service)
    app = FastAPI()
    app.include_router(routes.router)

    response = TestClient(app).get(
        "/knowledge/search",
        params={"query": "产品", "workspace_ids": "missing"},
    )

    assert response.status_code == 422


def test_knowledge_ask_accepts_a_single_note_scope(
    retrieval_store: WorkspaceStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class _Retrieval:
        def search(self, **kwargs):
            captured.update(kwargs)
            return {"answer": "仅来自所选笔记", "sources": []}

    monkeypatch.setattr(routes, "_workspace_store", retrieval_store)
    monkeypatch.setattr(routes, "_retrieval", lambda: _Retrieval())
    app = FastAPI()
    app.include_router(routes.router)

    response = TestClient(app).post("/knowledge/ask", json={
        "question": "这篇笔记说了什么？",
        "item_refs": [{"workspace_id": "ws_alpha", "item_id": "text-note"}],
    })

    assert response.status_code == 200
    assert captured["item_refs"] == [{"workspace_id": "ws_alpha", "item_id": "text-note"}]


def test_knowledge_exact_post_supports_a_single_note_scope(
    retrieval_store: WorkspaceStore,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = RetrievalService(
        store=retrieval_store,
        exact_service=ExactSearchService(
            store=retrieval_store,
            database_path=tmp_path / "search.sqlite3",
        ),
    )
    monkeypatch.setattr(routes, "_workspace_store", retrieval_store)
    monkeypatch.setattr(routes, "_retrieval", lambda: service)
    app = FastAPI()
    app.include_router(routes.router)

    response = TestClient(app).post("/knowledge/search", json={
        "question": "独立编辑",
        "item_refs": [{"workspace_id": "ws_alpha", "item_id": "text-note"}],
    })

    assert response.status_code == 200
    assert {source["item_id"] for source in response.json()["sources"]} == {"text-note"}
