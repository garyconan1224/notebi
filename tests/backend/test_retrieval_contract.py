from __future__ import annotations

from typing import Any

import pytest

from backend.app.routes.search import GlobalSearchRequest
from backend.app.services import workspace_search_service as search_service
from backend.app.services.workspace_store import WorkspaceStore


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

    assert set(source) == {
        "workspace_id",
        "workspace_name",
        "item_id",
        "item_type",
        "item_title",
        "chunk_excerpt",
        "score",
        "jump_url",
    }
    assert source["chunk_excerpt"] == "产品原文片段"
    assert source["jump_url"] == (
        "/workspaces/ws_alpha/items/legacy-shared-item/video_result"
    )


@pytest.mark.xfail(
    strict=True,
    reason="P1 will add mode and future filter fields to the unified request",
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


@pytest.mark.xfail(
    strict=True,
    reason="P1 will normalize source identity, evidence field, and time range",
)
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
