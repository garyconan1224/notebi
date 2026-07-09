"""Local ASR with mlx-whisper (Apple Silicon only).

签名对齐 asr_fast_whisper.transcribe_file_with_fast_whisper，
使 asr_router 可以用统一接口调用两者。
"""

from __future__ import annotations

import os
import platform
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

_last_probe_error: Optional[Tuple[str, str, str]] = None

# mlx-community Whisper 仓库命名不统一：常规版本是 'whisper-{size}-mlx'，
# turbo 例外没有 -mlx 后缀。
MLX_MODEL_MAP: dict[str, str] = {
    "tiny": "mlx-community/whisper-tiny-mlx",
    "base": "mlx-community/whisper-base-mlx",
    "small": "mlx-community/whisper-small-mlx",
    "medium": "mlx-community/whisper-medium-mlx",
    "large-v1": "mlx-community/whisper-large-v1-mlx",
    "large-v2": "mlx-community/whisper-large-v2-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
}


def resolve_mlx_repo_id(model_size: str) -> str:
    if model_size not in MLX_MODEL_MAP:
        raise ValueError(
            f"不支持的 MLX Whisper 模型大小: {model_size}。"
            f"可选: {', '.join(MLX_MODEL_MAP)}"
        )
    return MLX_MODEL_MAP[model_size]


def is_mlx_whisper_available() -> bool:
    """轻量级探活：检测 mlx_whisper 是否可导入（不加载模型）。"""
    global _last_probe_error
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        _last_probe_error = ("PlatformError", "mlx-whisper 仅支持 macOS arm64", "")
        return False
    try:
        import mlx_whisper  # noqa: F401
        _last_probe_error = None
        return True
    except Exception as err:  # noqa: BLE001
        _last_probe_error = (
            type(err).__name__,
            str(err),
            traceback.format_exc(),
        )
        return False


def get_last_probe_error() -> Optional[Tuple[str, str, str]]:
    return _last_probe_error


class _DownloadProgressAggregator:
    """线程安全的下载进度聚合器，供 snapshot_download 的 tqdm_class 使用。

    snapshot_download 会把 tqdm_class 交给 thread_map 包裹文件列表；
    这里按已完成文件数统一上报 progress_callback。
    """

    _lock = threading.Lock()
    _total_bytes: int = 0
    _done_bytes: int = 0
    _files_done: int = 0
    _files_total: int = 0
    _callback: Optional[Callable[[float, str], None]] = None
    _log_callback: Optional[Callable[[str], None]] = None
    _download_started: bool = False

    @classmethod
    def reset(
        cls,
        progress_callback: Optional[Callable[[float, str], None]],
        log_callback: Optional[Callable[[str], None]],
    ) -> None:
        with cls._lock:
            cls._total_bytes = 0
            cls._done_bytes = 0
            cls._files_done = 0
            cls._files_total = 0
            cls._callback = progress_callback
            cls._log_callback = log_callback
            cls._download_started = False

    @classmethod
    def _report(cls) -> None:
        with cls._lock:
            cb = cls._callback
            total = cls._total_bytes
            done = cls._done_bytes
            fd = cls._files_done
            ft = cls._files_total
        if not cb:
            return
        if total > 0:
            ratio = min(0.99, done / total)
            done_mb = done / 1024 / 1024
            total_mb = total / 1024 / 1024
            msg = f"📥 下载模型 | {done_mb:.0f}/{total_mb:.0f} MB | {fd}/{ft} files"
            try:
                cb(ratio, msg)
            except Exception:  # noqa: BLE001
                pass
        elif ft > 0:
            ratio = min(1.0, fd / ft)
            msg = f"📥 下载模型 | {fd}/{ft} files"
            try:
                cb(ratio, msg)
            except Exception:  # noqa: BLE001
                pass


class _FileProgress:
    """snapshot_download 的 tqdm_class 代理。

    huggingface_hub.snapshot_download 会把 tqdm_class 传给 thread_map，
    因此这里跟踪的是已完成文件数，不是单文件字节数。
    """

    _lock = threading.RLock()

    @classmethod
    def get_lock(cls) -> Any:
        return cls._lock

    @classmethod
    def set_lock(cls, lock: Any) -> None:
        cls._lock = lock

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._iterable = args[0] if args else None
        try:
            total = int(kwargs.get("total", 0) or 0)
        except (TypeError, ValueError):
            total = 0
        with _DownloadProgressAggregator._lock:
            _DownloadProgressAggregator._files_total = max(
                _DownloadProgressAggregator._files_total,
                total,
            )
            if not _DownloadProgressAggregator._download_started:
                _DownloadProgressAggregator._download_started = True
                log_cb = _DownloadProgressAggregator._log_callback
                if log_cb:
                    try:
                        log_cb(f"📥 开始下载模型文件...")
                    except Exception:  # noqa: BLE001
                        pass
        self._total = total
        self._done = 0

    def __iter__(self) -> Any:
        if self._iterable is None:
            return iter(())
        for item in self._iterable:
            yield item
            self.update(1)

    def update(self, n: int = 1) -> None:
        if n <= 0:
            return
        prev = self._done
        self._done = min(self._total, prev + n) if self._total else prev + n
        delta = self._done - prev
        if delta > 0:
            with _DownloadProgressAggregator._lock:
                _DownloadProgressAggregator._files_done += delta
            _DownloadProgressAggregator._report()

    def close(self) -> None:
        if self._total and self._done < self._total:
            self.update(self._total - self._done)

    # tqdm duck-type：让 snapshot_download 不报错
    def set_description(self, desc: str) -> None:
        pass

    def set_postfix(self, **kwargs: Any) -> None:
        pass

    def refresh(self) -> None:
        pass

    def unpause(self) -> None:
        pass

    def clear(self) -> None:
        pass

    def display(self) -> None:
        pass

    def __enter__(self) -> "_FileProgress":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


