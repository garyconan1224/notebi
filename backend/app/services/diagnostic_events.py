"""Q7：用户诊断事件层。

把原始技术日志整理成「用户能采取行动」的诊断事件（三层架构的第一层）：
- 有限事件代码 + 中文摘要 + 可能原因 + 建议操作 + scope/correlation；
- 时间窗内重复的相同事件聚合计数，不刷屏；
- 原始技术细节保留在第二层（按需展开），脱敏后进入诊断包。

映射覆盖：VLM 模型不匹配、B 站元数据失败、ASR/说话人、ffmpeg、导出、
磁盘/权限等（反馈 #15 的可操作诊断）。
"""

from __future__ import annotations

import re
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional

# ── 事件代码目录：code → {summary, cause, action} ────────────────

EVENT_CATALOG: Dict[str, Dict[str, str]] = {
    "application_started": {
        "summary": "应用已启动",
        "cause": "进程或会话启动时记录一次。",
        "action": "无需处理。",
    },
    "vlm_model_mismatch": {
        "summary": "画面理解模型与配置不匹配",
        "cause": "结果来自旧的视觉模型，或当前视觉模型设置与生成时不同。",
        "action": "在 设置 → 模型 中确认视觉模型，然后重新生成该笔记。",
    },
    "bilibili_meta_failed": {
        "summary": "B 站元数据获取失败",
        "cause": "BV 号无效、视频被删除，或网络/风控限制。",
        "action": "检查链接是否正确、视频是否可访问，稍后重试。",
    },
    "asr_failed": {
        "summary": "语音转写失败",
        "cause": "本地转写引擎未安装，或音频无法解码。",
        "action": "在 设置 → 模型 中检查转写引擎，或确认音频文件完整后重试。",
    },
    "diarization_failed": {
        "summary": "区分说话人失败",
        "cause": "说话人模型未就绪，或音频中无法区分多人。",
        "action": "可在结果页点「重试」补做说话人识别；字幕仍按单人保留。",
    },
    "ffmpeg_missing": {
        "summary": "未检测到 ffmpeg",
        "cause": "本机未安装 ffmpeg，音视频处理与烧录字幕不可用。",
        "action": "安装 ffmpeg（如 brew install ffmpeg），或改用软字幕导出。",
    },
    "export_failed": {
        "summary": "导出失败",
        "cause": "缺少本地媒体/字幕，或目标目录不可写。",
        "action": "按提示补齐缺失内容，或更换导出目标后重试。",
    },
    "disk_or_permission": {
        "summary": "磁盘写入失败或权限不足",
        "cause": "磁盘已满，或数据目录无写入权限。",
        "action": "释放磁盘空间，或检查数据目录权限后重试。",
    },
    "link_preview_failed": {
        "summary": "链接预览获取失败",
        "cause": "链接不可访问，或平台接口限制。",
        "action": "确认链接有效；仍可尝试直接提交。",
    },
    "task_cancelled": {
        "summary": "任务已取消",
        "cause": "用户主动取消了该任务。",
        "action": "如需继续，可在任务中心重试。",
    },
    "task_failed": {
        "summary": "任务执行失败",
        "cause": "处理过程中发生未分类错误。",
        "action": "在任务中心查看失败阶段和技术详情，然后重试。",
    },
}


def describe_event(event_code: str) -> Dict[str, str]:
    """返回事件代码对应的中文摘要/原因/建议；未知代码给通用兜底。"""
    known = EVENT_CATALOG.get(event_code)
    if known:
        return dict(known)
    return {
        "summary": event_code or "未知事件",
        "cause": "暂无该事件的详细说明。",
        "action": "可查看原始技术日志了解细节。",
    }


# ── 脱敏（诊断包导出前强制执行）─────────────────────────────────

# 先处理 Bearer 头（值可能带多段），再处理 key=value/ key: value 凭据，
# 最后兜底已知的令牌前缀（sk-/pk-/NT-/hf-/ghp- 等）。
_BEARER_RE = re.compile(r"(?i)\bbearer\s+\S+")
_KEY_VALUE_RE = re.compile(
    r"(?i)\b(access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|secret|cookie|"
    r"authorization|auth|token|password|passwd|credential)\b\s*[:=]\s*\S+"
)
_TOKEN_PREFIX_RE = re.compile(r"\b(?:sk|pk|NT|hf|ghp|gho|xox[baprs])-?[A-Za-z0-9_\-]{10,}")
_ABS_PATH_RE = re.compile(r"(?:/Users/|/home/|/private/|C:\\Users\\)[^\s\"',;]+")


