"""S5 Task 1: 稳定检索来源身份测试。"""

from __future__ import annotations

import pytest

from backend.app.services.knowledge_source import (
    KnowledgeSource,
    build_jump_url,
    compute_source_id,
)
from backend.app.services.retrieval_service import _extract_citations
from backend.app.services.retrieval_service import _record_indexable_content_count
from backend.app.models.workspace import MergedNote, WorkspaceRecord
from backend.app.services.workspace_search_service import _build_source


# ── Task 1.1: source_id 稳定性 ───────────────────────────────────────────────


def test_source_id_is_chunk_stable() -> None:
    """同一 item 的不同转写时间段/字段有不同 source_id；同一片段重建索引后 ID 不变。"""
    first = KnowledgeSource.create(
        workspace_id="w1",
        item_id="i1",
        field="transcript",
        start_ms=30000,
    )
    second = KnowledgeSource.create(
        workspace_id="w1",
        item_id="i1",
        field="transcript",
        start_ms=60000,
    )
    # 不同时间段 → 不同 ID
    assert first.source_id != second.source_id

    # 同一片段重建 → 相同 ID
    rebuilt = KnowledgeSource.create(
        workspace_id="w1",
        item_id="i1",
        field="transcript",
        start_ms=30000,
    )
    assert first.source_id == rebuilt.source_id


def test_source_id_different_fields() -> None:
    """不同字段有不同 source_id。"""
    transcript = KnowledgeSource.create(
        workspace_id="w1",
        item_id="i1",
        field="transcript",
    )
    summary = KnowledgeSource.create(
        workspace_id="w1",
        item_id="i1",
        field="summary",
    )
    assert transcript.source_id != summary.source_id


def test_source_id_different_workspaces() -> None:
    """不同 workspace 有不同 source_id。"""
    ws1 = KnowledgeSource.create(workspace_id="w1", item_id="i1", field="transcript")
    ws2 = KnowledgeSource.create(workspace_id="w2", item_id="i1", field="transcript")
    assert ws1.source_id != ws2.source_id


# ── Task 1.2: compute_source_id 确定性 ───────────────────────────────────────


def test_compute_source_id_deterministic() -> None:
    """compute_source_id 是确定性的。"""
    id1 = compute_source_id("w1", "i1", "transcript", 0, 30000, 60000)
    id2 = compute_source_id("w1", "i1", "transcript", 0, 30000, 60000)
    assert id1 == id2


def test_compute_source_id_uses_sha256() -> None:
    """source_id 是 SHA-256 短 ID（16 字符）。"""
    source_id = compute_source_id("w1", "i1", "transcript")
    assert len(source_id) == 16
    assert all(c in "0123456789abcdef" for c in source_id)


# ── Task 1.3: KnowledgeSource 模型 ───────────────────────────────────────────


def test_knowledge_source_round_trip() -> None:
    """KnowledgeSource 序列化/反序列化。"""
    source = KnowledgeSource.create(
        workspace_id="w1",
        item_id="i1",
        field="transcript",
        start_ms=30000,
        end_ms=60000,
        title="Test Video",
        excerpt="This is a test excerpt",
        score=0.95,
    )
    data = source.to_dict()
    restored = KnowledgeSource.from_dict(data)

    assert restored.source_id == source.source_id
    assert restored.workspace_id == "w1"
    assert restored.start_ms == 30000
    assert restored.title == "Test Video"
    assert restored.score == 0.95


# ── Task 1.4: jump_url 构建 ──────────────────────────────────────────────────


def test_jump_url_with_start_ms() -> None:
    """音视频 jump_url 包含 start_ms。"""
    url = build_jump_url("w1", "i1", "transcript", start_ms=30000)
    assert "workspace_id=w1" in url
    assert "item_id=i1" in url
    assert "start_ms=30000" in url


def test_jump_url_without_start_ms() -> None:
    """文本 jump_url 不包含 start_ms。"""
    url = build_jump_url("w1", "i1", "summary", start_ms=0)
    assert "workspace_id=w1" in url
    assert "start_ms" not in url


def test_jump_url_zero_start_ms() -> None:
    """start_ms=0 不包含在 URL 中。"""
    url = build_jump_url("w1", "i1", "transcript", start_ms=0)
    assert "start_ms" not in url


def test_workspace_source_builder_uses_chunk_identity() -> None:
    source_map = {
        "/tmp/item.json": {
            "workspace_id": "w1",
            "workspace_name": "合集一",
            "item_id": "i1",
            "content_id": "content-1",
            "lineage_id": "lineage-1",
            "item_type": "video",
            "item_title": "视频一",
        }
    }
    first = _build_source(
        {
            "source_file": "/tmp/item.json",
            "field": "transcript",
            "segment_id": "segment-1",
            "start_ms": 30_000,
            "end_ms": 35_000,
            "skeleton_text": "第一段",
            "score": 0.9,
        },
        source_map,
        "w1",
        "合集一",
    )
    second = _build_source(
        {
            "source_file": "/tmp/item.json",
            "field": "transcript",
            "segment_id": "segment-2",
            "start_ms": 60_000,
            "end_ms": 65_000,
            "skeleton_text": "第二段",
            "score": 0.8,
        },
        source_map,
        "w1",
        "合集一",
    )

    assert first["source_id"] != second["source_id"]
    assert first["content_id"] == "content-1"
    assert first["lineage_id"] == "lineage-1"
    assert first["jump_url"].endswith(
        "?start_ms=30000&field=transcript&segment=segment-1"
    )


def test_active_merged_note_counts_as_indexable_content() -> None:
    record = WorkspaceRecord(
        workspace_id="w1",
        name="仅融合笔记",
        merged_notes=[
            MergedNote(title="综合结论", content_md="可以检索的融合内容")
        ],
    )

    assert _record_indexable_content_count(record, task_store=None) == 1


def test_unknown_source_citations_are_rejected() -> None:
    sources = [{"source_id": "known-a"}, {"source_id": "known-b"}]

    citations, warnings = _extract_citations(
        "可信 [source:known-b]，伪造 [source:made-up]，重复 [source:known-b]",
        sources,
        include_warnings=True,
    )

    assert citations == [{"number": 1, "source_id": "known-b"}]
    assert warnings == ["unknown citation source_id: made-up"]
