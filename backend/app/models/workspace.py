from __future__ import annotations

"""Workspace（工作空间）领域模型。

设计文档第 2 章「任务系统」：一个 workspace = 一个独立工作空间，
内含多个素材（视频/音频/图片/文字），共享一个数据库与 LLM 上下文。

与现有 backend.app.models.tasks.TaskRecord 的关系：
- TaskRecord 表示「一次具体执行」（下载、分析、转录），保持不变；
- WorkspaceItem.related_task_ids 把 TaskRecord 反向关联回素材；
- 一个 Workspace 内的多个素材可触发多次 TaskRecord，互不冲突。
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, FrozenSet, List, Optional
import uuid


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class WorkspaceStatus(str, Enum):
    """工作空间状态。"""

    ACTIVE = "active"
    PROCESSING = "processing"
    ANALYZED = "analyzed"
    ARCHIVED = "archived"


class ItemType(str, Enum):
    """素材类型——对应设计文档四大分支。"""

    VIDEO = "video"
    AUDIO = "audio"
    IMAGE = "image"
    TEXT = "text"


class ItemStatus(str, Enum):
    """素材处理状态。"""

    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    PARTIAL = "partial"
    FAILED = "failed"


# 终结态集合（用于删除/查询过滤）。
TERMINAL_ITEM_STATUS: FrozenSet[str] = frozenset(
    {ItemStatus.DONE.value, ItemStatus.PARTIAL.value, ItemStatus.FAILED.value}
)


@dataclass
class PreflightConfig:
    """前置配置（设计文档第 4 章）。

    分三大区：
      1) background — 已抽到 WorkspaceBackground 单独管理，可在 item 维度覆盖
      2) models     — 视觉/文本/视频三类模型选择（值为 provider_id）
      3) tasks      — 本次要执行的分析项及其子参数（按 item.type 不同结构不同）

    所有字段都可选。未填字段在调用 LLM/pipeline 时跳过对应步骤。
    """

    background_overrides: Dict[str, Any] = field(default_factory=dict)
    models: Dict[str, str] = field(default_factory=dict)  # {vision: id, text: id, video: id}
    tasks: Dict[str, Any] = field(default_factory=dict)   # 与 item.type 关联的勾选 + 子参数
    intent: str = ""  # "learning" | ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PreflightConfig":
        if not isinstance(data, dict):
            return cls()
        return cls(
            background_overrides=dict(data.get("background_overrides") or {}),
            models=dict(data.get("models") or {}),
            tasks=dict(data.get("tasks") or {}),
            intent=str(data.get("intent") or ""),
        )


@dataclass
class ItemSummary:
    """单份总结产物（多模板、多版本并存）。"""

    summary_id: str  # uuid4
    template: str  # 模板 id（concise / detailed / ...）
    version: int  # 同一素材内全局自增，0, 1, 2, 3 ...
    summary_mode: str = "general"  # general | speaker_aware
    name: str = ""  # 用户自定义版本名（空则用默认标签）
    background_for_summary: str = ""  # 这次生成用的「总结用背景」
    content_md: str = ""  # LLM 产出的 markdown
    model_used: str = ""  # provider/model（审计用）
    coverage: Dict[str, Any] = field(default_factory=dict)  # 长内容分块与覆盖审计
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ItemSummary":
        return cls(
            summary_id=str(data.get("summary_id") or ""),
            template=str(data.get("template") or "concise"),
            version=int(data.get("version") if data.get("version") is not None else 0),
            summary_mode=str(data.get("summary_mode") or "general"),
            name=str(data.get("name") or ""),
            background_for_summary=str(data.get("background_for_summary") or ""),
            content_md=str(data.get("content_md") or ""),
            model_used=str(data.get("model_used") or ""),
            coverage=dict(data.get("coverage") or {}),
            created_at=str(data.get("created_at") or _now_iso()),
        )


@dataclass
class InlineFrame:
    """学习模式视频在转录正文中插入的截图。"""

    segment_idx: int                  # 关联第几段转录
    frame_timestamp: float            # 帧的视频时间戳（秒）
    frame_path: str                   # 帧图片路径（相对 workspace 根）
    source: str = "user"              # "user" (用户手选) | "suggested" (系统推荐被采纳)
    created_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "InlineFrame":
        return cls(
            segment_idx=int(data.get("segment_idx") or 0),
            frame_timestamp=float(data.get("frame_timestamp") or 0),
            frame_path=str(data.get("frame_path") or ""),
            source=str(data.get("source") or "user"),
            created_at=str(data.get("created_at") or _now_iso()),
        )


@dataclass
class WorkspaceItem:
    """工作空间内单个素材。"""

    item_id: str
    type: str  # ItemType 字面量
    source: str  # "url" | "local"
    source_value: str  # URL 或本地路径
    content_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    lineage_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    origin_content_id: Optional[str] = None
    legacy_item_id: str = ""
    name: str = ""  # 显示名（默认从 source 推导）
    status: str = ItemStatus.PENDING.value
    preflight: PreflightConfig = field(default_factory=PreflightConfig)
    results: Dict[str, Any] = field(default_factory=dict)
    related_task_ids: List[str] = field(default_factory=list)
    tags: Dict[str, Any] = field(default_factory=dict)
    summaries: List[ItemSummary] = field(default_factory=list)
    inline_frames: List[InlineFrame] = field(default_factory=list)
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        # asdict 会把 preflight、summaries 自动展开成 dict，无需额外处理
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkspaceItem":
        # 解析 summaries 列表
        raw_summaries = data.get("summaries")
        summaries: List[ItemSummary] = []
        if isinstance(raw_summaries, list):
            summaries = [ItemSummary.from_dict(s) for s in raw_summaries if isinstance(s, dict)]

        # 解析 inline_frames 列表
        raw_inline = data.get("inline_frames")
        inline_frames: List[InlineFrame] = []
        if isinstance(raw_inline, list):
            inline_frames = [InlineFrame.from_dict(f) for f in raw_inline if isinstance(f, dict)]

        # 运行时迁移：老数据没有 summaries 但 results["summary"] 有内容 → 构造 legacy v1
        if not summaries:
            legacy_content = (data.get("results") or {}).get("summary") or ""
            if isinstance(legacy_content, str) and legacy_content.strip():
                summaries = [ItemSummary(
                    summary_id="legacy",
                    template="legacy",
                    version=1,
                    content_md=legacy_content,
                )]

        return cls(
            item_id=str(data.get("item_id") or ""),
            type=str(data.get("type") or ItemType.VIDEO.value),
            source=str(data.get("source") or "local"),
            source_value=str(data.get("source_value") or ""),
            content_id=str(data.get("content_id") or ""),
            lineage_id=str(data.get("lineage_id") or ""),
            origin_content_id=(
                str(data["origin_content_id"]) if data.get("origin_content_id") else None
            ),
            legacy_item_id=str(data.get("legacy_item_id") or ""),
            name=str(data.get("name") or ""),
            status=str(data.get("status") or ItemStatus.PENDING.value),
            preflight=PreflightConfig.from_dict(data.get("preflight") or {}),
            results=dict(data.get("results") or {}),
            related_task_ids=list(data.get("related_task_ids") or []),
            tags=dict(data.get("tags") or {}),
            summaries=summaries,
            inline_frames=inline_frames,
            created_at=str(data.get("created_at") or _now_iso()),
            updated_at=str(data.get("updated_at") or _now_iso()),
        )


@dataclass
class WorkspaceBackground:
    """前置配置「背景信息」（设计文档 4.2）。

    所有字段可选；未填字段在 LLM 注入时会被跳过。
    """

    content_type: str = ""  # 课程 / 会议 / 宣传片 / Vlog ...
    participants: List[str] = field(default_factory=list)
    topic: str = ""  # 主题背景
    glossary: List[str] = field(default_factory=list)  # 专有名词
    purpose: str = ""  # 复刻参考 / 竞品分析 / 内容学习 ...

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkspaceBackground":
        if not isinstance(data, dict):
            return cls()
        return cls(
            content_type=str(data.get("content_type") or ""),
            participants=list(data.get("participants") or []),
            topic=str(data.get("topic") or ""),
            glossary=list(data.get("glossary") or []),
            purpose=str(data.get("purpose") or ""),
        )


def _gen_merged_id() -> str:
    """生成融合笔记 ID（短 UUID）。"""
    import uuid
    return uuid.uuid4().hex[:12]


def _gen_merged_version_id() -> str:
    return uuid.uuid4().hex[:12]


@dataclass
class MergedNoteVersion:
    version_id: str = field(default_factory=_gen_merged_version_id)
    content_md: str = ""
    item_ids: List[str] = field(default_factory=list)
    source_snapshot: List[Dict[str, str]] = field(default_factory=list)
    created_at: str = field(default_factory=_now_iso)
    created_by: str = "user"  # ai / user / restore

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MergedNoteVersion":
        created_by = str(data.get("created_by") or "user")
        if created_by not in {"ai", "user", "restore"}:
            created_by = "user"
        return cls(
            version_id=str(data.get("version_id") or _gen_merged_version_id()),
            content_md=str(data.get("content_md") or ""),
            item_ids=[str(item_id) for item_id in data.get("item_ids") or []],
            source_snapshot=[
                {str(key): str(value) for key, value in snapshot.items()}
                for snapshot in data.get("source_snapshot") or []
                if isinstance(snapshot, dict)
            ],
            created_at=str(data.get("created_at") or _now_iso()),
            created_by=created_by,
        )


@dataclass
class MergedNote:
    """合集级融合笔记：多个素材笔记经 LLM 合成后的综合笔记。"""

    merged_id: str = field(default_factory=_gen_merged_id)
    title: str = "综合笔记"
    item_ids: List[str] = field(default_factory=list)
    content_md: str = ""
    created_at: str = field(default_factory=_now_iso)
    current_version_id: str = ""
    versions: List[MergedNoteVersion] = field(default_factory=list)
    updated_at: str = ""
    deleted_at: str = ""

    def __post_init__(self) -> None:
        if not self.versions and (self.content_md or self.item_ids):
            version = MergedNoteVersion(
                content_md=self.content_md,
                item_ids=list(self.item_ids),
                created_at=self.created_at,
                created_by="ai",
            )
            self.versions.append(version)
            self.current_version_id = version.version_id
        if self.versions:
            current = next(
                (version for version in self.versions if version.version_id == self.current_version_id),
                self.versions[-1],
            )
            self.current_version_id = current.version_id
            self.content_md = current.content_md
            self.item_ids = list(current.item_ids)
        if not self.updated_at:
            self.updated_at = self.created_at

    def append_version(
        self,
        *,
        content_md: str,
        item_ids: List[str],
        source_snapshot: List[Dict[str, str]],
        created_by: str,
    ) -> MergedNoteVersion:
        version = MergedNoteVersion(
            content_md=content_md,
            item_ids=list(item_ids),
            source_snapshot=list(source_snapshot),
            created_by=created_by,
        )
        self.versions.append(version)
        self.current_version_id = version.version_id
        self.content_md = version.content_md
        self.item_ids = list(version.item_ids)
        self.updated_at = version.created_at
        return version

    def to_dict(self) -> Dict[str, Any]:
        return {
            "merged_id": self.merged_id,
            "title": self.title,
            "item_ids": list(self.item_ids),
            "content_md": self.content_md,
            "created_at": self.created_at,
            "current_version_id": self.current_version_id,
            "versions": [version.to_dict() for version in self.versions],
            "updated_at": self.updated_at,
            "deleted_at": self.deleted_at,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MergedNote":
        versions = [
            MergedNoteVersion.from_dict(version)
            for version in data.get("versions") or []
            if isinstance(version, dict)
        ]
        return cls(
            merged_id=str(data.get("merged_id") or _gen_merged_id()),
            title=str(data.get("title") or "综合笔记"),
            item_ids=list(data.get("item_ids") or []),
            content_md=str(data.get("content_md") or ""),
            created_at=str(data.get("created_at") or _now_iso()),
            current_version_id=str(data.get("current_version_id") or ""),
            versions=versions,
            updated_at=str(data.get("updated_at") or ""),
            deleted_at=str(data.get("deleted_at") or ""),
        )


@dataclass
class WorkspaceRecord:
    """工作空间记录。"""

    workspace_id: str
    name: str
    status: str = WorkspaceStatus.ACTIVE.value
    trashed: bool = False
    background: WorkspaceBackground = field(default_factory=WorkspaceBackground)
    items: List[WorkspaceItem] = field(default_factory=list)
    favorites: List[str] = field(default_factory=list)  # item_id 列表，复刻清单
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)
    # 运行期只创建 note；replica 仅用于启动期识别并清除历史数据。
    kind: str = "note"
    source: str = "manual"  # "manual" | "inbox" | "bilibili_favorites" | "bilibili_multipart" | "bilibili_uploader"
    source_meta: Dict[str, Any] = field(default_factory=dict)  # 来源合集的元数据（B站收藏夹/分P/UP主）
    merged_notes: List[MergedNote] = field(default_factory=list)  # 合集级融合笔记

    def to_dict(self) -> Dict[str, Any]:
        return {
            "workspace_id": self.workspace_id,
            "name": self.name,
            "status": self.status,
            "trashed": self.trashed,
            "background": self.background.to_dict(),
            "items": [it.to_dict() for it in self.items],
            "favorites": list(self.favorites),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "kind": self.kind,
            "source": self.source,
            "source_meta": self.source_meta,
            "merged_notes": [mn.to_dict() for mn in self.merged_notes],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkspaceRecord":
        items_raw = data.get("items") or []
        items: List[WorkspaceItem] = []
        for it in items_raw:
            if isinstance(it, dict):
                item = WorkspaceItem.from_dict(it)
                legacy_id = item.legacy_item_id or item.item_id
                if not item.content_id:
                    item.content_id = str(uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"notebi:content:{data.get('workspace_id', '')}:{legacy_id}",
                    ))
                    item.legacy_item_id = legacy_id
                if not item.lineage_id:
                    item.lineage_id = str(uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"notebi:lineage:{legacy_id}",
                    ))
                items.append(item)
        raw_status = str(data.get("status") or WorkspaceStatus.ACTIVE.value)
        # 老数据兼容：旧 "completed" 统一映射成 "analyzed"
        if raw_status == "completed":
            raw_status = WorkspaceStatus.ANALYZED.value
        # 老数据可能仍含 project_id 字段；from_dict 静默忽略
        # 仅在启动期清理时保留 legacy replica 原始标记；公开接口不再接受该类型。
        raw_kind = str(data.get("kind") or "note")
        if raw_kind not in ("note", "replica"):
            raw_kind = "note"
        # 老数据兼容：缺 source 字段默认 "manual"
        raw_source = str(data.get("source") or "manual")
        if raw_source not in (
            "manual",
            "inbox",
            "multi_url",
            "youtube_playlist",
            "bilibili_favorites",
            "bilibili_multipart",
            "bilibili_uploader",
        ):
            raw_source = "manual"
        raw_source_meta = data.get("source_meta") or {}
        if not isinstance(raw_source_meta, dict):
            raw_source_meta = {}
        return cls(
            workspace_id=str(data.get("workspace_id") or ""),
            name=str(data.get("name") or ""),
            status=raw_status,
            trashed=bool(data.get("trashed") or False),
            background=WorkspaceBackground.from_dict(data.get("background") or {}),
            items=items,
            favorites=list(data.get("favorites") or []),
            created_at=str(data.get("created_at") or _now_iso()),
            updated_at=str(data.get("updated_at") or _now_iso()),
            kind=raw_kind,
            source=raw_source,
            source_meta=raw_source_meta,
            merged_notes=[MergedNote.from_dict(mn) for mn in (data.get("merged_notes") or []) if isinstance(mn, dict)],
        )
