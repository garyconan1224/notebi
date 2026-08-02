from __future__ import annotations

"""Global knowledge, exact search, and conversation endpoints."""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.app.routes.pipeline import _runner as _pipeline_runner
from backend.app.routes.workspaces import _store as _workspace_store
from backend.app.models.knowledge_conversation import (
    KnowledgeMessage,
    KnowledgeSourceSnapshot,
)
from backend.app.services.knowledge_conversation_store import (
    KnowledgeConversationStore,
)
from backend.app.services.knowledge_message_service import KnowledgeMessageService
from backend.app.services.retrieval_service import RetrievalService
from shared.config import DATA_DIR

router = APIRouter(prefix="/knowledge", tags=["knowledge"])
_conversation_store = KnowledgeConversationStore(
    DATA_DIR / ".local" / "knowledge_conversations"
)


class KnowledgeAskRequest(BaseModel):
    question: str = Field(..., min_length=1)
    top_k: int = Field(default=10, ge=1, le=30)
    workspace_ids: Optional[List[str]] = None
    item_refs: Optional[List["KnowledgeItemRef"]] = None


class KnowledgeExactSearchRequest(KnowledgeAskRequest):
    """Structured exact-search input for scopes that include individual notes."""


class KnowledgeRebuildRequest(BaseModel):
    force: bool = False


class KnowledgeItemRef(BaseModel):
    """One note in its collection context; item IDs alone are not enough for linked copies."""

    workspace_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)


class ConversationCreateRequest(BaseModel):
    title: str = "新会话"
    default_scope: List[str] = Field(default_factory=list)
    default_item_refs: List[KnowledgeItemRef] = Field(default_factory=list)


class ConversationPatchRequest(BaseModel):
    title: Optional[str] = None
    default_scope: Optional[List[str]] = None
    default_item_refs: Optional[List[KnowledgeItemRef]] = None


class ConversationMessageRequest(BaseModel):
    question: str = Field(..., min_length=1)
    workspace_ids: Optional[List[str]] = None
    item_refs: Optional[List[KnowledgeItemRef]] = None
    top_k: int = Field(default=10, ge=1, le=30)


def _validate_scope(workspace_ids: Optional[List[str]]) -> List[str]:
    normalized = list(dict.fromkeys(workspace_ids or []))
    missing = [
        workspace_id
        for workspace_id in normalized
        if _workspace_store.get(workspace_id) is None
    ]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"unknown workspace_ids: {','.join(missing)}",
        )
    return normalized


