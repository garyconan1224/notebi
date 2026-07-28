from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.app.services.knowledge_conversation_store import (
    KnowledgeConversationStore,
)
from backend.app.services.knowledge_message_service import KnowledgeMessageService


class _Retrieval:
    def __init__(self) -> None:
        self.scopes: list[list[str] | None] = []

    def search(self, *, query, mode, top_k, workspace_ids):
        self.scopes.append(workspace_ids)
        source_id = f"source-{workspace_ids[0] if workspace_ids else 'all'}"
        return {
            "answer": f"回答 [source:{source_id}]",
            "sources": [{
                "source_id": source_id,
                "workspace_id": workspace_ids[0] if workspace_ids else "all",
                "item_id": "item",
                "title": "标题",
                "excerpt": "证据",
                "score": 0.9,
            }],
            "citations": [{"number": 1, "source_id": source_id}],
            "answer_status": "complete",
            "evidence_status": {
                "sufficient": True,
                "threshold": 0.2,
                "best_score": 0.9,
            },
        }


def _events(lines):
    return [json.loads(line) for line in lines]


def test_stream_emits_status_before_retrieval_and_retrieves_each_turn(
    tmp_path: Path,
) -> None:
    store = KnowledgeConversationStore(tmp_path / "conversations")
    conversation = store.create(title="测试")
    retrieval = _Retrieval()
    service = KnowledgeMessageService(store=store, retrieval=retrieval)

    first = service.stream(
        conversation.conversation_id,
        question="第一问",
        workspace_ids=["w1"],
    )
    first_status = json.loads(next(first))
    assert first_status["type"] == "status"
    assert first_status["stage"] == "retrieving"
    assert retrieval.scopes == []
    first_events = _events(first)

    second_events = _events(service.stream(
        conversation.conversation_id,
        question="第二问",
        workspace_ids=["w2"],
    ))

    assert retrieval.scopes == [["w1"], ["w2"]]
    assert any(event["type"] == "sources" for event in first_events)
    assert any(
        event["type"] == "status" and event["stage"] == "generating"
        for event in first_events
    )
    assert any(event["type"] == "delta" for event in second_events)
    assert second_events[-1]["type"] == "done"
    persisted = store.get(conversation.conversation_id)
    assert persisted is not None
    assert [message.scope_snapshot for message in persisted.messages if message.role == "user"] == [
        ["w1"],
        ["w2"],
    ]


def test_stream_failure_keeps_sources_and_marks_message_failed(
    tmp_path: Path,
) -> None:
    class FailingRetrieval:
        def search(self, **_kwargs):
            raise RuntimeError("model unavailable")

    store = KnowledgeConversationStore(tmp_path / "conversations")
    conversation = store.create()
    service = KnowledgeMessageService(store=store, retrieval=FailingRetrieval())

    events = _events(service.stream(
        conversation.conversation_id,
        question="问题",
        workspace_ids=[],
    ))

    assert events[-1]["type"] == "error"
    persisted = store.get(conversation.conversation_id)
    assert persisted is not None
    assert persisted.messages[-1].status == "failed"
    assert persisted.messages[-1].sources == []
