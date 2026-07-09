import json
from pathlib import Path

from shared import knowledge_base as kb


def test_rag_metadata_and_sources(monkeypatch, tmp_path: Path) -> None:
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

    sample = {
        "video_title": "Sample Video",
        "author": "Alice",
        "tags": ["phone", "review"],
        "published_at": "2026-01-01",
        "source_url": "https://example.com/video",
        "time_range": "00:10-00:20",
        "frames": [{"timestamp": "00:10", "description_zh": "产品特写"}],
    }
    p = tmp_path / "sample.json"
    p.write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")

    knowledge = kb.load_folder_as_knowledge("k", str(tmp_path), embedding_model="BAAI/bge-m3")
    assert isinstance(knowledge, kb.LongKnowledge)
    first = knowledge.chunks[0]
    assert first.title == "Sample Video"
    assert first.author == "Alice"
    assert "phone" in first.tags

    sources = kb.retrieve_with_sources("k", knowledge, "特写内容")
    assert sources
    assert sources[0]["title"] == "Sample Video"
