"""性能档位配置端点。

R23: 按内存档位自动调节 Whisper 模型大小 + 截帧密度。
- GET  /performance_tier  → 回显当前档位 + 内存探测推荐档
- POST /performance_tier  → 保存档位（同时填充 transcriber + 截帧默认值）
"""

from __future__ import annotations

from dataclasses import asdict, replace
from typing import Any, Dict, Literal, Optional

import psutil
from fastapi import APIRouter
from pydantic import BaseModel, Field

from shared.settings_store import (
    PerformanceConfig,
    PerformanceTier,
    load_settings,
    save_settings,
)

router = APIRouter(tags=["performance"])


class PerformanceTierUpdateRequest(BaseModel):
    """POST /performance_tier 请求体。"""

    tier: Optional[Literal["low", "medium", "high"]] = Field(
        default=None,
        description="性能档位；传入值不在白名单时 422",
    )


def _serialize(cfg: PerformanceConfig, recommended: PerformanceTier) -> Dict[str, Any]:
    mem = psutil.virtual_memory()
    return {
        "tier": cfg.tier,
        "recommended_tier": recommended,
        "total_ram_gb": round(mem.total / 1024**3, 1),
        "whisper_model_size": cfg.whisper_model_size,
        "interval_sec": cfg.interval_sec,
        "max_frames": cfg.max_frames,
    }


@router.get("/performance_tier")
def get_performance_tier() -> Dict[str, Any]:
    """回显当前性能档位 + 内存探测推荐。"""
    settings = load_settings()
    mem = psutil.virtual_memory()
    recommended = PerformanceConfig.recommend_tier(mem.total / 1024**3)
    return _serialize(settings.performance, recommended)


@router.post("/performance_tier")
def update_performance_tier(req: PerformanceTierUpdateRequest) -> Dict[str, Any]:
    """保存性能档位。

    同时将档位对应的 whisper_model_size 写入 transcriber 配置，
    使转录和截帧都生效。
    """
    settings = load_settings()
    mem = psutil.virtual_memory()
    recommended = PerformanceConfig.recommend_tier(mem.total / 1024**3)

    new_tier: PerformanceTier = req.tier if req.tier is not None else settings.performance.tier
    assert new_tier in ("low", "medium", "high")

    new_perf = PerformanceConfig(tier=new_tier)

    # 同步更新 transcriber 的 whisper_model_size
    new_transcriber = replace(
        settings.transcriber,
        whisper_model_size=new_perf.whisper_model_size,
    )

    save_settings(replace(settings, transcriber=new_transcriber, performance=new_perf))
    return _serialize(new_perf, recommended)
