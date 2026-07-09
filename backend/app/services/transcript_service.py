from __future__ import annotations

"""Transcript service with subtitle-first fallback strategy."""

import io
import time
from typing import Any, Dict, List

from backend.app.services.asr_fast_whisper import transcribe_with_fast_whisper
from backend.app.services.asr_groq import transcribe_with_groq
from backend.app.services.subtitle_fetcher import fetch_best_subtitle


def _download_audio_bytes(url: str) -> bytes:
    try:
        import yt_dlp
    except Exception as err:  # noqa: BLE001
        raise RuntimeError("yt-dlp is required for transcript extraction") from err

    with io.BytesIO() as _buf:
        # yt-dlp writes to file; use tempfile path for compatibility.
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as d:
            out = str(Path(d) / "audio.%(ext)s")
            opts = {
                "format": "bestaudio/best",
                "outtmpl": out,
                "quiet": True,
                "no_warnings": True,
                "ignoreconfig": True,
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "128",
                    }
                ],
            }
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
            audio_file = next(Path(d).glob("audio*.mp3"), None)
            if audio_file is None:
                raise RuntimeError("failed to extract audio file")
            return audio_file.read_bytes()


def get_transcript(
    url: str,
    *,
    prefer_subtitle: bool = True,
    enable_fast_whisper: bool = True,
    fast_whisper_model: str = "base",
    fast_whisper_device: str = "cpu",
    enable_groq: bool = True,
    groq_api_key: str = "",
    groq_model: str = "whisper-large-v3",
) -> Dict[str, Any]:
    """获取语音转录结果"""
    started = time.perf_counter()
    if prefer_subtitle:
        hit = fetch_best_subtitle(url)
        if hit is not None:
            text, segments, meta = hit
            return {
                "source": "subtitle",
                "text": text,
                "meta": meta,
                "elapsed_ms": int((time.perf_counter() - started) * 1000),
            }

    audio_bytes = _download_audio_bytes(url)
    errors: List[str] = []

    if enable_fast_whisper:
        try:
            txt = transcribe_with_fast_whisper(
                audio_bytes,
                model_name=fast_whisper_model,
                device=fast_whisper_device,
            )
            if txt:
                return {
                    "source": "asr_fast_whisper",
                    "text": txt,
                    "meta": {"model": fast_whisper_model, "device": fast_whisper_device},
                    "elapsed_ms": int((time.perf_counter() - started) * 1000),
                }
        except Exception as err:  # noqa: BLE001
            errors.append(f"fast_whisper: {err}")

    if enable_groq:
        try:
            txt = transcribe_with_groq(audio_bytes, api_key=groq_api_key, model=groq_model)
            if txt:
                return {
                    "source": "asr_groq",
                    "text": txt,
                    "meta": {"model": groq_model},
                    "elapsed_ms": int((time.perf_counter() - started) * 1000),
                }
        except Exception as err:  # noqa: BLE001
            errors.append(f"groq: {err}")

    raise RuntimeError("transcript extraction failed: " + " | ".join(errors))
