"""NDJSON conversation message orchestration."""

from __future__ import annotations

import json
from time import perf_counter
from typing import Any, Generator, Optional

from backend.app.models.knowledge_conversation import (
    KnowledgeMessage,
    KnowledgeSourceSnapshot,
)
from backend.app.services.knowledge_conversation_store import (
    KnowledgeConversationStore,
)
from backend.app.services.retrieval_service import RetrievalService


def _line(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


class KnowledgeMessageService:
    def __init__(
        self,
        *,
        store: KnowledgeConversationStore,
        retrieval: Optional[RetrievalService] = None,
    ) -> None:
        self.store = store
        self.retrieval = retrieval or RetrievalService()

    def stream(
        self,
        conversation_id: str,
        *,
        question: str,
        workspace_ids: Optional[list[str]],
        item_refs: Optional[list[dict[str, str]]] = None,
        top_k: int = 10,
        answer_version: int = 1,
    ) -> Generator[str, None, None]:
        conversation = self.store.get(conversation_id)
        if conversation is None:
            raise KeyError(conversation_id)
        scope = (
            list(dict.fromkeys(workspace_ids))
            if workspace_ids is not None
            else list(conversation.default_scope)
        )
        item_scope = (
            list(item_refs)
            if item_refs is not None
            else list(conversation.default_item_refs)
        )
        user = KnowledgeMessage(
            role="user",
            status="complete",
            content=question,
            query_text=question,
            scope_snapshot=scope,
            scope_item_refs=item_scope,
        )
        assistant = KnowledgeMessage(
            role="assistant",
            status="retrieving",
            query_text=question,
            scope_snapshot=scope,
            scope_item_refs=item_scope,
            answer_version=answer_version,
        )
        self.store.append_message(conversation_id, user)
        self.store.append_message(conversation_id, assistant)
        started = perf_counter()

        try:
            # This yield intentionally precedes retrieval work.
            yield _line({
                "type": "status",
                "stage": "retrieving",
                "message_id": assistant.message_id,
            })
            retrieval_started = perf_counter()
            result = self.retrieval.search(
                query=question,
                mode="smart",
                top_k=top_k,
                workspace_ids=scope or None,
                item_refs=item_scope or None,
            )
            assistant.sources = [
                KnowledgeSourceSnapshot.model_validate(source)
                for source in result.get("sources", [])
            ]
            assistant.citations = [
                str(citation.get("source_id") or "")
                for citation in result.get("citations", [])
                if citation.get("source_id")
            ]
            assistant.evidence_status = dict(result.get("evidence_status") or {})
            assistant.timings_ms["retrieval"] = round(
                (perf_counter() - retrieval_started) * 1000
            )
            self.store.replace_message(conversation_id, assistant)
            yield _line({
                "type": "sources",
                "message_id": assistant.message_id,
                "sources": [
                    source.model_dump(mode="json") for source in assistant.sources
                ],
                "citations": assistant.citations,
                "evidence_status": assistant.evidence_status,
            })

            answer_status = result.get("answer_status") or "complete"
            if answer_status == "insufficient_evidence":
                assistant.status = "insufficient_evidence"
                assistant.content = ""
            else:
                assistant.status = "generating"
                self.store.replace_message(conversation_id, assistant)
                yield _line({
                    "type": "status",
                    "stage": "generating",
                    "message_id": assistant.message_id,
                })
                answer = str(result.get("answer") or "")
                assistant.content = answer
                for start in range(0, len(answer), 80):
                    yield _line({
                        "type": "delta",
                        "message_id": assistant.message_id,
                        "text": answer[start : start + 80],
                    })
                assistant.status = "complete"
            assistant.timings_ms["total"] = round((perf_counter() - started) * 1000)
            self.store.replace_message(conversation_id, assistant)
            yield _line({
                "type": "done",
                "message": assistant.model_dump(mode="json"),
            })
        except GeneratorExit:
            assistant.status = "failed"
            assistant.error = "client disconnected"
            assistant.timings_ms["total"] = round((perf_counter() - started) * 1000)
            self.store.replace_message(conversation_id, assistant)
            raise
        except Exception as error:  # noqa: BLE001
            assistant.status = "failed"
            assistant.error = str(error)
            assistant.timings_ms["total"] = round((perf_counter() - started) * 1000)
            self.store.replace_message(conversation_id, assistant)
            yield _line({
                "type": "error",
                "message_id": assistant.message_id,
                "error": str(error),
                "recoverable": True,
            })
