from __future__ import annotations

"""BiliNote 兼容适配层（Phase A.2 重写）。

目标：把 BiliNote 风格的 `/api/*` 请求薄包装后转发到 Nibi
pipeline 任务引擎（`backend/app/routes/pipeline.py` 的 `_store` / `_runner`），
避免出现第二套独立任务引擎。

- 响应统一包装为 ``{"code": 0, "msg": "", "data": {...}}``。
- 任务状态机映射：内部 v1.1 §11 阶段名 → BiliNote 7 态
  （PENDING/PARSING/DOWNLOADING/TRANSCRIBING/SUMMARIZING/SUCCESS/FAILED）。
- 路由前缀 ``/api``，与现有 ``/pipeline`` / ``/providers`` 共存。
"""

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import httpx
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.app.models.tasks import LEGACY_STATUS_MAP, TERMINAL_STATUS_VALUES, TaskStatus
from backend.app.routes.pipeline import _runner as _pipeline_runner
from backend.app.routes.pipeline import _store as _pipeline_store
from shared.config import ROOT_DIR, ensure_workspace_dirs, get_workspace_videos_dir
from shared.settings_store import load_settings

router = APIRouter(prefix="/api", tags=["bilinote-compat"])


# ── 响应封装 ──────────────────────────────────────────────────


class BiliNoteResponse(BaseModel):
    """统一响应包装 `{code, msg, data}`（对齐 BiliNote 协议）。"""

    code: int = 0
    msg: str = ""
    data: Optional[Dict[str, Any]] = None


def _ok(data: Optional[Dict[str, Any]] = None, msg: str = "") -> BiliNoteResponse:
    return BiliNoteResponse(code=0, msg=msg, data=data)


def _err(msg: str, *, code: int = 1, data: Optional[Dict[str, Any]] = None) -> BiliNoteResponse:
    return BiliNoteResponse(code=code, msg=msg, data=data)


# ── 辅助：当前项目解析 ────────────────────────────────────────
# 后端进程无 streamlit 上下文，直接读取 `.local/current_project.json`；
# 若文件缺失则兜底为 "default_project"（与 shared.config._sanitize_workspace_id 兜底一致）。
_CURRENT_PROJECT_PATH: Path = ROOT_DIR / ".local" / "current_project.json"