def _ensure_model_downloaded(
    repo_id: str,
    *,
    log_callback: Optional[Callable[[str], None]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> str:
    """确保模型已下载到本地缓存，返回本地路径。

    使用 huggingface_hub.snapshot_download + 自定义 tqdm class，
    通过 progress_callback 实时推送逐文件下载进度。
    """
    from huggingface_hub import snapshot_download

    def _emit(msg: str) -> None:
        if log_callback:
            try:
                log_callback(msg)
            except Exception:  # noqa: BLE001
                pass

    def _emit_progress(ratio: float, msg: str) -> None:
        if progress_callback:
            try:
                progress_callback(max(0.0, min(1.0, ratio)), msg)
            except Exception:  # noqa: BLE001
                pass

    _emit(f"📥 下载 mlx-whisper 模型 | repo={repo_id}")
    _emit_progress(0.0, "开始下载...")

    _DownloadProgressAggregator.reset(progress_callback, log_callback)

    local_dir = snapshot_download(
        repo_id,
        local_dir_use_symlinks=False,
        tqdm_class=_FileProgress,
    )

    _emit_progress(1.0, "模型下载完成")
    _emit(f"✅ 模型已就绪 | path={local_dir}")
    return local_dir


def transcribe_file_with_mlx_whisper(
    file_path: str | Path,
    *,
    model_name: str = "base",
    language: str = "",
    initial_prompt: str = "",
    log_callback: Optional[Callable[[str], None]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    return_segments: bool = False,
) -> "str | tuple[str, list[dict[str, Any]], float]":
    """用 mlx-whisper 转录本地音/视频文件。

    签名对齐 asr_fast_whisper.transcribe_file_with_fast_whisper。
    """
    import mlx_whisper

    def _emit(msg: str) -> None:
        if log_callback:
            try:
                log_callback(msg)
            except Exception:  # noqa: BLE001
                pass

    def _emit_progress(ratio: float, msg: str) -> None:
        if progress_callback:
            try:
                progress_callback(max(0.0, min(1.0, ratio)), msg)
            except Exception:  # noqa: BLE001
                pass

    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"转录文件不存在: {path}")

    repo_id = resolve_mlx_repo_id(model_name)

    # 确保模型已下载（带进度回调）
    _ensure_model_downloaded(
        repo_id,
        log_callback=log_callback,
        progress_callback=progress_callback,
    )

    _emit(f"🧠 mlx-whisper 开始转录 | model={model_name} lang={language or 'auto'}")
    _emit_progress(0.0, "转录中...")
    t0 = time.perf_counter()

    transcribe_kwargs: dict[str, Any] = {}
    if language:
        transcribe_kwargs["language"] = language
    if initial_prompt:
        transcribe_kwargs["initial_prompt"] = initial_prompt

    result = mlx_whisper.transcribe(
        str(path),
        path_or_hf_repo=repo_id,
        **transcribe_kwargs,
    )

    elapsed = time.perf_counter() - t0
    segments_raw = result.get("segments", [])
    detected_lang = result.get("language", "unknown")

    parts: List[str] = []
    seg_dicts: List[Dict[str, Any]] = []
    for seg in segments_raw:
        text = str(seg.get("text", "")).strip()
        if text:
            parts.append(text)
            seg_dicts.append({
                "start": float(seg.get("start", 0.0)),
                "end": float(seg.get("end", 0.0)),
                "text": text,
            })

    total_duration = seg_dicts[-1]["end"] if seg_dicts else 0.0
    _emit_progress(1.0, "转录完成")
    _emit(f"✅ mlx-whisper 转录完成 | {len(seg_dicts)} 段 | {elapsed:.1f}s | lang={detected_lang}")

    text_out = "\n".join(parts).strip()
    if return_segments:
        return text_out, seg_dicts, total_duration
    return text_out
