"""
聊天存储：按 workspace 维度，将聊天消息以 jsonl 持久化到 data/chats/<workspace_id>.jsonl。

一行一条消息，追加写入，避免大文件重写。读取时按 chat_id 过滤或分组。
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Literal

from shared.config import DATA_DIR

CHATS_DIR: Path = DATA_DIR / "chats"

Role = Literal["user", "assistant", "system"]
_VALID_ROLES: tuple[str, ...] = ("user", "assistant", "system")
_WORKSPACE_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


class ChatStoreError(Exception):
    """聊天存储相关错误。"""


@dataclass
class ChatMessage:
    chat_id: str
    role: Role
    content: str
    message_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).replace(microsecond=0).isoformat())
    model: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "ChatMessage":
        return cls(
            chat_id=str(data["chat_id"]),
            role=data["role"],
            content=str(data.get("content", "")),
            message_id=str(data.get("message_id") or uuid.uuid4().hex),
            created_at=str(data.get("created_at") or datetime.now(timezone.utc).replace(microsecond=0).isoformat()),
            model=data.get("model"),
        )


@dataclass(frozen=True)
class ChatSummary:
    chat_id: str
    message_count: int
    first_at: str
    last_at: str


def _validate_workspace_id(workspace_id: str) -> str:
    wid = (workspace_id or "").strip()
    if not wid or not _WORKSPACE_ID_RE.match(wid):
        raise ChatStoreError(f"非法 workspace_id: {workspace_id!r}")
    return wid


def _path_for(workspace_id: str) -> Path:
    wid = _validate_workspace_id(workspace_id)
    return CHATS_DIR / f"{wid}.jsonl"


class ChatStore:
    """线程安全的 jsonl 聊天存储。"""

    def __init__(self, root: Path | None = None) -> None:
        self._root: Path = Path(root) if root is not None else CHATS_DIR
        self._lock = Lock()

    def _file(self, workspace_id: str) -> Path:
        wid = _validate_workspace_id(workspace_id)
        return self._root / f"{wid}.jsonl"

    def append(self, workspace_id: str, msg: ChatMessage) -> ChatMessage:
        if msg.role not in _VALID_ROLES:
            raise ChatStoreError(f"非法 role: {msg.role!r}")
        if not (msg.chat_id or "").strip():
            raise ChatStoreError("chat_id 不能为空")
        path = self._file(workspace_id)
        with self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(msg.to_dict(), ensure_ascii=False) + "\n")
        return msg

    def list(self, workspace_id: str, chat_id: str | None = None) -> list[ChatMessage]:
        path = self._file(workspace_id)
        if not path.exists():
            return []
        out: list[ChatMessage] = []
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if chat_id is not None and data.get("chat_id") != chat_id:
                    continue
                try:
                    out.append(ChatMessage.from_dict(data))
                except (KeyError, TypeError):
                    continue
        return out

    def list_chats(self, workspace_id: str) -> list[ChatSummary]:
        msgs = self.list(workspace_id)
        groups: dict[str, list[ChatMessage]] = {}
        for m in msgs:
            groups.setdefault(m.chat_id, []).append(m)
        summaries: list[ChatSummary] = []
        for cid, items in groups.items():
            items.sort(key=lambda m: m.created_at)
            summaries.append(
                ChatSummary(
                    chat_id=cid,
                    message_count=len(items),
                    first_at=items[0].created_at,
                    last_at=items[-1].created_at,
                )
            )
        summaries.sort(key=lambda s: s.last_at, reverse=True)
        return summaries


_default_store = ChatStore()


def get_default_store() -> ChatStore:
    return _default_store