def _validate_item_refs(item_refs: Optional[List[KnowledgeItemRef]]) -> List[Dict[str, str]]:
    normalized: List[Dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for ref in item_refs or []:
        key = (ref.workspace_id, ref.item_id)
        if key in seen:
            continue
        try:
            _workspace_store.get_item(ref.workspace_id, ref.item_id)
        except KeyError as err:
            raise HTTPException(
                status_code=422,
                detail=f"unknown item_ref: {ref.workspace_id}/{ref.item_id}",
            ) from err
        seen.add(key)
        normalized.append({"workspace_id": ref.workspace_id, "item_id": ref.item_id})
    return normalized


def _conversation_payload(conversation) -> Dict[str, Any]:
    return conversation.model_dump(mode="json")


def _retrieval() -> RetrievalService:
    return RetrievalService(
        store=_workspace_store,
        task_store=_pipeline_runner.store,
    )


@router.get("/status")
def knowledge_status() -> Dict[str, Any]:
    try:
        return _retrieval().status()
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/rebuild")
def knowledge_rebuild(req: KnowledgeRebuildRequest | None = None) -> Dict[str, Any]:
    try:
        return _retrieval().start_rebuild(
            force=bool(req.force) if req else False
        )
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/ask")
def knowledge_ask(req: KnowledgeAskRequest) -> Dict[str, Any]:
    try:
        scope = _validate_scope(req.workspace_ids)
        item_refs = _validate_item_refs(req.item_refs)
        return _retrieval().search(
            query=req.question,
            mode="smart",
            top_k=req.top_k,
            workspace_ids=scope or None,
            item_refs=item_refs or None,
        )
    except RuntimeError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    except KeyError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/search")
def knowledge_exact_search(
    query: str = Query(..., min_length=1),
    workspace_ids: Optional[List[str]] = Query(default=None),
    item_types: Optional[List[str]] = Query(default=None),
    tags: Optional[List[str]] = Query(default=None),
    top_k: int = Query(default=30, ge=1, le=100),
) -> Dict[str, Any]:
    """Exact local text lookup; it never creates a conversation message."""
    normalized_scope = [
        value
        for raw in workspace_ids or []
        for value in raw.split(",")
        if value
    ]
    scope = _validate_scope(normalized_scope)
    return _retrieval().search(
        query=query,
        mode="exact",
        top_k=top_k,
        workspace_ids=scope or None,
        item_types=item_types,
        tags=tags,
    )


@router.post("/search")
def knowledge_exact_search_post(
    req: KnowledgeExactSearchRequest,
) -> Dict[str, Any]:
    scope = _validate_scope(req.workspace_ids)
    item_refs = _validate_item_refs(req.item_refs)
    try:
        return _retrieval().search(
            query=req.question,
            mode="exact",
            top_k=req.top_k,
            workspace_ids=scope or None,
            item_refs=item_refs or None,
        )
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/conversations")
def list_conversations(
    keyword: str = Query(default="", max_length=200),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Dict[str, Any]:
    conversations, total = _conversation_store.list(
        keyword=keyword,
        limit=limit,
        offset=offset,
    )
    return {
        "items": [_conversation_payload(item) for item in conversations],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/conversations")
def create_conversation(req: ConversationCreateRequest) -> Dict[str, Any]:
    scope = _validate_scope(req.default_scope)
    item_refs = _validate_item_refs(req.default_item_refs)
    return _conversation_payload(
        _conversation_store.create(
            title=req.title,
            default_scope=scope,
            default_item_refs=item_refs,
        )
    )


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str) -> Dict[str, Any]:
    conversation = _conversation_store.get(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    return _conversation_payload(conversation)


@router.patch("/conversations/{conversation_id}")
def patch_conversation(
    conversation_id: str,
    req: ConversationPatchRequest,
) -> Dict[str, Any]:
    scope = (
        _validate_scope(req.default_scope)
        if req.default_scope is not None
        else None
    )
    item_refs = (
        _validate_item_refs(req.default_item_refs)
        if req.default_item_refs is not None
        else None
    )
    conversation = _conversation_store.update(
        conversation_id,
        title=req.title,
        default_scope=scope,
        default_item_refs=item_refs,
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    return _conversation_payload(conversation)


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str) -> Dict[str, bool]:
    if not _conversation_store.delete(conversation_id):
        raise HTTPException(status_code=404, detail="conversation not found")
    return {"deleted": True}


@router.post("/conversations/{conversation_id}/messages/stream")
def stream_conversation_message(
    conversation_id: str,
    req: ConversationMessageRequest,
) -> StreamingResponse:
    conversation = _conversation_store.get(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    scope = (
        _validate_scope(req.workspace_ids)
        if req.workspace_ids is not None
        else list(conversation.default_scope)
    )
    item_refs = (
        _validate_item_refs(req.item_refs)
        if req.item_refs is not None
        else list(conversation.default_item_refs)
    )
    service = KnowledgeMessageService(
        store=_conversation_store,
        retrieval=_retrieval(),
    )
    return StreamingResponse(
        service.stream(
            conversation_id,
            question=req.question.strip(),
            workspace_ids=scope,
            item_refs=item_refs,
            top_k=req.top_k,
        ),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache"},
    )


@router.post(
    "/conversations/{conversation_id}/messages/{message_id}/regenerate"
)
def regenerate_conversation_message(
    conversation_id: str,
    message_id: str,
) -> Dict[str, Any]:
    conversation = _conversation_store.get(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="conversation not found")
    original = next(
        (
            message
            for message in conversation.messages
            if message.message_id == message_id and message.role == "assistant"
        ),
        None,
    )
    if original is None:
        raise HTTPException(status_code=404, detail="assistant message not found")
    try:
        result = _retrieval().search(
            query=original.query_text,
            mode="smart",
            top_k=10,
            workspace_ids=original.scope_snapshot or None,
            item_refs=original.scope_item_refs or None,
        )
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    regenerated = KnowledgeMessage(
        role="assistant",
        status=(
            "insufficient_evidence"
            if result.get("answer_status") == "insufficient_evidence"
            else "complete"
        ),
        content=str(result.get("answer") or ""),
        query_text=original.query_text,
        scope_snapshot=list(original.scope_snapshot),
        scope_item_refs=list(original.scope_item_refs),
        answer_version=max(
            (
                message.answer_version
                for message in conversation.messages
                if message.role == "assistant"
                and message.query_text == original.query_text
            ),
            default=original.answer_version,
        )
        + 1,
        citations=[
            str(citation.get("source_id") or "")
            for citation in result.get("citations", [])
            if citation.get("source_id")
        ],
        sources=[
            KnowledgeSourceSnapshot.model_validate(source)
            for source in result.get("sources", [])
        ],
        evidence_status=dict(result.get("evidence_status") or {}),
    )
    _conversation_store.append_message(conversation_id, regenerated)
    return regenerated.model_dump(mode="json")
