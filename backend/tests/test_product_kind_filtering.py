from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services.workspace_store import WorkspaceStore
from shared.knowledge_base import ShortKnowledge


def _record(workspace_id: str, kind: str, name: str) -> WorkspaceRecord:
    return WorkspaceRecord(
        workspace_id=workspace_id,
        name=name,
        kind=kind,
        items=[
            WorkspaceItem(
                item_id=f"{workspace_id}-item",
                type="text",
                source="local",
                source_value=f"{name}.txt",
                name=f"{name} item",
                results={"summary": f"{name} summary"},
            )
        ],
    )


def test_workspace_store_list_all_filters_by_kinds(tmp_path):
    store = WorkspaceStore(root=tmp_path)
    store.create(_record("note-1", "note", "Note"))
    store.create(_record("replica-1", "replica", "Replica"))

    assert {rec.workspace_id for rec in store.list_all(kinds=["note"])} == {"note-1"}
    assert {rec.workspace_id for rec in store.list_all(kinds=["replica"])} == {"replica-1"}
    assert {rec.workspace_id for rec in store.list_all(kinds=["note", "replica"])} == {
        "note-1",
        "replica-1",
    }

    with pytest.raises(ValueError):
        store.list_all(kinds=["storyboard"])


def test_search_across_workspaces_filters_explicit_workspace_ids_by_kinds(tmp_path, monkeypatch):
    from backend.app.services import workspace_search_service as search_service

    store = WorkspaceStore(root=tmp_path)
    store.create(_record("note-1", "note", "Note"))
    store.create(_record("replica-1", "replica", "Replica"))

    monkeypatch.setattr(search_service, "_resolve_api_key", lambda _api_key: "key")
    monkeypatch.setattr(search_service, "get_reranker_model_for_rag", lambda _settings: "rerank")
    monkeypatch.setattr(
        search_service,
        "build_or_load_workspace_index",
        lambda workspace_id, *_args, **_kwargs: (
            ShortKnowledge(
                mode="short",
                combined_json_text=f"{workspace_id} content",
                total_chars=20,
            ),
            {},
        ),
    )
    monkeypatch.setattr(
        search_service,
        "rerank_documents",
        lambda *_args, **_kwargs: [{"index": 0, "relevance_score": 1.0}],
    )
    monkeypatch.setattr(search_service, "_llm_answer", lambda *_args, **_kwargs: "answer")

    result = search_service.search_across_workspaces(
        query="test",
        workspace_ids=["note-1", "replica-1"],
        kinds=["note"],
        store=store,
    )

    assert [source["workspace_id"] for source in result["sources"]] == ["note-1"]


def test_global_knowledge_status_filters_indexable_records_by_kinds(tmp_path, monkeypatch):
    from backend.app.services import global_knowledge

    store = WorkspaceStore(root=tmp_path)
    store.create(_record("note-1", "note", "Note"))
    store.create(_record("replica-1", "replica", "Replica"))

    monkeypatch.setattr(global_knowledge, "load_settings", lambda: SimpleNamespace())
    monkeypatch.setattr(global_knowledge, "get_embedding_model_for_rag", lambda _settings: "embed")
    monkeypatch.setattr(global_knowledge, "_global_meta", lambda *_args, **_kwargs: None)

    records = global_knowledge._indexable_records(store, allowed_kinds=["note"])
    status = global_knowledge.get_global_status(store=store, allowed_kinds=["note"])

    assert [rec.workspace_id for rec in records] == ["note-1"]
    assert status["workspace_count"] == 1
    assert status["indexable_workspace_count"] == 1
    assert status["stale_workspace_ids"] == ["note-1"]


def test_ask_global_filters_subrange_cache_build_by_kinds(tmp_path, monkeypatch):
    from backend.app.services import global_knowledge
    import shared.knowledge_base as knowledge_base

    store = WorkspaceStore(root=tmp_path)
    store.create(_record("note-1", "note", "Note"))
    store.create(_record("replica-1", "replica", "Replica"))

    monkeypatch.setattr(global_knowledge, "load_settings", lambda: SimpleNamespace())
    monkeypatch.setattr(global_knowledge, "get_embedding_model_for_rag", lambda _settings: "embed")
    monkeypatch.setattr(global_knowledge, "_resolve_api_key", lambda _api_key: "key")
    monkeypatch.setattr(global_knowledge, "_load_from_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(global_knowledge, "_load_short_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(global_knowledge, "_persist_short_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(global_knowledge, "_persist_long_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(global_knowledge, "_global_meta", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(global_knowledge, "_llm_answer", lambda *_args, **_kwargs: "answer")
    monkeypatch.setattr(
        knowledge_base,
        "load_folder_as_knowledge",
        lambda *_args, **_kwargs: ShortKnowledge(
            mode="short",
            combined_json_text="note content",
            total_chars=20,
        ),
    )

    result = global_knowledge.ask_global(
        question="test",
        workspace_ids=["note-1", "replica-1"],
        allowed_kinds=["note"],
        store=store,
    )

    assert [source["workspace_id"] for source in result["sources"]] == ["note-1"]
