"""ASR 引擎路由器：本地优先级 mlx-whisper > fast-whisper > remote HTTP。

Usage:
    from backend.app.services.asr_router import run_local_asr_with_fallback

    text, segments, duration, engine = run_local_asr_with_fallback(
        file_path="/path/to/audio.mp3",
        api_key="sk-...",       # 可选，用于 remote fallback
        api_base="https://...", # 可选
        model_name="base",
        log_callback=runner.append_log,
        progress_callback=runner.set_progress,
    )
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_OPENCC_T2S = None


def _to_simplified(text: str) -> str:
    """繁体→简体转换，OpenCC t2s 惰性单例。

    opencc 不可用时静默返回原文（与 asr_fast_whisper 行为一致）。
    """
    global _OPENCC_T2S
    if _OPENCC_T2S is None:
        try:
            from opencc import OpenCC
            _OPENCC_T2S = OpenCC("t2s")
        except Exception:
            _OPENCC_T2S = False  # type: ignore[assignment]
            return text
    if _OPENCC_T2S is False:
        return text
    try:
        return _OPENCC_T2S.convert(text)  # type: ignore[union-attr]
    except Exception:
        return text


def select_asr_engine(api_key: str = "") -> str:
    """选择 ASR 引擎，返回引擎名。

    优先级：mlx-whisper（macOS arm64）> fast-whisper > remote
    """
    # 1. mlx-whisper（Apple Silicon 优先）
    try:
        from backend.app.services.asr_mlx_whisper import is_mlx_whisper_available
        if is_mlx_whisper_available():
            return "mlx-whisper"
    except ImportError:
        pass

    # 2. fast-whisper
    try:
        from backend.app.services.asr_fast_whisper import is_fast_whisper_available
        if is_fast_whisper_available():
            return "fast-whisper"
    except ImportError:
        pass

    # 3. remote（需要 api_key）
    if api_key:
        return "remote"

    return "none"


def run_local_asr_with_fallback(
    file_path: str | Path,
    *,
    api_key: str = "",
    api_base: str = "",
    model_name: str = "base",
    audio_model: str = "",
    language: str = "",
    initial_prompt: str = "",
    log_callback: Optional[Callable[[str], None]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Tuple[str, List[Dict[str, Any]], float, str]:
    """按优先级尝试 ASR 引擎，返回 (text, segments, duration, engine_name)。

    全部失败时抛出 RuntimeError。
    """
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"ASR 文件不存在: {path}")

    errors: List[str] = []
    tried: List[str] = []

    def _emit(msg: str) -> None:
        if log_callback:
            try:
                log_callback(msg)
            except Exception:  # noqa: BLE001
                pass

    # ── 1. mlx-whisper ──────────────────────────────────────────
    try:
        from backend.app.services.asr_mlx_whisper import (
            is_mlx_whisper_available,
            transcribe_file_with_mlx_whisper,
        )
        if is_mlx_whisper_available():
            tried.append("mlx-whisper")
            _emit("🔍 选用 ASR 引擎：mlx-whisper")
            result = transcribe_file_with_mlx_whisper(
                file_path,
                model_name=model_name,
                language=language,
                initial_prompt=initial_prompt,
                log_callback=log_callback,
                progress_callback=progress_callback,
                return_segments=True,
            )
            text, segs, dur = result
            if text.strip():
                text = _to_simplified(text)
                for seg in segs:
                    seg["text"] = _to_simplified(seg.get("text", ""))
                return text, segs, dur, "mlx-whisper"
            errors.append("mlx-whisper: 转写结果为空")
    except Exception as err:
        errors.append(f"mlx-whisper: {err}")
        logger.warning("mlx-whisper 失败，尝试下一引擎: %s", err)

    # ── 2. fast-whisper ─────────────────────────────────────────
    try:
        from backend.app.services.asr_fast_whisper import (
            is_fast_whisper_available,
            transcribe_file_with_fast_whisper,
        )
        if is_fast_whisper_available():
            tried.append("fast-whisper")
            _emit("🔍 选用 ASR 引擎：fast-whisper")
            result = transcribe_file_with_fast_whisper(
                file_path,
                model_name=model_name,
                language=language,
                initial_prompt=initial_prompt,
                log_callback=log_callback,
                progress_callback=progress_callback,
                return_segments=True,
            )
            text, segs, dur = result
            if text.strip():
                text = _to_simplified(text)
                for seg in segs:
                    seg["text"] = _to_simplified(seg.get("text", ""))
                return text, segs, dur, "fast-whisper"
            errors.append("fast-whisper: 转写结果为空")
    except Exception as err:
        errors.append(f"fast-whisper: {err}")
        logger.warning("fast-whisper 失败，尝试下一引擎: %s", err)

    # ── 3. remote HTTP（需要 api_key）──────────────────────────
    if api_key:
        try:
            tried.append("remote")
            _emit("🔍 选用 ASR 引擎：remote HTTP")
            text, segs, dur = _transcribe_remote(
                file_path,
                api_key=api_key,
                api_base=api_base,
                audio_model=audio_model,
                language=language,
                log_callback=log_callback,
                progress_callback=progress_callback,
            )
            if text.strip():
                text = _to_simplified(text)
                for seg in segs:
                    seg["text"] = _to_simplified(seg.get("text", ""))
                return text, segs, dur, "remote"
            errors.append("remote: 转写结果为空")
        except Exception as err:
            errors.append(f"remote: {err}")
            logger.warning("remote ASR 失败: %s", err)

    # ── 全部失败 ───────────────────────────────────────────────
    detail = " | ".join(errors) if errors else "无可用 ASR 引擎"
    raise RuntimeError(f"ASR 全部失败（已尝试: {', '.join(tried) or '无'}）: {detail}")


def _transcribe_remote(
    file_path: str | Path,
    *,
    api_key: str,
    api_base: str = "",
    audio_model: str = "",
    language: str = "",
    log_callback: Optional[Callable[[str], None]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Tuple[str, List[Dict[str, Any]], float]:
    """通过 OpenAI 兼容 HTTP API 转写。"""
    import httpx

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

    base = (api_base or "https://api.openai.com/v1").rstrip("/")
    url = f"{base}/audio/transcriptions"

    _emit_progress(0.0, "上传音频到远程 ASR...")
    _emit(f"🌐 远程 ASR | endpoint={url}")

    path = Path(file_path)
    with open(path, "rb") as f:
        files = {"file": (path.name, f, "application/octet-stream")}
        data: dict[str, Any] = {"model": audio_model or "whisper-1", "response_format": "verbose_json"}
        if language:
            data["language"] = language
        resp = httpx.post(
            url,
            files=files,
            data=data,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=300,
        )
        resp.raise_for_status()

    result = resp.json()
    segments_raw = result.get("segments", [])
    seg_dicts = [
        {
            "start": float(s.get("start", 0.0)),
            "end": float(s.get("end", 0.0)),
            "text": str(s.get("text", "")).strip(),
        }
        for s in segments_raw
        if s.get("text", "").strip()
    ]
    text = "\n".join(s["text"] for s in seg_dicts)
    duration = seg_dicts[-1]["end"] if seg_dicts else float(result.get("duration", 0.0))

    _emit_progress(1.0, "远程转录完成")
    _emit(f"✅ 远程 ASR 完成 | {len(seg_dicts)} 段")

    return text, seg_dicts, duration
