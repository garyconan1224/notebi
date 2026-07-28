"""Persistent knowledge conversation models.

Only reader-visible conversation state and evidence snapshots are stored.
Provider credentials and model prompts are intentionally not represented.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


class KnowledgeSourceSnapshot(BaseModel):
    model_config = ConfigDict(extra="ignore")

    source_id: str
    workspace_id: str
    item_id: str
    content_id: str = ""
    lineage_id: str = ""
    workspace_name: str = ""
    item_type: str = "text"
    source_type: str = "content"
    item_title: str = ""
    title: str = ""
    excerpt: str = ""
    chunk_excerpt: str = ""
    field: str = "content"
    segment_id: str = ""
    segment: str | int = ""
    start_ms: int | None = None
    end_ms: int | None = None
    score: float = 0.0
    jump_url: str = ""


MessageStatus = Literal[
    "retrieving",
    "generating",
    "complete",
    "failed",
    "insufficient_evidence",
]


class KnowledgeMessage(BaseModel):
    message_id: str = Field(default_factory=lambda: str(uuid4()))
    role: Literal["user", "assistant"]
    status: MessageStatus
    content: str = ""
    scope_snapshot: List[str] = Field(default_factory=list)
    query_text: str = ""
    answer_version: int = 1
    citations: List[str] = Field(default_factory=list)
    sources: List[KnowledgeSourceSnapshot] = Field(default_factory=list)
    evidence_status: Dict[str, Any] = Field(default_factory=dict)
    error: str = ""
    timings_ms: Dict[str, int] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=_now)


class KnowledgeConversation(BaseModel):
    conversation_id: str = Field(default_factory=lambda: str(uuid4()))
    title: str = "新会话"
    default_scope: List[str] = Field(default_factory=list)
    messages: List[KnowledgeMessage] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
