"""Q3 / D4：媒体导出服务。

- 原视频：流式复制已有本地媒体，绝不重新编码；
- 软字幕：媒体 + SRT/VTT 打包 zip；
- 烧录字幕：ffmpeg 后台任务，支持进度 / 取消 / 失败清理临时文件。

错误一律「可操作」：说明缺什么 + 替代路径（spec §5.3）。
"""

from __future__ import annotations

import io
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from shared.audio_analyzer import export_ass, export_srt, export_vtt


class MediaExportError(Exception):
    """带用户可操作信息的导出错误。"""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def resolve_local_media_from_url(url: str, data_dir: Path) -> Optional[Path]:
    """仅依据 URL 解析本地路径（不做 item 结构推断）。"""
    if not url:
        return None
    if url.startswith("/static/"):
        rel = url[len("/static/"):]
        path = (data_dir / rel).resolve()
        if path.exists() and str(path).startswith(str(data_dir.resolve())):
            return path
        return None
    p = Path(url)
    return p if p.exists() else None


def resolve_local_media_path(item: Any, data_dir: Path) -> Optional[Path]:
    """把 item 的 /static/... 媒体 URL 解析为本地真实路径；不存在返回 None。"""
    media = getattr(item, "results", None) or {}
    media_obj = media.get("media") or {}
    url = ""
    video = media_obj.get("video") or {}
    if isinstance(video, dict) and video.get("url"):
        url = str(video["url"])
    elif media_obj.get("audio"):
        url = str(media_obj["audio"])
    if not url:
        # 兜底：直接从 results 顶层找（与 note payload 相同的提取口径）
        url = str(media.get("video_url") or media.get("audio_url") or "")
    return resolve_local_media_from_url(url, data_dir)


def collect_segments(results: Dict[str, Any]) -> List[Dict[str, Any]]:
    """三级降级查找并归一化字幕 segments（与 export.py 同口径）。"""
    raw = (
        results.get("segments")
        or results.get("transcript_segments")
        or results.get("transcript")
        or []
    )
    if isinstance(raw, str) or not raw:
        return []
    if not (isinstance(raw, list) and raw and isinstance(raw[0], dict)):
        return []
    segments: List[Dict[str, Any]] = []
    for i, seg in enumerate(raw):
        start = seg.get("start")
        end = seg.get("end")
        if start is None:
            start = seg.get("t_sec")
        if start is None:
            continue
        start = float(start)
        if end is None:
            nxt = raw[i + 1] if i + 1 < len(raw) else None
            nxt_start = float(nxt.get("start") or nxt.get("t_sec") or 0) if nxt else 0
            end = nxt_start if nxt_start > start else start + 5.0
        text = str(seg.get("text") or "").strip()
        if not text:
            continue
        segments.append({
            "start": start,
            "end": float(end),
            "text": text,
            "speaker": str(seg.get("speaker") or ""),
        })
    return segments


def build_subtitle_content(
    segments: List[Dict[str, Any]],
    subtitle_format: str,
    title: str,
) -> str:
    if subtitle_format == "srt":
        return export_srt(segments)
    if subtitle_format == "vtt":
        return export_vtt(segments)
    if subtitle_format == "ass":
        return export_ass(segments, title=title)
    raise MediaExportError(400, f"不支持的字幕格式：{subtitle_format}（可选 srt/vtt/ass）")


def build_softsub_zip(
    media_path: Path,
    subtitle_content: str,
    subtitle_ext: str,
    base_name: str,
) -> bytes:
    """媒体文件 + 字幕打包为 zip（软字幕，不重编码）。"""
    safe = base_name.replace("/", "_").replace("\\", "_")[:60] or "media"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(media_path, arcname=f"{safe}{media_path.suffix}")
        zf.writestr(f"{safe}.{subtitle_ext}", subtitle_content)
    return buf.getvalue()


def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


# ── 烧录任务管理 ────────────────────────────────────────────────

_BURN_STATUS = ("pending", "running", "done", "failed", "cancelled")


@dataclass
class BurnTask:
    task_id: str
    item_id: str
    workspace_id: str
    status: str = "pending"
    progress: float = 0.0
    output_url: str = ""
    error: str = ""
    duration_sec: float = 0.0
    _proc: Optional[subprocess.Popen] = field(default=None, repr=False)
    _tmp_path: Optional[Path] = field(default=None, repr=False)


class BurnTaskRegistry:
    """进程内烧录任务表。取消/失败负责清理临时文件。"""

    def __init__(self) -> None:
        self._tasks: Dict[str, BurnTask] = {}
        self._lock = threading.Lock()

    def create(self, item_id: str, workspace_id: str) -> BurnTask:
        task = BurnTask(task_id=f"burn-{uuid.uuid4().hex[:10]}", item_id=item_id, workspace_id=workspace_id)
        with self._lock:
            self._tasks[task.task_id] = task
        return task

    def get(self, task_id: str) -> Optional[BurnTask]:
        with self._lock:
            return self._tasks.get(task_id)

    def _cleanup(self, task: BurnTask) -> None:
        if task._tmp_path and task._tmp_path.exists():
            try:
                task._tmp_path.unlink()
            except OSError:
                pass
            task._tmp_path = None

    def cancel(self, task_id: str) -> Optional[BurnTask]:
        task = self.get(task_id)
        if task is None:
            return None
        if task.status in ("done", "failed", "cancelled"):
            return task
        task.status = "cancelled"
        if task._proc and task._proc.poll() is None:
            try:
                task._proc.terminate()
            except Exception:  # noqa: BLE001
                pass
        self._cleanup(task)
        return task


burn_registry = BurnTaskRegistry()

_TIME_RE = re.compile(r"out_time_ms=(\d+)")


def run_burn_subtitles(
    task: BurnTask,
    media_path: Path,
    srt_path: Path,
    output_path: Path,
    font_name: str = "",
    font_size: int = 0,
) -> None:
    """在后台线程执行 ffmpeg 烧录；进度写 task.progress，结束更新状态。"""
    task.status = "running"
    task._tmp_path = output_path

    srt_escaped = str(srt_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    force_style = ""
    if font_name or font_size:
        parts = []
        if font_name:
            parts.append(f"FontName={font_name}")
        if font_size:
            parts.append(f"FontSize={font_size}")
        force_style = f":force_style='{','.join(parts)}'"

    cmd = [
        "ffmpeg", "-y", "-v", "error", "-progress", "pipe:1",
        "-i", str(media_path),
        "-vf", f"subtitles='{srt_escaped}'{force_style}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "copy",
        str(output_path),
    ]
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        task._proc = proc
        if task.duration_sec > 0 and proc.stdout:
            for line in proc.stdout:
                m = _TIME_RE.search(line)
                if m:
                    elapsed = int(m.group(1)) / 1_000_000
                    task.progress = min(0.99, elapsed / task.duration_sec)
                if task.status == "cancelled":
                    break
        proc.wait()
        if task.status == "cancelled":
            burn_registry._cleanup(task)
            return
        if proc.returncode == 0 and output_path.exists():
            task.status = "done"
            task.progress = 1.0
            task._tmp_path = None
        else:
            err = proc.stderr.read() if proc.stderr else ""
            task.status = "failed"
            task.error = f"ffmpeg 烧录失败：{err.strip()[:300] or '未知错误'}"
            burn_registry._cleanup(task)
    except FileNotFoundError:
        task.status = "failed"
        task.error = "未找到 ffmpeg：无法烧录字幕。可改用「软字幕」打包导出。"
        burn_registry._cleanup(task)
