"""Phase 2A.2 — workspace 聊天接口测试（两段式 SSE）。

happy path: POST 创建一轮 → SSE 拿到 delta+done → 消息持久化到 chat_store。
error path: 不存在的 workspace 返回 404；prompt 为空返回 422。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import chat as chat_module
from backend.app.services.chat_runner import ChatRunner
from backend.app.services.workspace_store import WorkspaceRecord, WorkspaceStore
from shared.chat_store import ChatStore


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    ws_store = WorkspaceStore(root=tmp_path / "workspaces")
    rec = WorkspaceRecord(workspace_id="ws_test_01", name="测试工作区")
    ws_store.create(rec)

    chat_store = ChatStore(root=tmp_path / "chats")

    def fake_llm(messages, model):
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        return f"echo:{last_user}"

    runner = ChatRunner(store=chat_store, llm_caller=fake_llm, chunk_size=4, chunk_delay_s=0.0)

    monkeypatch.setattr(chat_module, "_workspaces", ws_store)
    # chat 路由通过模块导入复用 workspaces 路由的 _store；测试里两边都换成隔离实例
    from backend.app.routes import workspaces as ws_module
    monkeypatch.setattr(ws_module, "_store", ws_store)
    monkeypatch.setattr(chat_module, "_runner", runner)
    monkeypatch.setattr(chat_module, "_chat_store", chat_store)

    app = FastAPI()
    app.include_router(chat_module.router)
    with TestClient(app) as c:
        yield c


def _consume_sse(client: TestClient, url: str) -> list[dict]:
    events: list[dict] = []
    with client.stream("GET", url) as resp:
        assert resp.status_code == 200
        for line in resp.iter_lines():
            if not line or line.startswith(":"):
                continue
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
                if events[-1]["type"] in ("done", "error"):
                    break
    return events


def test_chat_turn_streams_and_persists(client: TestClient) -> None:
    r = client.post(
        "/workspaces/ws_test_01/chat",
        json={"prompt": "你好世界"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    turn_id = body["turn_id"]
    chat_id = body["chat_id"]
    assert turn_id and chat_id

    events = _consume_sse(client, f"/workspaces/ws_test_01/chat/events?turn_id={turn_id}")
    deltas = [e for e in events if e["type"] == "delta"]
    dones = [e for e in events if e["type"] == "done"]
    assert deltas, "应至少收到一条 delta"
    assert dones and dones[0]["chat_id"] == chat_id
    assert "".join(d["text"] for d in deltas) == "echo:你好世界"

    msgs = client.get(f"/workspaces/ws_test_01/chat/messages?chat_id={chat_id}").json()
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["content"] == "echo:你好世界"

    chats = client.get("/workspaces/ws_test_01/chat/list").json()
    assert len(chats) == 1 and chats[0]["chat_id"] == chat_id and chats[0]["message_count"] == 2


def test_chat_workspace_not_found(client: TestClient) -> None:
    r = client.post("/workspaces/ws_nope/chat", json={"prompt": "hi"})
    assert r.status_code == 404


def test_chat_empty_prompt_rejected(client: TestClient) -> None:
    r = client.post("/workspaces/ws_test_01/chat", json={"prompt": ""})
    assert r.status_code == 422
