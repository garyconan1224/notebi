"""Workspace 聊天接口：两段式 SSE（对齐 1F /pipeline/tasks/{id}/events）。

- POST /workspaces/{ws_id}/chat：创建一轮对话，返回 chat_id 与 turn_id。用户消息立即落盘。
- GET /workspaces/{ws_id}/chat/events?turn_id=...：SSE 推送 delta / done / error，30s 心跳。
- GET /workspaces/{ws_id}/chat/messages：查询历史，可按 chat_id 过滤。
- GET /workspaces/{ws_id}/chat/list：按 chat_id 汇总。
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from backend.app.routes.workspaces import _store as _workspaces
from backend.app.services.chat_context import build_item_context
from backend.app.services.chat_runner import ChatRunner
from shared.chat_store import get_default_store as get_chat_store

router = APIRouter(prefix="/workspaces", tags=["chat"])

_runner = ChatRunner()
_chat_store = get_chat_store()


class ChatCreateRequest(BaseModel):
    prompt: str = Field(min_length=1)
    chat_id: Optional[str] = None
    model: Optional[str] = None
    # N6: 选中的上下文素材 id 列表（空 = 兼容旧浮动入口，无 item 上下文）
    item_ids: List[str] = Field(default_factory=list)
    # B-8: 前端直接提供 system prompt（如 LN 页的 ln.md+transcript 上下文）；
    # 优先级高于 item_ids 构建的上下文。
    system_prompt: Optional[str] = None


def _require_workspace(workspace_id: str) -> None:
    if _workspaces.get(workspace_id) is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")


@router.post("/{workspace_id}/chat")
def create_chat_turn(workspace_id: str, req: ChatCreateRequest) -> Dict[str, Any]:
    _require_workspace(workspace_id)

    # B-8: 前端直接传 system_prompt 时优先使用（LN 上下文注入）
    workspace = _workspaces.get(workspace_id)
    assert workspace is not None  # _require_workspace 已校验

    if req.system_prompt:
        final_system_prompt = req.system_prompt
        truncated = False
        used_ids: List[str] = []
    else:
        # N6: 根据 item_ids 拼 system prompt（空 list → ctx.system_prompt = ""）
        ctx = build_item_context(workspace, list(req.item_ids or []))
        final_system_prompt = ctx.system_prompt or None
        truncated = ctx.truncated
        used_ids = ctx.used_item_ids

    try:
        turn = _runner.start_turn(
            workspace_id=workspace_id,
            chat_id=req.chat_id,
            prompt=req.prompt,
            model=req.model,
            system_prompt=final_system_prompt,
        )
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    return {
        "turn_id": turn.turn_id,
        "chat_id": turn.chat_id,
        "workspace_id": workspace_id,
        "status": turn.status,
        "context_truncated": truncated,
        "used_item_ids": used_ids,
    }


@router.get("/{workspace_id}/chat/events")
def stream_chat_events(workspace_id: str, turn_id: str = Query(...)) -> StreamingResponse:
    _require_workspace(workspace_id)
    turn = _runner.get(turn_id)
    if turn is None or turn.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail=f"turn not found: {turn_id}")

    HEARTBEAT_INTERVAL_S = 30.0
    POLL_INTERVAL_S = 0.1

    async def event_stream():
        last_idx = 0
        last_send_ts = time.monotonic()
        while True:
            cur = _runner.get(turn_id)
            if cur is None:
                yield f"data: {json.dumps({'type': 'error', 'message': 'turn lost'})}\n\n"
                break

            while last_idx < len(cur.deltas):
                payload = {"type": "delta", "text": cur.deltas[last_idx]}
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                last_idx += 1
                last_send_ts = time.monotonic()

            if cur.status == "done":
                done_payload = {
                    "type": "done",
                    "chat_id": cur.chat_id,
                    "message_id": cur.assistant_message_id,
                }
                yield f"data: {json.dumps(done_payload, ensure_ascii=False)}\n\n"
                break
            if cur.status == "error":
                err_payload = {"type": "error", "message": cur.error or "unknown"}
                yield f"data: {json.dumps(err_payload, ensure_ascii=False)}\n\n"
                break

            if time.monotonic() - last_send_ts >= HEARTBEAT_INTERVAL_S:
                yield ": heartbeat\n\n"
                last_send_ts = time.monotonic()

            await asyncio.sleep(POLL_INTERVAL_S)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{workspace_id}/chat/messages")
def list_messages(workspace_id: str, chat_id: Optional[str] = None) -> List[Dict[str, Any]]:
    _require_workspace(workspace_id)
    msgs = _chat_store.list(workspace_id, chat_id=chat_id)
    return [m.to_dict() for m in msgs]


@router.get("/{workspace_id}/chat/list")
def list_chats(workspace_id: str) -> List[Dict[str, Any]]:
    _require_workspace(workspace_id)
    return [
        {
            "chat_id": s.chat_id,
            "message_count": s.message_count,
            "first_at": s.first_at,
            "last_at": s.last_at,
        }
        for s in _chat_store.list_chats(workspace_id)
    ]
