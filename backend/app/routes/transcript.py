from __future__ import annotations

"""Transcript extraction routes."""

import os
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.services.transcript_service import get_transcript

router = APIRouter(prefix="/transcript", tags=["transcript"])


class TranscriptRequest(BaseModel):
    """语音转录请求"""
    url: str
    prefer_subtitle: bool = True
    enable_fast_whisper: bool = True
    fast_whisper_model: str = "base"
    fast_whisper_device: str = "cpu"
    enable_groq: bool = True
    groq_api_key: str = Field(default="")
    groq_model: str = "whisper-large-v3"


@router.post("/extract")
def extract_transcript(req: TranscriptRequest) -> Dict[str, Any]:
    try:
        return get_transcript(
            req.url,
            prefer_subtitle=req.prefer_subtitle,
            enable_fast_whisper=req.enable_fast_whisper,
            fast_whisper_model=req.fast_whisper_model,
            fast_whisper_device=req.fast_whisper_device,
            enable_groq=req.enable_groq,
            groq_api_key=req.groq_api_key or os.environ.get("GROQ_API_KEY", ""),
            groq_model=req.groq_model,
        )
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(err)) from err