def _resolve_project_id(project_id: Optional[str]) -> str:
    pid = (project_id or "").strip()
    if pid:
        ensure_workspace_dirs(pid)
        return pid
    try:
        if _CURRENT_PROJECT_PATH.is_file():
            data = json.loads(_CURRENT_PROJECT_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                saved = str(data.get("project_id") or "").strip()
                if saved:
                    ensure_workspace_dirs(saved)
                    return saved
    except Exception:
        pass
    fallback = "default_project"
    ensure_workspace_dirs(fallback)
    return fallback


# ── 状态机映射 ────────────────────────────────────────────────
# BiliNote 前端仅识别 7 态：PENDING/PARSING/DOWNLOADING/TRANSCRIBING/SUMMARIZING/SUCCESS/FAILED
# 内部 v1.1 §11 阶段名 → BiliNote 兼容名 的映射。
_BILINOTE_STATUS_MAP: Dict[str, str] = {
    TaskStatus.PENDING.value: "PENDING",
    TaskStatus.DOWNLOAD.value: "DOWNLOADING",
    TaskStatus.PROBE.value: "PARSING",
    TaskStatus.FRAMES.value: "PARSING",
    TaskStatus.ASR.value: "TRANSCRIBING",
    TaskStatus.VLM.value: "SUMMARIZING",
    TaskStatus.SUM.value: "SUMMARIZING",
    TaskStatus.STORE.value: "SUMMARIZING",
    TaskStatus.SUCCESS.value: "SUCCESS",
    TaskStatus.FAILED.value: "FAILED",
    TaskStatus.CANCELLED.value: "FAILED",
}


def _map_status_for_bilinote(status: str) -> str:
    mapped = _BILINOTE_STATUS_MAP.get(status)
    if mapped is not None:
        return mapped
    # 兼容旧状态名
    old_mapped = LEGACY_STATUS_MAP.get(status)
    if old_mapped is not None:
        return _BILINOTE_STATUS_MAP.get(old_mapped.value, "PENDING")
    return "PENDING"


# ── 请求模型 ──────────────────────────────────────────────────


class VideoRequest(BaseModel):
    """BiliNote 风格请求体（字段对齐 docs/BILINOTE_ARCHITECTURE.md §6.2）。"""

    video_url: str
    platform: str = "bilibili"
    quality: Literal["fast", "medium", "slow"] = "medium"
    screenshot: bool = False
    link: bool = False
    model_name: str = ""
    provider_id: str = ""
    task_id: Optional[str] = None  # 传入表示重试
    format: List[str] = Field(default_factory=list)
    style: str = "academic"
    extras: Optional[str] = None
    video_understanding: bool = False
    video_interval: int = 0
    grid_size: List[int] = Field(default_factory=lambda: [3, 3])
# ── Nibi 扩展字段（BiliNote 原协议无）──
    project_id: Optional[str] = None
    task_type: Literal["download", "analyze", "storyboard", "note"] = "note"


class DeleteTaskRequest(BaseModel):
    """BiliNote 原协议使用 video_id + platform；我们兼容 task_id 扩展字段。"""

    task_id: Optional[str] = None
    video_id: Optional[str] = None
    platform: Optional[str] = None



# ── 路由实现 ──────────────────────────────────────────────────


@router.post("/generate_note", response_model=BiliNoteResponse)
def generate_note(req: VideoRequest) -> BiliNoteResponse:
    """创建（或重试）一条任务，委托给 pipeline 任务引擎执行。"""
    project_id = _resolve_project_id(req.project_id)

    # payload 保留 BiliNote 全量字段，便于后续 note handler 读取
    payload: Dict[str, Any] = {
        "url": req.video_url,
        "video_url": req.video_url,
        "platform": req.platform,
        "quality": req.quality,
        "screenshot": req.screenshot,
        "link": req.link,
        "model_name": req.model_name,
        "provider_id": req.provider_id,
        "format": list(req.format or []),
        "style": req.style,
        "extras": req.extras,
        "video_understanding": req.video_understanding,
        "video_interval": req.video_interval,
        "grid_size": list(req.grid_size or [3, 3]),
    }

    try:
        if req.task_id:
            # 重试：复用原任务的 project_id/task_type/payload
            rec = _pipeline_runner.retry_task(req.task_id)
        else:
            rec = _pipeline_runner.create_task(project_id, req.task_type, payload)
    except KeyError as err:
        return _err(f"task not found: {err}")
    except ValueError as err:
        return _err(str(err))
    except Exception as err:  # noqa: BLE001
        return _err(f"create task failed: {err}")

    return _ok({"task_id": rec.task_id})


@router.get("/task_status/{task_id}", response_model=BiliNoteResponse)
def task_status(task_id: str) -> BiliNoteResponse:
    """查询任务状态，按 BiliNote 协议裁剪字段并映射状态。"""
    rec = _pipeline_store.get(task_id)
    if rec is None:
        return _err(f"task not found: {task_id}")

    raw_status = rec.status if isinstance(rec.status, str) else str(rec.status)
    mapped_status = _map_status_for_bilinote(raw_status)

    # message：错误/取消态优先展示固定提示，否则取最后一条日志
    message = ""
    if raw_status == TaskStatus.CANCELLED.value:
        message = "已取消"
    elif raw_status == TaskStatus.FAILED.value:
        message = rec.error or "任务失败"
    elif rec.log:
        try:
            message = str(rec.log[-1].message or "")
        except Exception:
            message = ""

    data: Dict[str, Any] = {
        "task_id": rec.task_id,
        "status": mapped_status,
        "message": message,
    }

    if raw_status == TaskStatus.SUCCESS.value:
        # TaskRecord.result 是通用 dict，按 BiliNote 需要的字段归一：
        # markdown 优先取 result.markdown，否则回退到 create 任务的 result.content
        result_raw: Dict[str, Any] = dict(rec.result or {})
        audio_meta_raw = result_raw.get("audio_meta") or {}
        if not isinstance(audio_meta_raw, dict):
            audio_meta_raw = {}
        data["result"] = {
            "markdown": str(result_raw.get("markdown") or result_raw.get("content") or ""),
            "transcript": str(result_raw.get("transcript") or ""),
            "audio_meta": {
                "title": str(audio_meta_raw.get("title") or ""),
                "cover_url": str(audio_meta_raw.get("cover_url") or ""),
                "duration": int(audio_meta_raw.get("duration") or 0),
            },
        }

    return _ok(data)


@router.post("/delete_task", response_model=BiliNoteResponse)
def delete_task(req: DeleteTaskRequest) -> BiliNoteResponse:
    """删除一条已终结任务（对齐 pipeline 的终结态约束）。"""
    tid = (req.task_id or req.video_id or "").strip()
    if not tid:
        return _err("task_id or video_id required")

    rec = _pipeline_store.get(tid)
    if rec is None:
        return _err(f"task not found: {tid}")
    if rec.status not in TERMINAL_STATUS_VALUES:
        return _err(
            f"task {tid} is still {rec.status}; only terminal tasks can be deleted",
            code=409,
        )
    ok = _pipeline_store.delete(tid)
    if not ok:
        return _err("delete failed")
    return _ok({"task_id": tid, "deleted": True})



# 文件名里允许的字符白名单，其他统一替换为下划线，防止越权写入
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._\u4e00-\u9fff\-]+")


