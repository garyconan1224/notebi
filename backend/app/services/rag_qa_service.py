from __future__ import annotations

"""RAG QA service with source citation payload."""

from typing import Any, Dict, List

from shared.knowledge_base import (
    LongKnowledge,
    ShortKnowledge,
    load_folder_as_knowledge,
    retrieve_with_sources,
)
from shared.settings_store import load_settings
from src.vidmirror.core.providers import ChatRequest
from src.vidmirror.core.providers.registry import create_default_registry


def ask_with_sources(
    *,
    project_json_dir: str,
    query: str,
    embedding_model: str,
    api_key: str = "",
) -> Dict[str, Any]:
    """使用源引用执行 RAG QA"""
    settings = load_settings()
    effective_key = api_key.strip() or settings.openai_api_key.strip()
    if not effective_key:
        raise ValueError("RAG requires openai-compatible api key")

    knowledge = load_folder_as_knowledge(
        effective_key,
        project_json_dir,
        embedding_model=embedding_model,
    )
    source_items: List[Dict[str, Any]] = []
    if isinstance(knowledge, LongKnowledge):
        source_items = list(retrieve_with_sources(effective_key, knowledge, query))
        context = "\n\n".join(
            [
                f"[{i+1}] title={s.get('title') or 'N/A'} file={s['source_file']} range={s.get('time_range') or 'N/A'}\n{s['skeleton_text'][:3000]}"
                for i, s in enumerate(source_items)
            ]
        )
    else:
        assert isinstance(knowledge, ShortKnowledge)
        context = knowledge.combined_json_text[:12000]
        source_items = [
            {
                "title": "short_mode_context",
                "source_file": "merged_json",
                "chunk_index": 0,
                "time_range": "",
                "source_url": "",
                "score": 0.0,
            }
        ]

    registry = create_default_registry()
    profile = registry.resolve_default_profile(settings, "chat")
    provider = registry.build(profile)
    model = profile.default_models.get("chat") or settings.text_model
    if not model:
        raise ValueError("default chat model is not configured")
    answer = provider.chat(
        ChatRequest(
            model=model,
            messages=[
                {"role": "system", "content": "You are a helpful RAG assistant. Cite evidence by source index."},
                {
                    "role": "user",
                    "content": f"Question:\n{query}\n\nContext:\n{context}\n\nPlease answer in Chinese and include citation markers like [1], [2].",
                },
            ],
            temperature=0.2,
            max_tokens=2048,
        )
    )
    return {"answer": answer, "sources": source_items}
