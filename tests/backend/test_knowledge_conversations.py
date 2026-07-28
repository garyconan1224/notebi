from __future__ import annotations

import json
from pathlib import Path

from backend.app.models.knowledge_conversation import KnowledgeMessage
from backend.app.services.knowledge_conversation_store import (
    KnowledgeConversationStore,
)


def test_conversation_store_create_append_restart_delete(tmp_path: Path) -> None:
    root = tmp_path / "conversations"
    store = KnowledgeConversationStore(root)
    conversation = store.create(
        title="离线搜索",
        default_scope=["w1", "w2"],
    )
    store.append_message(
        conversation.conversation_id,
        KnowledgeMessage(
            role="user",
            status="complete",
            query_text="离线搜索是什么？",
            content="离线搜索是什么？",
            scope_snapshot=["w1"],
        ),
    )

    restarted = KnowledgeConversationStore(root)
    loaded = restarted.get(conversation.conversation_id)
    assert loaded is not None
    assert loaded.title == "离线搜索"
    assert loaded.default_scope == ["w1", "w2"]
    assert loaded.messages[0].query_text == "离线搜索是什么？"
    assert not list(root.glob("*.tmp"))

    assert restarted.delete(conversation.conversation_id) is True
    assert restarted.get(conversation.conversation_id) is None


def test_conversation_store_lists_latest_and_isolates_corrupt_file(
    tmp_path: Path,
) -> None:
    root = tmp_path / "conversations"
    store = KnowledgeConversationStore(root)
    first = store.create(title="第一条")
    second = store.create(title="第二条")
    root.joinpath("broken.json").write_text("{not-json", encoding="utf-8")

    restarted = KnowledgeConversationStore(root)
    results, total = restarted.list(keyword="条", limit=10, offset=0)

    assert total == 2
    assert {item.conversation_id for item in results} == {
        first.conversation_id,
        second.conversation_id,
    }
    assert results[0].updated_at >= results[1].updated_at


def test_conversation_json_contains_no_secrets_or_prompt(
    tmp_path: Path,
) -> None:
    root = tmp_path / "conversations"
    store = KnowledgeConversationStore(root)
    conversation = store.create(title="安全")
    store.append_message(
        conversation.conversation_id,
        KnowledgeMessage(
            role="assistant",
            status="complete",
            content="回答",
            sources=[{
                "source_id": "source-1",
                "workspace_id": "w1",
                "item_id": "i1",
                "excerpt": "证据",
            }],
        ),
    )

    payload = json.loads(
        root.joinpath(f"{conversation.conversation_id}.json").read_text("utf-8")
    )
    serialized = json.dumps(payload)
    assert "api_key" not in serialized
    assert "system_prompt" not in serialized
    assert "cookie" not in serialized.lower()
