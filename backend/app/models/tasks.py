from __future__ import annotations

"""Task domain models."""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, FrozenSet, List, Literal


class TaskStatus(str, Enum):
    """Pipeline 任务状态机（继承 str 以便 JSON 直接序列化为字符串）。

    阶段名对齐 v1.1 §11：download / probe / frames / asr / vlm / sum / store。
    """

    PENDING = "PENDING"
    DOWNLOAD = "DOWNLOAD"      # 下载（仅链接来源）
    PROBE = "PROBE"            # 探测（格式/时长/字幕轨）
    FRAMES = "FRAMES"          # 截帧（画面准备）
    ASR = "ASR"                # 转写（Whisper）
    VLM = "VLM"                # 视觉分析（逐帧提示词）
    # Phase 2C.1：文本输入层阶段（v1.1 §11 文本链）
    FETCH = "FETCH"            # 拉取（URL 下载 / 文件就绪）
    PARSE = "PARSE"            # 解析（PDF/DOCX/HTML → 原始文本）
    EXTRACT = "EXTRACT"        # 抽取（标题 + 正文规范化）
    SUM = "SUM"                # 总结（LLM 生成总结）
    ASSOCIATE = "ASSOCIATE"    # N10: 联想归纳
    REWRITE = "REWRITE"        # N10: 改写/润色
    TRANSLATE = "TRANSLATE"    # N10: 翻译
    STORE = "STORE"            # 入库（写入任务数据库）
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    AWAITING_CONFIRM = "AWAITING_CONFIRM"  # A3: VAD 无人声，等待用户确认切音乐模式


# 历史遗留状态 → 新 Enum 的映射。
# 覆盖范围：phase-1 早期命名（running/done/error/queued）、
# phase-2 命名（succeeded/failed/cancelled），
# 以及 1F 之前的阶段名（PARSING/DOWNLOADING/TRANSCRIBING/ANALYZING/SUMMARIZING）。
LEGACY_STATUS_MAP: Dict[str, TaskStatus] = {
    "running": TaskStatus.DOWNLOAD,
    "done": TaskStatus.SUCCESS,
    "error": TaskStatus.FAILED,
    "queued": TaskStatus.PENDING,
    "succeeded": TaskStatus.SUCCESS,
    "failed": TaskStatus.FAILED,
    "cancelled": TaskStatus.CANCELLED,
    # 1F 之前的阶段名
    "PARSING": TaskStatus.PROBE,
    "DOWNLOADING": TaskStatus.DOWNLOAD,
    "TRANSCRIBING": TaskStatus.ASR,
    "ANALYZING": TaskStatus.VLM,
    "SUMMARIZING": TaskStatus.SUM,
}


# 终结态集合（用于 delete/SSE 终止判断等）。
TERMINAL_STATUS_VALUES: FrozenSet[str] = frozenset(
    {TaskStatus.SUCCESS.value, TaskStatus.FAILED.value, TaskStatus.CANCELLED.value}
)


def coerce_status(raw: Any) -> "TaskStatus":
    """将任意旧/新状态字符串归一为 TaskStatus，未知值兜底为 PENDING。"""
    if isinstance(raw, TaskStatus):
        return raw
    key = str(raw or "")
    mapped = LEGACY_STATUS_MAP.get(key)
    if mapped is not None:
        return mapped
    try:
        return TaskStatus(key)
    except ValueError:
        return TaskStatus.PENDING


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class TaskLogEntry:
    ts: str
    level: Literal["info", "warning", "error"]
    message: str

    @classmethod
    def create(cls, message: str, level: Literal["info", "warning", "error"] = "info") -> "TaskLogEntry":
        return cls(ts=_now_iso(), level=level, message=message)


@dataclass
class TaskRecord:
    """任务记录数据模型"""
    task_id: str
    project_id: str
    task_type: str
    payload: Dict[str, Any]
    status: str = TaskStatus.PENDING.value
    progress: float = 0.0
    log: List[TaskLogEntry] = field(default_factory=list)
    result: Dict[str, Any] = field(default_factory=dict)
    error: str = ""
    retry_of: str = ""
    cancel_requested: bool = False
    created_at: str = field(default_factory=_now_iso)
    updated_at: str = field(default_factory=_now_iso)

    def to_dict(self, include_logs: bool = True, include_result: bool = True, log_tail: int = 0) -> Dict[str, Any]:
        """转换为字典格式。

        include_logs=False 时完全不序列化 log（轻量列表接口用）。
        include_result=False 时返回空 result dict。
        log_tail>0 时只保留最后 N 条日志。
        """
        obj = asdict(self)
        if include_logs:
            entries = [asdict(item) for item in self.log]
            if log_tail > 0 and len(entries) > log_tail:
                entries = entries[-log_tail:]
            obj["log"] = entries
        else:
            obj["log"] = []
        if not include_result:
            obj["result"] = {}
        obj["status"] = self.status.value if isinstance(self.status, TaskStatus) else str(self.status)
        return obj

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TaskRecord":
        """从字典创建任务记录"""
        log_items: List[TaskLogEntry] = []
        for item in data.get("log") or []:
            if not isinstance(item, dict):
                continue
            log_items.append(
                TaskLogEntry(
                    ts=str(item.get("ts") or _now_iso()),
                    level=str(item.get("level") or "info"),  # type: ignore[arg-type]
                    message=str(item.get("message") or ""),
                )
            )
        return cls(
            task_id=str(data.get("task_id") or ""),
            project_id=str(data.get("project_id") or ""),
            task_type=str(data.get("task_type") or ""),
            payload=dict(data.get("payload") or {}),
            status=coerce_status(data.get("status")).value,
            progress=float(data.get("progress") or 0.0),
            log=log_items,
            result=dict(data.get("result") or {}),
            error=str(data.get("error") or ""),
            retry_of=str(data.get("retry_of") or ""),
            cancel_requested=bool(data.get("cancel_requested") or False),
            created_at=str(data.get("created_at") or _now_iso()),
            updated_at=str(data.get("updated_at") or _now_iso()),
        )
