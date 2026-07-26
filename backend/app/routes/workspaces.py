from __future__ import annotations

"""Workspace 路由——多媒体内容分析系统的「工作空间」CRUD。

路由前缀 /workspaces，与 /pipeline、/providers 等并列。
存储委托给 backend.app.services.workspace_store.WorkspaceStore，
持久化文件位于 data/workspaces/<workspace_id>.json。

接口清单（最小可用集，后续按设计文档增补）：
  POST   /workspaces                     创建工作空间
  GET    /workspaces                     列表（默认排除 trashed；trashed_only/include_trashed 可切换视图）
  GET    /workspaces/{ws_id}             详情
  PATCH  /workspaces/{ws_id}             更新名称 / 状态 / 背景信息
  DELETE /workspaces/{ws_id}             软删除（标记 trashed=True）
  POST   /workspaces/{ws_id}/restore     从垃圾桶恢复
  DELETE /workspaces/{ws_id}/permanent   彻底删除（必须先软删）
  DELETE /workspaces/trash               清空垃圾桶
  POST   /workspaces/{ws_id}/items       添加素材
  DELETE /workspaces/{ws_id}/items/{id}  移除素材
  POST   /workspaces/{ws_id}/favorites/{id}    收藏素材
  DELETE /workspaces/{ws_id}/favorites/{id}    取消收藏
"""

import io
import json
import logging
import re
import shutil
import sqlite3
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import parse_qs, quote, urlparse

import httpx
from backend.app.models.tasks import TERMINAL_STATUS_VALUES, TaskStatus

# 项目根目录（backend/app/routes/workspaces.py → routes → app → backend → root）
_ROOT_DIR: Path = Path(__file__).resolve().parent.parent.parent.parent
logger = logging.getLogger(__name__)

_TRANSLATE_CHUNK_MAX_CHARS = 6000
_TRANSLATE_CHUNK_MAX_LINES = 80
_TRANSLATE_MAX_TOKENS = 9000
_TRANSLATE_REQUEST_TIMEOUT = 120
_TRANSLATE_MAX_WORKERS = 4
_TRANSLATE_MODEL_CANDIDATES = (
    "Pro/deepseek-ai/DeepSeek-V3.2",
    "Qwen/Qwen2.5-72B-Instruct",
    "Qwen/Qwen3-8B",
)

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.app.models.workspace import (
    InlineFrame,
    ItemStatus,
    ItemSummary,
    ItemType,
    MergedNote,
    PreflightConfig,
    WorkspaceBackground,
    WorkspaceItem,
    WorkspaceRecord,
    WorkspaceStatus,
)
from backend.app.services.audio_result_demo import build_demo_audio_result
from backend.app.services.note_assembler import (
    assemble_item_note,
    build_source_md,
    extract_transcript_from_results,
    normalize_transcript,
    note_dir,
)
from backend.app.services.note_exporter import build_note_export_response
from backend.app.services.metadata_store import MetadataStore
from backend.app.services.note_version_store import NoteVersionStore
from backend.app.services.speaker_labels import (
    SPEAKER_ROLE_OPTIONS,
    apply_speaker_map,
    apply_speaker_renames,
)
from backend.app.services.summary_generator import generate_summary
from backend.app.services.summary_templates import list_template_ids
from backend.app.services.video_result_demo import build_demo_video_result
from backend.app.services.workspace_search_service import _jump_url, search_one_workspace
from backend.app.services.workspace_store import WorkspaceStore
from shared.config import DATA_DIR
from shared.settings_store import load_settings
from shared.url_sniffer import sniff_url

# 复用 pipeline 路由的 runner / store 单例，避免重复初始化任务引擎
from backend.app.routes.pipeline import _runner as _pipeline_runner
from backend.app.models.tasks import TaskRecord

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

# 进程级单例 store（与 pipeline 路由的 _store 同模式）
_store = WorkspaceStore()
_metadata = MetadataStore()
_note_versions = NoteVersionStore()


def migrate_legacy_metadata() -> int:
    """在应用启动期把兼容 JSON 元数据幂等同步到 SQLite。"""
    return _metadata.migrate_legacy(_store.list_all(include_trashed=True))


def _handle_summary_task(record: TaskRecord, runner: Any) -> Dict[str, Any]:
    """后台生成总结；结果放进 task.result，前端按任务进度读取。"""
    payload = record.payload or {}
    workspace_id = str(payload.get("workspace_id") or record.project_id)
    item_id = str(payload.get("item_id") or "")
    rec = _store.get(workspace_id)
    if rec is None:
        raise RuntimeError(f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    if not _summary_source_present(item.results or {}):
        raise RuntimeError("当前素材没有可用于总结的内容")

    summary = generate_summary(
        item,
        str(payload.get("template") or "concise"),
        str(payload.get("background_for_summary") or ""),
        summary_mode=str(payload.get("summary_mode") or "general"),
        provider_id=str(payload.get("provider_id") or ""),
        model=str(payload.get("model") or ""),
        search_web=bool(payload.get("search_web")),
        progress=lambda ratio, message: runner.set_progress(record.task_id, ratio, message),
    )
    # 在模型调用完成后再取版本号，避免两个并行总结任务同时拿到同一个 vN。
    next_ver = _store.next_summary_version(workspace_id, item_id)
    summary.version = next_ver
    _store.add_item_summary(workspace_id, item_id, summary)
    runner.set_progress(record.task_id, 0.98, "正在保存总结版本")
    return {
        "summary": summary.to_dict(),
        "workspace_id": workspace_id,
        "item_id": item_id,
    }


_pipeline_runner.register("summary", _handle_summary_task)


# R3.1: 本地路径 → /static/... URL（供前端 <img> / <video> / <audio> src 使用）
def to_static_url(path: str | Path) -> str:
    """将本地文件路径转为 /static/... URL。

    规则：
    - 已经是 /static/ 开头 → 原样返回
    - 绝对路径在 DATA_DIR 下且文件存在 → /static/<相对路径>
    - 相对路径（如 workspaces/ws1/images/a.png）→ 按 DATA_DIR / 相对路径 解析
    - 其他（外部 URL / 路径不在 data 下 / 文件不存在）→ 返回空串
    """
    if not path:
        return ""
    s = str(path)
    if s.startswith("/static/"):
        return s
    data_resolved = DATA_DIR.resolve()
    try:
        p = Path(s).resolve()
        if (data_resolved in p.parents or p == data_resolved) and p.exists():
            return "/static/" + quote(p.relative_to(data_resolved).as_posix())
    except (ValueError, OSError):
        pass
    # 相对路径兜底：当作相对于 DATA_DIR
    candidate = data_resolved / s
    try:
        if candidate.exists():
            return "/static/" + quote(candidate.resolve().relative_to(data_resolved).as_posix())
    except (ValueError, OSError):
        pass
    return ""


def _note_audio_url(
    workspace_id: str,
    item: WorkspaceItem,
    results: Dict[str, Any],
    frontmatter: Optional[Dict[str, Any]] = None,
) -> str:
    """Resolve the browser-playable audio URL for audio notes."""

    audio_info = results.get("audio") if isinstance(results.get("audio"), dict) else {}

    def _from_value(value: Any) -> str:
        raw = str(value or "").strip()
        if not raw:
            return ""
        if raw.startswith(("http://", "https://", "/static/")):
            return raw
        return to_static_url(raw)

    media_fm = (frontmatter or {}).get("media") or {}
    fm_audio = media_fm.get("audio") if isinstance(media_fm, dict) else None
    if isinstance(fm_audio, dict):
        fm_url = _from_value(fm_audio.get("url") or fm_audio.get("src"))
        if fm_url:
            return fm_url
    elif isinstance(fm_audio, str):
        fm_url = _from_value(fm_audio)
        if fm_url:
            return fm_url

    for key in ("path", "file", "audio_path"):
        candidate = _from_value(audio_info.get(key) or results.get(key))
        if candidate:
            return candidate

    filename = str(audio_info.get("filename") or "").strip()
    if filename:
        for candidate_path in (
            DATA_DIR / "workspaces" / workspace_id / "audio" / filename,
            DATA_DIR / "workspaces" / "default_project" / "audio" / filename,
            DATA_DIR / "workspaces" / workspace_id / filename,
            DATA_DIR / "workspaces" / "default_project" / filename,
        ):
            candidate = to_static_url(candidate_path)
            if candidate:
                return candidate

    if item.source == "local":
        source_url = to_static_url(item.source_value)
        if source_url:
            return source_url

    existing_url = _from_value(audio_info.get("url"))
    if existing_url:
        return existing_url

    return item.source_value if item.source == "url" else ""


def _task_config_value(tasks: Dict[str, Any], *keys: str) -> Any:
    """Return the first present task config, preserving False boolean values."""
    for key in keys:
        if key in tasks:
            value = tasks.get(key)
            if isinstance(value, (dict, bool)):
                return value
    return None


def _copy_task_config(
    payload: Dict[str, Any],
    payload_key: str,
    tasks: Dict[str, Any],
    *task_keys: str,
) -> None:
    value = _task_config_value(tasks, *task_keys)
    if value is not None:
        payload[payload_key] = value


def normalize_video_summary_path(raw: str) -> str:
    """规范化前端 summary_path 值为 pipeline 可识别的 canonical 值。"""
    if not raw:
        return ""
    mapping: Dict[str, str] = {
        # 字幕路径
        "字幕直接总结": "subtitle",
        "只听字幕/音频转写": "subtitle",
        "subtitle": "subtitle",
        # 音视频综合路径
        "音视频合并 · 最详细": "av_combined",
        "音视频综合": "av_combined",
        "detailed": "av_combined",
        "av_combined": "av_combined",
        # 只看画面路径
        "只看画面": "visual_only",
        "visual_only": "visual_only",
        # 视频模型直传（保留未来项）
        "视频模型直接分析": "video_model",
        "video_model": "video_model",
    }
    return mapping.get(raw.strip(), raw.strip())


def _adapt_r8_frame_prompt(frame_prompt: Dict[str, Any]) -> Dict[str, Any]:
    """R8 preflightTasks 字段名 -> CaptureParams 可读字段名。"""
    adapted = dict(frame_prompt)
    if "frame_mode" in adapted and "mode" not in adapted:
        raw_mode = str(adapted.pop("frame_mode"))
        mode_map = {"按秒截帧": "interval", "AI 镜头分析": "ai_shot"}
        adapted["mode"] = mode_map.get(raw_mode, raw_mode)
    if "sec_per_frame" in adapted and "interval_sec" not in adapted:
        adapted["interval_sec"] = adapted.pop("sec_per_frame")
    if "shot_frames" in adapted and "frames_per_shot" not in adapted:
        raw = str(adapted.pop("shot_frames"))
        # "2 帧 · 首+尾" -> 2, "3 帧 · 首+中+尾" -> 3
        try:
            adapted["frames_per_shot"] = int(raw[0])
        except (ValueError, IndexError):
            pass
    return adapted


def _augment_video_analyze_payload(payload: Dict[str, Any], item: WorkspaceItem) -> None:
    """Copy video preflight params used by the current analyze pipeline."""
    tasks = item.preflight.tasks or {}
    preflight_params = tasks.get("preflight")
    if isinstance(preflight_params, dict):
        if preflight_params.get("intent"):
            payload["intent"] = preflight_params["intent"]
        if preflight_params.get("background_for_recognition"):
            payload["background_for_recognition"] = preflight_params[
                "background_for_recognition"
            ]

    frame_prompts_params = tasks.get("frame_prompt")
    if isinstance(frame_prompts_params, dict):
        payload["frame_prompt"] = _adapt_r8_frame_prompt(frame_prompts_params)

    summary_params = tasks.get("summary")
    if isinstance(summary_params, dict):
        # 兼容 R8 summary.summary_path 和旧 summary.path
        raw_path = summary_params.get("summary_path") or summary_params.get("path")
        if raw_path:
            payload["summary_path"] = normalize_video_summary_path(str(raw_path))
        if summary_params.get("video_template"):
            payload["video_template"] = summary_params["video_template"]
        if summary_params.get("output_format"):
            payload["output_format"] = summary_params["output_format"]

    # 布尔标志兜底：preflight 中 transcribe + summarize 都为 true 时，
    # 默认走 N7b 路径 1（字幕直接总结），不触发 VLM 逐帧分析
    if tasks.get("transcribe") and tasks.get("summarize"):
        if "summary_path" not in payload:
            payload["summary_path"] = "subtitle"


def _on_download_success(completed_task: TaskRecord, runner) -> None:  # type: ignore[type-arg]
    """X.5 任务链：download 成功后自动 enqueue analyze，并把 analyze task_id 写回 item。

    逻辑：
    1. 从 download 产物拿 save_path（视频本地路径）
    2. enqueue 一个 analyze task，payload 带 video_basenames
    3. 扫描所有 workspace items，找引用了此 download task_id 的 item
    4. 追加 analyze task_id 到 item.related_task_ids（持久化）
    """
    save_path = str(completed_task.result.get("save_path") or "").strip()
    if not save_path:
        return  # download 没有产出文件（可能被取消），不起 analyze

    video_basename = Path(save_path).name
    project_id = completed_task.project_id
    refs: list[tuple[WorkspaceRecord, WorkspaceItem]] = []
    for ws in _store.list_all():
        for item in ws.items:
            if completed_task.task_id in item.related_task_ids:
                refs.append((ws, item))

    analyze_payload: Dict[str, Any] = {"video_basenames": [video_basename]}
    if refs:
        _augment_video_analyze_payload(analyze_payload, refs[0][1])

    # R13.1 继承 download 阶段 yt-dlp 抽取的视频元数据，供 ProcessingPage 在 analyze 阶段展示
    _dl_result = completed_task.result or {}
    for _key in ("video_title", "video_duration", "video_uploader", "video_thumbnail_url"):
        if _dl_result.get(_key):
            analyze_payload[_key] = _dl_result[_key]
    if completed_task.payload.get("url"):
        analyze_payload["source_url"] = completed_task.payload["url"]

    try:
        analyze_task = runner.create_task(project_id, "analyze", analyze_payload)
    except Exception:
        return  # analyze enqueue 失败不影响 download 本身

    # 从下载产物文件名里提取视频真实标题（yt-dlp 模板: %(title)s-%(id)s.%(ext)s）
    import re as _re
    _title = _re.sub(r'-[^-]+\.[^.]+$', '', video_basename) if video_basename else ""

    # 把 analyze task_id + 视频标题写回所有关联此 download task 的 workspace items
    for ws, item in refs:
        new_ids = list(item.related_task_ids) + [analyze_task.task_id]
        try:
            _update_kwargs: Dict[str, Any] = {"related_task_ids": new_ids}
            if _title and (not item.name or item.name in (item.source_value, item.source_value.split("/")[-1])):
                _update_kwargs["name"] = _title
            _store.update_item(ws.workspace_id, item.item_id, **_update_kwargs)
        except Exception:
            pass  # 写失败不阻断（X.1 桥仍能通过 download task 显示最终状态）

    # R13.6.1 用共享工具触发 workspace 改名（替代 R13.4 内联逻辑）
    _meta = dict(completed_task.result or {})
    if not _meta.get("video_title") and _title:
        _meta["video_title"] = _title
    _maybe_rename_workspace_from_video_title(completed_task, _meta)


_pipeline_runner.register_success_callback("download", _on_download_success)


# ── Phase 3C.4：分析任务 SUCCESS 后自动打标 ──────────────────────


def _autotag_items_for_task(task: TaskRecord, runner) -> None:  # type: ignore[type-arg]
    """对引用 task.task_id 的所有 workspace items 调 LLM 自动打标（同步逻辑）。

    跳过已经有 tags 的 item，避免重复消耗 LLM 配额；任何异常都不阻塞主流程。
    """
    # 延迟 import 避免与 settings/provider 链路的初始化顺序冲突
    from backend.app.services.tag_generator import generate_tags  # noqa: PLC0415

    for ws in _store.list_all():
        for item in ws.items:
            if task.task_id not in item.related_task_ids:
                continue
            existing_tags = item.tags if isinstance(item.tags, dict) else {}
            if existing_tags.get("_generated_at"):
                continue
            try:
                tags = generate_tags(item, ws, task_store=runner.store)
            except Exception:
                tags = {}
            if not tags:
                continue
            existing_custom = [
                str(tag).strip()
                for tag in existing_tags.get("custom_tags", [])
                if str(tag).strip()
            ]
            generated_custom = [
                str(tag).strip()
                for tag in tags.get("custom_tags", [])
                if str(tag).strip()
            ]
            if existing_custom:
                merged_custom = list(dict.fromkeys(existing_custom + generated_custom))[:10]
                tags = {**tags, "custom_tags": merged_custom}
            try:
                _store.update_item(ws.workspace_id, item.item_id, tags=tags)
            except Exception:
                pass


def _on_analysis_success_autotag(completed_task: TaskRecord, runner) -> None:  # type: ignore[type-arg]
    """task SUCCESS 后异步触发自动打标（不阻塞 task worker 线程）。"""
    threading.Thread(
        target=_autotag_items_for_task,
        args=(completed_task, runner),
        daemon=True,
        name=f"autotag-{completed_task.task_id}",
    ).start()


for _tt in ("analyze", "note", "text", "audio", "image"):
    _pipeline_runner.register_success_callback(_tt, _on_analysis_success_autotag)


def _assemble_note_for_task(task: TaskRecord, runner) -> None:  # type: ignore[type-arg]
    """对引用 task.task_id 的所有 workspace items 触发 note 惰性组装（同步逻辑）。

    只在 notes/<item_id>/ 不存在时组装（幂等：已组装的跳过）。
    任何异常都不阻塞主流程。
    """
    for ws, item in _iter_workspace_items_for_task(task, runner):
        _ensure_task_linked_to_item(ws.workspace_id, item, task, runner)
        nd = note_dir(ws.workspace_id, item.item_id)
        # 从 task store 回填 results（与 get_item_note 同逻辑），再判断 note.md
        # 是否为旧自动稿；未手改的旧稿可以用最新结果重建。
        merged = dict(item.results or {})
        if task.result:
            merged.update(task.result)
        item.results = merged
        item_status = (
            ItemStatus.PARTIAL.value
            if task.status == TaskStatus.PARTIAL.value
            else ItemStatus.DONE.value
        )
        _store.update_item(
            ws.workspace_id,
            item.item_id,
            results=merged,
            status=item_status,
        )
        initial_summary = str(merged.get("summary") or "").strip()
        if item.type == ItemType.AUDIO.value and initial_summary and not item.summaries:
            _store.add_item_summary(
                ws.workspace_id,
                item.item_id,
                ItemSummary(
                    summary_id=str(uuid.uuid4()),
                    template=str(task.payload.get("summary_template") or "standard"),
                    version=0,
                    summary_mode=str(
                        merged.get("summary_mode")
                        or task.payload.get("summary_mode")
                        or "general"
                    ),
                    content_md=initial_summary,
                    model_used=str(task.payload.get("text_model") or ""),
                ),
            )
        note_path = nd / "note.md"
        if note_path.exists() and not _refresh_auto_note_if_stale(ws.workspace_id, item, note_path):
            continue
        try:
            assemble_item_note(ws.workspace_id, item.item_id, _item=item)
        except Exception:
            pass


def _on_analysis_success_assemble(completed_task: TaskRecord, runner) -> None:  # type: ignore[type-arg]
    """task SUCCESS 后异步触发 note 组装（不阻塞 task worker 线程）。"""
    threading.Thread(
        target=_assemble_note_for_task,
        args=(completed_task, runner),
        daemon=True,
        name=f"assemble-{completed_task.task_id}",
    ).start()


for _tt in ("analyze", "text", "audio", "image", "note"):
    _pipeline_runner.register_success_callback(_tt, _on_analysis_success_assemble)

_pipeline_runner.register_partial_callback("audio", _on_analysis_success_assemble)


# ── 7.2 标题全链路：note task 成功后回写 item.name ─────────────


def _task_lineage_ids(task: TaskRecord, runner) -> List[str]:  # type: ignore[type-arg]
    """返回当前 task 及其 retry_of 链路上的 task_id，供 workspace item 反查。"""
    ids: List[str] = []
    seen: set[str] = set()
    current: Optional[TaskRecord] = task

    while current is not None and current.task_id not in seen:
        ids.append(current.task_id)
        seen.add(current.task_id)
        retry_of = str(current.retry_of or "").strip()
        if not retry_of:
            break
        parent = runner.store.get(retry_of)
        if parent is None and retry_of not in seen:
            ids.append(retry_of)
            seen.add(retry_of)
        current = parent

    return ids


def _iter_workspace_items_for_task(
    task: TaskRecord, runner,  # type: ignore[type-arg]
) -> List[tuple[WorkspaceRecord, WorkspaceItem]]:
    """按 task_id/retry_of 链路找到关联的 workspace item。"""
    lineage = set(_task_lineage_ids(task, runner))
    if not lineage:
        return []

    matches: List[tuple[WorkspaceRecord, WorkspaceItem]] = []
    for ws in _store.list_all():
        for item in ws.items:
            if lineage.intersection(item.related_task_ids):
                matches.append((ws, item))
    return matches


def _ensure_task_linked_to_item(
    workspace_id: str,
    item: WorkspaceItem,
    task: TaskRecord,
    runner=None,  # type: ignore[no-untyped-def]
) -> None:
    """重试任务成功后，把新 task_id 补挂回原 item，避免库页只看到旧失败任务。"""
    if task.task_id not in item.related_task_ids:
        try:
            _store.update_item(
                workspace_id,
                item.item_id,
                related_task_ids=[*item.related_task_ids, task.task_id],
                status=ItemStatus.DONE.value,
            )
        except Exception:
            pass

    if runner is None:
        return
    payload = dict(task.payload or {})
    result = dict(task.result or {})
    changed = False
    if not payload.get("workspace_id"):
        payload["workspace_id"] = workspace_id
        changed = True
    if not payload.get("item_id"):
        payload["item_id"] = item.item_id
        changed = True
    if not result.get("workspace_id"):
        result["workspace_id"] = workspace_id
        changed = True
    if not result.get("item_id"):
        result["item_id"] = item.item_id
        changed = True
    if changed:
        try:
            runner.store.update(task.task_id, payload=payload, result=result)
        except Exception:
            pass


def _note_frontmatter(raw: str) -> Dict[str, Any]:
    """解析 note.md frontmatter；失败返回空 dict。"""
    if not raw.startswith("---\n"):
        return {}
    parts = raw.split("---\n", 2)
    if len(parts) < 3:
        return {}
    try:
        import yaml  # noqa: PLC0415

        parsed = yaml.safe_load(parts[1]) or {}
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _auto_note_is_stale(item: WorkspaceItem, note_md: str) -> bool:
    """判断现有 note.md 是否是需要被最新 task result 刷新的自动旧稿。"""
    fm = _note_frontmatter(note_md)
    if fm.get("user_edited") is True:
        return False

    results = item.results or {}
    markers: List[str] = []
    if item.type == ItemType.IMAGE.value and results.get("note_kind") == "image_text":
        # 图文笔记主稿必须包含图文混排正文；只有 note_body 不够。
        markers.extend([
            str(results.get("note_body") or "").strip(),
            str(results.get("markdown") or "").strip(),
        ])
    elif item.type == ItemType.AUDIO.value:
        markers.extend([
            str(results.get("note_body") or "").strip(),
            str(results.get("summary") or "").strip(),
            str(results.get("llm_summary") or "").strip(),
        ])
    else:
        markers.append(str(results.get("note_body") or "").strip())

    return any(marker and marker not in note_md for marker in markers)


def _refresh_auto_note_if_stale(workspace_id: str, item: WorkspaceItem, note_path: Path) -> bool:
    """若 note.md 是未手改的旧自动稿，则按最新 item.results 重建。"""
    if not note_path.exists():
        return False
    try:
        raw = note_path.read_text(encoding="utf-8")
    except Exception:
        return False
    if not _auto_note_is_stale(item, raw):
        return False
    assembled = assemble_item_note(workspace_id, item.item_id, overwrite=True, _item=item)
    return not bool(assembled.get("skipped"))


def _on_note_success_write_title(completed_task: TaskRecord, runner) -> None:  # type: ignore[type-arg]
    """note task 完成后，把真实标题回写 item.name。

    仅在 item.name 仍为 URL/ID 占位时覆盖，避免覆盖用户自定义名。
    """
    matches = _iter_workspace_items_for_task(completed_task, runner)
    for ws, item in matches:
        _ensure_task_linked_to_item(ws.workspace_id, item, completed_task, runner)

    video_title = str((completed_task.result or {}).get("video_title") or "").strip()
    if not video_title:
        return

    for ws, item in matches:
        # 判断 item.name 是否仍是占位名（_derive_item_name 产出）
        raw_name = item.name or ""
        derived = _derive_item_name(item.source_value or "")
        is_placeholder = (
            not raw_name
            or raw_name == derived
            or raw_name == (item.source_value or "")
        )
        if is_placeholder and raw_name != video_title:
            try:
                _store.update_item(ws.workspace_id, item.item_id, name=video_title)
            except Exception:
                pass


_pipeline_runner.register_success_callback("note", _on_note_success_write_title)


WORKSPACE_UPLOAD_ROOT: Path = DATA_DIR / "workspaces"
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024
_SAFE_UPLOAD_NAME_RE = re.compile(r"[^A-Za-z0-9._\u4e00-\u9fff\-]+")
_EXTENSION_TYPE_MAP: Dict[str, str] = {
    ".mp4": ItemType.VIDEO.value,
    ".mov": ItemType.VIDEO.value,
    ".avi": ItemType.VIDEO.value,
    ".mkv": ItemType.VIDEO.value,
    ".flv": ItemType.VIDEO.value,
    ".wmv": ItemType.VIDEO.value,
    ".webm": ItemType.VIDEO.value,
    ".mp3": ItemType.AUDIO.value,
    ".wav": ItemType.AUDIO.value,
    ".m4a": ItemType.AUDIO.value,
    ".aac": ItemType.AUDIO.value,
    ".flac": ItemType.AUDIO.value,
    ".ogg": ItemType.AUDIO.value,
    ".jpg": ItemType.IMAGE.value,
    ".jpeg": ItemType.IMAGE.value,
    ".png": ItemType.IMAGE.value,
    ".gif": ItemType.IMAGE.value,
    ".webp": ItemType.IMAGE.value,
    ".txt": ItemType.TEXT.value,
    ".md": ItemType.TEXT.value,
    ".srt": ItemType.TEXT.value,
    ".vtt": ItemType.TEXT.value,
    ".json": ItemType.TEXT.value,
    # Phase 2C.1：文本输入层支持的额外扩展名
    ".pdf": ItemType.TEXT.value,
    ".docx": ItemType.TEXT.value,
    ".html": ItemType.TEXT.value,
    ".htm": ItemType.TEXT.value,
}


# ── Pydantic 请求/响应模型 ─────────────────────────────────


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120, description="工作空间名称")
    background: Dict[str, Any] = Field(default_factory=dict)
    kind: Literal["note"] = Field(default="note", description="合集类型：note")
    source: str = Field(default="manual", description="manual|inbox|...")
    source_meta: Dict[str, Any] = Field(default_factory=dict)


