from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import knowledge as routes
from backend.app.routes import workspaces as workspace_routes
from backend.app.models.knowledge_conversation import KnowledgeMessage
from backend.app.services.knowledge_conversation_store import (
    KnowledgeConversationStore,
)


class _WorkspaceStore:
    def get(self, workspace_id: str):
        return object() if workspace_id in {"w1", "w2"} else None


def test_knowledge_uses_live_workspace_route_store() -> None:
    assert routes._workspace_store is workspace_routes._store


def _client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    store = KnowledgeConversationStore(tmp_path / "conversations")
    monkeypatch.setattr(routes, "_conversation_store", store)
    monkeypatch.setattr(routes, "_workspace_store", _WorkspaceStore())
    app = FastAPI()
    app.include_router(routes.router)
    return TestClient(app)


def test_conversation_rest_lifecycle_and_scope_validation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(tmp_path, monkeypatch)

    created = client.post(
        "/knowledge/conversations",
        json={"title": "研究", "default_scope": ["w1"]},
    )
    assert created.status_code == 200
    conversation_id = created.json()["conversation_id"]

    updated = client.patch(
        f"/knowledge/conversations/{conversation_id}",
        json={"title": "新标题", "default_scope": ["w1", "w2"]},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "新标题"

    invalid = client.patch(
        f"/knowledge/conversations/{conversation_id}",
        json={"default_scope": ["missing"]},
    )
    assert invalid.status_code == 422

    listing = client.get("/knowledge/conversations", params={"keyword": "新"})
    assert listing.status_code == 200
    assert listing.json()["total"] == 1

    assert client.delete(
        f"/knowledge/conversations/{conversation_id}"
    ).status_code == 200
    assert client.get(
        f"/knowledge/conversations/{conversation_id}"
    ).status_code == 404


def test_regenerate_appends_answer_version_without_overwriting(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(tmp_path, monkeypatch)
    store = routes._conversation_store
    conversation = store.create(title="版本")
    store.append_message(
        conversation.conversation_id,
        KnowledgeMessage(
            role="user",
            status="complete",
            query_text="问题",
            content="问题",
            scope_snapshot=["w1"],
        ),
    )
    original = KnowledgeMessage(
        role="assistant",
        status="complete",
        query_text="问题",
        content="旧答案",
        scope_snapshot=["w1"],
        answer_version=1,
    )
    store.append_message(conversation.conversation_id, original)

    class _Retrieval:
        def search(self, **_kwargs):
            return {
                "answer": "新答案 [source:known]",
                "answer_status": "complete",
                "sources": [{
                    "source_id": "known",
                    "workspace_id": "w1",
                    "item_id": "i1",
                }],
                "citations": [{"number": 1, "source_id": "known"}],
            }

    monkeypatch.setattr(routes, "_retrieval", lambda: _Retrieval())
    response = client.post(
        f"/knowledge/conversations/{conversation.conversation_id}"
        f"/messages/{original.message_id}/regenerate"
    )

    assert response.status_code == 200
    assert response.json()["answer_version"] == 2
    loaded = store.get(conversation.conversation_id)
    assert loaded is not None
    answers = [message for message in loaded.messages if message.role == "assistant"]
    assert [(message.answer_version, message.content) for message in answers] == [
        (1, "旧答案"),
        (2, "新答案 [source:known]"),
    ]


def test_unknown_workspace_is_422_not_all_scope(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client(tmp_path, monkeypatch)

    response = client.post(
        "/knowledge/conversations",
        json={"title": "错误范围", "default_scope": ["missing"]},
    )

    assert response.status_code == 422
