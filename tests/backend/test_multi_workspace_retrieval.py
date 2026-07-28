from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.app.services import workspace_search_service as service


class _Store:
    def __init__(self) -> None:
        self.records = {
            "w1": SimpleNamespace(workspace_id="w1", name="产品"),
            "w2": SimpleNamespace(workspace_id="w2", name="市场"),
            "w3": SimpleNamespace(workspace_id="w3", name="技术"),
        }

    def get(self, workspace_id: str):
        return self.records.get(workspace_id)

    def list_all(self, include_trashed: bool = False):
        return list(self.records.values())


def _raw(workspace_id: str, *, score: float, lineage: str, text: str):
    path = f"/tmp/{workspace_id}.json"
    return (
        [{
            "source_file": path,
            "field": "transcript",
            "segment_id": "segment-0",
            "start_ms": 1_000,
            "end_ms": 2_000,
            "skeleton_text": text,
            "score": score,
        }],
        [],
        {
            path: {
                "workspace_id": workspace_id,
                "workspace_name": workspace_id,
                "item_id": f"item-{workspace_id}",
                "content_id": f"content-{workspace_id}",
                "lineage_id": lineage,
                "item_type": "video",
                "item_title": text,
            }
        },
        workspace_id,
        workspace_id,
    )


def test_each_selected_workspace_gets_balanced_candidate_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, int]] = []

    def retrieve(**kwargs):
        calls.append((kwargs["workspace_id"], kwargs["per_ws_top_k"]))
        return _raw(
            kwargs["workspace_id"],
            score=0.9,
            lineage=f"lineage-{kwargs['workspace_id']}",
            text=f"有关内容 {kwargs['workspace_id']}",
        )

    monkeypatch.setattr(service, "_resolve_api_key", lambda _key: "key")
    monkeypatch.setattr(service, "_retrieve_one", retrieve)
    monkeypatch.setattr(
        service,
        "rerank_documents",
        lambda *_args, **_kwargs: [
            {"index": 0, "relevance_score": 0.9},
            {"index": 1, "relevance_score": 0.8},
        ],
    )
    monkeypatch.setattr(service, "_llm_answer", lambda *_args: "答案 [source:ignored]")

    result = service.search_across_workspaces(
        query="这个产品如何支持离线知识整理？",
        top_k=2,
        workspace_ids=["w1", "w2", "w3"],
        store=_Store(),
    )

    assert sorted(calls) == [("w1", 3), ("w2", 3), ("w3", 3)]
    assert len(result["sources"]) == 2


def test_same_lineage_sources_are_deduplicated_by_score(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def retrieve(**kwargs):
        return _raw(
            kwargs["workspace_id"],
            score=0.8 if kwargs["workspace_id"] == "w1" else 0.95,
            lineage="same-lineage",
            text="离线搜索",
        )

    monkeypatch.setattr(service, "_resolve_api_key", lambda _key: "key")
    monkeypatch.setattr(service, "_retrieve_one", retrieve)
    monkeypatch.setattr(
        service,
        "rerank_documents",
        lambda *_args, **_kwargs: [
            {"index": 0, "relevance_score": 0.7},
            {"index": 1, "relevance_score": 0.95},
        ],
    )
    monkeypatch.setattr(
        service,
        "_llm_answer",
        lambda _query, context: f"答案 {context}",
    )

    result = service.search_across_workspaces(
        query="离线",
        top_k=5,
        workspace_ids=["w1", "w2"],
        store=_Store(),
    )

    assert len(result["sources"]) == 1
    assert result["sources"][0]["workspace_id"] == "w2"


def test_weak_evidence_does_not_call_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service, "_resolve_api_key", lambda _key: "key")
    monkeypatch.setattr(
        service,
        "_retrieve_one",
        lambda **kwargs: _raw(
            kwargs["workspace_id"],
            score=0.01,
            lineage="weak",
            text="无关片段",
        ),
    )
    monkeypatch.setattr(
        service,
        "rerank_documents",
        lambda *_args, **_kwargs: [{"index": 0, "relevance_score": 0.01}],
    )
    monkeypatch.setattr(
        service,
        "_llm_answer",
        lambda *_args: (_ for _ in ()).throw(AssertionError("weak evidence called LLM")),
    )

    result = service.search_across_workspaces(
        query="完全不同的问题",
        workspace_ids=["w1"],
        store=_Store(),
    )

    assert result["answer"] == ""
    assert result["answer_status"] == "insufficient_evidence"
    assert result["evidence_status"]["sufficient"] is False