class WorkspaceUpdateRequest(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = Field(default=None, description="active|processing|analyzed|archived")
    background: Optional[Dict[str, Any]] = None


class ItemAddRequest(BaseModel):
    type: str = Field(description="video|audio|image|text")
    source: str = Field(description="url|local")
    source_value: str = Field(description="URL 或本地路径")
    name: str = Field(default="", description="可选显示名，未填则从 source_value 推导")


class GenerateNoteRequest(BaseModel):
    """NI.1: 「生成笔记」统一入口请求体。"""
    url: str = Field(description="粘贴的链接（小红书/视频/网页等）")
    name: str = Field(default="", description="可选显示名")
    embed_frames: bool = Field(
        default=True, description="视频笔记是否智能嵌入关键画面配图（关闭则纯文字）"
    )
    image_mode: str = Field(default="vision", description="提取模式: vision 或 ocr")
    frame_interval: int = Field(default=5, description="截帧间隔，多少秒截一帧")
    vision_model: str = Field(default="", description="视觉模型 ID（空=用系统默认）")
    intent: Literal["note", "learning", "collect"] = Field(
        default="note",
        description="任务意图：note / learning / collect",
    )
    note_media_kind: str = Field(
        default="auto",
        description="笔记子类型：auto / video / image_text / audio / text",
    )
    summary_template: str = Field(
        default="standard",
        description="笔记风格模板 ID（对应 summary_templates.py 中的模板）",
    )
    diarize: bool = Field(
        default=False,
        description="是否区分发言人（VN5 启用；当前仅记录到 task payload）",
    )
    summary_mode: str = Field(
        default="general",
        description="音频总结方式：general（普通）或 speaker_aware（区分说话人）",
    )
    speaker_count: Optional[int] = Field(
        default=None,
        ge=1,
        le=20,
        description="预计说话人数；空值表示自动判断",
    )
    user_notes: str = Field(
        default="",
        description="用户补充说明，生成时附加给模型的上下文",
    )


class BatchSourceItemRequest(BaseModel):
    source_url: str = Field(min_length=1, description="单个视频链接")
    title: str = Field(default="", description="显示标题")
    platform: str = Field(default="", description="bilibili|youtube|...")
    index: int = Field(default=0, ge=0, description="来源中的顺序，从 1 开始")
    duration_seconds: Optional[float] = Field(default=None, ge=0)
    thumbnail: Optional[str] = Field(default=None)
    external_id: str = Field(default="", description="平台侧 ID，如 bvid:p1 或 YouTube video id")


class BatchSourceResolveRequest(BaseModel):
    source: str = Field(min_length=1, max_length=20000, description="播放列表链接、多 P 链接或多链接文本")


class BatchSourceImportRequest(BaseModel):
    workspace_name: str = Field(default="", max_length=120)
    kind: str = Field(default="note", pattern="^note$")
    source_type: str = Field(
        default="multi_url",
        pattern="^(multi_url|youtube_playlist|bilibili_multipart|bilibili_favorites|bilibili_uploader)$",
    )
    source_url: str = Field(default="", max_length=2000)
    items: List[BatchSourceItemRequest] = Field(default_factory=list)
    start: bool = Field(default=True, description="创建合集后是否立即启动每条笔记任务")
    embed_frames: bool = Field(default=True)
    image_mode: str = Field(default="vision")
    frame_interval: int = Field(default=5, ge=1, le=120)
    vision_model: str = Field(default="")
    intent: str = Field(default="note")
    note_media_kind: str = Field(default="video")
    summary_template: str = Field(default="standard")
    diarize: bool = Field(default=False)
    summary_mode: str = Field(default="general")
    speaker_count: Optional[int] = Field(default=None, ge=1, le=20)
    user_notes: str = Field(default="", max_length=8000)


class PreflightSaveRequest(BaseModel):
    """前置配置保存请求体（设计文档第 4 章）。"""

    intent: str = Field(default="", description='"learning" | ""')
    background_overrides: Dict[str, Any] = Field(default_factory=dict)
    models: Dict[str, str] = Field(
        default_factory=dict,
        description="键: vision|text|video，值: provider_id",
    )
    tasks: Dict[str, Any] = Field(
        default_factory=dict,
        description="勾选项及子参数；结构按 item.type 区分",
    )


class AutoCreateRequest(BaseModel):
    """自动创建工作空间请求体。"""

    hint_url: Optional[str] = Field(default=None, description="提示 URL，用于推导名称")
    hint_text: Optional[str] = Field(default=None, description="提示文本，用于推导名称")
    kind: Literal["note"] = Field(default="note", description="合集类型：note")


class SniffUrlRequest(BaseModel):
    """URL 内容类型嗅探请求体。"""

    url: str = Field(min_length=1, description="待嗅探的 URL")


class ProbeDurationRequest(BaseModel):
    url: str


# ── 内部小工具 ────────────────────────────────────────────


def _ensure_valid_item_type(t: str) -> None:
    try:
        ItemType(t)
    except ValueError as err:
        raise HTTPException(
            status_code=400,
            detail=f"invalid item type: {t}; expected one of video|audio|image|text",
        ) from err


def _ensure_valid_status(s: Optional[str]) -> None:
    if s is None:
        return
    try:
        WorkspaceStatus(s)
    except ValueError as err:
        raise HTTPException(
            status_code=400,
            detail=f"invalid status: {s}",
        ) from err


# ── URL 规整（F1.7）──────────────────────────────────────────────────

_BILIBILI_BV_RE = re.compile(r"^BV[a-zA-Z0-9]+$")

# 抖音短链模式——用于从分享文案中提取纯 URL
_DOUYIN_URL_RE = re.compile(
    r"https?://(?:v\.douyin\.com|www\.douyin\.com|www\.iesdouyin\.com|dy\.com)/\S+",
    re.IGNORECASE,
)

# 通用 URL 提取——从任意分享文案中提取第一个 https?:// 开头的 URL（去除尾部中文标点）
_GENERIC_URL_RE = re.compile(r"https?://[^\s，。！？；：“”‘’（）【】《》]+")

_TRACKING_PARAMS = frozenset({
    "spm_id_from", "vd_source", "share_source", "share_medium",
    "bbid", "ts", "unique_k", "p", "vd_source_2",
})


def _normalize_media_url(raw: str) -> str:
    """规整用户粘入的 URL，确保同一视频的不同变体收敛为同一字符串。

    处理：
    ① 从分享文案中提取纯 URL（抖音短链优先，否则通用提取）
    ② 纯 BV 号 → 拼完整 B 站 URL
    ③ 缺 scheme → 补 https://
    ④ 去掉追踪参数（spm_id_from / vd_source 等）
    ⑤ 去掉尾斜杠
    """
    s = raw.strip()

    # ① 从分享文案中提取纯 URL
    dy_match = _DOUYIN_URL_RE.search(s)
    if dy_match:
        s = dy_match.group(0)
    else:
        generic_match = _GENERIC_URL_RE.search(s)
        if generic_match:
            s = generic_match.group(0)

    # ② 纯 BV 号
    if _BILIBILI_BV_RE.match(s):
        s = f"https://www.bilibili.com/video/{s}"

    # ③ 缺 scheme（没有任何 :// 的才补 https://）
    if "://" not in s:
        s = f"https://{s}"

    # ④⑤ 解析并清理
    try:
        u = urlparse(s)
        if u.query:
            qs_parts = [
                f"{k}={v}"
                for k, v in (p.split("=", 1) for p in u.query.split("&") if "=" in p)
                if k not in _TRACKING_PARAMS
            ]
            qs = "&".join(qs_parts)
        else:
            qs = ""
        clean = u.scheme + "://" + u.netloc + u.path.rstrip("/")
        if qs:
            clean += "?" + qs
        return clean
    except Exception:
        return s.rstrip("/")


def _validate_network_url(raw: str) -> str:
    """校验并规整网络链接。

    Why: source=url 直接交给下游 yt-dlp / 下载器，空白或畸形字符串会在
    pipeline 深处才报错，对用户不友好。这里在入口阻断。
    """
    value = _normalize_media_url(raw)
    if not value:
        raise HTTPException(status_code=400, detail="URL cannot be empty")
    try:
        parsed = urlparse(value)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=f"invalid URL: {err}") from err
    if parsed.scheme.lower() not in ("http", "https"):
        raise HTTPException(
            status_code=400,
            detail="URL must start with http:// or https://",
        )
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="URL host cannot be empty")
    # NI.1: 拦截无有效域名的 URL（如 "not a url" → "https://not"）
    hostname = (parsed.hostname or "").lower()
    if hostname not in ("localhost",) and "." not in hostname and not hostname.replace(".", "").isdigit():
        raise HTTPException(
            status_code=400,
            detail=f"URL host is not a valid domain: {parsed.netloc}",
        )
    return value


def _derive_item_name(source_value: str) -> str:
    """从 URL/路径里挑一个可读名字。"""
    raw = source_value.strip()
    if not raw:
        return "未命名素材"
    # 取最后一段（path 的 basename 或 URL 的 last segment）
    seg = raw.replace("\\", "/").rstrip("/").split("/")[-1]
    return seg or raw[:40]


def _sanitize_upload_name(name: str) -> str:
    """保留文件名本体，替换危险字符，避免跨目录写入。"""
    raw = Path(name or "").name or "upload.bin"
    safe = _SAFE_UPLOAD_NAME_RE.sub("_", raw).strip("._")
    return safe or "upload.bin"


def _unique_upload_path(upload_dir: Path, safe_name: str) -> Path:
    """避免同名上传覆盖已有文件。"""
    candidate = upload_dir / safe_name
    if not candidate.exists():
        return candidate

    stem = candidate.stem or "upload"
    suffix = candidate.suffix
    for idx in range(1, 10_000):
        candidate = upload_dir / f"{stem}_{idx}{suffix}"
        if not candidate.exists():
            return candidate
    raise HTTPException(status_code=500, detail="failed to allocate upload filename")


def _cleanup_workspace_uploads(workspace_id: str) -> None:
    """删除本服务为该 workspace 管理的上传目录。"""
    upload_dir = (WORKSPACE_UPLOAD_ROOT / workspace_id).resolve()
    root = WORKSPACE_UPLOAD_ROOT.resolve()
    try:
        upload_dir.relative_to(root)
    except ValueError:
        return
    shutil.rmtree(upload_dir, ignore_errors=True)


def _infer_upload_item_type(filename: str, content_type: Optional[str]) -> str:
    """按扩展名优先、MIME 兜底推断素材类型。"""
    ext = Path(filename or "").suffix.lower()
    if ext in _EXTENSION_TYPE_MAP:
        return _EXTENSION_TYPE_MAP[ext]

    mime = (content_type or "").lower()
    if mime.startswith("video/"):
        return ItemType.VIDEO.value
    if mime.startswith("audio/"):
        return ItemType.AUDIO.value
    if mime.startswith("image/"):
        return ItemType.IMAGE.value
    if mime.startswith("text/"):
        return ItemType.TEXT.value

    raise HTTPException(
        status_code=400,
        detail=(
            "unsupported upload file type; expected video/audio/image/text "
            "extension or MIME type"
        ),
    )


# ── 派生字段计算（Phase 1A，v1.1 §2.2）────────────────────


def _cover_thumbnail(rec: WorkspaceRecord) -> Optional[str]:
    """从合集内第一个可用 item 缩略图提取合集封面，找不到返回 None。"""
    for item in rec.items:
        overlay = _sync_item_with_tasks(item) or {}
        results = overlay.get("results") or item.results or {}
        thumb = _item_thumbnail(item, results)
        if thumb:
            return thumb
    return None


def _current_step(rec: WorkspaceRecord) -> Optional[str]:
    """取 workspace 内最新一个非终结任务的 status 字符串，没有则返回 None。

    遍历所有 item.related_task_ids，在 pipeline task_store 里查状态，
    排除 SUCCESS / FAILED / CANCELLED，取 updated_at 最大的那条。
    """
    best_status: Optional[str] = None
    best_updated: str = ""

    for item in rec.items:
        for tid in item.related_task_ids:
            task = _pipeline_runner.store.get(tid)
            if task is None:
                continue
            if task.status in TERMINAL_STATUS_VALUES:
                continue
            if task.updated_at > best_updated:
                best_updated = task.updated_at
                best_status = task.status

    return best_status


def _items_count_by_type(rec: WorkspaceRecord) -> Dict[str, int]:
    """统计 workspace 内各类素材数量，四类全返回（无则为 0）。"""
    counts: Dict[str, int] = {"video": 0, "audio": 0, "image": 0, "text": 0}
    for item in rec.items:
        t = item.type
        if t in counts:
            counts[t] += 1
    return counts


def _sync_item_with_tasks(item: WorkspaceItem) -> Optional[Dict[str, Any]]:
    """Phase X.1 状态桥（拉模式）：根据 related_task_ids 推导 item 当前应有的状态/产物。

    - status：SUCCESS→done / PARTIAL→partial / FAILED|CANCELLED→failed / 其它→processing
    - results：最新一条 SUCCESS/PARTIAL 任务的可用 result，作为 overlay 返回
    只读 task_store；返回 None 表示无需 overlay。**不修改** item 本身，避免污染 store 缓存。
    """
    if not item.related_task_ids:
        return None

    latest: Optional[Any] = None
    latest_result: Optional[Any] = None
    for tid in item.related_task_ids:
        task = _pipeline_runner.store.get(tid)
        if task is None:
            continue
        if latest is None or task.updated_at > latest.updated_at:
            latest = task
        if task.status in (TaskStatus.SUCCESS.value, TaskStatus.PARTIAL.value) and (
            latest_result is None or task.updated_at > latest_result.updated_at
        ):
            latest_result = task

    if latest is None:
        return None

    overlay: Dict[str, Any] = {}
    if latest.status == TaskStatus.SUCCESS.value:
        overlay["status"] = ItemStatus.DONE.value
    elif latest.status == TaskStatus.PARTIAL.value:
        overlay["status"] = ItemStatus.PARTIAL.value
    elif latest.status in (TaskStatus.FAILED.value, TaskStatus.CANCELLED.value):
        overlay["status"] = ItemStatus.FAILED.value
    else:
        overlay["status"] = ItemStatus.PROCESSING.value

    if latest_result is not None and latest_result.result:
        merged = dict(item.results or {})
        merged.update(latest_result.result)
        # 保留 item.results 中 transcript_segments 的 edited_text（用户在字幕轴的编辑）
        # task result 不含 edited_text，直接 update 会覆盖掉用户的编辑
        _item_segs = (item.results or {}).get("transcript_segments") or []
        _task_segs = merged.get("transcript_segments") or []
        if _item_segs and _task_segs:
            for i in range(min(len(_item_segs), len(_task_segs))):
                _et = _item_segs[i].get("edited_text")
                if _et:
                    _task_segs[i] = {**_task_segs[i], "edited_text": _et}
            merged["transcript_segments"] = _task_segs
        # 若最新 task 没提供 cover_thumbnail，从更早的 SUCCESS task 补（下载封面优先）
        if not merged.get("cover_thumbnail"):
            for tid in item.related_task_ids:
                task = _pipeline_runner.store.get(tid)
                if task is None or task is latest_result:
                    continue
                if task.status in (TaskStatus.SUCCESS.value, TaskStatus.PARTIAL.value) and task.result:
                    ct = task.result.get("cover_thumbnail")
                    if ct:
                        merged["cover_thumbnail"] = ct
                        break
        overlay["results"] = merged

    return overlay


def _task_failed_response(item: WorkspaceItem) -> Optional[Dict[str, Any]]:
    """R18.1.2: 若 item 最新任务已 FAILED，返回 task_failed 响应；否则返回 None。"""
    if not item.related_task_ids:
        return None
    latest_tid = item.related_task_ids[-1]
    task = _pipeline_runner.store.get(latest_tid)
    if task is not None and task.status == TaskStatus.FAILED.value:
        return {"source": "task_failed", "task_id": task.task_id, "error": task.error or "未知错误"}
    return None


def _enrich_workspace(rec: WorkspaceRecord) -> Dict[str, Any]:
    """把 WorkspaceRecord.to_dict() 合并上 Phase 1A 派生字段后返回。

    派生字段在路由层计算，不写回 WorkspaceStore。
    """
    d = rec.to_dict()
    items_out = d.get("items") or []
    for item_obj, item_dict in zip(rec.items, items_out):
        overlay = _sync_item_with_tasks(item_obj)
        if overlay:
            item_dict.update(overlay)
        results = item_dict.get("results") or {}
        item_dict["thumbnail"] = _item_thumbnail(item_obj, results)
        item_dict["primary_view"] = _compute_primary_view(item_obj, results)
        item_dict["favorite"] = item_obj.item_id in rec.favorites
    d["current_step"] = _current_step(rec)
    d["items_count_by_type"] = _items_count_by_type(rec)
    d["cover_thumbnail"] = _cover_thumbnail(rec)
    d["last_active_at"] = rec.updated_at
    return d


# ── Workspace CRUD ───────────────────────────────────────


@router.post("")
def create_workspace(req: WorkspaceCreateRequest) -> Dict[str, Any]:
    """新建一个工作空间。"""
    bg = WorkspaceBackground.from_dict(req.background or {})
    rec = WorkspaceRecord(
        workspace_id=str(uuid.uuid4()),
        name=req.name.strip(),
        background=bg,
        kind="note",
        source=req.source.strip() or "manual",
        source_meta=dict(req.source_meta or {}),
    )
    _store.create(rec)
    return rec.to_dict()


_AUTO_CREATE_LOGGER = logging.getLogger(f"{__name__}.auto_create")


def _generate_workspace_name(hint_url: str | None, hint_text: str | None) -> str:
    """根据 hint URL/text 生成工作空间名称。

    不调用 LLM（同步 LLM 调用可能耗时 20s+，触发 axios 15s 超时）。
    以 hostname + 时间戳作为确定性 fallback。
    """
    hint = (hint_url or hint_text or "").strip()
    hostname = ""
    if hint_url:
        try:
            hostname = urlparse(hint_url).hostname or ""
        except Exception:
            pass
    # 取 hostname 第一段（如 www.bilibili.com → bilibili）
    if hostname:
        parts = hostname.split(".")
        hostname = parts[-2] if len(parts) >= 2 else parts[0]
        hostname = hostname.capitalize()
    ts = datetime.now(timezone.utc).strftime("%m%d-%H%M")
    return f"{hostname} · {ts}" if hostname else f"工作空间 · {ts}"


def _maybe_rename_workspace_from_video_title(
    record,
    meta: Dict[str, Any],
) -> None:
    """R13.6.1 把 yt-dlp 拿到的视频标题回写到关联的自动建空间。

    任何 handler（download/audio/note）拿到 metadata 后都能调这个工具。
    """
    video_title = (meta or {}).get("video_title") or ""
    if not video_title:
        return
    url = record.payload.get("url") or record.payload.get("source") or ""
    platform = _platform_prefix_from_url(url) if url else ""
    new_ws_name = f"{platform} · {video_title}" if platform else video_title

    for ws in _store.list_all():
        if not _is_auto_generated_workspace_name(ws.name):
            continue
        for item in ws.items:
            if record.task_id in item.related_task_ids:
                try:
                    _store.update(ws.workspace_id, name=new_ws_name)
                except Exception:
                    pass
                break


def _is_auto_generated_workspace_name(name: str) -> bool:
    """判断 workspace name 是否是自动生成的 hostname + 时间戳格式（R13.4 用）。

    匹配 _generate_workspace_name 产出的模式：Xxx · MMDD-HHMM 或 工作空间 · MMDD-HHMM。
    """
    return bool(re.match(r"^(?:[A-Za-z一-龥]+ · \d{4}-\d{4}|工作空间 · \d{4}-\d{4})$", name or ""))


_PLATFORM_HOST_MAP: list[tuple[tuple[str, ...], str]] = [
    (("bilibili.com",), "bilibili"),
    (("youtube.com", "youtu.be"), "youtube"),
    (("xiaohongshu.com", "xhslink.com"), "xiaohongshu"),
    (("douyin.com", "iesdouyin.com"), "douyin"),
    (("kuaishou.com",), "kuaishou"),
    (("mp.weixin.qq.com",), "weixin"),
    (("x.com", "twitter.com"), "twitter"),
]


def _platform_prefix_from_url(url: str) -> str:
    """与前端 platformPrefixFromUrl 同语义，返回小写平台名或 ''."""
    if not url:
        return ""
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return ""
    for hosts, name in _PLATFORM_HOST_MAP:
        if any(host.endswith(h) for h in hosts):
            return name
    parts = host.replace("www.", "").split(".")
    return parts[-2] if len(parts) >= 2 else host


_BATCH_SOURCE_MAX_ITEMS = 300
_BATCH_BVID_RE = re.compile(r"(BV[0-9A-Za-z]{8,})")
_BATCH_HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.bilibili.com/",
}


def _extract_urls_for_batch(source: str) -> List[str]:
    urls = [m.group(0).rstrip(").,，。；;") for m in _GENERIC_URL_RE.finditer(source or "")]
    if not urls and _BILIBILI_BV_RE.match((source or "").strip()):
        urls = [(source or "").strip()]
    seen: set[str] = set()
    unique: List[str] = []
    for url in urls:
        if url not in seen:
            seen.add(url)
            unique.append(url)
    return unique[:_BATCH_SOURCE_MAX_ITEMS]


def _validate_batch_network_url(raw: str) -> str:
    """批量来源 URL 校验：保留 query，特别是 B 站多 P 的 p= 参数。"""
    value = (raw or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="batch item url 不能为空")
    if _BILIBILI_BV_RE.match(value):
        value = f"https://www.bilibili.com/video/{value}"
    else:
        match = _GENERIC_URL_RE.search(value)
        if match:
            value = match.group(0).rstrip(").,，。；;")
        if "://" not in value:
            value = f"https://{value}"
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail=f"invalid url: {raw}")
    clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}"
    if parsed.query:
        clean += f"?{parsed.query}"
    return clean


def _batch_bvid_from_url(url: str) -> str:
    match = _BATCH_BVID_RE.search(url or "")
    return match.group(1) if match else ""


def _bilibili_part_url(bvid: str, page: int) -> str:
    page_num = max(1, int(page or 1))
    return f"https://www.bilibili.com/video/{bvid}?p={page_num}"