def redact_text(text: str) -> str:
    """脱敏：移除凭据/令牌与绝对隐私路径。"""
    if not text:
        return text
    result = _BEARER_RE.sub("Bearer ***", text)
    result = _KEY_VALUE_RE.sub(lambda m: f"{m.group(1)}=***", result)
    result = _TOKEN_PREFIX_RE.sub("***", result)
    result = _ABS_PATH_RE.sub("<path>", result)
    return result


def redact_event(event: Dict[str, Any]) -> Dict[str, Any]:
    """对单条事件的文本字段脱敏，保留 scope/correlation 结构。"""
    cleaned = dict(event)
    for key in ("message", "summary", "cause", "action", "detail"):
        value = cleaned.get(key)
        if isinstance(value, str):
            cleaned[key] = redact_text(value)
    return cleaned


# ── 时间窗内聚合成对数 ──────────────────────────────────────────


class DiagnosticAggregator:
    """相同 (event_code, task_id) 在窗口内聚合计数，避免刷屏。"""

    def __init__(self, window_seconds: float = 30.0, max_entries: int = 500) -> None:
        self._window = window_seconds
        self._max = max_entries
        self._entries: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()

    def record(self, event_code: str, *, task_id: str = "", now: float, **fields: Any) -> Dict[str, Any]:
        key = f"{event_code}|{task_id}"
        entry = self._entries.get(key)
        if entry is not None and (now - entry["first_at"]) <= self._window:
            entry["count"] += 1
            entry["last_at"] = now
            self._entries.move_to_end(key)
            return entry
        entry = {
            "event_code": event_code,
            "task_id": task_id,
            "count": 1,
            "first_at": now,
            "last_at": now,
            **describe_event(event_code),
            **fields,
        }
        self._entries[key] = entry
        self._entries.move_to_end(key)
        while len(self._entries) > self._max:
            self._entries.popitem(last=False)
        return entry

    def recent(self, limit: int = 50) -> List[Dict[str, Any]]:
        items = list(self._entries.values())
        return items[-limit:]


_DEFAULT_AGGREGATOR = DiagnosticAggregator()


def emit_diagnostic_event(
    sink: Any,
    event_code: str,
    *,
    task_id: str = "",
    batch_id: str = "",
    workspace_id: str = "",
    stage: str = "",
    component: str = "",
    technical_detail: str = "",
    aggregator: Optional[DiagnosticAggregator] = None,
    now: Optional[float] = None,
) -> Any:
    """把有限事件代码写入标准日志，并对时间窗内重复事件降噪。

    第 1、2、4、8…次重复写入带累计次数的快照，其余重复被抑制；
    既保留趋势，又避免同一底层错误刷满诊断页。
    """
    agg = aggregator or _DEFAULT_AGGREGATOR
    entry = agg.record(event_code, task_id=task_id, now=time.monotonic() if now is None else now)
    count = int(entry["count"])
    if count > 1 and count & (count - 1):
        return None
    info = describe_event(event_code)
    message = info["summary"] if count == 1 else f"{info['summary']}（重复 {count} 次）"
    return sink.append(
        "ERROR",
        "diagnostic",
        message,
        task_id=task_id or None,
        batch_id=batch_id or None,
        workspace_id=workspace_id or None,
        stage=stage or None,
        event_code=event_code,
        component=component or None,
        outcome="failed",
        summary=info["summary"],
        probable_cause=info["cause"],
        suggested_action=info["action"],
        technical_detail=technical_detail or None,
        details={"item_count": count},
    )


def classify_task_failure(record: Any, *, stage: str, error: str) -> str:
    """按真实任务上下文把失败归入有限用户诊断代码。"""
    text = str(error or "").lower()
    task_type = str(getattr(record, "task_type", "") or "").lower()
    payload = getattr(record, "payload", {}) or {}
    source = str(payload.get("url") or payload.get("source") or payload.get("source_value") or "").lower()
    normalized_stage = str(stage or "").upper()
    if any(token in text for token in ("permission denied", "no space left", "disk full", "read-only file system")):
        return "disk_or_permission"
    if task_type == "burn_subtitle":
        missing_ffmpeg = "ffmpeg" in text and any(
            token in text for token in ("not", "missing", "未找到", "不存在")
        )
        return "ffmpeg_missing" if missing_ffmpeg else "export_failed"
    if normalized_stage == "DIARIZATION":
        return "diarization_failed"
    if normalized_stage == "ASR" or task_type == "audio":
        return "asr_failed"
    if normalized_stage in {"VLM", "FRAMES"} and any(token in text for token in ("model", "vision", "vlm")):
        return "vlm_model_mismatch"
    if "bilibili.com" in source or "b23.tv" in source:
        return "bilibili_meta_failed"
    if "export" in task_type or "ffmpeg" in text:
        return "export_failed"
    return "task_failed"
