"""S5 Task 1: 稳定检索来源身份。

source_id 由规范化的 workspace/item/field/segment/start/end 生成 SHA-256 短 ID。
同一 item 的不同转写时间段/字段有不同 source_id；同一片段重建索引后 ID 不变。
"""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional


def compute_source_id(
    workspace_id: str,
    item_id: str,
    field: str,
    segment: int | str = 0,
    start_ms: int = 0,
    end_ms: int = 0,
) -> str:
    """计算稳定的来源 ID。

    使用 SHA-256 的前 16 个字符作为短 ID。
    """
    # 规范化输入
    key = f"{workspace_id}:{item_id}:{field}:{segment}:{start_ms}:{end_ms}"
    hash_bytes = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return hash_bytes[:16]


@dataclass
class KnowledgeSource:
    """知识库检索来源。"""

    source_id: str
    workspace_id: str
    item_id: str
    content_id: str = ""
    lineage_id: str = ""
    source_type: str = "transcript"  # transcript / summary / ocr / merged_note
    title: str = ""
    excerpt: str = ""
    field: str = "transcript"
    segment: int | str = 0
    start_ms: int = 0
    end_ms: int = 0
    score: float = 0.0
    jump_url: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "KnowledgeSource":
        return cls(
            source_id=str(data.get("source_id") or ""),
            workspace_id=str(data.get("workspace_id") or ""),
            item_id=str(data.get("item_id") or ""),
            content_id=str(data.get("content_id") or ""),
            lineage_id=str(data.get("lineage_id") or ""),
            source_type=str(data.get("source_type") or "transcript"),
            title=str(data.get("title") or ""),
            excerpt=str(data.get("excerpt") or ""),
            field=str(data.get("field") or "transcript"),
            segment=data.get("segment") or 0,
            start_ms=int(data.get("start_ms") or 0),
            end_ms=int(data.get("end_ms") or 0),
            score=float(data.get("score") or 0.0),
            jump_url=str(data.get("jump_url") or ""),
        )

    @classmethod
    def create(
        cls,
        workspace_id: str,
        item_id: str,
        field: str = "transcript",
        segment: int | str = 0,
        start_ms: int = 0,
        end_ms: int = 0,
        **kwargs: Any,
    ) -> "KnowledgeSource":
        """创建来源，自动计算 source_id。"""
        source_id = compute_source_id(
            workspace_id=workspace_id,
            item_id=item_id,
            field=field,
            segment=segment,
            start_ms=start_ms,
            end_ms=end_ms,
        )
        return cls(
            source_id=source_id,
            workspace_id=workspace_id,
            item_id=item_id,
            field=field,
            segment=segment,
            start_ms=start_ms,
            end_ms=end_ms,
            **kwargs,
        )


def build_jump_url(
    workspace_id: str,
    item_id: str,
    source_type: str,
    start_ms: int = 0,
) -> str:
    """构建跳转 URL。

    音视频包含 start_ms，文本定位到 section/segment。
    """
    base = f"/note?workspace_id={workspace_id}&item_id={item_id}"
    if source_type in ("transcript", "audio", "video") and start_ms > 0:
        return f"{base}&start_ms={start_ms}"
    return base
