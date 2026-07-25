from __future__ import annotations

from backend.app.services.retrieval_service import RetrievalService
from backend.app.services.workspace_store import WorkspaceStore


class FakeExactSearch:
    def search(self, *_args, **_kwargs):
        return {
            "answer": "",
            "mode": "exact",
            "sources": [{
                "source_id": "exact-1",
                "workspace_id": "ws_alpha",
                "workspace_name": "产品研究",
                "item_id": "legacy-shared-item",
                "content_id": "filled-by-fixture",
                "item_type": "video",
                "item_title": "产品发布会",
                "field": "transcript",
                "segment_id": "segment-1",
                "start_ms": 10_000,
                "excerpt": "离线搜索",
            }],
        }


def test_hybrid_search_uses_rrf_and_keeps_smart_answer(
    retrieval_store: WorkspaceStore,
    monkeypatch,
) -> None:
    item = retrieval_store.get_item("ws_alpha", "legacy-shared-item")
    exact = FakeExactSearch()
    exact.search()["sources"][0]["content_id"] = item.content_id
    monkeypatch.setattr(exact, "search", lambda *_args, **_kwargs: {
        "answer": "",
        "mode": "exact",
        "sources": [{
            **FakeExactSearch().search()["sources"][0],
            "content_id": item.content_id,
        }],
    })
    monkeypatch.setattr(
        "backend.app.services.workspace_search_service.search_across_workspaces",
        lambda **_kwargs: {
            "answer": "支持离线搜索。",
            "sources": [{
                "source_id": "smart-1",
                "workspace_id": "ws_alpha",
                "workspace_name": "产品研究",
                "item_id": "legacy-shared-item",
                "item_type": "video",
                "item_title": "产品发布会",
                "field": "transcript",
                "segment_id": "segment-1",
                "start_ms": 10_000,
                "excerpt": "新产品支持离线搜索。",
            }],
        },
    )
    monkeypatch.setattr(RetrievalService, "status", lambda _self: {"ready": True})
    service = RetrievalService(store=retrieval_store, exact_service=exact)

    result = service.search(query="离线搜索", mode="hybrid", top_k=5)

    assert result["answer"] == "支持离线搜索。"
    assert result["mode"] == "hybrid"
    assert result["sources"][0]["retrieval_channels"] == ["exact", "semantic"]
