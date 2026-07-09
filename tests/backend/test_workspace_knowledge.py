"""Phase 3B.1：workspace_knowledge 数据桥 + FAISS 缓存层测试。"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.app.models.workspace import WorkspaceItem, WorkspaceRecord
from backend.app.services import workspace_knowledge as wk
from backend.app.services.workspace_store import WorkspaceStore
from shared import knowledge_base as kb


def _seed_workspace(store_root: Path) -> tuple[WorkspaceStore, str]:
    store = WorkspaceStore(root=store_root)
    rec = WorkspaceRecord(workspace_id="ws_test", name="测试空间")
    rec.items = [
        WorkspaceItem(
            item_id="it_001",
            type="video",
            source="url",
            source_value="https://example.com/v1",
            name="发布会片段",
            results={
                "video_title": "发布会片段",
                "tags": ["phone", "review"],
                "frames": [
                    {"timestamp": "00:10", "description_zh": "产品特写镜头"},
                    {"timestamp": "00:20", "description_zh": "主持人介绍价格"},
                ],
            },
        ),
        WorkspaceItem(
            item_id="it_002",
            type="image",
            source="local",
            source_value="/tmp/a.png",
            name="封面图",
            results={
                "title": "封面图",
                "description": "蓝色背景上的手机产品图",
            },
        ),
    ]
    store.create(rec)
    return store, rec.workspace_id


def _patch_embeddings(monkeypatch: pytest.MonkeyPatch) -> dict[str, int]:
    calls = {"embed": 0, "rerank": 0}

    def fake_embed(api_key, model, inputs, on_batch=None):
        calls["embed"] += 1
        return [[0.1 + i * 0.01 for i in range(16)] for _ in inputs]

    def fake_rerank(api_key, model, query, documents, top_n):
        calls["rerank"] += 1
        return [{"index": 0, "relevance_score": 0.9}]

    monkeypatch.setattr(kb, "SHORT_MODE_MAX_CHARS", 1)
    monkeypatch.setattr(kb, "create_embeddings", fake_embed)
    monkeypatch.setattr(kb, "rerank_documents", fake_rerank)
    return calls


def test_build_then_cache_hit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """首次构建后再次调用应命中 FAISS 缓存，不再触发 embedding。"""
    monkeypatch.setattr(wk, "CACHE_DIR", tmp_path / "embeddings_cache")
    store, wid = _seed_workspace(tmp_path / "workspaces")
    calls = _patch_embeddings(monkeypatch)

    knowledge1, src1 = wk.build_or_load_workspace_index(wid, api_key="fake-key", store=store)
    assert isinstance(knowledge1, kb.LongKnowledge)
    assert len(knowledge1.chunks) == 2
    assert calls["embed"] == 1  # 仅构建时调用一次
    # source_map 字段齐全
    assert any(info["item_id"] == "it_001" and info["item_type"] == "video" for info in src1.values())
    assert any(info["workspace_name"] == "测试空间" for info in src1.values())

    # 第二次调用：应命中缓存，embedding 不增长
    knowledge2, src2 = wk.build_or_load_workspace_index(wid, api_key="fake-key", store=store)
    assert isinstance(knowledge2, kb.LongKnowledge)
    assert len(knowledge2.chunks) == 2
    assert calls["embed"] == 1  # 没新增 → 命中缓存
    assert src2 == src1

    # 失效后下次构建会再次跑 embedding
    wk.invalidate_workspace_index(wid)
    wk.build_or_load_workspace_index(wid, api_key="fake-key", store=store)
    assert calls["embed"] == 2


def test_missing_api_key_raises(tmp_path: Path) -> None:
    store, wid = _seed_workspace(tmp_path / "workspaces")
    with pytest.raises(ValueError, match="api_key"):
        wk.build_or_load_workspace_index(wid, api_key="", store=store)
    with pytest.raises(ValueError, match="api_key"):
        wk.build_or_load_workspace_index(wid, api_key="   ", store=store)


def test_unknown_workspace_raises(tmp_path: Path) -> None:
    store = WorkspaceStore(root=tmp_path / "workspaces")
    with pytest.raises(KeyError):
        wk.build_or_load_workspace_index("does_not_exist", api_key="x", store=store)
