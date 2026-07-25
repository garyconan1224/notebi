from __future__ import annotations

from typing import Any
import json
from pathlib import Path

from backend.app.routes.search import GlobalSearchRequest
from backend.app.services import workspace_search_service as search_service
from backend.app.services.workspace_store import WorkspaceStore
from shared.knowledge_base import build_video_chunks_from_file


def test_retrieval_fixture_covers_identity_and_content_variants(
    retrieval_store: WorkspaceStore,
) -> None:
    records = retrieval_store.list_all()
    by_id = {record.workspace_id: record for record in records}
    assert len(records) == 2
    assert (
        by_id["ws_alpha"].items[0].item_id
        == by_id["ws_beta"].items[0].item_id
    )
    assert by_id["ws_alpha"].favorites == ["legacy-shared-item"]
    assert len(by_id["ws_alpha"].items[0].summaries) == 2
    assert by_id["ws_alpha"].items[1].results["content_md"]
    assert by_id["ws_beta"].items[1].results == {}


def test_legacy_source_contract_is_frozen() -> None:
    source = search_service._build_source(
        {
            "source_file": "/tmp/ws/item.json",
            "skeleton_text": "产品原文片段",
            "score": 0.88,
            "time_range": "00:10-00:18.500",
        },
        {
            "/tmp/ws/item.json": {
                "workspace_id": "ws_alpha",
                "workspace_name": "产品研究",
                "item_id": "legacy-shared-item",
                "item_type": "video",
                "item_title": "产品发布会",
            }
        },
        "",
        "",
    )

    assert {
        "workspace_id",
        "workspace_name",
        "item_id",
        "item_type",
        "item_title",
        "chunk_excerpt",
        "score",
        "jump_url",
    }.issubset(source)
    assert source["chunk_excerpt"] == "产品原文片段"
    assert source["jump_url"].startswith(
        "/workspaces/ws_alpha/items/legacy-shared-item/video_result"
    )


def test_target_smart_request_contract() -> None:
    request = GlobalSearchRequest(
        query="离线搜索",
        mode="smart",
        workspace_ids=["ws_alpha"],
        item_types=["video"],
        tags=["产品"],
    )
    assert request.mode == "smart"
    assert request.item_types == ["video"]
    assert request.tags == ["产品"]


def test_target_smart_source_contract() -> None:
    source: dict[str, Any] = search_service._build_source(
        {
            "source_file": "/tmp/ws/item.json",
            "skeleton_text": "产品原文片段",
            "score": 0.88,
            "time_range": "00:10-00:18.500",
        },
        {
            "/tmp/ws/item.json": {
                "workspace_id": "ws_alpha",
                "workspace_name": "产品研究",
                "item_id": "legacy-shared-item",
                "item_type": "video",
                "item_title": "产品发布会",
            }
        },
        "",
        "",
    )

    assert source["source_id"] == "ws_alpha:legacy-shared-item"
    assert source["excerpt"] == "产品原文片段"
    assert source["field"] == "transcript"
    assert source["segment_id"]
    assert source["start_ms"] == 10_000
    assert source["end_ms"] == 18_500


def test_transcript_segments_become_positioned_chunks(tmp_path: Path) -> None:
    path = tmp_path / "item.json"
    path.write_text(
        json.dumps(
            {
                "title": "访谈",
                "transcript_segments": [
                    {"start": 10.0, "end": 18.5, "text": "可定位原文"}
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    chunks = build_video_chunks_from_file(path)
    transcript = next(chunk for chunk in chunks if chunk.field == "transcript")
    assert transcript.segment_id == "transcript-0"
    assert transcript.start_ms == 10_000
    assert transcript.end_ms == 18_500
    assert transcript.skeleton_text == "可定位原文"