def _sanitize_upload_name(name: str) -> str:
    stem = Path(name or "").name or "upload.bin"
    return _SAFE_FILENAME_RE.sub("_", stem) or "upload.bin"


@router.post("/upload", response_model=BiliNoteResponse)
async def upload_video(
    file: UploadFile = File(...),
    project_id: Optional[str] = Form(default=None),
) -> BiliNoteResponse:
    """接收本地视频上传并保存到 `data/workspaces/<workspace>/videos/`。"""
    pid = _resolve_project_id(project_id)
    target_dir = get_workspace_videos_dir(pid)
    target_dir.mkdir(parents=True, exist_ok=True)

    safe_name = _sanitize_upload_name(file.filename or "upload.bin")
    dest = target_dir / safe_name
    try:
        content = await file.read()
        dest.write_bytes(content)
    except Exception as err:  # noqa: BLE001
        return _err(f"upload failed: {err}")

    # 相对工作区根目录的可访问路径（前端若需下载可走静态挂载或 proxy）
    try:
        rel = dest.resolve().relative_to(ROOT_DIR.resolve())
        url = "/" + str(rel).replace("\\", "/")
    except Exception:
        url = str(dest.resolve())
    return _ok({"url": url, "filename": safe_name, "project_id": pid})


@router.get("/image_proxy")
def image_proxy(url: str) -> StreamingResponse:
    """代理拉取图片（带 Referer，绕过 B 站防盗链）。直接返回图片流，不包装。"""
    target = (url or "").strip()
    if not target:
        return StreamingResponse(iter([b""]), status_code=400, media_type="text/plain")

    headers = {
        "Referer": "https://www.bilibili.com/",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0 Safari/537.36"
        ),
    }
    try:
        resp = httpx.get(target, headers=headers, timeout=15.0, follow_redirects=True)
    except Exception as err:  # noqa: BLE001
        return StreamingResponse(
            iter([str(err).encode("utf-8")]), status_code=502, media_type="text/plain"
        )

    media_type = resp.headers.get("content-type", "application/octet-stream")
    return StreamingResponse(
        iter([resp.content]), status_code=resp.status_code, media_type=media_type
    )

# 注：legacy `/api/provider/list` 与 `/api/model/list` 于 P2-11 下线；
# 前端与 Streamlit 均已统一走 `/providers/*`（`backend/app/routes/providers.py`）。
