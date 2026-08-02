"""笔记任务默认值的持久化读写端点。"""

from __future__ import annotations

from dataclasses import asdict, replace
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from shared.settings_store import (
    TaskDefaultsConfig,
    load_settings,
    save_settings,
)

router = APIRouter(tags=["task-defaults"])


class TaskDefaultsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary_template: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=80,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    video_frame_analysis: Optional[bool] = None
    frame_interval_sec: Optional[int] = Field(default=None, ge=1)
    diarize: Optional[bool] = None
    speaker_count: Optional[int] = Field(default=None, ge=2, le=5)
    summary_language: Optional[Literal["source", "zh-Hans", "zh-Hant", "en", "ja", "ko", "custom"]] = None
    summary_language_custom: Optional[str] = Field(
        default=None,
        max_length=35,
        pattern=r"^(?:|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$",
    )


def _serialize(config: TaskDefaultsConfig) -> Dict[str, Any]:
    return asdict(config)


@router.get("/task_defaults")
def get_task_defaults() -> Dict[str, Any]:
    return _serialize(load_settings().task_defaults)


@router.patch("/task_defaults")
def update_task_defaults(
    request: TaskDefaultsUpdateRequest,
) -> Dict[str, Any]:
    settings = load_settings()
    current = settings.task_defaults
    fields_set = request.model_fields_set
    updated = TaskDefaultsConfig(
        summary_template=(
            request.summary_template
            if "summary_template" in fields_set
            and request.summary_template is not None
            else current.summary_template
        ),
        video_frame_analysis=(
            request.video_frame_analysis
            if "video_frame_analysis" in fields_set
            and request.video_frame_analysis is not None
            else current.video_frame_analysis
        ),
        frame_interval_sec=(
            request.frame_interval_sec
            if "frame_interval_sec" in fields_set
            and request.frame_interval_sec is not None
            else current.frame_interval_sec
        ),
        diarize=(
            request.diarize
            if "diarize" in fields_set and request.diarize is not None
            else current.diarize
        ),
        speaker_count=(
            request.speaker_count
            if "speaker_count" in fields_set
            else current.speaker_count
        ),
        summary_language=(
            request.summary_language
            if "summary_language" in fields_set and request.summary_language is not None
            else current.summary_language
        ),
        summary_language_custom=(
            request.summary_language_custom
            if "summary_language_custom" in fields_set and request.summary_language_custom is not None
            else current.summary_language_custom
        ),
    )
    if updated.summary_language == "custom" and not updated.summary_language_custom:
        raise HTTPException(
            status_code=422,
            detail="summary_language_custom is required when summary_language is custom",
        )
    save_settings(replace(settings, task_defaults=updated))
    return _serialize(updated)
