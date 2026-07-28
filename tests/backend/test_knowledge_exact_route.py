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
