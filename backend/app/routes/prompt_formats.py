from __future__ import annotations

"""提示词格式模板配置端点（Phase 1G 增强）。

接口（无 prefix，挂在 root 下）:
- GET  /prompt_formats_config        回显（首次加载注入种子）
- POST /prompt_formats_config        整体覆盖 formats + active_*_ids
- POST /prompt_formats_config/reset  恢复默认（写盘）

请求语义采用「整体覆盖」而非 patch —— 因为模板是用户可任意增删的列表，
字段级 patch 语义反而复杂。三个字段都可选：未传 = 保留旧值。
"""

from dataclasses import asdict
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from shared.settings_store import (
    PromptFormat,
    PromptFormatsConfig,
    load_prompt_formats_with_seed,
    reset_prompt_formats,
    save_prompt_formats,
)

router = APIRouter(tags=["prompt_formats"])


class PromptFormatItem(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    category: str = Field(description="image | video")
    template: str = ""
    description: str = ""
    is_default: bool = False


class PromptFormatsConfigUpdateRequest(BaseModel):
    """整体覆盖请求体。字段 None = 沿用旧值。"""

    formats: Optional[List[PromptFormatItem]] = None
    active_image_ids: Optional[List[str]] = None
    active_video_ids: Optional[List[str]] = None


def _serialize(cfg: PromptFormatsConfig) -> Dict[str, Any]:
    return {
        "formats": [asdict(f) for f in cfg.formats],
        "active_image_ids": list(cfg.active_image_ids),
        "active_video_ids": list(cfg.active_video_ids),
    }


def _ensure_category(c: str) -> str:
    cat = c.strip().lower()
    if cat not in ("image", "video"):
        raise HTTPException(
            status_code=400, detail=f"invalid category {c!r}; expected 'image' or 'video'"
        )
    return cat


@router.get("/prompt_formats_config")
def get_prompt_formats_config() -> Dict[str, Any]:
    return _serialize(load_prompt_formats_with_seed())


@router.post("/prompt_formats_config")
def update_prompt_formats_config(req: PromptFormatsConfigUpdateRequest) -> Dict[str, Any]:
    current = load_prompt_formats_with_seed()

    if req.formats is None:
        next_formats = current.formats
    else:
        seen_ids: set[str] = set()
        accum: list[PromptFormat] = []
        for item in req.formats:
            fid = item.id.strip()
            if not fid:
                raise HTTPException(status_code=400, detail="format id cannot be empty")
            if fid in seen_ids:
                raise HTTPException(status_code=400, detail=f"duplicate format id: {fid}")
            seen_ids.add(fid)
            accum.append(
                PromptFormat(
                    id=fid,
                    name=item.name.strip() or fid,
                    category=_ensure_category(item.category),
                    template=item.template,
                    description=item.description.strip(),
                    is_default=item.is_default,
                )
            )
        next_formats = tuple(accum)

    def _normalize(raw: Optional[List[str]], fallback: tuple[str, ...]) -> tuple[str, ...]:
        if raw is None:
            return fallback
        out: list[str] = []
        for s in raw:
            v = str(s or "").strip()
            if v and v not in out:
                out.append(v)
        return tuple(out)

    next_cfg = PromptFormatsConfig(
        formats=next_formats,
        active_image_ids=_normalize(req.active_image_ids, current.active_image_ids),
        active_video_ids=_normalize(req.active_video_ids, current.active_video_ids),
    )

    # 校验 active ids 必须存在于 formats 内（容错：忽略不存在的）
    valid_ids = {f.id for f in next_cfg.formats}
    next_cfg = PromptFormatsConfig(
        formats=next_cfg.formats,
        active_image_ids=tuple(i for i in next_cfg.active_image_ids if i in valid_ids),
        active_video_ids=tuple(i for i in next_cfg.active_video_ids if i in valid_ids),
    )

    saved = save_prompt_formats(next_cfg)
    return _serialize(saved)


@router.post("/prompt_formats_config/reset")
def reset_prompt_formats_config() -> Dict[str, Any]:
    return _serialize(reset_prompt_formats())
