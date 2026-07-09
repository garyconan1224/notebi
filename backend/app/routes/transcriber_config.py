from __future__ import annotations

"""Transcriber (ASR) 配置端点。

冻结契约见 docs/DESIGN_NOTES_SETTINGS.md §3.4：
- GET  /transcriber_config 回显当前 AppSettings.transcriber
- POST /transcriber_config 写入 AppSettings.transcriber 并回显
"""

from dataclasses import asdict, replace
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from shared.settings_store import (
    TranscriberConfig,
    TranscriberType,
    load_settings,
    save_settings,
)

from backend.app.services.asr_fast_whisper import (
    _MODEL_APPROX_SIZE_MB,
    _hf_hub_cache_dir,
    _scan_model_cache_bytes,
    is_model_cached,
)

router = APIRouter(tags=["transcriber"])

# 暴露在 /transcriber_config/models 中的模型枚举；与 shared.settings_store 中允许的
# WhisperModelSize 保持一致。加入 large-v3-turbo 以便 UI 可选（首次调用时才会拉取）。
_WHISPER_MODEL_SIZES: tuple[str, ...] = (
    "tiny",
    "base",
    "small",
    "medium",
    "large-v3",
    "large-v3-turbo",
)

# 与 shared.settings_store._ALLOWED_TRANSCRIBER_TYPES 保持一致
_ALLOWED_TYPES: tuple[str, ...] = (
    "fast-whisper",
    "bcut",
    "kuaishou",
    "groq",
    "mlx-whisper",
)


class TranscriberConfigUpdateRequest(BaseModel):
    """POST /transcriber_config 请求体。

    全部字段可选：缺省则沿用现值；空串视为清空字符串字段。
    """

    type: Optional[Literal["fast-whisper", "bcut", "kuaishou", "groq", "mlx-whisper"]] = Field(
        default=None,
        description="转写引擎类型；传入值不在白名单时 422",
    )
    whisper_model_size: Optional[str] = None
    language: Optional[str] = None
    device: Optional[str] = None
    groq_api_key: Optional[str] = None
    initial_prompt: Optional[str] = None
    # R4.8: ASR 加速参数
    cpu_threads: Optional[int] = None
    beam_size: Optional[int] = None
    vad_filter: Optional[bool] = None


def _serialize(cfg: TranscriberConfig) -> Dict[str, Any]:
    return asdict(cfg)


@router.get("/transcriber_config")
def get_transcriber_config() -> Dict[str, Any]:
    """回显当前转写器配置。"""
    settings = load_settings()
    return _serialize(settings.transcriber)


@router.post("/transcriber_config")
def update_transcriber_config(req: TranscriberConfigUpdateRequest) -> Dict[str, Any]:
    """写入转写器配置并回显。

    字段级语义：
    - 为 ``None``（未传）→ 保留旧值；
    - 非 ``None`` → 覆盖为新值（含空串，用于清空可选字符串字段如 ``groq_api_key``/``initial_prompt``）。
    """
    settings = load_settings()
    current = settings.transcriber

    next_type: TranscriberType = current.type
    if req.type is not None:
        # pydantic 已通过 Literal 校验白名单，这里仅显式断言
        assert req.type in _ALLOWED_TYPES
        next_type = req.type

    new_cfg = TranscriberConfig(
        type=next_type,
        whisper_model_size=req.whisper_model_size if req.whisper_model_size is not None else current.whisper_model_size,
        language=req.language if req.language is not None else current.language,
        device=req.device if req.device is not None else current.device,
        groq_api_key=req.groq_api_key if req.groq_api_key is not None else current.groq_api_key,
        initial_prompt=req.initial_prompt if req.initial_prompt is not None else current.initial_prompt,
        cpu_threads=req.cpu_threads if req.cpu_threads is not None else current.cpu_threads,
        beam_size=req.beam_size if req.beam_size is not None else current.beam_size,
        vad_filter=req.vad_filter if req.vad_filter is not None else current.vad_filter,
    )

    # 兜底：fast-whisper (CTranslate2) 不支持 mps，自动回退 cpu
    if new_cfg.type in ("fast-whisper",) and new_cfg.device == "mps":
        new_cfg = replace(new_cfg, device="cpu")

    save_settings(replace(settings, transcriber=new_cfg))
    return _serialize(new_cfg)


@router.get("/transcriber_config/models")
def get_whisper_models_status() -> Dict[str, Any]:
    """列出所有支持的 Whisper 模型的本地缓存状态。

    返回结构：
        {
          "cache_dir": "/Users/.../.cache/huggingface/hub",
          "models": [
            {
              "name": "base",
              "cached": true,
              "estimated_size_mb": 145,
              "done_mb": 141,
              "pending_mb": 0
            },
            ...
          ]
        }
    - `cached` 由 `is_model_cached` 判定（snapshots 存在 + 无 .incomplete + ≥85% 预估）；
    - `pending_mb > 0` 表示后台正在下载，前端可据此轮询刷新。
    失败视为"未缓存"，不抛 500。
    """
    models: list[Dict[str, Any]] = []
    for name in _WHISPER_MODEL_SIZES:
        try:
            done, pending = _scan_model_cache_bytes(name)
            cached = is_model_cached(name)
        except Exception:  # noqa: BLE001 -- 路由层守护：单模型探测失败不影响整体响应
            done, pending, cached = 0, 0, False
        models.append(
            {
                "name": name,
                "cached": cached,
                "estimated_size_mb": _MODEL_APPROX_SIZE_MB.get(name, 0),
                "done_mb": round(done / 1024 / 1024, 1),
                "pending_mb": round(pending / 1024 / 1024, 1),
            }
        )
    return {"cache_dir": str(_hf_hub_cache_dir()), "models": models}
