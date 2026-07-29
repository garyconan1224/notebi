"""Small in-process manager for explicit local runtime-model downloads.

Model weights remain in their upstream caches; this service only exposes their
state and starts a background download after an explicit settings-page action.
It intentionally never runs a download during application startup.
"""

from __future__ import annotations

import platform
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from backend.app.services.asr_fast_whisper import (
    _MODEL_APPROX_SIZE_MB,
    _hf_hub_cache_dir,
    _scan_model_cache_bytes,
    is_model_cached,
)
from backend.app.services.asr_mlx_whisper import MLX_MODEL_MAP, resolve_mlx_repo_id
from shared.sherpa_diarizer import _model_root


_FAST_SIZES = ("tiny", "base", "small", "medium", "large-v3", "large-v3-turbo")
_jobs_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _repo_cached(repo_id: str) -> bool:
    root = _hf_hub_cache_dir() / f"models--{repo_id.replace('/', '--')}"
    snapshots = root / "snapshots"
    if not snapshots.is_dir():
        return False
    try:
        return not any(path.name.endswith(".incomplete") for path in (root / "blobs").glob("*"))
    except OSError:
        return False


def _job(model_id: str) -> dict[str, Any]:
    with _jobs_lock:
        return dict(_jobs.get(model_id, {}))


def _update(model_id: str, **values: Any) -> None:
    with _jobs_lock:
        current = _jobs.setdefault(model_id, {})
        current.update(values)
        current["updated_at"] = _now()


def _fast_status(size: str) -> dict[str, Any]:
    done, pending = _scan_model_cache_bytes(size)
    expected = int(_MODEL_APPROX_SIZE_MB.get(size, 0))
    job = _job(f"fast-whisper:{size}")
    cached = is_model_cached(size)
    progress = min(0.99, (done + pending) / (expected * 1024 * 1024)) if expected else float(job.get("progress") or 0)
    return {
        "model_id": f"fast-whisper:{size}",
        "family": "fast-whisper",
        "title": f"Faster Whisper · {size}",
        "description": "本地 CPU/CUDA 转写模型，可在转写设置中切换使用。",
        "estimated_size_mb": expected,
        "done_mb": round(done / 1024 / 1024, 1),
        "pending_mb": round(pending / 1024 / 1024, 1),
        "cached": cached,
        "compatible": True,
        "cache_dir": str(_hf_hub_cache_dir()),
        "status": "ready" if cached else str(job.get("status") or "not_downloaded"),
        "progress": 1.0 if cached else progress,
        "message": str(job.get("message") or "未下载"),
        "error": str(job.get("error") or ""),
    }


def _mlx_status(size: str) -> dict[str, Any]:
    repo_id = resolve_mlx_repo_id(size)
    job = _job(f"mlx-whisper:{size}")
    compatible = platform.system() == "Darwin" and platform.machine() == "arm64"
    cached = _repo_cached(repo_id)
    return {
        "model_id": f"mlx-whisper:{size}",
        "family": "mlx-whisper",
        "title": f"MLX Whisper · {size}",
        "description": "Apple Silicon 专用本地转写模型。",
        "estimated_size_mb": 0,
        "done_mb": 0,
        "pending_mb": 0,
        "cached": cached,
        "compatible": compatible,
        "cache_dir": str(_hf_hub_cache_dir()),
        "status": "ready" if cached else str(job.get("status") or "not_downloaded"),
        "progress": 1.0 if cached else float(job.get("progress") or 0),
        "message": str(job.get("message") or "未下载"),
        "error": str(job.get("error") or ""),
    }


def _sherpa_status() -> dict[str, Any]:
    root = _model_root()
    segment = root / "model.int8.onnx"
    embedding = root / "3dspeaker_eres2net_base_zh-cn_16k.onnx"
    cached = segment.is_file() and embedding.is_file()
    job = _job("sherpa-diarization")
    return {
        "model_id": "sherpa-diarization",
        "family": "speaker-diarization",
        "title": "说话人识别 · Sherpa ONNX",
        "description": "区分多人发言并支持姓名、角色和说话人总结。",
        "estimated_size_mb": 0,
        "done_mb": round(sum(path.stat().st_size for path in (segment, embedding) if path.is_file()) / 1024 / 1024, 1),
        "pending_mb": 0,
        "cached": cached,
        "compatible": True,
        "cache_dir": str(root),
        "status": "ready" if cached else str(job.get("status") or "not_downloaded"),
        "progress": 1.0 if cached else float(job.get("progress") or 0),
        "message": str(job.get("message") or "未下载"),
        "error": str(job.get("error") or ""),
    }


