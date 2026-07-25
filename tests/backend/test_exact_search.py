from __future__ import annotations

import sqlite3
from pathlib import Path

from backend.app.services.exact_search_service import ExactSearchService
from backend.app.services.retrieval_service import RetrievalService
from backend.app.services.workspace_store import WorkspaceStore


def test_exact_search_indexes_transcript_summary_note_and_tags(
    retrieval_store: WorkspaceStore,
    tmp_path: Path,
) -> None:
    service = ExactSearchService(
        store=retrieval_store,
        database_path=tmp_path / "search.sqlite3",
    )
    service.rebuild()

    transcript = service.search("离线搜索")
    summary = service.search("第二版产品总结")
    note = service.search("独立编辑")
    tag = service.search("待复查")

    assert transcript["sources"][0]["field"] == "transcript"
    assert transcript["sources"][0]["start_ms"] == 10_000
    assert summary["sources"][0]["field"] == "summary"
    assert note["sources"][0]["field"] == "note"
    assert tag["sources"][0]["field"] == "tags"


def test_exact_search_supports_two_character_chinese_and_filters(
    retrieval_store: WorkspaceStore,
    tmp_path: Path,
) -> None:
    service = ExactSearchService(
        store=retrieval_store,
        database_path=tmp_path / "search.sqlite3",
    )
    service.rebuild()

    result = service.search(
        "产品",
        workspace_ids=["ws_alpha"],
        item_types=["video"],
    )

    assert result["mode"] == "exact"
    assert result["answer"] == ""
    assert result["sources"]
    assert {source["workspace_id"] for source in result["sources"]} == {"ws_alpha"}
    assert {source["item_type"] for source in result["sources"]} == {"video"}


def test_exact_search_falls_back_when_fts5_is_unavailable(
    retrieval_store: WorkspaceStore,
    tmp_path: Path,
) -> None:
    path = tmp_path / "search.sqlite3"
    service = ExactSearchService(store=retrieval_store, database_path=path)
    service.rebuild()
    with sqlite3.connect(path) as connection:
        connection.execute("UPDATE schema_meta SET value='0' WHERE key='fts5'")
        connection.execute(
            "UPDATE search_chunks SET content='offline finder' "
            "WHERE source_id=(SELECT source_id FROM search_chunks LIMIT 1)"
        )

    assert service.search("offline")["sources"]


def test_exact_rebuild_is_idempotent_and_repairs_corruption(
    retrieval_store: WorkspaceStore,
    tmp_path: Path,
) -> None:
    path = tmp_path / "search.sqlite3"
    service = ExactSearchService(store=retrieval_store, database_path=path)
    first = service.rebuild()
    second = service.rebuild()
    assert first["chunk_count"] == second["chunk_count"]

    path.write_bytes(b"not a sqlite database")
    repaired = service.search("产品")
    assert repaired["sources"]


def test_exact_search_suggestions_are_local_and_prefix_filtered(
    retrieval_store: WorkspaceStore,
    tmp_path: Path,
) -> None:
    service = ExactSearchService(
        store=retrieval_store,
        database_path=tmp_path / "search.sqlite3",
    )
    service.rebuild()

    assert "产品发布会" in service.suggest("产品")


def test_retrieval_service_exact_mode_does_not_call_smart_search(
    retrieval_store: WorkspaceStore,
    tmp_path: Path,
    monkeypatch,
) -> None:
    exact = ExactSearchService(
        store=retrieval_store,
        database_path=tmp_path / "search.sqlite3",
    )
    service = RetrievalService(store=retrieval_store, exact_service=exact)
    monkeypatch.setattr(
        "backend.app.services.workspace_search_service.search_across_workspaces",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("smart search called")),
    )

    result = service.search(query="产品", mode="exact")
    assert result["mode"] == "exact"
    assert result["answer"] == ""