def _expand_b23_url(url: str) -> str:
    if "b23.tv" not in (url or "").lower():
        return url
    try:
        with httpx.Client(timeout=10.0, headers=_BATCH_HTTP_HEADERS, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            return str(resp.url)
    except Exception:
        return url


def _resolve_bilibili_multipart_source(url: str) -> Dict[str, Any]:
    bvid = _batch_bvid_from_url(url)
    if not bvid:
        raise HTTPException(status_code=400, detail="未识别到 B 站 BV 号")
    api_url = "https://api.bilibili.com/x/web-interface/view"
    try:
        with httpx.Client(timeout=12.0, headers=_BATCH_HTTP_HEADERS, follow_redirects=True) as client:
            resp = client.get(api_url, params={"bvid": bvid})
            resp.raise_for_status()
            payload = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"B 站分 P 信息获取失败: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="B 站分 P 信息返回格式异常") from exc

    if int(payload.get("code") or 0) != 0:
        msg = payload.get("message") or "B 站接口返回失败"
        raise HTTPException(status_code=502, detail=str(msg))
    data = payload.get("data") or {}
    pages = data.get("pages") or []
    title = str(data.get("title") or bvid)
    cover = data.get("pic") or None
    items: List[Dict[str, Any]] = []
    if isinstance(pages, list) and pages:
        for idx, page in enumerate(pages[:_BATCH_SOURCE_MAX_ITEMS], start=1):
            if not isinstance(page, dict):
                continue
            page_num = int(page.get("page") or idx)
            part = str(page.get("part") or f"P{page_num}")
            display_title = part if part == title else f"{title} · P{page_num} {part}"
            items.append({
                "source_url": _bilibili_part_url(bvid, page_num),
                "title": display_title,
                "platform": "bilibili",
                "index": page_num,
                "duration_seconds": float(page.get("duration") or 0) or None,
                "thumbnail": cover,
                "external_id": f"{bvid}:p{page_num}",
            })
    if not items:
        items.append({
            "source_url": f"https://www.bilibili.com/video/{bvid}",
            "title": title,
            "platform": "bilibili",
            "index": 1,
            "duration_seconds": float(data.get("duration") or 0) or None,
            "thumbnail": cover,
            "external_id": bvid,
        })
    return {
        "source_type": "bilibili_multipart",
        "source_url": f"https://www.bilibili.com/video/{bvid}",
        "title": title,
        "items": items,
        "meta": {"bvid": bvid, "part_count": len(items)},
    }


def _youtube_thumbnail(entry: Dict[str, Any]) -> Optional[str]:
    thumb = entry.get("thumbnail")
    if isinstance(thumb, str) and thumb:
        return thumb
    thumbs = entry.get("thumbnails")
    if isinstance(thumbs, list):
        for item in reversed(thumbs):
            if isinstance(item, dict) and item.get("url"):
                return str(item["url"])
    return None


def _normalize_remote_asset_url(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    clean = value.strip()
    if not clean:
        return None
    if clean.startswith("//"):
        return f"https:{clean}"
    return clean


def _fetch_bilibili_video_brief(client: httpx.Client, bvid: str) -> Dict[str, Any]:
    if not bvid:
        return {}
    try:
        resp = client.get(
            "https://api.bilibili.com/x/web-interface/view",
            params={"bvid": bvid},
        )
        resp.raise_for_status()
        payload = resp.json()
    except Exception:
        return {}
    try:
        code = int(payload.get("code") or 0)
    except Exception:
        code = -1
    if code != 0:
        return {}
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        return {}
    owner = data.get("owner") if isinstance(data.get("owner"), dict) else {}
    return {
        "title": str(data.get("title") or "").strip(),
        "thumbnail": _normalize_remote_asset_url(data.get("pic")),
        "duration_seconds": float(data.get("duration") or 0) or None,
        "uploader": str(owner.get("name") or "").strip(),
    }


def _is_youtube_playlist_url(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if not any(host.endswith(h) for h in ("youtube.com", "youtu.be")):
        return False
    if parsed.path.rstrip("/") == "/playlist":
        return True
    return bool(parse_qs(parsed.query).get("list"))


def _resolve_youtube_playlist_source(url: str) -> Dict[str, Any]:
    try:
        import yt_dlp  # type: ignore
    except Exception as exc:
        raise HTTPException(status_code=503, detail="yt-dlp 未安装，无法解析 YouTube 播放列表") from exc

    opts = {
        "extract_flat": "in_playlist",
        "quiet": True,
        "skip_download": True,
        "ignoreerrors": True,
        "nocheckcertificate": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"YouTube 播放列表解析失败: {exc}") from exc

    if not isinstance(info, dict):
        raise HTTPException(status_code=502, detail="YouTube 播放列表返回格式异常")
    entries = [entry for entry in (info.get("entries") or []) if isinstance(entry, dict)]
    if not entries:
        raise HTTPException(status_code=400, detail="未解析到播放列表视频")
    title = str(info.get("title") or "YouTube 播放列表")
    items: List[Dict[str, Any]] = []
    for idx, entry in enumerate(entries[:_BATCH_SOURCE_MAX_ITEMS], start=1):
        source_url = entry.get("webpage_url") or entry.get("url") or entry.get("id") or ""
        source_url = str(source_url)
        if source_url and not source_url.startswith(("http://", "https://")):
            source_url = f"https://www.youtube.com/watch?v={source_url}"
        if not source_url:
            continue
        items.append({
            "source_url": _validate_batch_network_url(source_url),
            "title": str(entry.get("title") or f"视频 {idx}"),
            "platform": "youtube",
            "index": int(entry.get("playlist_index") or idx),
            "duration_seconds": float(entry.get("duration") or 0) or None,
            "thumbnail": _youtube_thumbnail(entry),
            "external_id": str(entry.get("id") or ""),
        })
    if not items:
        raise HTTPException(status_code=400, detail="播放列表条目缺少可用视频链接")
    return {
        "source_type": "youtube_playlist",
        "source_url": url,
        "title": title,
        "items": items,
        "meta": {"playlist_id": str(info.get("id") or ""), "item_count": len(items)},
    }


def _flat_entry_url(entry: Dict[str, Any], platform: str) -> str:
    raw = str(entry.get("webpage_url") or entry.get("url") or entry.get("id") or "").strip()
    if not raw:
        return ""
    if raw.startswith("//"):
        raw = f"https:{raw}"
    if raw.startswith(("http://", "https://")):
        return raw
    if platform == "bilibili":
        bvid = _batch_bvid_from_url(raw)
        if bvid:
            return f"https://www.bilibili.com/video/{bvid}"
    if platform == "youtube":
        return f"https://www.youtube.com/watch?v={raw}"
    return raw


def _resolve_ytdlp_collection_source(url: str, *, source_type: str, platform: str, fallback_title: str) -> Dict[str, Any]:
    try:
        import yt_dlp  # type: ignore
    except Exception as exc:
        raise HTTPException(status_code=503, detail="yt-dlp 未安装，无法解析批量来源") from exc

    opts = {
        "extract_flat": "in_playlist",
        "quiet": True,
        "skip_download": True,
        "ignoreerrors": True,
        "nocheckcertificate": True,
        "playlistend": _BATCH_SOURCE_MAX_ITEMS,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"批量来源解析失败: {exc}") from exc

    if not isinstance(info, dict):
        raise HTTPException(status_code=502, detail="批量来源返回格式异常")
    entries = [entry for entry in (info.get("entries") or []) if isinstance(entry, dict)]
    title = str(info.get("title") or fallback_title)
    items: List[Dict[str, Any]] = []
    bili_client: Optional[httpx.Client] = None
    bili_brief_cache: Dict[str, Dict[str, Any]] = {}
    if platform == "bilibili":
        bili_client = httpx.Client(timeout=5.0, headers=_BATCH_HTTP_HEADERS, follow_redirects=True)
    try:
        for idx, entry in enumerate(entries[:_BATCH_SOURCE_MAX_ITEMS], start=1):
            source_url = _flat_entry_url(entry, platform)
            if not source_url:
                continue
            try:
                source_url = _validate_batch_network_url(source_url)
            except HTTPException:
                continue
            entry_id = str(entry.get("id") or "").strip()
            bvid = _batch_bvid_from_url(source_url) or _batch_bvid_from_url(entry_id)
            raw_title = str(entry.get("title") or "").strip()
            thumbnail = _youtube_thumbnail(entry)
            duration_seconds = float(entry.get("duration") or 0) or None
            brief: Dict[str, Any] = {}
            if bili_client and bvid and (not raw_title or raw_title == bvid or not thumbnail or not duration_seconds):
                brief = bili_brief_cache.get(bvid) or _fetch_bilibili_video_brief(bili_client, bvid)
                bili_brief_cache[bvid] = brief
            display_title = raw_title
            if not display_title or display_title == bvid:
                display_title = str(brief.get("title") or "").strip()
            if not thumbnail:
                thumbnail = _normalize_remote_asset_url(brief.get("thumbnail"))
            if not duration_seconds:
                duration_seconds = brief.get("duration_seconds")
            items.append({
                "source_url": source_url,
                "title": display_title or entry_id or bvid or f"视频 {idx}",
                "platform": platform,
                "index": int(entry.get("playlist_index") or idx),
                "duration_seconds": duration_seconds,
                "thumbnail": thumbnail,
                "external_id": entry_id or bvid,
            })
    finally:
        if bili_client is not None:
            bili_client.close()
    if not items:
        raise HTTPException(status_code=400, detail="未解析到可选择的视频条目")
    return {
        "source_type": source_type,
        "source_url": url,
        "title": title,
        "items": items,
        "meta": {"item_count": len(items), "extractor": str(info.get("extractor_key") or "")},
    }


def _classify_bilibili_collection_url(url: str) -> Optional[str]:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    path = parsed.path.lower()
    query = parse_qs(parsed.query)
    if "space.bilibili.com" in host:
        return "bilibili_uploader"
    if any(part in path for part in ("favlist", "medialist", "collectiondetail", "seriesdetail")):
        return "bilibili_favorites"
    if query.get("fid") or query.get("sid"):
        return "bilibili_favorites"
    return None


def _resolve_multi_url_source(urls: List[str], *, title: str = "批量链接合集") -> Dict[str, Any]:
    items: List[Dict[str, Any]] = []
    for idx, raw_url in enumerate(urls[:_BATCH_SOURCE_MAX_ITEMS], start=1):
        url = _validate_batch_network_url(raw_url)
        items.append({
            "source_url": url,
            "title": _derive_item_name(url),
            "platform": _platform_prefix_from_url(url),
            "index": idx,
            "duration_seconds": None,
            "thumbnail": None,
            "external_id": "",
        })
    if not items:
        raise HTTPException(status_code=400, detail="未识别到可导入链接")
    return {
        "source_type": "multi_url",
        "source_url": urls[0] if len(urls) == 1 else "",
        "title": title,
        "items": items,
        "meta": {"item_count": len(items)},
    }


def _resolve_batch_source(source: str) -> Dict[str, Any]:
    raw = (source or "").strip()
    urls = _extract_urls_for_batch(raw)
    if len(urls) > 1:
        return _resolve_multi_url_source(urls)

    url = _validate_batch_network_url(urls[0] if urls else raw)
    url = _expand_b23_url(url)
    platform = _platform_prefix_from_url(url)
    if platform == "youtube" and _is_youtube_playlist_url(url):
        return _resolve_youtube_playlist_source(url)
    if platform == "bilibili":
        collection_type = _classify_bilibili_collection_url(url)
        if collection_type:
            fallback = "UP 主投稿合集" if collection_type == "bilibili_uploader" else "B 站视频合集"
            return _resolve_ytdlp_collection_source(
                url,
                source_type=collection_type,
                platform="bilibili",
                fallback_title=fallback,
            )
    if platform == "bilibili" and _batch_bvid_from_url(url):
        return _resolve_bilibili_multipart_source(url)
    return _resolve_multi_url_source([url])


def _inject_active_chat_provider(payload: Dict[str, Any]) -> None:
    try:
        settings = load_settings()
        for provider in settings.providers:
            if not provider.enabled or not provider.api_key.strip():
                continue
            if "chat" in provider.capabilities:
                payload["api_key"] = provider.api_key
                if hasattr(provider, "default_models") and provider.default_models:
                    payload["text_model"] = provider.default_models.get("chat", "")
                break
    except Exception:
        pass


def _create_batch_note_task(
    workspace_id: str,
    item: WorkspaceItem,
    req: BatchSourceImportRequest,
) -> TaskRecord:
    batch_meta = (item.results or {}).get("batch_source") if isinstance(item.results, dict) else {}
    batch_meta = batch_meta if isinstance(batch_meta, dict) else {}
    payload: Dict[str, Any] = {
        "url": item.source_value,
        "title": item.name,
        "video_title": item.name,
        "workspace_id": workspace_id,
        "item_id": item.item_id,
        "preflight": {
            "embed_frames": req.embed_frames,
            "image_mode": req.image_mode,
            "frame_prompt": {
                "mode": "interval",
                "interval_sec": req.frame_interval,
            },
            "intent": req.intent or "note",
        },
        "intent": req.intent or "note",
        "note_media_kind": req.note_media_kind or "video",
        "source_type": "link",
        "kind_hint": item.type,
        "summary_template": req.summary_template or "standard",
        "diarize": req.diarize,
        "summary_mode": req.summary_mode,
        "speaker_count": req.speaker_count,
        "batch_source": {
            "source_type": req.source_type,
            "source_url": req.source_url,
            "workspace_id": workspace_id,
            "index": batch_meta.get("index"),
            "total": len(req.items),
        },
    }
    if req.vision_model.strip():
        payload["vision_model"] = req.vision_model.strip()
    if req.user_notes.strip():
        payload["user_notes"] = req.user_notes.strip()
    _inject_active_chat_provider(payload)
    return _pipeline_runner.create_task(workspace_id, "note", payload)


@router.post("/auto-create")
def auto_create_workspace(req: AutoCreateRequest) -> Dict[str, Any]:
    """根据 hint URL/text 用 LLM 生成名字，自动建空间。"""
    name = _generate_workspace_name(req.hint_url, req.hint_text)
    rec = WorkspaceRecord(
        workspace_id=str(uuid.uuid4()),
        name=name,
        kind="note",
    )
    _store.create(rec)
    return rec.to_dict()


_INBOX_WORKSPACE_ID = "__inbox__"


@router.post("/ensure-inbox")
def ensure_inbox() -> Dict[str, Any]:
    """懒创建隐藏收纳箱 workspace（固定 ID __inbox__）。已存在则直接返回。"""
    rec = _store.get(_INBOX_WORKSPACE_ID)
    if rec is not None:
        return rec.to_dict()
    rec = WorkspaceRecord(
        workspace_id=_INBOX_WORKSPACE_ID,
        name="收纳箱",
        source="inbox",
    )
    _store.create(rec)
    return rec.to_dict()


@router.post("/sniff-url")
def sniff_media_url(req: SniffUrlRequest) -> dict:
    """嗅探 URL 的内容类型（不下载实际文件）。

    策略三层：已知平台路径匹配 → HTTP Content-Type →
    fallback。始终返回 200，嗅探失败时返回 primary_type='video'
    并附带 error 字段供前端展示/降级。
    """
    try:
        result = sniff_url(req.url)
        d = result.to_dict()
        if not result.platform and not result.content_type_header:
            # 完全 fallback 场景——没有任何可识别的信号
            d["error"] = "无法识别内容类型，已按「视频」处理"
        return d
    except Exception:
        logger.warning("sniff_url failed for %s", req.url, exc_info=True)
        return {
            "primary_type": "video",
            "possible_types": ["video"],
            "platform": None,
            "title": None,
            "thumbnail": None,
            "content_type_header": None,
            "error": "嗅探服务异常，已按「视频」降级处理",
        }


@router.post("/probe-duration")
def probe_video_duration(req: ProbeDurationRequest) -> dict:
    """轻量探测视频时长（yt-dlp 只取元数据、不下载），供前端「取画面」算预估帧数。

    失败一律返回 0（前端据此回退到默认间隔），不抛异常、不阻塞识别流程。
    """
    from shared.video_download_ytdlp import fetch_ytdlp_metadata

    try:
        meta = fetch_ytdlp_metadata(req.url)
        return {"duration_sec": int(meta.get("duration") or 0)}
    except Exception:
        logger.warning("probe_video_duration failed for %s", req.url, exc_info=True)
        return {"duration_sec": 0}


@router.get("/{workspace_id}/items/{item_id}/probe-media")
def probe_item_media(workspace_id: str, item_id: str) -> dict:
    """探测本地素材时长 + 首帧封面，供「添加素材」弹窗即时显示。

    本地文件已上传（source_value 为绝对路径），用 cv2 探测——支持 flv/mkv 等
    HTML5 video 播不了的格式。失败一律降级返回 0 / 空，不阻塞添加流程。
    """
    from shared.video_analyzer import extract_first_frame, probe_duration_seconds

    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = next((it for it in rec.items if it.item_id == item_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail=f"item not found: {item_id}")

    path = item.source_value or ""
    if not path or not Path(path).is_file():
        return {"duration_sec": 0, "cover_url": ""}

    duration = 0
    try:
        duration = probe_duration_seconds(path)
    except Exception:
        logger.warning("probe_item_media duration failed for %s", path, exc_info=True)

    cover_url = ""
    try:
        thumb = Path(path).parent / f"_probe_{item_id}_thumb.jpg"
        if extract_first_frame(path, thumb):
            cover_url = to_static_url(thumb)
    except Exception:
        logger.warning("probe_item_media cover failed for %s", path, exc_info=True)

    return {"duration_sec": duration, "cover_url": cover_url}


@router.get("")
def list_workspaces(
    trashed_only: bool = False,
    include_trashed: bool = False,
) -> List[Dict[str, Any]]:
    """列出工作空间。

    默认排除 trashed（软删除后的"垃圾桶"内容）。
    trashed_only=true：仅返回垃圾桶；include_trashed=true：返回全部。
    """
    recs = _store.list_all(
        trashed_only=trashed_only,
        include_trashed=include_trashed,
    )
    # 隐藏收纳箱，不在合集列表展示
    recs = [r for r in recs if r.source != "inbox"]
    return [_enrich_workspace(r) for r in recs]


# ── Phase L1：资料库聚合端点 ──────────────────────────────


def _item_duration_seconds(
    item: WorkspaceItem,
    results: Optional[Dict[str, Any]] = None,
) -> Optional[float]:
    """从 item.results（或传入的 merged results）提取时长。"""
    results = results or item.results or {}
    dur = results.get("duration_sec")
    if dur is None:
        dur = (results.get("tracks_meta") or {}).get("total_sec")
    if dur is not None:
        try:
            return float(dur)
        except (ValueError, TypeError):
            return None
    return None


def _item_thumbnail(item: WorkspaceItem, results: dict = None) -> Optional[str]:
    """从 item.results（或传入的 merged results）提取缩略图路径，转为 /static/ URL。"""
    results = results or item.results or {}
    path = None
    if results.get("cover_thumbnail"):
        path = str(results["cover_thumbnail"])
    else:
        frames = results.get("frames") or []
        if frames and isinstance(frames[0], dict):
            for key in ("thumbnail", "frame_image_path", "frame_image"):
                if frames[0].get(key):
                    path = str(frames[0][key])
                    break
    # NI.3: 图文笔记的 images 数组（第一张图作为缩略图）
    if not path and item.type == "image":
        images = results.get("images") or []
        if images and isinstance(images[0], str) and images[0]:
            path = images[0]
    if not path and item.type == "audio":
        audio = results.get("audio") if isinstance(results.get("audio"), dict) else {}
        audio_filename = str(audio.get("filename") or "").strip()
        project_id = str(results.get("project_id") or "").strip()
        if audio_filename and project_id:
            stem = Path(audio_filename).stem
            audio_dir = DATA_DIR / "workspaces" / project_id / "audio"
            for ext in (".jpg", ".jpeg", ".webp", ".png"):
                candidate = audio_dir / f"{stem}{ext}"
                if candidate.is_file():
                    path = str(candidate)
                    break
    if path:
        # HTTP URL 直接返回（如图片源地址）
        if path.startswith(("http://", "https://")):
            return path
        try:
            data_root = (_ROOT_DIR / "data").resolve()
            abs_path = Path(path).resolve()
            if abs_path.is_relative_to(data_root):
                return "/static/" + str(abs_path.relative_to(data_root))
            return path
        except (ValueError, OSError):
            return path
    # 第三级：yt-dlp 拿到的远端封面 URL（audio 任务 / video 任务都可能有）
    vt = results.get("video_thumbnail_url")
    if vt and isinstance(vt, str) and vt.startswith(("http://", "https://")):
        return vt
    return None


def _item_display_name(
    rec: WorkspaceRecord,
    item: WorkspaceItem,
    results: dict,
) -> str:
    """从最新结果里取资料库卡片标题，兼容旧 audio 结果只存 filename 的情况。"""
    video_title = str(results.get("video_title") or "").strip()
    if video_title:
        return video_title

    audio = results.get("audio") if isinstance(results.get("audio"), dict) else {}
    audio_filename = str(audio.get("filename") or "").strip()
    if audio_filename:
        return Path(audio_filename).stem

    # NI.3: 从 video_file 路径提取标题（图文笔记场景：video_file 是本地文件夹/文件路径）
    video_file = str(results.get("video_file") or "").strip()
    if video_file:
        stem = Path(video_file).stem
        # 路径 stem 有意义且不是纯 UUID/数字时用作标题
        if stem and not stem.replace("-", "").isdigit() and len(stem) > 2:
            return stem

    raw_name = item.name or ""
    source_tail = item.source_value.split("/")[-1] if item.source_value else ""
    if raw_name and raw_name not in (item.source_value, source_tail):
        return raw_name

    if rec.name:
        return rec.name
    return raw_name


def _plain_card_text(raw: Any, *, limit: int = 150) -> str:
    """把结果里的 markdown/转写内容压成卡片摘要。"""
    if raw is None:
        return ""
    if isinstance(raw, list):
        parts: List[str] = []
        for entry in raw:
            if isinstance(entry, dict):
                text = entry.get("text") or entry.get("content") or entry.get("sentence")
                if text:
                    parts.append(str(text))
            elif isinstance(entry, str):
                parts.append(entry)
            if len(" ".join(parts)) >= limit:
                break
        raw = " ".join(parts)
    if not isinstance(raw, str):
        return ""
    text = raw.strip()
    if not text:
        return ""
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        return text[: limit - 1].rstrip() + "…"
    return text


def _item_card_description(item: WorkspaceItem, results: dict) -> str:
    """为资料库卡片提取一行用户可扫读的简介。"""
    summary_candidates: List[Any] = []
    if item.summaries:
        latest_summary = sorted(item.summaries, key=lambda s: s.created_at, reverse=True)[0]
        summary_candidates.append(latest_summary.content_md)
    summary_candidates.extend([
        results.get("note_summary"),
        results.get("summary"),
        results.get("description"),
        results.get("video_description"),
        results.get("transcript"),
        results.get("segments"),
    ])
    for candidate in summary_candidates:
        text = _plain_card_text(candidate)
        if text:
            return text

    if item.type == ItemType.AUDIO.value:
        return "音频笔记：保留转写、时间线与后续总结入口。"
    if item.type == ItemType.VIDEO.value:
        return "视频笔记：保留封面、字幕、关键帧与结构化总结。"
    if item.type == ItemType.IMAGE.value:
        return "图文笔记：保留图片素材与视觉分析结果。"
    if item.type == ItemType.TEXT.value:
        return "文本笔记：保留原文与结构化摘要。"
    return "素材已收纳，可继续整理、收藏或加入合集。"


def _item_primary_task_status(item: WorkspaceItem) -> Optional[str]:
    """返回 item.related_task_ids 里最新 task 的 status。"""
    if not item.related_task_ids:
        return None
    latest = None
    for tid in item.related_task_ids:
        task = _pipeline_runner.store.get(tid)
        if task is None:
            continue
        if latest is None or task.updated_at > latest.updated_at:
            latest = task
    return latest.status if latest else None



def _compute_primary_view(item: "WorkspaceItem", results: dict) -> str:
    """计算前端该进哪个页。"""
    # 有笔记数据（转写/总结/执行过 note 任务）
    has_note_data = bool(results.get("transcript")) or bool(results.get("summary")) or any("note" in t for t in (item.related_task_ids or []))
    if has_note_data:
        return "note"

    return "note"


def _default_summary_template_for_item(item: "WorkspaceItem", results: dict) -> str:
    """返回素材当前最合适的新建总结默认模板。"""
    template = str(results.get("default_summary_template") or "").strip()
    if template:
        return template
    preflight = getattr(item, "preflight", None)
    tasks = getattr(preflight, "tasks", {}) if preflight else {}
    if isinstance(tasks, dict):
        for key in ("summary", "transcribe_summary", "note"):
            cfg = tasks.get(key)
            if isinstance(cfg, dict):
                template = str(cfg.get("summary_template") or "").strip()
                if template:
                    return template
    return ""


@router.get("/library")
def get_library(
    include_trashed: bool = False,
) -> Dict[str, Any]:
    """聚合端点：摊平所有 workspace items + workspace 摘要，供「资料库」页使用。"""
    recs = _store.list_all(
        include_trashed=include_trashed,
        trashed_only=False,
    )

    items_out: List[Dict[str, Any]] = []
    workspaces_out: List[Dict[str, Any]] = []

    for rec in recs:
        # workspace 摘要卡片（收纳箱不展示为合集卡片）
        if rec.source != "inbox":
            workspaces_out.append({
                "workspace_id": rec.workspace_id,
                "name": rec.name,
                "kind": rec.kind,
                "items_count": len(rec.items),
                "items_count_by_type": _items_count_by_type(rec),
                "cover_thumbnail": _cover_thumbnail(rec),
                "updated_at": rec.updated_at,
                "status": rec.status,
            })

        for item in rec.items:
            # X.1 bridge：用 task 状态覆盖 item status
            item_status = item.status
            overlay = _sync_item_with_tasks(item)
            if overlay and "status" in overlay:
                item_status = overlay["status"]

            results = (overlay.get("results") if overlay else None) or item.results or {}
            if item.type == ItemType.VIDEO.value and isinstance(results, dict):
                preferred_basenames = list(results.get("json_output_basenames") or [])
                results = _materialize_video_results_from_analyze(
                    dict(results),
                    preferred_basenames=preferred_basenames,
                )
            display_name = _item_display_name(rec, item, results)
            audio_nature = None
            if item.type == "audio":
                music_mode = results.get("music_mode")
                has_music = results.get("music")
                has_speech = (results.get("vad") or {}).get("has_speech")
                if music_mode or (has_music and not has_speech):
                    audio_nature = "music"
                elif has_speech:
                    audio_nature = "speech"
            items_out.append({
                "item_id": item.item_id,
                "content_id": item.content_id,
                "lineage_id": item.lineage_id,
                "workspace_id": rec.workspace_id,
                "workspace_name": rec.name,
                "workspace_kind": rec.kind,
                "type": item.type,
                "source": item.source,
                "source_value": item.source_value,
                "name": display_name,
                "status": item_status,
                "created_at": item.created_at,
                "updated_at": item.updated_at,
                "duration_seconds": _item_duration_seconds(item, results),
                "thumbnail": _item_thumbnail(item, results),
                "description": _item_card_description(item, results),
                "favorite": item.item_id in rec.favorites,
                "results_summary": {
                    "has_summary": bool(results.get("summary")),
                    "has_transcript": bool(results.get("transcript")),
                },
                "primary_task_status": _item_primary_task_status(item),
                "preflight": item.preflight.to_dict() if hasattr(item, 'preflight') else {},
                "tags": item.tags or {},
                "uploader": str(results.get("video_uploader") or "") or None,
                "has_subtitle": bool(results.get("subtitle_paths")),
                "has_chapters": bool(results.get("chapters") or (results.get("av_synthesis") or {}).get("chapters")),
                "primary_view": _compute_primary_view(item, results),
                "frames_count": len(results.get("frames") or []) if item.type == "video" else 0,
                "audio_nature": audio_nature,
            })

    return {"items": items_out, "workspaces": workspaces_out}


class BatchDeleteRequest(BaseModel):
    items: list[dict]  # [{"workspace_id": "...", "item_id": "..."}, ...]


class BatchAddToWorkspaceRequest(BaseModel):
    target_workspace_id: str
    items: list[dict]  # [{"workspace_id": "...", "item_id": "..."}, ...]


class BatchOrganizeRequest(BaseModel):
    items: list[dict]
    tags: Optional[Dict[str, Any]] = None
    folder_id: Optional[str] = None


@router.post("/items/batch-delete")
def batch_delete_items(req: BatchDeleteRequest) -> Dict[str, Any]:
    """批量删除素材。"""
    removed: list[str] = []
    failed: list[dict] = []
    for entry in req.items:
        ws_id = str(entry.get("workspace_id") or "")
        item_id = str(entry.get("item_id") or "")
        if not ws_id or not item_id:
            failed.append({**entry, "reason": "missing workspace_id or item_id"})
            continue
        # 1-B 对齐：删 item 前先取出 related_task_ids，删除后同步清理 task_store，
        # 否则批量删除会留下孤儿任务（单个删除已处理，批量删除此前遗漏）。
        ws = _store.get(ws_id)
        item = next((it for it in ws.items if it.item_id == item_id), None) if ws else None
        related_tids = list(item.related_task_ids) if item else []
        try:
            _store.remove_item(ws_id, item_id)
            removed.append(item_id)
        except KeyError as err:
            failed.append({"workspace_id": ws_id, "item_id": item_id, "reason": str(err)})
            continue
        for tid in related_tids:
            try:
                _pipeline_runner.store.delete(tid)
            except Exception:
                pass  # 单个删除失败不阻塞主流程
    return {"removed": len(removed), "failed": len(failed), "removed_ids": removed, "failures": failed}


@router.post("/items/batch-add-to-workspace")
def batch_add_items_to_workspace(req: BatchAddToWorkspaceRequest) -> Dict[str, Any]:
    """把已有素材加入目标合集。

    创建独立内容副本，保留同源谱系和只读媒体引用，不重复触发下载/分析。
    """
    target_id = req.target_workspace_id.strip()
    target = _store.get(target_id)
    if target is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {target_id}")

    existing_lineages = {item.lineage_id for item in target.items}
    added: List[str] = []
    skipped: List[str] = []
    failed: List[Dict[str, Any]] = []

    for entry in req.items:
        ws_id = str(entry.get("workspace_id") or "").strip()
        item_id = str(entry.get("item_id") or "").strip()
        if not ws_id or not item_id:
            failed.append({**entry, "reason": "missing workspace_id or item_id"})
            continue
        source = _store.get(ws_id)
        if source is None:
            failed.append({"workspace_id": ws_id, "item_id": item_id, "reason": "source workspace not found"})
            continue
        if source.kind != target.kind:
            failed.append({"workspace_id": ws_id, "item_id": item_id, "reason": "workspace kind mismatch"})
            continue

        item = next((it for it in source.items if it.item_id == item_id), None)
        if item is None:
            failed.append({"workspace_id": ws_id, "item_id": item_id, "reason": "item not found"})
            continue
        if item.lineage_id in existing_lineages:
            skipped.append(item_id)
            continue

        target_note_dir: Optional[Path] = None
        try:
            cloned = WorkspaceItem.from_dict(item.to_dict())
            cloned.item_id = str(uuid.uuid4())
            cloned.content_id = str(uuid.uuid4())
            cloned.origin_content_id = item.content_id
            cloned.legacy_item_id = item.legacy_item_id or item.item_id
            cloned.related_task_ids = []
            source_note_dir = note_dir(ws_id, item_id)
            target_note_dir = note_dir(target_id, cloned.item_id)
            if source_note_dir.exists():
                shutil.copytree(source_note_dir, target_note_dir)
            _store.add_item(target_id, cloned)
            existing_lineages.add(cloned.lineage_id)
            added.append(cloned.item_id)
        except Exception as err:
            if target_note_dir is not None:
                shutil.rmtree(target_note_dir, ignore_errors=True)
            failed.append({"workspace_id": ws_id, "item_id": item_id, "reason": str(err)})

    return {
        "added": len(added),
        "skipped": len(skipped),
        "failed": len(failed),
        "added_ids": added,
        "skipped_ids": skipped,
        "failures": failed,
    }


@router.post("/items/batch-organize")
def batch_organize_items(req: BatchOrganizeRequest) -> Dict[str, Any]:
    """Apply manual tags and/or a workspace folder to selected independent copies."""

    if req.tags is None and req.folder_id is None:
        raise HTTPException(status_code=400, detail="tags or folder_id is required")
    if req.tags is not None:
        _validate_tags(req.tags)
    changed = 0
    failures: List[Dict[str, Any]] = []
    for reference in req.items:
        workspace_id = str(reference.get("workspace_id") or "")
        item_id = str(reference.get("item_id") or "")
        try:
            item = _store.get_item(workspace_id, item_id)
            if req.folder_id is not None:
                _metadata.move_content(workspace_id, item.content_id, req.folder_id)
            if req.tags is not None:
                _metadata.replace_tags(item.content_id, req.tags, "MANUAL")
                automatic = _metadata.tags_for_content(item.content_id, "AUTO")
                _store.update_item(
                    workspace_id,
                    item_id,
                    tags={**automatic, **req.tags},
                )
            changed += 1
        except (KeyError, ValueError) as error:
            failures.append({**reference, "reason": str(error)})
    return {"changed": changed, "failed": len(failures), "failures": failures}


@router.get("/{workspace_id}/items/{item_id}/lineage")
def list_item_lineage(workspace_id: str, item_id: str) -> Dict[str, Any]:
    """列出其他合集中的同源独立副本，不自动合并或覆盖。"""

    try:
        current = _store.get_item(workspace_id, item_id)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    copies = []
    for workspace in _store.list_all(include_trashed=False):
        for item in workspace.items:
            if item.lineage_id != current.lineage_id or item.content_id == current.content_id:
                continue
            copies.append({
                "workspace_id": workspace.workspace_id,
                "workspace_name": workspace.name,
                "item_id": item.item_id,
                "content_id": item.content_id,
                "lineage_id": item.lineage_id,
                "name": item.name,
                "type": item.type,
                "updated_at": item.updated_at,
                "jump_url": _jump_url(workspace.workspace_id, item.item_id, item.type),
            })
    return {
        "content_id": current.content_id,
        "lineage_id": current.lineage_id,
        "copies": sorted(copies, key=lambda copy: copy["updated_at"], reverse=True),
    }


@router.post("/batch-sources/resolve")
def resolve_batch_source(req: BatchSourceResolveRequest) -> Dict[str, Any]:
    """解析批量来源：B 站多 P / YouTube 播放列表 / 多链接文本。"""
    return _resolve_batch_source(req.source)


@router.post("/batch-sources/import")
def import_batch_source(req: BatchSourceImportRequest) -> Dict[str, Any]:
    """把解析后的批量来源导入为新合集，并可立即启动每条笔记任务。"""
    if not req.items:
        raise HTTPException(status_code=400, detail="items 不能为空")
    if len(req.items) > _BATCH_SOURCE_MAX_ITEMS:
        raise HTTPException(status_code=400, detail=f"一次最多导入 {_BATCH_SOURCE_MAX_ITEMS} 条")

    now = datetime.now(timezone.utc).isoformat()
    first_title = (req.items[0].title or "").strip()
    workspace_name = (
        req.workspace_name.strip()
        or (f"批量合集 · {first_title}" if first_title else "")
        or f"批量合集 · {datetime.now().strftime('%m%d-%H%M')}"
    )
    if len(workspace_name) > 120:
        workspace_name = workspace_name[:120].rstrip()
    workspace_id = str(uuid.uuid4())
    items: List[WorkspaceItem] = []
    intent = req.intent or "note"

    for idx, entry in enumerate(req.items, start=1):
        url = _validate_batch_network_url(entry.source_url)
        title = (entry.title or "").strip() or _derive_item_name(url)
        thumb = (entry.thumbnail or "").strip() or None
        platform = (entry.platform or "").strip() or _platform_prefix_from_url(url)
        item = WorkspaceItem(
            item_id=str(uuid.uuid4()),
            type=ItemType.VIDEO.value,
            source="url",
            source_value=url,
            name=title,
            status=ItemStatus.PENDING.value,
            preflight=PreflightConfig(
                intent=intent,
                tasks={
                    "summary": {
                        "embed_frames": req.embed_frames,
                        "summary_template": req.summary_template,
                        "diarize": req.diarize,
                    },
                },
            ),
            results={
                "video_title": title,
                "video_thumbnail_url": thumb,
                "cover_thumbnail": thumb,
                "duration_sec": entry.duration_seconds,
                "default_summary_template": req.summary_template,
                "batch_source": {
                    "source_type": req.source_type,
                    "source_url": req.source_url,
                    "platform": platform,
                    "index": entry.index or idx,
                    "external_id": entry.external_id,
                },
            },
            tags={
                "custom_tags": [tag for tag in ["批量导入", platform, "视频合集"] if tag],
            },
        )
        items.append(item)

    rec = WorkspaceRecord(
        workspace_id=workspace_id,
        name=workspace_name,
        status=WorkspaceStatus.PROCESSING.value if req.start else WorkspaceStatus.ACTIVE.value,
        kind=req.kind,
        source=req.source_type,
        source_meta={
            "source_type": req.source_type,
            "source_url": req.source_url,
            "items_total": len(items),
            "imported_at": now,
        },
        items=items,
    )
    rec = _store.create(rec)

    tasks: List[Dict[str, Any]] = []
    if req.start:
        for item in list(rec.items):
            try:
                task_rec = _create_batch_note_task(rec.workspace_id, item, req)
            except ValueError as err:
                raise HTTPException(status_code=409, detail=str(err)) from err
            rec = _store.update_item(
                rec.workspace_id,
                item.item_id,
                related_task_ids=list(item.related_task_ids) + [task_rec.task_id],
                status=ItemStatus.PROCESSING.value,
            )
            tasks.append({
                "task_id": task_rec.task_id,
                "item_id": item.item_id,
                "item_type": item.type,
            })

    latest = _store.get(rec.workspace_id) or rec
    return {
        "workspace": _enrich_workspace(latest),
        "items_added": len(items),
        "tasks": tasks,
    }


@router.get("/{workspace_id}")
def get_workspace(workspace_id: str) -> Dict[str, Any]:
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    return _enrich_workspace(rec)


@router.patch("/{workspace_id}")
def update_workspace(workspace_id: str, req: WorkspaceUpdateRequest) -> Dict[str, Any]:
    _ensure_valid_status(req.status)
    payload: Dict[str, Any] = {}
    if req.name is not None:
        if not req.name.strip():
            raise HTTPException(status_code=400, detail="name cannot be empty")
        payload["name"] = req.name.strip()
    if req.status is not None:
        payload["status"] = req.status
    if req.background is not None:
        payload["background"] = req.background
    if not payload:
        raise HTTPException(status_code=400, detail="no fields to update")
    try:
        rec = _store.update(workspace_id, **payload)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    return _enrich_workspace(rec)


def _cleanup_workspace_chat(workspace_id: str) -> None:
    """删除该 workspace 的聊天 jsonl。"""
    from shared.chat_store import CHATS_DIR

    safe = workspace_id.replace("/", "_").replace("\\", "_").strip()
    if not safe:
        return
    fp = (CHATS_DIR / f"{safe}.jsonl").resolve()
    try:
        fp.relative_to(CHATS_DIR.resolve())
    except ValueError:
        return
    if fp.exists():
        try:
            fp.unlink()
        except OSError:
            pass


def _permanently_delete_workspace(workspace_id: str) -> None:
    """物理删除 workspace：JSON 记录 + 上传目录 + 聊天文件。

    不递归扫描全局共享目录（data/videos / data/json_data）——那些目录按 item 维度
    组织且可能与其它 workspace 共享，由 item 级删除路径独立处理。
    """
    ok = _store.delete(workspace_id)
    if not ok:
        raise HTTPException(
            status_code=500,
            detail=(
                "failed to delete workspace file on disk "
                "(check filesystem permissions on data/workspaces/)"
            ),
        )
    _cleanup_workspace_uploads(workspace_id)
    _cleanup_workspace_chat(workspace_id)


# 注意：路径 /trash 必须在 /{workspace_id} 之前注册，否则会被 path param 吞掉
@router.delete("/trash")
def empty_trash() -> Dict[str, Any]:
    """清空垃圾桶：物理删除所有 trashed=True 的 workspace 及关联文件。"""
    trashed = _store.list_all(trashed_only=True)
    deleted: List[str] = []
    for rec in trashed:
        try:
            _permanently_delete_workspace(rec.workspace_id)
            deleted.append(rec.workspace_id)
        except HTTPException:
            # 单条失败不阻塞其它，前端可重试
            continue
    return {"deleted": deleted, "count": len(deleted)}


@router.delete("/{workspace_id}")
def delete_workspace(workspace_id: str) -> Dict[str, Any]:
    """软删除：标记 trashed=True，不删 JSON 记录与素材文件。

    通过 POST /workspaces/{id}/restore 恢复；
    通过 DELETE /workspaces/{id}/permanent 彻底删除。
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    if rec.trashed:
        # 已经在垃圾桶里，幂等返回
        return {"trashed": True, "workspace_id": workspace_id, "already": True}
    _store.update(workspace_id, trashed=True)
    return {"trashed": True, "workspace_id": workspace_id}


@router.post("/{workspace_id}/restore")
def restore_workspace(workspace_id: str) -> Dict[str, Any]:
    """从垃圾桶恢复：trashed=False，原 status 保留。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    if not rec.trashed:
        return {"restored": True, "workspace_id": workspace_id, "already": True}
    _store.update(workspace_id, trashed=False)
    return {"restored": True, "workspace_id": workspace_id}


@router.delete("/{workspace_id}/permanent")
def permanently_delete_workspace(workspace_id: str) -> Dict[str, Any]:
    """彻底删除：物理删除 JSON 记录 + 上传目录 + 聊天文件。

    必须先经过软删除（trashed=True）才能彻底删除——避免误操作。
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    if not rec.trashed:
        raise HTTPException(
            status_code=400,
            detail="workspace must be trashed before permanent deletion",
        )
    _permanently_delete_workspace(workspace_id)
    return {"deleted": True, "workspace_id": workspace_id}


# ── Item 操作 ────────────────────────────────────────────


@router.post("/{workspace_id}/items")
def add_item(workspace_id: str, req: ItemAddRequest) -> Dict[str, Any]:
    """向工作空间添加一个素材。"""
    _ensure_valid_item_type(req.type)
    if req.source not in ("url", "local"):
        raise HTTPException(status_code=400, detail="source must be 'url' or 'local'")
    if not req.source_value.strip():
        raise HTTPException(status_code=400, detail="source_value cannot be empty")

    if req.source == "url":
        normalized_value = _validate_network_url(req.source_value)
    else:
        normalized_value = req.source_value.strip()

    item = WorkspaceItem(
        item_id=str(uuid.uuid4()),
        type=req.type,
        source=req.source,
        source_value=normalized_value,
        name=(req.name.strip() or _derive_item_name(normalized_value)),
    )
    try:
        rec = _store.add_item(workspace_id, item)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    return rec.to_dict()


@router.post("/{workspace_id}/items/upload")
async def upload_item(
    workspace_id: str,
    file: UploadFile = File(...),
    name: str = Form(default=""),
    item_type: Optional[str] = Form(default=None, alias="type"),
) -> Dict[str, Any]:
    """上传本地文件并登记为工作空间素材。"""
    if _store.get(workspace_id) is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")

    explicit_type = (item_type or "").strip()
    if explicit_type:
        _ensure_valid_item_type(explicit_type)
        resolved_type = explicit_type
    else:
        resolved_type = _infer_upload_item_type(file.filename or "", file.content_type)

    upload_dir = WORKSPACE_UPLOAD_ROOT / workspace_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _sanitize_upload_name(file.filename or "upload.bin")
    dest = _unique_upload_path(upload_dir, safe_name)

    total_bytes = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="uploaded file exceeds 500MB limit")
                out.write(chunk)
        if total_bytes == 0:
            raise HTTPException(status_code=400, detail="uploaded file cannot be empty")
    except HTTPException:
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    except Exception as err:  # noqa: BLE001
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"upload failed: {err}") from err
    finally:
        await file.close()

    item = WorkspaceItem(
        item_id=str(uuid.uuid4()),
        type=resolved_type,
        source="local",
        source_value=str(dest.resolve()),
        name=(name.strip() or safe_name),
    )
    try:
        rec = _store.add_item(workspace_id, item)
    except KeyError as err:
        try:
            dest.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(status_code=404, detail=str(err)) from err
    return rec.to_dict()


@router.delete("/{workspace_id}/items/{item_id}")
def remove_item(workspace_id: str, item_id: str) -> Dict[str, Any]:
    # 1-B：删 item 前先取出 related_task_ids，删除后同步清理 task_store
    item = None
    ws = _store.get(workspace_id)
    if ws is not None:
        item = next((it for it in ws.items if it.item_id == item_id), None)
    related_tids = list(item.related_task_ids) if item else []
    try:
        rec = _store.remove_item(workspace_id, item_id)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    for tid in related_tids:
        try:
            _pipeline_runner.store.delete(tid)
        except Exception:
            pass  # 单个删除失败不阻塞主流程
    return rec.to_dict()


# ── Favorites（复刻收藏夹）──────────────────────────────


@router.post("/{workspace_id}/favorites/{item_id}")
def favorite_item(workspace_id: str, item_id: str) -> Dict[str, Any]:
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    _metadata.set_favorite(workspace_id, item.content_id)
    favorite_ids = _metadata.favorite_content_ids(workspace_id)
    rec = _store.update(
        workspace_id,
        favorites=[candidate.item_id for candidate in rec.items
                   if candidate.content_id in favorite_ids],
    )
    return rec.to_dict()


@router.delete("/{workspace_id}/favorites/{item_id}")
def unfavorite_item(workspace_id: str, item_id: str) -> Dict[str, Any]:
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    _metadata.remove_favorite(workspace_id, item.content_id)
    favorite_ids = _metadata.favorite_content_ids(workspace_id)
    rec = _store.update(
        workspace_id,
        favorites=[candidate.item_id for candidate in rec.items
                   if candidate.content_id in favorite_ids],
    )
    return rec.to_dict()


class MetadataNameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    parent_id: Optional[str] = None


class FolderMoveRequest(BaseModel):
    folder_id: str


class FavoriteImportRequest(BaseModel):
    payload: Dict[str, Any]


@router.get("/metadata/favorite-groups")
def list_favorite_groups() -> List[Dict[str, Any]]:
    return _metadata.list_favorite_groups()


@router.get("/metadata/favorites/export")
def export_favorite_metadata() -> Dict[str, Any]:
    return _metadata.export_favorites()


@router.get("/metadata/favorites/resolved")
def resolved_favorites(
    group_id: Optional[str] = Query(default=None),
) -> List[Dict[str, Any]]:
    """R3-A：已解析收藏数据源。

    解析所有未软删除 workspace（含 __inbox__）中的收藏，
    按 (workspace_id, content_id) 解析，跳过丢失/已删除内容。
    """
    raw_items = _metadata.all_favorite_items(group_id=group_id)
    # 构建 workspace 索引（含 inbox，排除 trashed）
    all_recs = _store.list_all(include_trashed=True)
    ws_index: Dict[str, WorkspaceRecord] = {
        r.workspace_id: r for r in all_recs if not r.trashed
    }
    resolved: List[Dict[str, Any]] = []
    for entry in raw_items:
        ws_id = entry["workspace_id"]
        content_id = entry["content_id"]
        rec = ws_index.get(ws_id)
        if rec is None:
            continue  # workspace 不存在或已软删除
        # 按 content_id 查找 item
        item = next(
            (it for it in rec.items if it.content_id == content_id), None
        )
        if item is None:
            continue  # item 已丢失
        # 构建 jump_url
        if item.type in ("audio", "note"):
            jump_url = f"/workspaces/{ws_id}/items/{item.item_id}/note"
        else:
            jump_url = f"/workspaces/{ws_id}/items/{item.item_id}/result"
        resolved.append({
            "workspace_id": ws_id,
            "workspace_name": rec.name,
            "item_id": item.item_id,
            "content_id": content_id,
            "item_name": item.name or item.source_value,
            "item_type": item.type,
            "group_ids": entry["group_ids"],
            "favorited_at": entry["favorited_at"],
            "jump_url": jump_url,
        })
    return resolved


@router.post("/metadata/favorites/import")
def import_favorite_metadata(req: FavoriteImportRequest) -> Dict[str, int]:
    records = _store.list_all(include_trashed=True)
    valid = {item.content_id for record in records for item in record.items}
    result = _metadata.import_favorites(req.payload, valid)
    for record in records:
        favorite_ids = _metadata.favorite_content_ids(record.workspace_id)
        snapshot = [
            item.item_id for item in record.items if item.content_id in favorite_ids
        ]
        if snapshot != record.favorites:
            _store.update(record.workspace_id, favorites=snapshot)
    return result


@router.post("/metadata/favorite-groups")
def create_favorite_group(req: MetadataNameRequest) -> Dict[str, Any]:
    try:
        return _metadata.create_favorite_group(req.name)
    except (ValueError, sqlite3.IntegrityError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.get("/metadata/favorite-groups/{group_id}/items")
def list_favorite_group_items(group_id: str) -> List[Dict[str, Any]]:
    return _metadata.favorite_items(group_id)


@router.delete("/metadata/favorite-groups/{group_id}")
def delete_favorite_group(group_id: str) -> Dict[str, bool]:
    try:
        _metadata.delete_favorite_group(group_id)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    return {"deleted": True}


@router.post("/{workspace_id}/favorites/{item_id}/groups/{group_id}")
def add_favorite_to_group(
    workspace_id: str, item_id: str, group_id: str,
) -> Dict[str, Any]:
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    try:
        _metadata.set_favorite(workspace_id, item.content_id, group_id)
    except sqlite3.IntegrityError as err:
        raise HTTPException(status_code=404, detail="favorite group not found") from err
    if item_id not in rec.favorites:
        rec = _store.update(workspace_id, favorites=[*rec.favorites, item_id])
    return rec.to_dict()


@router.get("/{workspace_id}/folders")
def list_workspace_folders(workspace_id: str) -> List[Dict[str, Any]]:
    if _store.get(workspace_id) is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    return _metadata.list_folders(workspace_id)


@router.post("/{workspace_id}/folders")
def create_workspace_folder(
    workspace_id: str, req: MetadataNameRequest,
) -> Dict[str, Any]:
    if _store.get(workspace_id) is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    try:
        return _metadata.create_folder(workspace_id, req.name, req.parent_id)
    except (ValueError, sqlite3.IntegrityError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.delete("/{workspace_id}/folders/{folder_id}")
def delete_workspace_folder(workspace_id: str, folder_id: str) -> Dict[str, bool]:
    _metadata.delete_folder(workspace_id, folder_id)
    return {"deleted": True}


@router.put("/{workspace_id}/items/{item_id}/folder")
def move_item_to_folder(
    workspace_id: str, item_id: str, req: FolderMoveRequest,
) -> Dict[str, bool]:
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    try:
        _metadata.move_content(workspace_id, item.content_id, req.folder_id)
    except ValueError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
    return {"moved": True}


# ── Preflight 配置 + 触发分析 ───────────────────────────


def _find_item(rec: WorkspaceRecord, item_id: str) -> WorkspaceItem:
    """工具：在 workspace 内查找 item，找不到抛 404。"""
    target = next((it for it in rec.items if it.item_id == item_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail=f"item not found: {item_id}")
    return target


@router.put("/{workspace_id}/items/{item_id}/preflight")
def save_preflight(
    workspace_id: str, item_id: str, req: PreflightSaveRequest
) -> Dict[str, Any]:
    """保存某素材的前置配置。

    说明：保存与触发解耦——可以先保存（用户调参），稍后再调 /start 真正执行分析。
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    target = _find_item(rec, item_id)
    target.preflight = PreflightConfig(
        intent=req.intent,
        background_overrides=req.background_overrides,
        models=req.models,
        tasks=req.tasks,
    )
    try:
        rec = _store.update_item(workspace_id, item_id, preflight=target.preflight)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    return rec.to_dict()


def _bridge_to_pipeline_payload(
    item: WorkspaceItem, workspace: WorkspaceRecord
) -> tuple[str, Dict[str, Any]]:
    """把 workspace item + preflight 翻译成现有 pipeline task 的 (task_type, payload)。

    当前只处理 video 分支（MVP 范围）：
      - source=url  → task_type='download'
      - source=local→ task_type='analyze'（视频已在本地）

    audio / image / text 分支需对应的 pipeline handler，后续阶段实现，
    目前抛 501 让前端展示「即将上线」提示。
    """
    if item.type == ItemType.TEXT.value:
        payload: Dict[str, Any] = {
            "source": item.source_value,
            "source_type": item.source,  # "url" or "local"
        }
        # N10: 透传 text 子参数 + 全局模型/key
        models = item.preflight.models or {}
        if models.get("text"):
            payload["text_model"] = models["text"]
        tasks = item.preflight.tasks or {}
        for task_id in ("summary", "assoc", "rewrite", "translate", "multi"):
            params = tasks.get(task_id)
            if isinstance(params, dict):
                payload[task_id] = params
        # T3.2: 前端 assoc_dirs[] → pipeline association.directions
        assoc_task = tasks.get("assoc")
        if isinstance(assoc_task, dict) and assoc_task.get("on"):
            dirs = assoc_task.get("assoc_dirs") or assoc_task.get("assoc_dir")
            if isinstance(dirs, str):
                dirs = [dirs]
            if isinstance(dirs, list) and dirs:
                payload["association"] = {"enabled": True, "directions": dirs}
        return "text", payload

    if item.type == ItemType.IMAGE.value:
        payload = {
            "source": item.source_value,
            "source_type": item.source,  # "url" or "local"
        }
        # N9: 透传 image 子参数 + 全局模型/key
        models = item.preflight.models or {}
        if models.get("vision"):
            payload["vision_model"] = models["vision"]
        if models.get("text"):
            payload["text_model"] = models["text"]
        tasks = item.preflight.tasks or {}
        for task_id in ("ocr", "prompt", "assoc", "compare"):
            params = tasks.get(task_id)
            if isinstance(params, dict):
                payload[task_id] = params
        # T3.2: 前端 assoc_dirs[] → pipeline assoc.directions
        assoc_task = tasks.get("assoc")
        if isinstance(assoc_task, dict):
            dirs = assoc_task.get("assoc_dirs") or assoc_task.get("assoc_dir")
            if isinstance(dirs, str):
                dirs = [dirs]
            if isinstance(dirs, list):
                payload["assoc"] = {**assoc_task, "directions": dirs}
        # R21.P3.S1: 透传 preflight 新字段（image_mode / background_for_recognition）
        _preflight = tasks.get("preflight")
        if isinstance(_preflight, dict):
            if _preflight.get("image_mode"):
                payload["image_mode"] = _preflight["image_mode"]
            if _preflight.get("background_for_recognition"):
                payload["background_for_recognition"] = _preflight["background_for_recognition"]
        return "image", payload

    if item.type == ItemType.AUDIO.value:
        payload = {
            "source": item.source_value,
            "source_type": item.source,  # "url" or "local"
        }
        # N8: 透传 audio 子参数 + 全局模型/key（与 video analyze 路径对齐）
        # IP.9.2: 前端 6 任务 ID → 后端 bridge 兼容映射
        models = item.preflight.models or {}
        if models.get("text"):
            payload["text_model"] = models["text"]
        tasks = item.preflight.tasks or {}
        # R18: 新结构 transcribe_summary 包含所有转写+总结子项
        ts = tasks.get("transcribe_summary")
        if isinstance(ts, dict):
            # 映射子项到后端期望的 payload key
            _copy_task_config(payload, "voiceprint", ts, "speaker_diarize")
            _copy_task_config(payload, "srt", ts, "subtitle_export")
            # 顶层参数直接透传
            for k in (
                "proper_nouns",
                "include_timestamps",
                "summary_template",
                "summary_mode",
                "speaker_count",
            ):
                v = ts.get(k)
                if v is not None and v != "":
                    payload[k] = v
            # asr 整体开关
            if "on" in ts:
                payload["asr"] = {"enabled": bool(ts["on"])}
        else:
            # 兼容旧结构
            _copy_task_config(payload, "asr", tasks, "asr_summary", "asr")
            _copy_task_config(payload, "voiceprint", tasks, "voiceprint")
            _copy_task_config(payload, "srt", tasks, "subtitle_file", "srt")
        # AddMaterial 的当前音频配置存放在 tasks.summary；这是新建音频的主路径。
        summary_cfg = tasks.get("summary")
        if isinstance(summary_cfg, dict):
            if summary_cfg.get("summary_template"):
                payload["summary_template"] = summary_cfg["summary_template"]
            if summary_cfg.get("summary_mode"):
                payload["summary_mode"] = summary_cfg["summary_mode"]
            if "diarize" in summary_cfg:
                payload["voiceprint"] = {"enabled": bool(summary_cfg["diarize"])}
            if summary_cfg.get("speaker_count") is not None:
                payload["speaker_count"] = summary_cfg["speaker_count"]
        # 音频笔记不进入音乐/复刻能力；旧配置字段不再透传，避免历史设置重新触发这些流程。
        # R21.P3.S1: 透传 preflight 新字段（background_for_recognition）
        _preflight = tasks.get("preflight")
        if isinstance(_preflight, dict):
            if _preflight.get("background_for_recognition"):
                payload["background_for_recognition"] = _preflight["background_for_recognition"]
        return "audio", payload

    if item.type not in (ItemType.VIDEO.value,):
        raise HTTPException(
            status_code=501,
            detail=f"暂不支持触发 {item.type} 分支的分析",
        )

    if item.source == "url":
        # Track K: 视频 URL 重新触发也统一走 note task。
        # 旧 download -> success callback -> analyze 链会产生第二个任务；
        # note task 内部自行执行 download/transcribe/analyze/note。
        payload: Dict[str, Any] = {
            "url": item.source_value,
            "workspace_id": workspace.workspace_id,
            # #19: 供 ProcessingPage 动态步骤矩阵
            "source_type": "link",
            "kind_hint": item.type,  # "video"|"audio"|"image"|"text"
        }
        # TODO: quality 等高级参数目前 _resolve_download_kwargs 不消费，
        # 等 download handler 支持 format_selector 映射后再启用。
        bg = item.preflight.background_overrides or {}
        for k in ("quality", "frame_mode", "frame_interval_sec", "max_frames", "enabled_steps", "prompt_style"):
            if k in bg:
                payload[k] = bg[k]
        # R21.P3.S1: 透传 preflight 新字段（intent / background_for_recognition）
        # 优先读 item.preflight.intent（前端 savePreflight 存在顶层），
        # 兜底读 tasks.preflight.intent（旧路径兼容）。
        tasks = item.preflight.tasks or {}
        _preflight = tasks.get("preflight")
        if isinstance(_preflight, dict):
            if _preflight.get("intent"):
                payload["intent"] = _preflight["intent"]
            if _preflight.get("background_for_recognition"):
                payload["background_for_recognition"] = _preflight["background_for_recognition"]
        if "intent" not in payload and item.preflight.intent:
            payload["intent"] = item.preflight.intent
        # R3.11: 透传嵌图配置（embed_frames / max_embed_frames）
        # 前端存 tasks.summary.embed_frames / tasks.summary.max_embed_frames
        _summary_cfg = tasks.get("summary")
        _pf: Dict[str, Any] = payload.get("preflight") or {}
        if isinstance(_summary_cfg, dict):
            if "embed_frames" in _summary_cfg:
                _pf["embed_frames"] = _summary_cfg["embed_frames"]
            if "max_embed_frames" in _summary_cfg:
                _pf["max_embed_frames"] = _summary_cfg["max_embed_frames"]
            if _summary_cfg.get("summary_template"):
                payload["summary_template"] = _summary_cfg["summary_template"]
            if _summary_cfg.get("summary_mode"):
                payload["summary_mode"] = _summary_cfg["summary_mode"]
            if "diarize" in _summary_cfg:
                payload["diarize"] = _summary_cfg["diarize"]
            if _summary_cfg.get("speaker_count") is not None:
                payload["speaker_count"] = _summary_cfg["speaker_count"]
        if bg.get("frame_interval_sec") is not None:
            _pf["frame_prompt"] = {
                "mode": "interval",
                "interval_sec": bg["frame_interval_sec"],
            }
        if _pf:
            payload["preflight"] = _pf
        return "note", payload

    # local：走 note pipeline（视频已在本地，note handler 跳过下载）— Bug #2 修复
    _local_fname = item.source_value.split("/")[-1]
    payload: Dict[str, Any] = {
        "url": item.source_value,          # 满足 handle_note_task 的 url 非空校验；本地分支不用它下载
        "source_type": "local",
        "kind_hint": item.type,            # #19: 供 ProcessingPage 动态步骤矩阵
        "video_basenames": [_local_fname or item.name],
        "workspace_id": workspace.workspace_id,
    }
    # 复用上方 url 分支同款 preflight 透传（保持一致）
    bg = item.preflight.background_overrides or {}
    for k in ("quality", "frame_mode", "frame_interval_sec", "max_frames", "enabled_steps", "prompt_style"):
        if k in bg:
            payload[k] = bg[k]
    tasks = item.preflight.tasks or {}
    _preflight = tasks.get("preflight")
    if isinstance(_preflight, dict):
        if _preflight.get("intent"):
            payload["intent"] = _preflight["intent"]
        if _preflight.get("background_for_recognition"):
            payload["background_for_recognition"] = _preflight["background_for_recognition"]
    if "intent" not in payload and item.preflight.intent:
        payload["intent"] = item.preflight.intent
    _summary_cfg = tasks.get("summary")
    _pf: Dict[str, Any] = payload.get("preflight") or {}
    if isinstance(_summary_cfg, dict):
        if "embed_frames" in _summary_cfg:
            _pf["embed_frames"] = _summary_cfg["embed_frames"]
        if "max_embed_frames" in _summary_cfg:
            _pf["max_embed_frames"] = _summary_cfg["max_embed_frames"]
        if _summary_cfg.get("summary_template"):
            payload["summary_template"] = _summary_cfg["summary_template"]
        if _summary_cfg.get("summary_mode"):
            payload["summary_mode"] = _summary_cfg["summary_mode"]
        if "diarize" in _summary_cfg:
            payload["diarize"] = _summary_cfg["diarize"]
        if _summary_cfg.get("speaker_count") is not None:
            payload["speaker_count"] = _summary_cfg["speaker_count"]
    if bg.get("frame_interval_sec") is not None:
        _pf["frame_prompt"] = {
            "mode": "interval",
            "interval_sec": bg["frame_interval_sec"],
        }
    if _pf:
        payload["preflight"] = _pf
    models = item.preflight.models or {}
    if models.get("vision"):
        payload["vision_model"] = models["vision"]
    if models.get("text"):
        payload["text_model"] = models["text"]
    return "note", payload


@router.post("/{workspace_id}/items/{item_id}/start")
def start_item_pipeline(workspace_id: str, item_id: str) -> Dict[str, Any]:
    """根据已保存的 preflight 触发对应的 pipeline 任务。

    动作：
      1. 校验 workspace + item 存在
      2. 翻译 item + preflight → pipeline (task_type, payload)
      3. 调 _pipeline_runner.create_task 创建任务
      4. 写 task_id 回 item.related_task_ids，状态置 processing
      5. 返回更新后的 workspace + 新建 task_id
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    # N1.4 移除 WorkspaceRecord.project_id 后，统一用 default_project 兜底。
    # N1b 磁盘布局已迁移至 data/workspaces/<id>/。
    project_id = "default_project"

    task_type, payload = _bridge_to_pipeline_payload(item, rec)

    try:
        task_rec = _pipeline_runner.create_task(project_id, task_type, payload)
    except ValueError as err:
        # 例如「同 URL 已有正在执行的下载任务」
        raise HTTPException(status_code=409, detail=str(err)) from err

    # 写回 item：追加 task_id + 状态 processing
    new_task_ids = list(item.related_task_ids) + [task_rec.task_id]
    rec = _store.update_item(
        workspace_id,
        item_id,
        related_task_ids=new_task_ids,
        status=ItemStatus.PROCESSING.value,
    )

    return {
        "workspace": rec.to_dict(),
        "task_id": task_rec.task_id,
        "task_type": task_type,
    }


# ── NI.1: 「生成笔记」统一入口 ────────────────────────────────

_SNIFF_TO_ITEM_TYPE: Dict[str, str] = {
    "video": ItemType.VIDEO.value,
    "audio": ItemType.AUDIO.value,
    "image": ItemType.IMAGE.value,
    "text": ItemType.TEXT.value,
}

# 图文平台：sniff_url 报 "text" 但实际含图，应落为 image 类型
_IMAGE_TEXT_PLATFORMS: frozenset = frozenset({"xiaohongshu", "twitter"})


@router.post("/{workspace_id}/items/generate-note")
def generate_note(workspace_id: str, req: GenerateNoteRequest) -> Dict[str, Any]:
    """NI.1: 粘贴链接 → 自动识别类型 → 创建 item + note task → 关联。

    流程：sniff_url 推断 type → 创建 workspace item → 创建 note task
    → 写回 item.related_task_ids。
    """
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url 不能为空")

    # NI.1: 复用现有 URL 校验（scheme/netloc 检查 + 规整）
    url = _validate_network_url(url)

    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")

    # 1. 嗅探 URL 类型 → 映射 ItemType（图文平台且 primary_type=text 时 override 为 image）
    try:
        sniff = sniff_url(url)
        if sniff.platform in _IMAGE_TEXT_PLATFORMS and sniff.primary_type == "text":
            item_type = ItemType.IMAGE.value
        else:
            item_type = _SNIFF_TO_ITEM_TYPE.get(sniff.primary_type, ItemType.TEXT.value)
    except Exception:
        item_type = ItemType.TEXT.value

    # 2. 创建 workspace item
    item = WorkspaceItem(
        item_id=str(uuid.uuid4()),
        type=item_type,
        source="url",
        source_value=url,
        name=(req.name.strip() or _derive_item_name(url)),
    )
    try:
        rec = _store.add_item(workspace_id, item)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err

    # 2.1 将 intent 写入 item preflight（复刻页 / get_item_result 依赖此字段）
    _intent = req.intent or "note"
    item.preflight = PreflightConfig(intent=_intent)
    _store.update_item(workspace_id, item.item_id, preflight=item.preflight)

    # 3. 创建 note task（复用 handle_note_task 统一流程）
    #    注入 LLM 配置（从 provider store 获取活跃 chat provider 的 key + model）
    _task_payload: dict = {
        "url": url,
        "workspace_id": workspace_id,
        "item_id": item.item_id,
    }
    # R3.16: 透传嵌图开关 → note task；embed_frames=False 时 standard 总结不配图。
    # max_embed_frames 不传，由 summary_generator 按候选数自适应封顶（智能按需）。
    _task_payload["preflight"] = {
        "embed_frames": req.embed_frames,
        "image_mode": req.image_mode,
        "frame_prompt": {
            "mode": "interval",
            "interval_sec": req.frame_interval
        },
        "intent": req.intent or "note",
    }
    # R4.7: 透传用户选择的视觉模型（空=用系统默认）
    if req.vision_model.strip():
        _task_payload["vision_model"] = req.vision_model.strip()
    # 意图分流：记录用户选择的任务意图和笔记子类型
    _task_payload["intent"] = req.intent or "note"
    _task_payload["note_media_kind"] = req.note_media_kind or "auto"
    # #19: 写入 source_type + kind_hint，ProcessingPage 动态步骤矩阵需要
    _task_payload["source_type"] = "link"
    _task_payload["kind_hint"] = sniff.primary_type  # "video"|"audio"|"image"|"text"
    # VN2: 透传笔记风格/发言人区分/用户补充说明（VN5 前后端联调时消费）
    _task_payload["summary_template"] = req.summary_template
    _task_payload["diarize"] = req.diarize
    _task_payload["summary_mode"] = req.summary_mode
    if req.speaker_count is not None:
        _task_payload["speaker_count"] = req.speaker_count
    if req.user_notes.strip():
        _task_payload["user_notes"] = req.user_notes.strip()
    try:
        _s = load_settings()
        for _p in _s.providers:
            if not _p.enabled or not _p.api_key.strip():
                continue
            if "chat" in _p.capabilities:
                _task_payload["api_key"] = _p.api_key
                if hasattr(_p, "default_models") and _p.default_models:
                    _task_payload["text_model"] = _p.default_models.get("chat", "")
                break
    except Exception:
        pass  # provider 配置缺失不影响 note 任务创建

    try:
        task_rec = _pipeline_runner.create_task(
            "default_project",
            "note",
            _task_payload,
        )
    except ValueError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err

    # 4. 关联 task → item（写回 related_task_ids + 状态 processing）
    new_ids = list(item.related_task_ids) + [task_rec.task_id]
    rec = _store.update_item(
        workspace_id,
        item.item_id,
        related_task_ids=new_ids,
        status=ItemStatus.PROCESSING.value,
    )

    return {
        "workspace": rec.to_dict(),
        "task_id": task_rec.task_id,
        "task_type": "note",
        "item_type": item_type,
        "item_id": item.item_id,
    }


# ── Phase 1G: 视频结果页聚合接口 ───────────────────────


def _video_result_has_real_data(results: Dict[str, Any]) -> bool:
    """判断 item.results 里是否已经有可用的数据。

    四种路径的真数据判定：
    1. subtitle：summary_path='subtitle' 且 summary 或 transcript 非空
    2. visual_only：frames 非空 list（无需 transcript）
    3. av_combined：frames 非空 list + (transcript 非空 list 或 summary 非空)
    4. 默认（detailed / VLM）：frames list + transcript list 都存在
    """
    if not isinstance(results, dict):
        return False
    summary_path = results.get("summary_path", "")
    # N7b 路径 1：字幕直接总结
    if summary_path == "subtitle":
        transcript = results.get("transcript")
        has_transcript = (
            bool(transcript.strip()) if isinstance(transcript, str) else bool(transcript)
        )
        return bool(results.get("summary") or has_transcript)
    # visual_only：只看画面，只需 frames
    if summary_path == "visual_only":
        frames = results.get("frames")
        return bool(frames) and isinstance(frames, list) and len(frames) > 0
    # av_combined：音视频综合，需要 frames + (transcript 或 summary)
    if summary_path == "av_combined":
        frames = results.get("frames")
        transcript = results.get("transcript")
        has_frames = bool(frames) and isinstance(frames, list) and len(frames) > 0
        has_transcript = isinstance(transcript, list) and len(transcript) > 0
        return has_frames and (has_transcript or bool(results.get("summary")))
    # 默认路径（detailed / VLM）：帧分析 + 转写
    frames = results.get("frames")
    transcript = results.get("transcript")
    return bool(frames) and isinstance(frames, list) and isinstance(transcript, list)


def _parse_ts_to_sec(ts: str) -> float:
    """把 'MM:SS' 或 'HH:MM:SS' 或纯数字字符串转成秒数。"""
    parts = ts.strip().split(":")
    try:
        if len(parts) == 1:
            return float(parts[0])
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except (ValueError, IndexError):
        pass
    return 0.0


def _locate_analyze_report_dir(
    json_outputs: list,
    preferred_basenames: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """从 json_outputs 定位「分析报告」目录。

    返回 {"report_dir": Path, "json_stem": str, "target_path": Path} 或 None。
    """
    from pathlib import Path as _Path

    candidates = list(json_outputs)
    if preferred_basenames:
        def _norm(s: str) -> str:
            return s.replace("-", "_").replace(".", "_")
        stems = [_norm(_Path(b).stem) for b in preferred_basenames if b]
        matched = [p for p in candidates if any(stem and stem in _norm(p) for stem in stems)]
        if matched:
            candidates = matched

    target_path = None
    for p in candidates:
        if _Path(p).exists():
            target_path = p
            break
    if not target_path:
        return None

    json_stem = _Path(target_path).stem.replace("_视觉数据", "")
    parent_dir = _Path(target_path).parent

    for candidate_dir in [
        parent_dir / f"{json_stem}_分析报告",
        parent_dir.parent / "videos" / f"{json_stem}_分析报告",
    ]:
        if candidate_dir.is_dir():
            return {"report_dir": candidate_dir, "json_stem": json_stem, "target_path": target_path}

    # 有些旧产物：分析报告目录就是 parent_dir 本身（frames 在同级）
    if (parent_dir / "frames").is_dir():
        return {"report_dir": parent_dir, "json_stem": json_stem, "target_path": target_path}

    return None


def _is_target_frame_format(frames: list) -> bool:
    """检查 frames 是否已经是目标格式（包含 image_path, sec, ts 等字段）。
    只检查第一帧，因为所有帧应该格式一致。
    """
    if not frames:
        return False
    first = frames[0]
    # 目标格式必须包含这些字段
    required_fields = ("image_path", "sec", "ts")
    return all(field in first for field in required_fields)


def _convert_absolute_to_static_url(abs_path: str, data_root: Path) -> str:
    """把绝对路径转成前端可用的 /static/... URL。"""
    if not abs_path or abs_path.startswith("/static/"):
        return abs_path
    try:
        from pathlib import Path as _Path
        p = _Path(abs_path).resolve()
        rel = str(p.relative_to(data_root)).replace("\\", "/")
        # quote 编码 # 空格等特殊字符（safe='/' 保留分隔符）；否则文件名含 #
        # 时浏览器会把 # 当 fragment 截断请求 → static 404（抖音/小红书标题带 hashtag 高频命中）
        return "/static/" + quote(rel)
    except (ValueError, OSError):
        return abs_path


def _materialize_video_results_from_analyze(
    results: Dict[str, Any],
    preferred_basenames: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """把 analyze task 产出的 json_outputs 文件转成 frames+transcript 结构。

    analyze 任务 result 形如：
        {"json_outputs": ["/path/to/xxx_视觉数据.json", ...]}
    json 文件里有 frames[{timestamp, description_zh, ...}] 和 global_visual_summary。

    当 preferred_basenames 给出（来自 analyze task.payload.video_basenames）时，
    优先选 path 名里包含其中任一 basename 词干的文件；防止 analyze 批处理
    project 下多视频时 result 含多份 json_outputs，端点拿错文件。
    """
    if not isinstance(results, dict):
        return results
    # C-0 fix: 只有 frames 已具备目标字段（image_path, sec, ts）才可以提前返回
    if results.get("frames") and _is_target_frame_format(results["frames"]):
        return results  # 已是目标格式
    # N7b 路径 1：字幕直接总结结果，无需从 JSON 文件物化
    if results.get("summary_path") == "subtitle":
        results.setdefault("frames", [])
        results.setdefault("transcript", results.get("transcript") or [])
        return results
    # visual_only：只看画面，transcript 始终为空
    if results.get("summary_path") == "visual_only":
        results.setdefault("frames", [])
        results.setdefault("transcript", [])
    json_outputs = results.get("json_outputs") or []
    if not json_outputs:
        return results
    import json as _json
    from pathlib import Path as _Path

    located = _locate_analyze_report_dir(json_outputs, preferred_basenames)
    if not located:
        return results
    target_path = located["target_path"]
    json_stem = located["json_stem"]
    report_dir = located["report_dir"]

    try:
        with open(target_path, "r", encoding="utf-8") as f:
            visual = _json.load(f)
    except Exception:
        return results
    raw_frames = visual.get("frames") or []

    data_root = _ROOT_DIR / "data"
    frames_dir = report_dir / "frames" if (report_dir / "frames").is_dir() else None

    # C-0: 支持合并 raw frames（来自 results.frames）和视觉 JSON frames
    # raw frames 可能只有 frame_image/frame_image_path，需要与视觉 JSON 按顺序合并
    existing_raw_frames = results.get("frames") or []

    frames = []
    for idx, fr in enumerate(raw_frames):
        # C-0: 优先用 raw frame 的真实图片路径（如果存在且有效）
        img_path = ""
        if idx < len(existing_raw_frames):
            raw_img = existing_raw_frames[idx].get("frame_image_path") or existing_raw_frames[idx].get("frame_image") or ""
            if raw_img:
                # 把绝对路径转成 /static/... URL
                img_path = _convert_absolute_to_static_url(raw_img, data_root)
        # 如果 raw frame 没有图片路径，尝试从视觉 JSON 获取
        if not img_path:
            img_path = fr.get("frame_image_path") or fr.get("image_path") or ""
        # C-0.1: 先解析 timestamp 为 sec，用于后续拼文件名
        raw_ts = fr.get("timestamp", "")
        if isinstance(raw_ts, (int, float)):
            sec_val = float(raw_ts)
        elif isinstance(raw_ts, str) and raw_ts.strip():
            sec_val = _parse_ts_to_sec(raw_ts.strip())
        else:
            sec_val = float(idx)  # fallback: 帧序号当秒数
        # C-0.1 fix: 用 sec_val（来自 timestamp）拼文件名，不用 idx
        if not img_path and frames_dir:
            # 命名规则：{basename}_{HH}_{MM}_{SS}.jpg（timestamp 秒数转时分秒）
            total_sec = int(sec_val)
            h = total_sec // 3600
            m = (total_sec % 3600) // 60
            s = total_sec % 60
            fname = f"{json_stem}_{h:02d}_{m:02d}_{s:02d}.jpg"
            candidate = (frames_dir / fname).resolve()
            if candidate.exists():
                try:
                    img_path = "/static/" + str(candidate.relative_to(data_root)).replace("\\", "/")
                except ValueError:
                    img_path = ""
        frames.append({
            "idx": idx,
            "sec": sec_val,
            "ts": raw_ts if isinstance(raw_ts, str) else str(raw_ts),
            "frame_index": idx,
            "timestamp": raw_ts,
            "description": fr.get("description_zh") or fr.get("description") or "",
            "frame_image_path": img_path,
            "image_path": img_path,
            # 兼容前端 VideoResultFrame 的可选字段
            "shot_type": fr.get("shot_type", ""),
            "title": fr.get("title", ""),
            "subtitle": fr.get("subtitle", ""),
            "tags": fr.get("tags", {}),
        })
    return {
        **results,
        "frames": frames,
        "transcript": results.get("transcript") or [],
        # N7b: LLM 字幕总结优先于视觉全局摘要
        "summary": results.get("summary") or visual.get("global_visual_summary", ""),
        "video_title": visual.get("video_title", ""),
    }


@router.get("/{workspace_id}/items/{item_id}/result")
def get_item_result(workspace_id: str, item_id: str) -> Dict[str, Any]:
    """视频结果页聚合数据（v1.1 §5.3 三轨时间轴所需）。

    优先返回 item.results 里的真数据；当 results 尚未由分析管线填充时，
    退化到 video_result_demo.build_demo_video_result，保证前端三轨可见。
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    if item.type != ItemType.VIDEO.value:
        raise HTTPException(
            status_code=400,
            detail=f"item type {item.type!r} has no video result (only 'video' supported in Phase 1G)",
        )

    # R18.1.2: 任务已失败时直接返回 task_failed，不回落 demo
    failed = _task_failed_response(item)
    if failed is not None:
        return failed

    # X.1 bridge: check task results overlay so video_result sees real data
    v_overlay = _sync_item_with_tasks(item)
    v_results = dict(v_overlay.get("results", {})) if v_overlay and v_overlay.get("results") else dict(item.results or {})

    # 找最近一条 SUCCESS analyze task，用它的 payload.video_basenames 给 _materialize 提示
    preferred_basenames: List[str] = []
    for tid in reversed(item.related_task_ids):
        task = _pipeline_runner.store.get(tid)
        if task is None or task.task_type != "analyze" or task.status != TaskStatus.SUCCESS.value:
            continue
        preferred_basenames = list(task.payload.get("video_basenames") or [])
        if preferred_basenames:
            break
    v_results = _materialize_video_results_from_analyze(v_results, preferred_basenames=preferred_basenames)

    # C-5: 合并用户帧标题改名 overrides
    _title_overrides = (item.results or {}).get("frame_title_overrides", {})
    if _title_overrides and v_results.get("frames"):
        for _idx_str, _new_title in _title_overrides.items():
            _idx = int(_idx_str)
            if 0 <= _idx < len(v_results["frames"]):
                v_results["frames"][_idx]["title"] = _new_title

    # 规范化 transcript 为数组（前端 VideoResult.transcript 期望 array）
    # 优先从 transcript_segments 构建（含 edited_text 优先 + 时间码），
    # 兜底从 transcript 字段（字符串或数组）。
    _segments = v_results.get("transcript_segments") or []
    if _segments:
        v_results["transcript"] = normalize_transcript(_segments)
    else:
        raw_transcript = v_results.get("transcript")
        if isinstance(raw_transcript, str):
            v_results["transcript"] = (
                [{"t_sec": 0, "t_str": "00:00", "text": raw_transcript.strip()}]
                if raw_transcript.strip()
                else []
            )
        elif isinstance(raw_transcript, list) and raw_transcript:
            # list of dicts（可能是 start/end/text 或 t_sec/t_str/text）
            v_results["transcript"] = normalize_transcript(raw_transcript)
        elif not isinstance(raw_transcript, list):
            v_results["transcript"] = []
    # visual_only：确保 transcript 为空数组，frames 从 json_outputs 物化
    if v_results.get("summary_path") == "visual_only":
        v_results.setdefault("transcript", [])
        v_results.setdefault("frames", [])

    if _video_result_has_real_data(v_results):
        payload = v_results
        payload.setdefault("source", "item_results")
        duration = float(payload.get("duration_sec") or 0)

        # 解析 video URL：优先本地 /static 路径，兜底源 URL（仿 audio 模式）
        _video_url = ""
        _source_url = item.source_value if item.source == "url" else ""
        # 尝试从 workspace/videos/ 目录找本地视频文件
        _videos_dir = _ROOT_DIR / "data" / "workspaces" / workspace_id / "videos"
        if _videos_dir.is_dir():
            _video_files = sorted(_videos_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
            if _video_files:
                _rel = _video_files[0].relative_to(_ROOT_DIR / "data").as_posix()
                _video_url = f"/static/{_rel}"
        # 降级：去 analyze 产物目录找 mp4（default_project/videos/）
        if not _video_url:
            _json_outputs = v_results.get("json_outputs") or []
            if _json_outputs:
                _located = _locate_analyze_report_dir(_json_outputs, preferred_basenames)
                if _located:
                    _report_parent = _located["report_dir"].parent
                    _json_stem = _located["json_stem"]
                    # 提取 BVid 用于匹配 mp4 文件名
                    import re as _re
                    _bvid_match = _re.search(r'(BV[A-Za-z0-9]+)', _json_stem)
                    if _bvid_match:
                        _bvid = _bvid_match.group(1)
                        for _mp4 in _report_parent.glob("*.mp4"):
                            if _bvid in _mp4.name:
                                _rel = _mp4.relative_to(_ROOT_DIR / "data").as_posix()
                                _video_url = f"/static/{_rel}"
                                break
        # 优先本地 URL；没有则用源 URL
        _final_video_url = _video_url or _source_url

        payload.setdefault(
            "video",
            {
                "item_id": item.item_id,
                "title": item.name,
                "url": _final_video_url,
                "source_url": _source_url,
                "duration_sec": duration,
                "duration_str": "",
            },
        )
        payload.setdefault(
            "tracks_meta",
            {
                "total_sec": duration,
                "frame_count": len(payload.get("frames", [])),
                "transcript_count": len(payload.get("transcript", [])),
            },
        )
        payload.setdefault("intent", item.preflight.intent)
        return payload

    demo_res = build_demo_video_result(item.item_id, item.name)
    demo_res["is_demo"] = True
    demo_res["intent"] = item.preflight.intent if item.preflight else None
    return demo_res


# ── Phase 1H: 图片结果页接口 ───────────────────────────────


def _build_demo_image_result(item_id: str, item_name: str) -> Dict[str, Any]:
    """图片结果页 demo fixture（Phase 1H）。

    当 item.results 尚未填充时返回固定示例，保证前端左图右信息可跑通。
    数据对齐 v1.1 §7.4 图片结果页布局（视觉理解：描述/OCR/标签/EXIF）。
    """
    return {
        "source": "demo_fixture",
        "image": {
            "item_id": item_id,
            "title": item_name,
            "image_url": "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200",
        },
        "description": "壮丽的山脉倒映在平静的湖面上，前景是翠绿的草地，天空呈现金色日落。画面构图采用三分法，前景草地、中景湖泊、远景山脉层次分明。",
        "ocr_text": "",
        "exif": {
            "device": "Canon EOS R5",
            "lens": "RF 24-70mm f/2.8 L IS USM",
            "time": "2024-08-15 18:32:05",
            "aperture": "f/8.0",
            "shutter": "1/250s",
            "iso": "ISO 100",
            "gps": {"lat": 46.6863, "lon": 7.8632},
        },
        "dimensions": {
            "width": 6000,
            "height": 4000,
            "format": "JPEG",
            "size_kb": 8520.3,
        },
        "tags": {
            "subject": ["山脉", "湖泊", "草地"],
            "scene": ["瑞士", "因特拉肯", "阿尔卑斯"],
            "style": ["风光摄影", "写实"],
            "lighting": ["金色时刻", "逆光"],
            "color": ["金色", "翠绿", "深蓝"],
            "composition": ["三分法", "对称倒影"],
            "lens": ["广角", "f/8"],
        },
    }


@router.get("/{workspace_id}/items/{item_id}/image_result")
def get_image_result(workspace_id: str, item_id: str) -> Dict[str, Any]:
    """图片结果页聚合数据（v1.1 §7.4）。

    优先返回 item.results 里的真数据；当 results 尚未填充时，
    退化到 demo fixture，保证前端左图右信息可跑通。
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    if item.type != ItemType.IMAGE.value:
        raise HTTPException(
            status_code=400,
            detail=f"item type {item.type!r} has no image result (only 'image' supported in Phase 1H)",
        )

    # R18.1.2: 任务已失败时直接返回 task_failed，不回落 demo
    failed = _task_failed_response(item)
    if failed is not None:
        return failed

    # X.1 bridge: merge task results overlay so image_result sees real data
    overlay = _sync_item_with_tasks(item)
    results = dict(overlay.get("results", {})) if overlay and overlay.get("results") else dict(item.results or {})
    has_real = isinstance(results, dict) and (
        results.get("description") or results.get("ocr_text") or results.get("tags")
    )
    if has_real:
        payload = dict(results)
        payload.setdefault("source", "item_results")
        payload.setdefault(
            "image",
            {
                "item_id": item.item_id,
                "title": item.name,
                "image_url": item.source_value if item.source == "url" else "",
            },
        )
        return payload

    return _build_demo_image_result(item.item_id, item.name)


@router.get("/{workspace_id}/items/{item_id}/image_compare")
def get_image_compare(
    workspace_id: str,
    item_id: str,
    item_ids: Optional[str] = None,
) -> Dict[str, Any]:
    """多图对比（N9）。

    收集同工作空间内所有已完成分析的图片素材结果，
    与当前图片进行结构化对比（标签 / 描述 / 联想）。
    如果 VLM 可用，还会生成一段总结性对比分析。

    可选查询参数 item_ids（逗号分隔）：只对比指定素材。
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    if item.type != ItemType.IMAGE.value:
        raise HTTPException(status_code=400, detail="image_compare 仅支持 image 类型素材")

    # 收集同 workspace 内所有已完成的 image 素材的结果
    allowed_ids = set(item_ids.split(",")) if item_ids else None
    image_items = [
        it for it in rec.items
        if it.type == ItemType.IMAGE.value and (allowed_ids is None or it.item_id in allowed_ids)
    ]
    collected: List[Dict[str, Any]] = []
    for it in image_items:
        overlay = _sync_item_with_tasks(it)
        results = dict(overlay.get("results", {})) if overlay and overlay.get("results") else dict(it.results or {})
        has_real = isinstance(results, dict) and results.get("description")
        collected.append({
            "item_id": it.item_id,
            "name": it.name,
            "is_current": it.item_id == item_id,
            "source_value": it.source_value,
            "description": results.get("description", ""),
            "ocr_text": results.get("ocr_text", ""),
            "tags": results.get("tags", {}),
            "associations": results.get("associations", {}),
            "has_result": has_real,
        })

    # 尝试 VLM 总结对比（best-effort）
    vlm_summary = ""
    items_with_results = [c for c in collected if c["has_result"]]
    if len(items_with_results) >= 2:
        try:
            from shared.settings_store import load_settings as _load_s
            from shared.provider_registry import create_default_registry as _cdr
            from shared.provider_base import ChatRequest as _CR

            _s = _load_s()
            _api_key = (_s.openai_api_key or "").strip()
            if _api_key:
                _reg = _cdr()
                _prof = _reg.resolve_default_profile(_s, "vision")
                _prov = _reg.build(_prof)
                _model = _prof.default_models.get("vision") or (_s.vision_model or "").strip()
                if _model:
                    # 构造对比 prompt
                    summaries = []
                    for idx, c in enumerate(items_with_results, 1):
                        tag_str = ", ".join(
                            v for vals in c["tags"].values() for v in vals
                        ) if c["tags"] else "无"
                        summaries.append(
                            f"图片{idx}「{c['name']}」：{c['description'][:200]}。标签：{tag_str}"
                        )
                    compare_prompt = (
                        f"以下是{len(items_with_results)}张图片的分析结果，请做对比总结：\n\n"
                        + "\n\n".join(summaries)
                        + "\n\n请从以下维度对比：\n"
                        "1. 内容主题差异\n2. 风格/色调对比\n3. 各自优势和适用场景\n"
                        "4. 如果要选一张做代表，选哪张？为什么？\n"
                        "用中文回答，300-500字。"
                    )
                    vlm_summary = _prov.chat(_CR(
                        model=_model,
                        messages=[{"role": "user", "content": compare_prompt}],
                        temperature=0.4,
                        max_tokens=1200,
                    )).strip()
        except Exception:
            pass  # VLM 对比是锦上添花，失败不影响结构化数据返回

    return {
        "workspace_id": workspace_id,
        "current_item_id": item_id,
        "images": collected,
        "vlm_summary": vlm_summary,
    }


# ── 多文对比（N10）────────────────────────────────────────────


@router.get("/{workspace_id}/items/{item_id}/text_compare")
def get_text_compare(
    workspace_id: str,
    item_id: str,
    item_ids: Optional[str] = None,
) -> Dict[str, Any]:
    """多文对比（N10）。

    收集同工作空间内所有已完成分析的文字素材结果，
    与当前文字进行结构化对比（摘要 / 要点 / 联想归纳）。
    如果 LLM 可用，还会生成一段总结性对比分析。

    可选查询参数 item_ids（逗号分隔）：只对比指定素材。
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    if item.type != ItemType.TEXT.value:
        raise HTTPException(status_code=400, detail="text_compare 仅支持 text 类型素材")

    # 收集同 workspace 内所有已完成的 text 素材的结果
    allowed_ids = set(item_ids.split(",")) if item_ids else None
    text_items = [
        it for it in rec.items
        if it.type == ItemType.TEXT.value and (allowed_ids is None or it.item_id in allowed_ids)
    ]
    collected: List[Dict[str, Any]] = []
    for it in text_items:
        overlay = _sync_item_with_tasks(it)
        results = dict(overlay.get("results", {})) if overlay and overlay.get("results") else dict(it.results or {})
        has_real = isinstance(results, dict) and results.get("summary")
        collected.append({
            "item_id": it.item_id,
            "name": it.name,
            "is_current": it.item_id == item_id,
            "source_value": it.source_value,
            "summary": results.get("summary", ""),
            "content_preview": (results.get("content", "") or "")[:500],
            "associations": results.get("associations", {}),
            "rewrites": results.get("rewrites", {}),
            "translations": results.get("translations", {}),
            "char_count": results.get("char_count", 0),
            "has_result": has_real,
        })

    # 尝试 LLM 对比总结（best-effort）
    llm_summary = ""
    items_with_results = [c for c in collected if c["has_result"]]
    if len(items_with_results) >= 2:
        try:
            from shared.settings_store import load_settings as _load_s
            from shared.provider_registry import create_default_registry as _cdr
            from shared.provider_base import ChatRequest as _CR

            _s = _load_s()
            _api_key = (_s.openai_api_key or "").strip()
            if _api_key:
                _reg = _cdr()
                _prof = _reg.resolve_default_profile(_s, "chat")
                _prov = _reg.build(_prof)
                _model = _prof.default_models.get("chat") or (_s.text_model or "").strip()
                if _model:
                    summaries = []
                    for idx, c in enumerate(items_with_results, 1):
                        assoc_str = "; ".join(
                            f"{k}: {v[:80]}" for k, v in (c["associations"] or {}).items()
                        ) if c["associations"] else "无"
                        summaries.append(
                            f"文本{idx}「{c['name']}」（{c['char_count']}字）：{c['summary'][:200]}。联想：{assoc_str}"
                        )
                    compare_prompt = (
                        f"以下是{len(items_with_results)}篇文本的分析结果，请做对比总结：\n\n"
                        + "\n\n".join(summaries)
                        + "\n\n请从以下维度对比：\n"
                        "1. 观点异同\n2. 立场倾向\n3. 信息完整性\n4. 时间线梳理（若适用）\n"
                        "用中文回答，300-500字。"
                    )
                    llm_summary = _prov.chat(_CR(
                        model=_model,
                        messages=[{"role": "user", "content": compare_prompt}],
                        temperature=0.4,
                        max_tokens=1200,
                    )).strip()
        except Exception:
            pass  # LLM 对比是锦上添花，失败不影响结构化数据返回

    return {
        "workspace_id": workspace_id,
        "current_item_id": item_id,
        "texts": collected,
        "llm_summary": llm_summary,
    }


# ── 音频结果页（Phase 2B） ────────────────────────────────────


@router.get("/{workspace_id}/items/{item_id}/audio_result")
def get_audio_result(workspace_id: str, item_id: str) -> Dict[str, Any]:
    """音频结果页聚合数据（Phase 2B）。

    优先返回 item.results 里的真数据；当 results 尚未填充时，
    退化到 demo fixture，保证前端音频播放器 + transcript 列表可跑通。
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    if item.type != ItemType.AUDIO.value:
        raise HTTPException(
            status_code=400,
            detail=f"item type {item.type!r} has no audio result (only 'audio' supported)",
        )

    # R18.1.2: 任务已失败时直接返回 task_failed，不回落 demo
    failed = _task_failed_response(item)
    if failed is not None:
        return failed

    # X.1 bridge: overlay task results so audio_result sees real data
    a_overlay = _sync_item_with_tasks(item)
    results = dict(a_overlay.get("results", {})) if a_overlay and a_overlay.get("results") else dict(item.results or {})
    has_real = isinstance(results, dict) and (
        results.get("transcript") or results.get("transcript_segments")
    )
    if has_real:
        payload = dict(results)
        payload.setdefault("source", "item_results")
        audio_payload = dict(payload.get("audio") or {})
        if not audio_payload.get("title"):
            filename_title = Path(str(audio_payload.get("filename") or "")).stem
            audio_payload["title"] = (
                str(results.get("video_title") or "").strip()
                or filename_title
                or item.name
            )
        audio_payload.setdefault("item_id", item.item_id)
        # url 字段：优先返回本地音频文件的 /static URL（浏览器可播）；
        # 找不到再 fallback 到源 URL（如 B 站网页链接，仅用于"打开来源"按钮，不能给 <audio src>）
        _filename = str(audio_payload.get("filename") or "").strip()
        _local_url = ""
        if _filename:
            _candidates = [
                _ROOT_DIR / "data" / "workspaces" / workspace_id / "audio" / _filename,
                _ROOT_DIR / "data" / "workspaces" / "default_project" / "audio" / _filename,
                _ROOT_DIR / "data" / "workspaces" / workspace_id / _filename,
                _ROOT_DIR / "data" / "workspaces" / "default_project" / _filename,
            ]
            for _p in _candidates:
                if _p.exists():
                    _rel = _p.relative_to(_ROOT_DIR / "data").as_posix()
                    _local_url = f"/static/{_rel}"
                    break
        # 注意：audio_payload 里可能已有 url（pipeline 写入的源 URL），不能用 setdefault
        # 必须强制覆盖：能播放的本地 URL 优先；同时把源 URL 留到 source_url 字段
        _existing_url = str(audio_payload.get("url") or "")
        _source_url = (
            item.source_value if item.source == "url"
            else _existing_url  # 兜底：若已有 url 字段就当源 URL 保留
        )
        audio_payload["url"] = _local_url or _source_url
        audio_payload.setdefault("source_url", _source_url)  # 保留源链接给"打开来源"按钮用
        audio_payload.setdefault("duration_sec", results.get("tracks_meta", {}).get("total_sec", 0))
        audio_payload.setdefault("duration_str", "")
        payload["audio"] = audio_payload
        payload.setdefault(
            "tracks_meta",
            {
                "total_sec": results.get("tracks_meta", {}).get("total_sec", 0),
                "transcript_count": len(results.get("transcript") or results.get("transcript_segments") or []),
            },
        )
        return payload

    return build_demo_audio_result(item.item_id, item.name)


# ── 文本结果页（Phase 2C.2）───────────────────────────────────


def _read_text_result_from_disk(task_id: str, project_id: str) -> Optional[Dict[str, Any]]:
    """从磁盘读取 text 任务产物（data/workspaces/<pid>/text/<task_id>.json）。"""
    json_path = DATA_DIR / "workspaces" / project_id / "text" / f"{task_id}.json"
    if not json_path.is_file():
        return None
    try:
        return json.loads(json_path.read_text(encoding="utf-8"))
    except Exception:
        return None


@router.get("/{workspace_id}/items/{item_id}/text_result")
def get_text_result(workspace_id: str, item_id: str) -> Dict[str, Any]:
    """文本结果页聚合数据（Phase 2C.2）。

    查找顺序：
      1. item.results（task_runner 已回写）
      2. item.related_task_ids → task_store → 磁盘 JSON 文件
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    if item.type != ItemType.TEXT.value:
        raise HTTPException(
            status_code=400,
            detail=f"item type {item.type!r} has no text result (only 'text' supported)",
        )

    # R18.1.2: 任务已失败时直接返回 task_failed
    failed = _task_failed_response(item)
    if failed is not None:
        return failed

    # 优先从 item.results 读取
    results = item.results or {}
    has_real = isinstance(results, dict) and "content" in results and bool(results.get("title"))
    if has_real:
        payload = dict(results)
        payload.setdefault("source", "item_results")
        return payload

    # 回退：从 task_store + 磁盘文件读取
    project_id = "default_project"
    for task_id in reversed(item.related_task_ids):
        task = _pipeline_runner.store.get(task_id)
        if task is None:
            continue
        task_result = task.result or {}
        # 优先用 task.result 里的数据
        if "content" in task_result and bool(task_result.get("title")):
            payload = dict(task_result)
            payload.setdefault("source", "task_result")
            return payload
        # 再尝试磁盘 JSON
        disk_data = _read_text_result_from_disk(task_id, project_id)
        if disk_data and "content" in disk_data:
            disk_data.setdefault("source", "disk_json")
            return disk_data

    raise HTTPException(
        status_code=404,
        detail="text result not ready: no completed text task found for this item",
    )


# ── T2: 文本内容在线编辑 ─────────────────────────────────


class TextContentUpdateRequest(BaseModel):
    content: str = Field(min_length=0, description="编辑后的文本内容")


@router.patch("/{workspace_id}/items/{item_id}/text_content")
def update_text_content(
    workspace_id: str, item_id: str, req: TextContentUpdateRequest
) -> Dict[str, Any]:
    """更新纯文素材的正文内容（T2 在线编辑）。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    if item.type != ItemType.TEXT.value:
        raise HTTPException(status_code=400, detail="only text items support content editing")

    results = dict(item.results or {})
    results["content"] = req.content
    _store.update_item(workspace_id, item_id, results=results)
    saved_at = datetime.now(timezone.utc).isoformat()
    return {"content": req.content, "saved_at": saved_at}


# ── C-5 帧标题改名 ─────────────────────────────────────────


class FrameTitleRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)


@router.patch("/{workspace_id}/items/{item_id}/frames/{frame_idx}/title")
def update_frame_title(
    workspace_id: str, item_id: str, frame_idx: int, req: FrameTitleRequest
) -> Dict[str, Any]:
    """更新指定帧的标题（存入 item.results.frame_title_overrides）。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    results = dict(item.results or {})
    overrides = dict(results.get("frame_title_overrides", {}))
    overrides[str(frame_idx)] = req.title
    results["frame_title_overrides"] = overrides

    try:
        _store.update_item(workspace_id, item_id, results=results)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err

    return {"ok": True, "frame_idx": frame_idx, "title": req.title}


# ── Phase 3B.2：单工作空间语义检索 ─────────────────────────


class WorkspaceSearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int = Field(default=5, ge=1, le=20)


@router.post("/{workspace_id}/search")
def workspace_search(workspace_id: str, req: WorkspaceSearchRequest) -> Dict[str, Any]:
    """在单个工作空间内做 RAG 检索，返回 {answer, sources[]}。"""
    try:
        return search_one_workspace(
            workspace_id=workspace_id,
            query=req.query,
            top_k=req.top_k,
            store=_store,
            task_store=_pipeline_runner.store,
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


# ── Phase 3C.3：标签 CRUD + 重新生成 ─────────────────────────


class TagsUpdateRequest(BaseModel):
    """手动校正标签请求体。"""

    tags: Dict[str, Any]


def _validate_tags(tags: Dict[str, Any]) -> None:
    """校验系统 6 维度的 key/value 合法性，custom_tags 跳过 value 校验。"""
    from shared.config import TAG_DIMENSIONS

    system_dims = {k: v for k, v in TAG_DIMENSIONS.items() if k != "custom_tags"}
    for key, value in tags.items():
        if key.startswith("_"):
            continue  # 跳过 _generated_at / _generated_model 等内部字段
        if key == "custom_tags":
            continue
        if key not in system_dims:
            raise HTTPException(
                status_code=422,
                detail=f"unknown tag dimension: {key!r}",
            )
        choices = system_dims[key].get("choices") or []
        if choices and value not in choices:
            raise HTTPException(
                status_code=422,
                detail=f"invalid value {value!r} for dimension {key!r}; expected one of {choices}",
            )


@router.get("/{workspace_id}/items/{item_id}/tags")
def get_item_tags(workspace_id: str, item_id: str) -> Dict[str, Any]:
    """返回指定素材的当前标签。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    _find_item(rec, item_id)
    item = next(it for it in rec.items if it.item_id == item_id)
    return {"tags": item.tags}


@router.put("/{workspace_id}/items/{item_id}/tags")
def update_item_tags(
    workspace_id: str, item_id: str, req: TagsUpdateRequest
) -> Dict[str, Any]:
    """手动校正标签（做维度合法性校验）。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    _find_item(rec, item_id)
    _validate_tags(req.tags)
    item = _find_item(rec, item_id)
    _metadata.replace_tags(item.content_id, req.tags, "MANUAL")
    rec = _store.update_item(workspace_id, item_id, tags=req.tags)
    item = next(it for it in rec.items if it.item_id == item_id)
    return {"tags": item.tags}


@router.post("/{workspace_id}/items/{item_id}/tags/regenerate")
def regenerate_item_tags(workspace_id: str, item_id: str) -> Dict[str, Any]:
    """重新触发 LLM 打标并写回。"""
    from backend.app.services.tag_generator import generate_tags

    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    try:
        new_tags = generate_tags(item, rec, task_store=_pipeline_runner.store)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
    _metadata.replace_tags(item.content_id, new_tags, "AUTO")
    manual_tags = _metadata.tags_for_content(item.content_id, "MANUAL")
    merged_tags = {**new_tags, **manual_tags}
    rec = _store.update_item(workspace_id, item_id, tags=merged_tags)
    item = next(it for it in rec.items if it.item_id == item_id)
    return {"tags": item.tags}


# ── A2：说话人名称映射 ─────────────────────────────────────


class SpeakerMapRequest(BaseModel):
    """说话人姓名与角色配置请求体。"""

    speaker_map: Dict[str, str]
    speaker_roles: Optional[Dict[str, str]] = None


@router.patch("/{workspace_id}/items/{item_id}/speaker_map")
def update_speaker_map(
    workspace_id: str, item_id: str, req: SpeakerMapRequest
) -> Dict[str, Any]:
    """保存说话人姓名/角色，并同步更新已有总结及其落盘文件。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    results = dict(item.results or {})
    previous_map = {
        str(key): str(value)
        for key, value in (results.get("speaker_map") or {}).items()
    }
    roles = req.speaker_roles
    if roles is None:
        roles = dict(results.get("speaker_roles") or {})
    normalized_roles: Dict[str, str] = {}
    for raw_id, raw_role in roles.items():
        role = str(raw_role or "").strip()
        if role and role not in SPEAKER_ROLE_OPTIONS:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的说话人角色: {role}；可选角色：{'、'.join(SPEAKER_ROLE_OPTIONS)}",
            )
        if role:
            normalized_roles[str(raw_id).strip()] = role
    results["speaker_map"] = req.speaker_map
    results["speaker_roles"] = normalized_roles
    _store.update_item(workspace_id, item_id, results=results)
    has_speaker_summaries = any(
        summary.summary_mode == "speaker_aware" for summary in item.summaries
    )
    updated_count = _store.update_speaker_summary_labels(
        workspace_id, item_id, req.speaker_map, previous_speaker_map=previous_map
    )
    return {
        "speaker_map": req.speaker_map,
        "speaker_roles": normalized_roles,
        "summary_refresh": {
            "status": "updated" if has_speaker_summaries else "not_needed",
            "updated_count": updated_count,
            "reason": f"已同步替换 {updated_count} 份区分说话人总结中的名称。"
            if has_speaker_summaries
            else "当前没有区分说话人总结需要更新。",
        },
    }


class TranscriptSegmentEditRequest(BaseModel):
    """转录段编辑请求体。"""

    edited_text: str = Field(..., description="编辑后的文本，空字符串表示恢复原文")


class NoteUpdateRequest(BaseModel):
    """R1.1: note.md 正文写入请求体。"""

    body: str = Field(..., description="正文 markdown（不含 frontmatter）")
    version_source: Literal[
        "USER_EDIT", "RESTORE", "ADOPT_FROM_SIBLING"
    ] = "USER_EDIT"


class TranslateRequest(BaseModel):
    """字幕翻译请求体。"""

    target_lang: str = Field(..., description="目标语言代码，如 zh/en/ja")
    force: bool = Field(False, description="是否忽略已有缓存并重新翻译")


@router.post("/{workspace_id}/items/{item_id}/translate")
async def translate_transcript(
    workspace_id: str, item_id: str, req: TranslateRequest
) -> Dict[str, Any]:
    """逐段翻译字幕并落盘缓存。

    已在 results.translations[target_lang] 有缓存且 force=false 时直接返回，不重复调 LLM。
    """
    from fastapi.concurrency import run_in_threadpool

    target_lang = req.target_lang.strip().lower()
    if not target_lang:
        raise HTTPException(status_code=400, detail="target_lang 不能为空")

    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    nd = note_dir(workspace_id, item_id)
    lines = _note_transcript(item.results or {}, nd)
    if not lines:
        raise HTTPException(status_code=400, detail="该素材没有字幕可翻译")

    # 检查缓存。旧版本可能落过只覆盖前半段的残缺译文；残缺缓存不能再返回给前端。
    results = dict(item.results or {})
    translations = dict(results.get("translations") or {})

    # 拼待翻译文本
    texts_to_translate = [str(ln.get("text", "")).strip() for ln in lines]
    non_empty = [t for t in texts_to_translate if t]
    if not non_empty:
        raise HTTPException(status_code=400, detail="字幕内容为空，无法翻译")

    cached_segments = _normalize_translation_segments(translations.get(target_lang), len(texts_to_translate))
    if cached_segments:
        if _translation_complete(cached_segments, texts_to_translate):
            if not req.force:
                return {
                    "target_lang": target_lang,
                    "segments": cached_segments,
                    "cached": True,
                    "complete": True,
                    "filled": _translation_filled_count(cached_segments, texts_to_translate),
                    "total": len(non_empty),
                }
        else:
            translations.pop(target_lang, None)
            results["translations"] = translations
            _store.update_item(workspace_id, item_id, results=results)

    def _do_translate() -> List[Dict[str, Any]]:
        return _translate_segments_batch(texts_to_translate, target_lang)

    try:
        translated = await run_in_threadpool(_do_translate)
    except RuntimeError as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"翻译 LLM 调用失败: {err}") from err

    if not _translation_complete(translated, texts_to_translate):
        filled = _translation_filled_count(translated, texts_to_translate)
        raise HTTPException(
            status_code=502,
            detail=f"字幕翻译结果不完整：{filled}/{len(non_empty)} 条，请重试",
        )

    # 落盘缓存
    translations[target_lang] = translated
    results["translations"] = translations
    _store.update_item(workspace_id, item_id, results=results)

    return {
        "target_lang": target_lang,
        "segments": translated,
        "cached": False,
        "complete": True,
        "filled": _translation_filled_count(translated, texts_to_translate),
        "total": len(non_empty),
    }


def _translate_segments_batch(
    texts: List[str], target_lang: str
) -> List[Dict[str, Any]]:
    """批量翻译字幕段，调用 LLM 并解析编号输出。

    返回与输入 texts 对齐的 [{idx: int, text: str}, ...] 列表。
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    from src.vidmirror.core.providers import ChatRequest
    from src.vidmirror.core.providers.registry import create_default_registry
    from shared.settings_store import load_settings as _load_settings

    lang_names = {"zh": "简体中文", "en": "English", "ja": "日本語"}
    lang_display = lang_names.get(target_lang, target_lang)

    system_prompt = (
        f"你是一个专业的字幕翻译器。请将以下编号的字幕行逐行翻译成{lang_display}。\n"
        f"严格要求：\n"
        f"1. 保持编号格式 [N] 译文，一行一段\n"
        f"2. 不要合并或拆分行\n"
        f"3. 只输出译文，不要加任何解释或说明\n"
        f"4. 不要输出思考过程；如果模型支持，请使用 /no_think 模式"
    )

    settings = _load_settings()
    registry = create_default_registry()
    profile = registry.resolve_default_profile(settings, "chat")
    provider = registry.build(profile)
    default_chat_model = str(profile.default_models.get("chat") or "").strip()
    if not default_chat_model:
        raise RuntimeError("未配置 chat model")
    try:
        available_models = set(provider.list_models("chat"))
    except Exception:
        available_models = set()
    chat_model = _select_translation_model(default_chat_model, available_models)
    logger.info("translate_transcript: using model %s", chat_model)

    result: List[Dict[str, Any]] = []
    for idx in range(len(texts)):
        result.append({"idx": idx, "text": ""})

    def _translate_chunk(chunk: List[tuple[int, str]]) -> Dict[int, str]:
        numbered = "/no_think\n" + "\n".join(f"[{idx}] {text}" for idx, text in chunk)
        raw = provider.chat(ChatRequest(
            model=chat_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": numbered},
            ],
            temperature=0.3,
            max_tokens=_TRANSLATE_MAX_TOKENS,
            timeout=_TRANSLATE_REQUEST_TIMEOUT,
        ))
        parsed = _parse_numbered_translation(raw)
        missing = [idx for idx, _ in chunk if not parsed.get(idx)]
        if missing:
            retry_chunk = [(idx, text) for idx, text in chunk if idx in set(missing)]
            retry_numbered = "/no_think\n" + "\n".join(f"[{idx}] {text}" for idx, text in retry_chunk)
            retry_raw = provider.chat(ChatRequest(
                model=chat_model,
                messages=[
                    {"role": "system", "content": f"{system_prompt}\n你上次漏了部分编号，这次必须返回下面每一个编号。"},
                    {"role": "user", "content": retry_numbered},
                ],
                temperature=0.2,
                max_tokens=_TRANSLATE_MAX_TOKENS,
                timeout=_TRANSLATE_REQUEST_TIMEOUT,
            ))
            parsed.update(_parse_numbered_translation(retry_raw))
            missing = [idx for idx, _ in chunk if not parsed.get(idx)]
            if missing:
                for idx, text in retry_chunk:
                    if idx not in set(missing):
                        continue
                    single_raw = provider.chat(ChatRequest(
                        model=chat_model,
                        messages=[
                            {"role": "system", "content": f"请将这一句字幕翻译成{lang_display}。只输出译文，不要解释，不要编号。"},
                            {"role": "user", "content": text},
                        ],
                        temperature=0.2,
                        max_tokens=512,
                        timeout=_TRANSLATE_REQUEST_TIMEOUT,
                    ))
                    single_text = _parse_single_translation(single_raw, idx)
                    if single_text:
                        parsed[idx] = single_text
                missing = [idx for idx, _ in chunk if not parsed.get(idx)]
                if missing:
                    sample = ", ".join(str(i) for i in missing[:8])
                    raise RuntimeError(f"字幕翻译结果缺少编号：{sample}")
        return parsed

    chunks = _iter_translation_chunks(texts)
    max_workers = min(_TRANSLATE_MAX_WORKERS, len(chunks)) or 1
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_chunk = {
            executor.submit(_translate_chunk, chunk): (chunk_no, chunk)
            for chunk_no, chunk in enumerate(chunks, start=1)
        }
        for future in as_completed(future_to_chunk):
            chunk_no, chunk = future_to_chunk[future]
            parsed = future.result()
            for idx, translated_text in parsed.items():
                if 0 <= idx < len(texts):
                    result[idx]["text"] = translated_text
            logger.info(
                "translate_transcript: chunk %s/%s translated (%s lines)",
                chunk_no,
                len(chunks),
                len(chunk),
            )

    return result


def _select_translation_model(default_model: str, available_models: set[str]) -> str:
    """选择字幕翻译模型，优先使用稳定保持编号的大模型。"""
    for candidate in _TRANSLATE_MODEL_CANDIDATES:
        if candidate in available_models:
            return candidate
    return default_model


def _iter_translation_chunks(texts: List[str]) -> List[List[tuple[int, str]]]:
    """把字幕按行数和字符数切成适合单次 LLM 调用的小块。"""
    chunks: List[List[tuple[int, str]]] = []
    current: List[tuple[int, str]] = []
    current_chars = 0
    for idx, text in enumerate(texts):
        clean = str(text or "").strip()
        if not clean:
            continue
        line_chars = len(clean) + len(str(idx)) + 4
        if current and (
            len(current) >= _TRANSLATE_CHUNK_MAX_LINES
            or current_chars + line_chars > _TRANSLATE_CHUNK_MAX_CHARS
        ):
            chunks.append(current)
            current = []
            current_chars = 0
        current.append((idx, clean))
        current_chars += line_chars
    if current:
        chunks.append(current)
    return chunks


def _parse_numbered_translation(raw: str) -> Dict[int, str]:
    """解析 LLM 返回的 [idx] 译文行。"""
    parsed: Dict[int, str] = {}
    for line in str(raw or "").splitlines():
        match = re.match(r"^\s*\[(\d+)\]\s*(.+?)\s*$", line)
        if not match:
            continue
        idx = int(match.group(1))
        text = match.group(2).strip()
        if text:
            parsed[idx] = text
    return parsed


def _parse_single_translation(raw: str, idx: int) -> str:
    """解析单行补漏翻译，兼容模型返回纯文本或仍带编号。"""
    parsed = _parse_numbered_translation(raw)
    if parsed.get(idx):
        return parsed[idx]
    for line in str(raw or "").splitlines():
        text = line.strip()
        if not text or text == "/no_think":
            continue
        numbered = re.match(r"^\s*\[?(\d+)\]?[\.、:：\s-]+(.+?)\s*$", text)
        if numbered:
            if int(numbered.group(1)) != idx:
                continue
            text = numbered.group(2).strip()
        if text:
            return text
    return ""


def _normalize_translation_segments(value: Any, total: int) -> List[Dict[str, Any]]:
    """兼容旧的 dict / list 两种译文缓存格式，统一成与字幕对齐的列表。"""
    if not value:
        return []
    result = [{"idx": idx, "text": ""} for idx in range(total)]
    if isinstance(value, list):
        for seg in value:
            if not isinstance(seg, dict):
                continue
            idx = seg.get("idx")
            if isinstance(idx, int) and 0 <= idx < total:
                result[idx]["text"] = str(seg.get("text") or "").strip()
    elif isinstance(value, dict):
        for idx_raw, text in value.items():
            try:
                idx = int(idx_raw)
            except Exception:
                continue
            if 0 <= idx < total:
                result[idx]["text"] = str(text or "").strip()
    return result


def _translation_filled_count(segments: List[Dict[str, Any]], source_texts: List[str]) -> int:
    filled = 0
    for idx, source in enumerate(source_texts):
        if not str(source or "").strip():
            continue
        if idx < len(segments) and str(segments[idx].get("text") or "").strip():
            filled += 1
    return filled


def _translation_complete(segments: List[Dict[str, Any]], source_texts: List[str]) -> bool:
    total = sum(1 for text in source_texts if str(text or "").strip())
    return total > 0 and _translation_filled_count(segments, source_texts) == total


@router.patch("/{workspace_id}/items/{item_id}/transcript/segments/{segment_idx}")
def update_transcript_segment(
    workspace_id: str,
    item_id: str,
    segment_idx: int,
    req: TranscriptSegmentEditRequest,
) -> Dict[str, Any]:
    """编辑单段转录文本（A-1：字幕在线编辑）。

    字幕的「显示真相」= _note_transcript（内存 results 优先，重启后回退 transcript.json），
    所以编辑必须按同一份「显示列表」的下标定位，并把改动同时落到三处：
      ① 内存 results（本会话即时生效）② transcript.json（扛重启）③ source.md（源md 同步）。
    旧实现只认内存 results，重启后 results 空 → out of range → 「保存失败，请重试」。
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    nd = note_dir(workspace_id, item_id)

    # 显示列表（与前端字幕轴完全一致）——按它的下标做边界校验，不再只认内存 results
    lines = _note_transcript(item.results or {}, nd)
    if segment_idx < 0 or segment_idx >= len(lines):
        raise HTTPException(
            status_code=400,
            detail=f"segment_idx {segment_idx} out of range (0-{len(lines) - 1})",
        )

    new_text = req.edited_text.strip()

    # ① 内存 results：写到「第 idx 个非空段」（与 normalize 跳空段逻辑对齐，避免下标错位）
    results = dict(item.results or {})
    raw_segs = list(results.get("transcript_segments") or [])
    if raw_segs:
        cnt = -1
        for ri, rseg in enumerate(raw_segs):
            if not isinstance(rseg, dict):
                continue
            if not str(rseg.get("edited_text") or rseg.get("text", "")).strip():
                continue
            cnt += 1
            if cnt == segment_idx:
                raw_segs[ri] = {**rseg, "edited_text": new_text or None}
                break
        results["transcript_segments"] = raw_segs
        _store.update_item(workspace_id, item_id, results=results)

    # ② transcript.json（扛重启）+ ③ source.md（源md 同步）
    try:
        tp = nd / "transcript.json"
        disk = json.loads(tp.read_text(encoding="utf-8")) if tp.exists() else None
        if not (isinstance(disk, list) and 0 <= segment_idx < len(disk) and isinstance(disk[segment_idx], dict)):
            disk = [dict(x) for x in lines]  # 兜底：用显示列表重建一份
        # 空字符串 = 恢复原文（保留显示列表里的原 text）
        disk[segment_idx]["text"] = new_text or str(lines[segment_idx].get("text", ""))
        disk[segment_idx].pop("edited_text", None)
        nd.mkdir(parents=True, exist_ok=True)
        tp.write_text(json.dumps(disk, ensure_ascii=False), encoding="utf-8")
        _rebuild_source_md_transcript(nd, [dict(x) for x in disk])
    except Exception:
        logger.warning("update_transcript_segment: 同步 transcript.json / source.md 失败（best-effort）", exc_info=True)

    return {"segment_idx": segment_idx, "edited_text": new_text or None}


# ── 总结 CRUD ──────────────────────────────────────────────────


class SummaryCreateRequest(BaseModel):
    """生成总结请求体。"""

    template: str = Field(..., description="模板 id（concise / detailed / ...）")
    summary_mode: str = Field("general", description="总结方式：general | speaker_aware")
    background_for_summary: str = Field("", description="总结用背景信息（可选）")
    provider_id: str = Field("", description="指定 provider（空 = 默认）")
    model: str = Field("", description="指定模型（空 = provider 默认）")
    search_web: bool = Field(False, description="是否联网搜索补充上下文")


def _ensure_valid_template(template_id: str) -> None:
    if template_id not in list_template_ids():
        raise HTTPException(
            status_code=400,
            detail=f"未知模板: {template_id}，可用: {', '.join(list_template_ids())}",
        )


def _ensure_valid_summary_mode(summary_mode: str) -> None:
    if summary_mode not in {"general", "speaker_aware"}:
        raise HTTPException(
            status_code=400,
            detail="未知总结方式，支持 general（普通总结）或 speaker_aware（区分说话人总结）",
        )


def _summary_source_present(results: Dict[str, Any]) -> bool:
    """Whether task/item results contain enough material to generate a summary."""
    return any(
        key in results and bool(results.get(key))
        for key in (
            "content",
            "transcript",
            "transcript_segments",
            "summary",
            "note_body",
            "markdown",
            "source_md_raw",
            "image_infos",
        )
    )


@router.get("/{workspace_id}/items/{item_id}/summaries")
def list_summaries(workspace_id: str, item_id: str) -> List[Dict[str, Any]]:
    """列出该 item 的所有总结（按素材级 version 排序）。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    speaker_map = (item.results or {}).get("speaker_map") or {}
    sorted_summaries = sorted(item.summaries, key=lambda s: (s.version, s.created_at, s.summary_id))
    response: List[Dict[str, Any]] = []
    for summary in sorted_summaries:
        data = summary.to_dict()
        if summary.summary_mode == "speaker_aware":
            data["content_md"] = apply_speaker_map(data.get("content_md") or "", speaker_map)
        response.append(data)
    return response


@router.post("/{workspace_id}/items/{item_id}/summaries", status_code=201)
async def create_summary(
    workspace_id: str, item_id: str, req: SummaryCreateRequest
) -> Dict[str, Any]:
    """创建后台总结任务；长音频不再占住前端 HTTP 请求。"""

    _ensure_valid_template(req.template)
    _ensure_valid_summary_mode(req.summary_mode)
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    # item.results 缺少实质内容时，从 task store 回填（与 _sync_item_with_tasks 同逻辑）
    has_content = bool(item.results and _summary_source_present(item.results))
    if not has_content and item.related_task_ids:
        for tid in reversed(item.related_task_ids):
            task = _pipeline_runner.store.get(tid)
            if task and task.result and _summary_source_present(task.result):
                item.results = dict(task.result)
                break

    if req.summary_mode == "speaker_aware":
        if item.type not in {"audio", "video"}:
            raise HTTPException(status_code=400, detail="区分说话人总结仅支持音频或视频素材")
        segments = item.results.get("transcript_segments") if item.results else None
        has_speaker_segments = any(
            isinstance(seg, dict) and str(seg.get("speaker") or "").strip()
            for seg in (segments or [])
        )
        if not has_speaker_segments:
            raise HTTPException(
                status_code=409,
                detail="当前素材没有可用的说话人识别结果，无法生成区分说话人总结。请先启用说话人识别并重新分析。",
            )

    # R3.2: 视频素材物化 frames（标准总结嵌关键帧需要）
    # R3.4 fix: 传 json_output_basenames 做 preferred 过滤，防多视频工作区帧串台
    if item.type == "video" and item.results and not item.results.get("frames"):
        _pb = list(item.results.get("json_output_basenames") or [])
        item.results = dict(_materialize_video_results_from_analyze(item.results, preferred_basenames=_pb))

    try:
        task = _pipeline_runner.create_task(
            workspace_id,
            "summary",
            {
                "workspace_id": workspace_id,
                "item_id": item_id,
                "template": req.template,
                "background_for_summary": req.background_for_summary,
                "provider_id": req.provider_id,
                "model": req.model,
                "search_web": req.search_web,
                "summary_mode": req.summary_mode,
                "title": item.name,
            },
        )
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"创建总结任务失败: {err}") from err

    # 阶段 C1：把 summary task_id 关联到 item.related_task_ids，删除 item 时才能一并清理。
    # 去重追加，不覆盖原任务 ID；关联失败则清理刚创建的任务，避免孤儿任务。
    if task.task_id not in item.related_task_ids:
        try:
            _store.update_item(
                workspace_id,
                item_id,
                related_task_ids=[*item.related_task_ids, task.task_id],
            )
        except Exception as err:
            try:
                _pipeline_runner.store.delete(task.task_id)
            except Exception:
                pass
            raise HTTPException(
                status_code=500, detail=f"关联总结任务失败: {err}",
            ) from err

    return {
        "status": "accepted",
        "task_id": task.task_id,
        "workspace_id": workspace_id,
        "item_id": item_id,
    }


@router.get("/{workspace_id}/items/{item_id}/summaries/{summary_id}")
def get_summary(workspace_id: str, item_id: str, summary_id: str) -> Dict[str, Any]:
    """取单份总结详情。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    summary = next((s for s in item.summaries if s.summary_id == summary_id), None)
    if summary is None:
        raise HTTPException(status_code=404, detail=f"summary not found: {summary_id}")
    data = summary.to_dict()
    if summary.summary_mode == "speaker_aware":
        data["content_md"] = apply_speaker_map(
            data.get("content_md") or "",
            (item.results or {}).get("speaker_map") or {},
        )
    return data


@router.delete("/{workspace_id}/items/{item_id}/summaries/{summary_id}")
def delete_summary(workspace_id: str, item_id: str, summary_id: str) -> Dict[str, str]:
    """硬删指定总结。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    _find_item(rec, item_id)  # 确认 item 存在
    deleted = _store.delete_item_summary(workspace_id, item_id, summary_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"summary not found: {summary_id}")
    return {"status": "deleted", "summary_id": summary_id}


class SummaryRenameRequest(BaseModel):
    name: str = ""


@router.patch("/{workspace_id}/items/{item_id}/summaries/{summary_id}")
def rename_summary(
    workspace_id: str,
    item_id: str,
    summary_id: str,
    req: SummaryRenameRequest,
) -> Dict[str, Any]:
    """改名指定总结版本（空字符串 = 清除自定义名）。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    _find_item(rec, item_id)  # 确认 item 存在
    try:
        summary = _store.rename_item_summary(workspace_id, item_id, summary_id, req.name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return summary.to_dict()


# ── Note（R0.2: 只读 note 文件 + 惰性组装）───────────────────────


def _note_transcript(results: Dict[str, Any], nd: Path) -> List[Dict[str, Any]]:
    """GET/PUT 共用：取规范化的字幕 [{t_sec, t_str, text}]。

    内存 results 优先；内存为空（如后端重启后 item.results 丢失）则从 note 目录
    transcript.json 兜底读取——修复"时间码不落盘、重启即丢"。

    规范化逻辑统一走 note_assembler，避免 GET 读 segments / PUT 读 string 这类两边不一致。
    """
    segs = extract_transcript_from_results(results)
    if segs:
        # best-effort 回填：内存有、磁盘还没有 → 顺手落盘，让它扛过下次重启
        tp = nd / "transcript.json"
        if not tp.exists():
            try:
                nd.mkdir(parents=True, exist_ok=True)
                tp.write_text(json.dumps(segs, ensure_ascii=False), encoding="utf-8")
            except Exception:
                pass
        return segs

    # 内存没有 → 落盘兜底
    tp = nd / "transcript.json"
    if tp.exists():
        try:
            return normalize_transcript(json.loads(tp.read_text(encoding="utf-8")))
        except Exception:
            return []
    return []


def _rebuild_source_md_transcript(nd: Path, lines: List[Dict[str, Any]]) -> None:
    """用规范化字幕行重建 source.md 的「转写正文」，保留已有「视频信息」头。

    字幕编辑后调用，让 source.md 跟着改。**只重建转写正文段**，
    保留 build_source_md 写的「## 视频信息」头（重启后 results 已空，
    不能用 build_source_md 整体重建，否则会把头和正文一起清掉）。
    """
    body_parts: List[str] = []
    for ln in lines:
        text = str(ln.get("text") or "")
        if not text:
            continue
        ts = str(ln.get("t_str") or "")
        body_parts.append(f"**[{ts}]** {text}" if ts else text)
    body = "\n\n".join(body_parts)

    sp = nd / "source.md"
    marker = "## 转写正文"
    if sp.exists():
        existing = sp.read_text(encoding="utf-8")
        if marker in existing:
            header = existing.split(marker)[0]
            sp.write_text(f"{header}{marker}\n\n{body}\n", encoding="utf-8")
            return
    sp.write_text(body + "\n", encoding="utf-8")


@router.get("/{workspace_id}/items/{item_id}/note")
def get_item_note(workspace_id: str, item_id: str) -> Dict[str, Any]:
    """读取 item 的 note 目录（source.md + note.md + summaries/*）。

    惰性组装：若 notes/<item_id>/ 不存在，先从 task store 回填 results，
    再 assemble_item_note 一次（覆盖历史 item）。
    """
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    nd = note_dir(workspace_id, item_id)
    note_path = nd / "note.md"

    # 从 task store 回填最新 SUCCESS result；note.md 已存在时也需要回填，
    # 因为 retry 成功可能晚于旧 note.md 的首次惰性组装。
    latest_result_task = None
    if item.related_task_ids:
        for tid in reversed(item.related_task_ids):
            task = _pipeline_runner.store.get(tid)
            if task and task.result:
                merged = dict(item.results or {})
                merged.update(task.result)
                item.results = merged
                latest_result_task = task
                break

    # 惰性组装：目录不存在或 note.md 缺失时触发；旧自动稿则按最新结果刷新。
    if not note_path.exists():
        assemble_item_note(workspace_id, item_id, _item=item)
    else:
        _refresh_auto_note_if_stale(workspace_id, item, note_path)

    # 读取文件（assemble 失败时文件可能不存在，返回空字符串）
    source_md = ""
    note_md = ""
    if (nd / "source.md").exists():
        source_md = (nd / "source.md").read_text(encoding="utf-8")
    if note_path.exists():
        note_md = note_path.read_text(encoding="utf-8")

    # 主笔记与历史总结文件可能由旧版本生成，文件里仍保留 SPEAKER_00/01。
    # 读取时再次按当前映射规范化，保证刷新、切换版本和编辑入口看到的都是同一套姓名。
    results = item.results or {}
    item_type = item.type  # "image" | "video" | "audio" | "text"
    raw_speaker_map = results.get("speaker_map") or {}
    current_speaker_map = (
        raw_speaker_map
        if item_type in {"audio", "video"} and isinstance(raw_speaker_map, dict)
        else {}
    )
    note_md = apply_speaker_renames(
        note_md, current_speaker_map, current_speaker_map
    )

    # 解析 frontmatter（从 note_md 提取 YAML）
    frontmatter: Dict[str, Any] = {}
    if note_md.startswith("---\n"):
        parts = note_md.split("---\n", 2)
        if len(parts) >= 3:
            import yaml  # noqa: PLC0415
            try:
                frontmatter = yaml.safe_load(parts[1]) or {}
            except Exception:
                pass

    # 收集 summaries 文件
    summaries: List[Dict[str, Any]] = []
    for sm_path in sorted(nd.glob("summaries/**/*.md")):
        rel = sm_path.relative_to(nd)
        # summaries/<template>/v<n>.md → 提取 template 和 version
        parts_rel = rel.parts  # ('summaries', '<template>', 'v<n>.md')
        template = parts_rel[1] if len(parts_rel) >= 2 else "unknown"
        version_str = parts_rel[2].replace("v", "").replace(".md", "") if len(parts_rel) >= 3 else "1"
        try:
            version = int(version_str)
        except ValueError:
            version = 1
        summaries.append({
            "template": template,
            "version": version,
            "path": str(rel),
            "content": apply_speaker_renames(
                sm_path.read_text(encoding="utf-8"),
                current_speaker_map,
                current_speaker_map,
            ),
        })

    # ── R3.1: 从 results 实时提取 media URL + transcript ──
    media: Dict[str, Any] = {}
    transcript: Any = None

    if item_type == "image":
        # NI.1: note task 产出 results["images"]（下载的图片路径列表），优先使用
        result_images = results.get("images") or []
        if result_images:
            media["images"] = [
                to_static_url(p) if not str(p).startswith("/static/") else str(p)
                for p in result_images
            ]
        else:
            # 原有逻辑：图片在 item.source_value
            img_url = ""
            if item.source == "url":
                img_url = item.source_value
            else:
                # upload：source_value 是本地绝对路径
                img_url = to_static_url(item.source_value)
            media["images"] = [img_url] if img_url else []
        # 结构化图片信息（description_parts），供前端展示
        _image_infos = results.get("image_infos")
        if _image_infos:
            media["image_infos"] = _image_infos

    elif item_type == "video":
        # 视频文件 URL：优先用 note task 结果中的确切 video_file，扫目录只作 fallback。
        _video_url = ""
        _result_video = str(results.get("video_file") or results.get("video_url") or "").strip()
        if _result_video:
            _video_url = (
                _result_video
                if _result_video.startswith(("http://", "https://", "/static/"))
                else to_static_url(_result_video)
            )
        # 从 frontmatter 的 media.video.url 获取（note.md 里记录的路径）
        if not _video_url:
            _fm_video = str((frontmatter.get("media") or {}).get("video", {}).get("url") or "").strip()
            if _fm_video and not _fm_video.startswith(("http://", "https://")):
                _video_url = to_static_url(_fm_video)
            elif _fm_video:
                _video_url = _fm_video
        _vid_dir = DATA_DIR / "workspaces" / workspace_id / "videos"
        if not _video_url and _vid_dir.is_dir():
            _vid_files = sorted(_vid_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
            if _vid_files:
                _video_url = to_static_url(_vid_files[0])
        if not _video_url:
            _video_url = item.source_value if item.source == "url" else ""
        duration = float(results.get("duration_sec") or results.get("duration") or 0)
        media["video"] = {"url": _video_url, "duration": duration}
        # frames（可能已 materialize 为 /static URL，也可能是绝对路径）
        frames_data = results.get("frames") or []
        media["frames"] = []
        for f in frames_data:
            fp = f.get("frame_image_path") or f.get("image_path") or ""
            sec = f.get("sec", 0)
            media["frames"].append({"sec": sec, "url": fp if fp.startswith("/static/") else to_static_url(fp)})
        # transcript（优先 segments 带时间码，降级为纯文本规范化）
        transcript = _note_transcript(results, nd)

    elif item_type == "audio":
        media["audio"] = _note_audio_url(workspace_id, item, results, frontmatter)
        media["waveform"] = results.get("waveform_peaks") or []
        # transcript：统一规范成 [{t_sec, t_str, text}]
        transcript = _note_transcript(results, nd)

    # summary_hint：图文内容分类结果，供前端 NewSummaryModal 默认选中模板
    summary_hint: Dict[str, Any] = {}
    _cc = results.get("content_category")
    if _cc:
        summary_hint["content_category"] = _cc
    _dst = results.get("default_summary_template")
    if not _dst:
        _dst = _default_summary_template_for_item(item, results)
    if _dst:
        summary_hint["default_template"] = _dst

    raw_summary_failure = results.get("partial_failure")
    summary_failure = (
        raw_summary_failure
        if isinstance(raw_summary_failure, dict) and raw_summary_failure.get("stage") == "summary"
        else None
    )

    return {
        "frontmatter": frontmatter,
        "source_md": source_md,
        "note_md": note_md,
        "summaries": summaries,
        "note_dir": str(nd),
        "media": media,
        "transcript": transcript,
        "translations": results.get("translations", {}),
        # 音频说话人改名需要随 /note 回显，保证刷新后字幕和总结入口仍使用用户名称。
        "speaker_map": results.get("speaker_map", {}) if item_type in {"audio", "video"} else {},
        "speaker_roles": results.get("speaker_roles", {}) if item_type in {"audio", "video"} else {},
        "summary_hint": summary_hint,
        # 自动总结失败时，结果页必须拿到原因和可重试的任务 ID，不能只显示空态。
        "summary_failure": summary_failure,
        "summary_retry_task_id": latest_result_task.task_id if summary_failure and latest_result_task else "",
    }


def _extract_note_body(markdown: str) -> str:
    if markdown.startswith("---\n"):
        parts = markdown.split("---\n", 2)
        if len(parts) >= 3:
            return parts[2].lstrip("\n")
    return markdown


@router.put("/{workspace_id}/items/{item_id}/note")
def update_item_note(workspace_id: str, item_id: str, req: NoteUpdateRequest) -> Dict[str, Any]:
    """R1.1: 写入 note.md 正文（保留 frontmatter 机器字段）。

    逻辑：读现有 note.md → 解析旧 frontmatter（tags/media/layers 全部保留）
    → version+1、updated_at、user_edited=true → 正文换成新 body
    → 拼回 ---\nyaml---\nbody 写盘 → 返回完整 note（同 GET 结构）。
    note.md 不存在时先惰性组装拿 frontmatter 再写。
    """
    import yaml as _yaml  # noqa: PLC0415

    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    nd = note_dir(workspace_id, item_id)
    note_path = nd / "note.md"
    previous_body: Optional[str] = None

    # 读取或惰性初始化 frontmatter
    frontmatter: Dict[str, Any] = {}
    if note_path.exists():
        raw = note_path.read_text(encoding="utf-8")
        previous_body = _extract_note_body(raw)
        if raw.startswith("---\n"):
            parts = raw.split("---\n", 2)
            if len(parts) >= 3:
                try:
                    frontmatter = _yaml.safe_load(parts[1]) or {}
                except Exception:
                    frontmatter = {}
    else:
        # note.md 不存在 → 先惰性组装拿 frontmatter
        if item.related_task_ids:
            for tid in reversed(item.related_task_ids):
                task = _pipeline_runner.store.get(tid)
                if task and task.result:
                    merged = dict(item.results or {})
                    merged.update(task.result)
                    item.results = merged
                    break
        assemble_item_note(workspace_id, item_id, _item=item)
        # 重新读取刚刚写入的 frontmatter
        if note_path.exists():
            raw = note_path.read_text(encoding="utf-8")
            if raw.startswith("---\n"):
                parts = raw.split("---\n", 2)
                if len(parts) >= 3:
                    try:
                        frontmatter = _yaml.safe_load(parts[1]) or {}
                    except Exception:
                        frontmatter = {}

    # 更新 frontmatter 机器字段
    frontmatter["version"] = int(frontmatter.get("version", 1)) + 1
    frontmatter["updated_at"] = datetime.now(timezone.utc).isoformat()
    frontmatter["user_edited"] = True

    # 序列化 + 拼回 note.md
    fm_yaml = _yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False, sort_keys=False)
    note_content = f"---\n{fm_yaml}---\n\n{req.body}"
    nd.mkdir(parents=True, exist_ok=True)
    note_path.write_text(note_content, encoding="utf-8")
    if previous_body is not None:
        _note_versions.checkpoint(item.content_id, previous_body, "BASELINE")
    _note_versions.checkpoint(item.content_id, req.body, req.version_source)

    # 读取 source.md
    source_md = ""
    source_path = nd / "source.md"
    if source_path.exists():
        source_md = source_path.read_text(encoding="utf-8")

    # 收集 summaries（复用 GET 逻辑）
    summaries: List[Dict[str, Any]] = []
    for sm_path in sorted(nd.glob("summaries/**/*.md")):
        rel = sm_path.relative_to(nd)
        parts_rel = rel.parts
        template = parts_rel[1] if len(parts_rel) >= 2 else "unknown"
        version_str = parts_rel[2].replace("v", "").replace(".md", "") if len(parts_rel) >= 3 else "1"
        try:
            version = int(version_str)
        except ValueError:
            version = 1
        summaries.append({
            "template": template,
            "version": version,
            "path": str(rel),
            "content": sm_path.read_text(encoding="utf-8"),
        })

    # ── R3.1: 从 results 实时提取 media URL + transcript（与 GET 同逻辑）──
    results = item.results or {}
    item_type = item.type
    media: Dict[str, Any] = {}
    transcript: Any = None

    if item_type == "image":
        # NI.1: 与 GET 同逻辑，优先使用 results["images"]（下载的图集）
        result_images = results.get("images") or []
        if result_images:
            media["images"] = [
                to_static_url(p) if not str(p).startswith("/static/") else str(p)
                for p in result_images
            ]
        else:
            img_url = ""
            if item.source == "url":
                img_url = item.source_value
            else:
                img_url = to_static_url(item.source_value)
            media["images"] = [img_url] if img_url else []
        _image_infos = results.get("image_infos")
        if _image_infos:
            media["image_infos"] = _image_infos

    elif item_type == "video":
        _video_url = ""
        _result_video = str(results.get("video_file") or results.get("video_url") or "").strip()
        if _result_video:
            _video_url = (
                _result_video
                if _result_video.startswith(("http://", "https://", "/static/"))
                else to_static_url(_result_video)
            )
        # 从 frontmatter 的 media.video.url 获取（note.md 里记录的路径）
        if not _video_url:
            _fm_video = str((frontmatter.get("media") or {}).get("video", {}).get("url") or "").strip()
            if _fm_video and not _fm_video.startswith(("http://", "https://")):
                _video_url = to_static_url(_fm_video)
            elif _fm_video:
                _video_url = _fm_video
        _vid_dir = DATA_DIR / "workspaces" / workspace_id / "videos"
        if not _video_url and _vid_dir.is_dir():
            _vid_files = sorted(_vid_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
            if _vid_files:
                _video_url = to_static_url(_vid_files[0])
        if not _video_url:
            _video_url = item.source_value if item.source == "url" else ""
        duration = float(results.get("duration_sec") or results.get("duration") or 0)
        media["video"] = {"url": _video_url, "duration": duration}
        frames_data = results.get("frames") or []
        media["frames"] = []
        for f in frames_data:
            fp = f.get("frame_image_path") or f.get("image_path") or ""
            sec = f.get("sec", 0)
            media["frames"].append({"sec": sec, "url": fp if fp.startswith("/static/") else to_static_url(fp)})
        # transcript：与 GET 同逻辑，统一规范成 [{t_sec, t_str, text}]（修复保存后变 string → 暂无字幕）
        transcript = _note_transcript(results, nd)

    elif item_type == "audio":
        media["audio"] = _note_audio_url(workspace_id, item, results, frontmatter)
        transcript = _note_transcript(results, nd)

    # summary_hint：图文内容分类结果（与 GET 同逻辑）
    summary_hint: Dict[str, Any] = {}
    _cc = results.get("content_category")
    if _cc:
        summary_hint["content_category"] = _cc
    _dst = results.get("default_summary_template")
    if not _dst:
        _dst = _default_summary_template_for_item(item, results)
    if _dst:
        summary_hint["default_template"] = _dst

    return {
        "frontmatter": frontmatter,
        "source_md": source_md,
        "note_md": note_content,
        "summaries": summaries,
        "note_dir": str(nd),
        "media": media,
        "transcript": transcript,
        "summary_hint": summary_hint,
    }


@router.get("/{workspace_id}/items/{item_id}/note/versions")
def list_note_versions(workspace_id: str, item_id: str) -> List[Dict[str, Any]]:
    item = _store.get_item(workspace_id, item_id)
    return [
        {key: value for key, value in version.items() if key != "body_md"}
        for version in _note_versions.list(item.content_id)
    ]


@router.get("/{workspace_id}/items/{item_id}/note/versions/{version_id}")
def get_note_version(
    workspace_id: str, item_id: str, version_id: str,
) -> Dict[str, Any]:
    item = _store.get_item(workspace_id, item_id)
    try:
        return _note_versions.get(item.content_id, version_id)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err


@router.post("/{workspace_id}/items/{item_id}/note/versions/{version_id}/restore")
def restore_note_version(
    workspace_id: str, item_id: str, version_id: str,
) -> Dict[str, Any]:
    item = _store.get_item(workspace_id, item_id)
    try:
        version = _note_versions.get(item.content_id, version_id)
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    return update_item_note(
        workspace_id,
        item_id,
        NoteUpdateRequest(body=version["body_md"], version_source="RESTORE"),
    )


class AdoptSiblingRequest(BaseModel):
    sibling_content_id: str


@router.post("/{workspace_id}/items/{item_id}/note/adopt-sibling")
def adopt_sibling_note(
    workspace_id: str, item_id: str, req: AdoptSiblingRequest,
) -> Dict[str, Any]:
    current = _store.get_item(workspace_id, item_id)
    sibling_location = next(
        (
            (record.workspace_id, sibling.item_id)
            for record in _store.list_all(include_trashed=False)
            for sibling in record.items
            if sibling.content_id == req.sibling_content_id
            and sibling.lineage_id == current.lineage_id
            and sibling.content_id != current.content_id
        ),
        None,
    )
    if sibling_location is None:
        raise HTTPException(status_code=404, detail="sibling content not found")
    sibling_note = get_item_note(*sibling_location)
    body = _extract_note_body(str(sibling_note.get("note_md") or ""))
    return update_item_note(
        workspace_id,
        item_id,
        NoteUpdateRequest(body=body, version_source="ADOPT_FROM_SIBLING"),
    )


@router.get("/{workspace_id}/items/{item_id}/note/export")
def export_item_note(workspace_id: str, item_id: str, format: str = "obsidian") -> StreamingResponse:
    """导出单素材 NoteShell 笔记。"""

    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    nd = note_dir(workspace_id, item_id)
    note_path = nd / "note.md"
    if not note_path.exists():
        if item.related_task_ids:
            for tid in reversed(item.related_task_ids):
                task = _pipeline_runner.store.get(tid)
                if task and task.result:
                    merged = dict(item.results or {})
                    merged.update(task.result)
                    item.results = merged
                    break
        assemble_item_note(workspace_id, item_id, _item=item)

    if not note_path.exists():
        raise HTTPException(status_code=404, detail="note not generated")

    note_md = note_path.read_text(encoding="utf-8")
    source_path = nd / "source.md"
    source_md = source_path.read_text(encoding="utf-8") if source_path.exists() else ""
    return build_note_export_response(
        workspace_id=workspace_id,
        item_id=item_id,
        item=item,
        note_md=note_md,
        source_md=source_md,
        format=format,
    )


# ── InlineFrames（学习模式视频按需补图）───────────────────────────


@router.get("/{workspace_id}/items/{item_id}/inline-frames")
def list_inline_frames(workspace_id: str, item_id: str) -> List[Dict[str, Any]]:
    """列出已插入的帧（按 segment_idx 排序）。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)
    frames = sorted(item.inline_frames, key=lambda f: f.segment_idx)
    return [f.to_dict() for f in frames]


@router.get("/{workspace_id}/items/{item_id}/inline-frames/suggested")
def get_suggested_inline_frames(workspace_id: str, item_id: str) -> List[Dict[str, Any]]:
    """临时计算返回系统推荐的帧位置（不持久化）。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    if item.preflight.intent != "learning":
        return []

    results = item.results or {}
    # av_combined 路径的 frames 在 json_outputs 里，需要物化
    # R3.4 fix: 传 preferred_basenames 防帧串台
    if not results.get("frames") and results.get("json_outputs"):
        _pb = list(results.get("json_output_basenames") or [])
        results = _materialize_video_results_from_analyze(results, preferred_basenames=_pb)
    frames = results.get("frames") or []
    transcript = results.get("transcript") or []

    if not frames or not transcript:
        return []

    from backend.app.services.inline_frame_suggester import suggest_inline_frames

    # transcript 格式：Video 用 { t_sec, t_str, text }，转成 { start, text }
    segments = []
    for t in transcript:
        start = t.get("t_sec") or _ts_str_to_sec(t.get("t_str", "0:00"))
        segments.append({"start": start, "text": t.get("text", "")})

    return suggest_inline_frames(frames, segments)


def _ts_str_to_sec(ts: str) -> float:
    """把 'MM:SS' 或 'HH:MM:SS' 转成秒数。"""
    parts = str(ts).strip().split(":")
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except ValueError:
        pass
    return 0.0


class InlineFramesSaveRequest(BaseModel):
    inline_frames: List[Dict[str, Any]]


@router.put("/{workspace_id}/items/{item_id}/inline-frames")
def save_inline_frames(
    workspace_id: str, item_id: str, req: InlineFramesSaveRequest
) -> Dict[str, Any]:
    """整体覆盖式保存 inline_frames。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    _find_item(rec, item_id)

    frames = [InlineFrame.from_dict(f) for f in req.inline_frames]
    saved = _store.save_inline_frames(workspace_id, item_id, frames)
    return {"status": "saved", "count": len(saved)}


# ── 音乐教学拆解（A-4） ──────────────────────────────────────────

class MusicTeachingRequest(BaseModel):
    bpm: float = Field(..., description="BPM")
    key: str = Field(..., description="调性")
    music_prompt: str = Field("", description="音乐提示词")


@router.post("/{workspace_id}/items/{item_id}/music-teaching/{seg_idx}")
async def music_teaching(
    workspace_id: str,
    item_id: str,
    seg_idx: int,
    req: MusicTeachingRequest,
) -> Dict[str, str]:
    """为指定音乐段生成「为什么动人」的教学解释。"""
    from fastapi.concurrency import run_in_threadpool
    from backend.app.services.music_teaching_prompts import (
        MusicTeachingRequest as TeachingReq,
        generate_teaching_explanation,
    )

    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    item = _find_item(rec, item_id)

    # 验证 seg_idx 有效性
    results = item.results or {}
    music_segments = results.get("music_segments") or []
    if seg_idx < 0 or seg_idx >= len(music_segments):
        raise HTTPException(status_code=400, detail=f"无效的段索引: {seg_idx}")

    teaching_req = TeachingReq(
        bpm=req.bpm,
        key=req.key,
        music_prompt=req.music_prompt,
    )

    # 复用 chat_runner
    from backend.app.services import chat_runner

    try:
        explanation = await run_in_threadpool(
            lambda: generate_teaching_explanation(teaching_req, chat_runner)
        )
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {err}") from err

    return {"explanation": explanation}


# ── 融合（Merge） ──────────────────────────────────────────


def _strip_frontmatter(md: str) -> str:
    """移除 markdown 头部的 YAML frontmatter（--- 块）。"""
    if md.startswith("---\n"):
        parts = md.split("---\n", 2)
        if len(parts) >= 3:
            return parts[2].lstrip("\n")
    return md


class MergeRequest(BaseModel):
    item_ids: List[str]
    style: str = "综合大纲"  # 融合风格：综合大纲 / 知识图谱 / 精华摘要


@router.post("/{workspace_id}/merge")
def merge_notes(workspace_id: str, req: MergeRequest) -> Dict[str, Any]:
    """融合：取选中素材的笔记 → LLM 合成综合笔记 → 存合集级 merged_notes。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")

    if len(req.item_ids) < 2:
        raise HTTPException(status_code=400, detail="融合至少需要 2 个素材")

    # 收集选中素材的笔记内容
    notes_to_merge: List[str] = []
    for item_id in req.item_ids:
        item = next((it for it in rec.items if it.item_id == item_id), None)
        if item is None:
            continue
        nd = note_dir(workspace_id, item_id)
        note_path = nd / "note.md"
        if not note_path.exists():
            continue
        raw_md = note_path.read_text(encoding="utf-8")
        md_body = _strip_frontmatter(raw_md).strip()
        if md_body:
            label = item.name or "未命名素材"
            notes_to_merge.append(f"## {label}\n\n{md_body}")

    if not notes_to_merge:
        raise HTTPException(status_code=400, detail="选中的素材均无笔记内容")

    # 调用 LLM 合成综合笔记
    combined = "\n\n---\n\n".join(notes_to_merge)

    # 按风格选择不同的 prompt
    style_prompts = {
        "综合大纲": "你是一个内容整合助手。请阅读以下多篇素材笔记，将它们融合成一篇**连贯、有条理的综合笔记**。\n\n要求：\n1. 提炼各素材的共同主题和关键信息\n2. 按逻辑结构组织（如：概述、要点、对比分析、总结）\n3. 保留重要细节，删除冗余\n4. 用 Markdown 格式输出（h2/h3 + 正文 + 列表）",
        "知识图谱": "你是一个知识整理助手。请阅读以下多篇素材笔记，提取其中的**核心概念和它们之间的关系**，组织成知识图谱式的笔记。\n\n要求：\n1. 识别所有关键概念（人物、术语、理论、事件等）\n2. 标注概念之间的关系（因果、包含、对比、时序等）\n3. 用 Markdown 格式输出，使用层级标题和列表呈现知识结构\n4. 在末尾附一个「概念关系总览」小节，用列表列出关键关系",
        "精华摘要": "你是一个信息提炼助手。请阅读以下多篇素材笔记，提取每篇的**核心精华**，合并成一份精炼摘要。\n\n要求：\n1. 每个素材提炼 2-4 条最关键的要点\n2. 合并重复观点，按主题归类\n3. 使用简洁的要点列表 + 一句话总结\n4. 全文不超过 1500 字，用 Markdown 格式输出",
    }
    prompt = style_prompts.get(req.style, style_prompts["综合大纲"])
    prompt = prompt + f"\n\n素材笔记如下：\n\n{combined}\n\n请输出综合笔记的 Markdown 正文（不要包含 frontmatter）："

    try:
        from backend.app.services.av_synthesis.llm import _call_llm  # noqa: PLC0415
        from shared.settings_store import load_settings as _load_s  # noqa: PLC0415

        _s = _load_s()
        api_key = (_s.openai_api_key or "").strip()
        if not api_key:
            raise HTTPException(status_code=503, detail="未配置 API Key，无法调用 LLM")

        merged_md = _call_llm(prompt, api_key, max_tokens=6000, temperature=0.4).strip()
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"LLM 调用失败: {err}") from err

    # 存入合集级载体（不新增 item，避免污染素材网格）
    merged = MergedNote(
        title=f"{req.style} - 综合笔记",
        item_ids=req.item_ids,
        content_md=merged_md,
    )
    rec.merged_notes.append(merged)
    _store.update(workspace_id, merged_notes=rec.merged_notes)

    return merged.to_dict()


@router.get("/{workspace_id}/merged-notes")
def list_merged_notes(workspace_id: str) -> List[Dict[str, Any]]:
    """列出合集内的全部融合笔记。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    return [mn.to_dict() for mn in rec.merged_notes]


@router.get("/{workspace_id}/merged-notes/{merged_id}")
def get_merged_note(workspace_id: str, merged_id: str) -> Dict[str, Any]:
    """获取单条融合笔记详情。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    mn = next((m for m in rec.merged_notes if m.merged_id == merged_id), None)
    if mn is None:
        raise HTTPException(status_code=404, detail=f"merged note not found: {merged_id}")
    return mn.to_dict()


@router.delete("/{workspace_id}/merged-notes/{merged_id}")
def delete_merged_note(workspace_id: str, merged_id: str) -> Dict[str, str]:
    """删除单条融合笔记。"""
    rec = _store.get(workspace_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"workspace not found: {workspace_id}")
    before = len(rec.merged_notes)
    rec.merged_notes = [m for m in rec.merged_notes if m.merged_id != merged_id]
    if len(rec.merged_notes) == before:
        raise HTTPException(status_code=404, detail=f"merged note not found: {merged_id}")
    _store.update(workspace_id, merged_notes=rec.merged_notes)
    return {"msg": "deleted"}