def _ocr_status() -> dict[str, Any]:
    job = _job("paddleocr-zh")
    # PaddleOCR owns the exact cache layout, which can change by runtime version.
    # Do not pretend we can prove persistence from a guessed filesystem path.
    ready_this_process = job.get("status") == "ready"
    return {
        "model_id": "paddleocr-zh",
        "family": "ocr",
        "title": "图片文字识别 · PaddleOCR 中文",
        "description": "从图片、幻灯片和截图中提取文字；模型由 Paddle 官方运行时管理。",
        "estimated_size_mb": 0,
        "done_mb": 0,
        "pending_mb": 0,
        "cached": ready_this_process,
        "compatible": True,
        "cache_dir": "由 PaddleOCR 运行时管理",
        "status": "ready" if ready_this_process else str(job.get("status") or "not_verified"),
        "progress": 1.0 if ready_this_process else float(job.get("progress") or 0),
        "message": str(job.get("message") or "尚未验证；首次下载后可立即使用"),
        "error": str(job.get("error") or ""),
    }


def list_local_models() -> list[dict[str, Any]]:
    return [
        *[_fast_status(size) for size in _FAST_SIZES],
        *[_mlx_status(size) for size in _FAST_SIZES if size in MLX_MODEL_MAP],
        _sherpa_status(),
        _ocr_status(),
    ]


def _run_download(model_id: str, report: Callable[[float, str], None]) -> None:
    family, _, variant = model_id.partition(":")
    if family == "fast-whisper" and variant in _FAST_SIZES:
        from huggingface_hub import snapshot_download
        report(0.03, "正在连接 Hugging Face 模型仓库")
        snapshot_download(f"Systran/faster-whisper-{variant}")
        report(1.0, "模型下载完成")
        return
    if family == "mlx-whisper" and variant in MLX_MODEL_MAP:
        if platform.system() != "Darwin" or platform.machine() != "arm64":
            raise RuntimeError("MLX Whisper 仅支持 Apple Silicon Mac")
        from backend.app.services.asr_mlx_whisper import _ensure_model_downloaded
        _ensure_model_downloaded(resolve_mlx_repo_id(variant), progress_callback=report)
        return
    if model_id == "sherpa-diarization":
        from shared.sherpa_diarizer import ensure_sherpa_models
        ensure_sherpa_models(progress_callback=report)
        report(1.0, "说话人识别模型已就绪")
        return
    if model_id == "paddleocr-zh":
        report(0.05, "正在初始化 PaddleOCR 官方模型")
        from shared.ocr_service import _get_engine
        _get_engine()
        report(1.0, "图片文字识别模型已就绪")
        return
    raise ValueError("未知本地模型")


def start_local_model_download(model_id: str) -> dict[str, Any]:
    known = {model["model_id"] for model in list_local_models()}
    if model_id not in known:
        raise KeyError(model_id)
    existing = _job(model_id)
    if existing.get("status") == "downloading":
        return existing

    _update(model_id, status="downloading", progress=0.0, message="等待开始下载", error="")

    def report(progress: float, message: str) -> None:
        _update(model_id, status="downloading", progress=max(0.0, min(0.99, progress)), message=message, error="")

    def worker() -> None:
        try:
            _run_download(model_id, report)
        except Exception as err:  # noqa: BLE001 - surfaced as a user-readable job result
            _update(model_id, status="failed", message="下载失败", error=str(err))
        else:
            _update(model_id, status="ready", progress=1.0, message="模型已就绪", error="")

    threading.Thread(target=worker, name=f"notebi-model-{model_id}", daemon=True).start()
    return _job(model_id)
