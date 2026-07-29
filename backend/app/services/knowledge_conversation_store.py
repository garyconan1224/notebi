"""Atomic JSON persistence for knowledge conversations."""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.app.models.knowledge_conversation import (
    KnowledgeConversation,
    KnowledgeMessage,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class KnowledgeConversationStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._cache: dict[str, KnowledgeConversation] = {}
        self._load_all()

    def _path(self, conversation_id: str) -> Path:
        return self.root / f"{conversation_id}.json"

    def _load_all(self) -> None:
        for path in self.root.glob("*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                conversation = KnowledgeConversation.model_validate(payload)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            self._cache[conversation.conversation_id] = conversation

    def _write(self, conversation: KnowledgeConversation) -> None:
        path = self._path(conversation.conversation_id)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(
                conversation.model_dump(mode="json"),
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        os.replace(temporary, path)

    def save(self, conversation: KnowledgeConversation) -> KnowledgeConversation:
        with self._lock:
            snapshot = conversation.model_copy(deep=True)
            self._cache[snapshot.conversation_id] = snapshot
            self._write(snapshot)
            return snapshot.model_copy(deep=True)

    def create(
        self,
        *,
        title: str = "新会话",
        default_scope: Optional[list[str]] = None,
    ) -> KnowledgeConversation:
        conversation = KnowledgeConversation(
            title=title.strip() or "新会话",
            default_scope=list(dict.fromkeys(default_scope or [])),
        )
        return self.save(conversation)

    def get(self, conversation_id: str) -> Optional[KnowledgeConversation]:
        with self._lock:
            value = self._cache.get(conversation_id)
            return value.model_copy(deep=True) if value else None

    def list(
        self,
        *,
        keyword: str = "",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[KnowledgeConversation], int]:
        with self._lock:
            values = [value.model_copy(deep=True) for value in self._cache.values()]
        needle = keyword.strip().casefold()
        if needle:
            values = [
                value
                for value in values
                if needle in value.title.casefold()
                or any(
                    needle in (message.query_text or message.content).casefold()
                    for message in value.messages
                )
            ]
        values.sort(key=lambda value: value.updated_at, reverse=True)
        return values[offset : offset + limit], len(values)

    def update(
        self,
        conversation_id: str,
        *,
        title: Optional[str] = None,
        default_scope: Optional[list[str]] = None,
    ) -> Optional[KnowledgeConversation]:
        with self._lock:
            conversation = self._cache.get(conversation_id)
            if conversation is None:
                return None
            updated = conversation.model_copy(deep=True)
            if title is not None:
                updated.title = title.strip() or "新会话"
            if default_scope is not None:
                updated.default_scope = list(dict.fromkeys(default_scope))
            updated.updated_at = _now()
            return self.save(updated)

    def append_message(
        self,
        conversation_id: str,
        message: KnowledgeMessage,
    ) -> Optional[KnowledgeConversation]:
        with self._lock:
            conversation = self._cache.get(conversation_id)
            if conversation is None:
                return None
            updated = conversation.model_copy(deep=True)
            updated.messages.append(message.model_copy(deep=True))
            updated.updated_at = _now()
            if (
                updated.title == "新会话"
                and message.role == "user"
                and message.query_text.strip()
            ):
                updated.title = message.query_text.strip()[:40]
            return self.save(updated)

    def replace_message(
        self,
        conversation_id: str,
        message: KnowledgeMessage,
    ) -> Optional[KnowledgeConversation]:
        with self._lock:
            conversation = self._cache.get(conversation_id)
            if conversation is None:
                return None
            updated = conversation.model_copy(deep=True)
            for index, existing in enumerate(updated.messages):
                if existing.message_id == message.message_id:
                    updated.messages[index] = message.model_copy(deep=True)
                    updated.updated_at = _now()
                    return self.save(updated)
            return None

    def delete(self, conversation_id: str) -> bool:
        with self._lock:
            if conversation_id not in self._cache:
                return False
            del self._cache[conversation_id]
            try:
                self._path(conversation_id).unlink()
            except OSError:
                pass
            return True
