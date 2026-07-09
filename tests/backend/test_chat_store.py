"""chat_store 单测：happy path + 非法 workspace_id 错误路径。"""

from __future__ import annotations

import pytest

from shared.chat_store import ChatMessage, ChatStore, ChatStoreError


def test_append_and_list_roundtrip(tmp_path):
    store = ChatStore(root=tmp_path)
    ws = "ws_demo_001"

    store.append(ws, ChatMessage(chat_id="c1", role="user", content="你好"))
    store.append(ws, ChatMessage(chat_id="c1", role="assistant", content="在的", model="gpt-x"))
    store.append(ws, ChatMessage(chat_id="c2", role="user", content="另一个会话"))

    all_msgs = store.list(ws)
    assert [m.content for m in all_msgs] == ["你好", "在的", "另一个会话"]

    c1 = store.list(ws, chat_id="c1")
    assert len(c1) == 2
    assert c1[1].role == "assistant"
    assert c1[1].model == "gpt-x"

    chats = store.list_chats(ws)
    assert {s.chat_id for s in chats} == {"c1", "c2"}
    by_id = {s.chat_id: s for s in chats}
    assert by_id["c1"].message_count == 2
    assert by_id["c2"].message_count == 1

    # 不存在的 workspace 返回空列表，不抛错
    assert store.list("ws_empty_xyz") == []


def test_invalid_workspace_id_raises(tmp_path):
    store = ChatStore(root=tmp_path)
    with pytest.raises(ChatStoreError):
        store.append("../etc/passwd", ChatMessage(chat_id="c1", role="user", content="hi"))
    with pytest.raises(ChatStoreError):
        store.append("", ChatMessage(chat_id="c1", role="user", content="hi"))


def test_invalid_role_raises(tmp_path):
    store = ChatStore(root=tmp_path)
    with pytest.raises(ChatStoreError):
        store.append("ws1", ChatMessage(chat_id="c1", role="robot", content="x"))  # type: ignore[arg-type]
