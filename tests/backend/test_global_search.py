"""Phase 3B.3：跨工作空间检索 POST /search 测试。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.routes import search as search_route
from backend.app.services import workspace_knowledge as wk
from backend.app.services import workspace_search_service as wss
from backend.app.services.retrieval_service import RetrievalService, _extract_citations
from backend.app.services.workspace_store import WorkspaceStore
from shared import knowledge_base as kb


def _make_item(item_id: str, title: str, desc: str) -> WorkspaceItem:
    return WorkspaceItem(
        item_id=item_id,
        type="video",
        source="url",
        source_value=f"https://x/{item_id}",
        name=title,
        results={
            "video_title": title,
            "frames": [{"timestamp": "00:01", "description_zh": desc}],
        },
    )


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    isolated_store = WorkspaceStore(root=tmp_path / "workspaces")
    rec_a = WorkspaceRecord(workspace_id="ws_a", name="A 空间")
    rec_a.items = [_make_item("ita1", "A 视频", "A 空间产品镜头")]
    rec_b = WorkspaceRecord(workspace_id="ws_b", name="B 空间")
    rec_b.items = [_make_item("itb1", "B 视频", "B 空间发布会现场")]
    isolated_store.create(rec_a)
    isolated_store.create(rec_b)

    monkeypatch.setattr(wk, "CACHE_DIR", tmp_path / "embeddings_cache")

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
    # 让跨空间 reranker 也返回所有候选，证明跨空间合并能生效
    monkeypatch.setattr(
        wss,
        "rerank_documents",
        lambda api_key, model, query, documents, top_n: [
            {"index": i, "relevance_score": 0.9 - i * 0.1} for i in range(len(documents))
        ],
    )

    fake_settings = MagicMock()
    fake_settings.openai_api_key = "fake-key"
    fake_settings.text_model = "gpt-x"
    monkeypatch.setattr(wss, "load_settings", lambda: fake_settings)
    monkeypatch.setattr(wss, "_llm_answer", lambda query, context: f"answer for: {query[:20]}")

    # 让 service 默认 store 走我们的隔离 store
    monkeypatch.setattr(wss, "WorkspaceStore", lambda *a, **kw: isolated_store)

    app = FastAPI()
    app.include_router(search_route.router)
    with TestClient(app) as c:
        yield c


def test_global_search_happy_path_cross_workspace(client: TestClient) -> None:
    """两个工作空间都应被检索，结果合并 + rerank 后含两个 workspace 的引用。"""
    resp = client.post("/search", json={"query": "产品", "top_k": 10})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["answer"].startswith("answer for:")
    wids = {s["workspace_id"] for s in data["sources"]}
    assert wids == {"ws_a", "ws_b"}, f"应跨两个 workspace，实际：{wids}"
    # SearchSource 字段完整
    for s in data["sources"]:
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
            assert k in s


def test_global_search_unknown_workspace_id_returns_404(client: TestClient) -> None:
    resp = client.post(
        "/search",
        json={"query": "anything", "workspace_ids": ["ws_a", "ws_missing"]},
    )
    assert resp.status_code == 404
    assert "ws_missing" in resp.json()["detail"]


# ─── R2-A：引用映射契约测试 ───


class TestExtractCitations:
    """Unit tests for _extract_citations."""

    def test_subset_citations(self) -> None:
        sources = [
            {"source_id": "a"},
            {"source_id": "b"},
            {"source_id": "c"},
        ]
        result = _extract_citations("见 [1] 和 [3]", sources)
        assert result == [
            {"number": 1, "source_id": "a"},
            {"number": 3, "source_id": "c"},
        ]

    def test_duplicate_citations_deduped(self) -> None:
        sources = [{"source_id": "x"}, {"source_id": "y"}]
        result = _extract_citations("[1] 再次 [1] 和 [2]", sources)
        assert result == [
            {"number": 1, "source_id": "x"},
            {"number": 2, "source_id": "y"},
        ]

    def test_out_of_range_discarded(self) -> None:
        sources = [{"source_id": "only"}]
        result = _extract_citations("[1] 和 [5] 和 [0]", sources)
        assert result == [{"number": 1, "source_id": "only"}]

    def test_no_citations_returns_empty(self) -> None:
        sources = [{"source_id": "a"}]
        assert _extract_citations("没有引用标记", sources) == []

    def test_empty_answer_returns_empty(self) -> None:
        assert _extract_citations("", [{"source_id": "a"}]) == []

    def test_empty_sources_returns_empty(self) -> None:
        assert _extract_citations("有 [1]", []) == []


def test_global_search_response_includes_citations(client: TestClient) -> None:
    """Smart mode response must include citations field."""
    resp = client.post("/search", json={"query": "产品", "top_k": 5})
    assert resp.status_code == 200
    data = resp.json()
    assert "citations" in data
    assert isinstance(data["citations"], list)


def test_exact_search_response_has_empty_citations(client: TestClient) -> None:
    """Exact mode must return citations=[] (no AI answer)."""
    resp = client.post("/search", json={"query": "产品", "mode": "exact"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["citations"] == []
    assert data["answer"] == ""
