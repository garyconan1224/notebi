from __future__ import annotations

"""Downloader(yt-dlp) 配置端点。

冻结契约见 docs/DESIGN_NOTES_SETTINGS.md §3.1(阶段 3 新增)与 §4.3:
- GET  /download_config 回显当前 AppSettings.download
- POST /download_config 字段级 patch(None 沿用/非 None 覆盖);数值字段后端 clamp,
  cookie_base_dirs 接受 list[str],持久化为 tuple[str, ...]。
"""

from dataclasses import asdict, replace
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from shared.settings_store import (
    DownloadConfig,
    load_settings,
    save_settings,
)

router = APIRouter(tags=["download"])


class DownloadConfigUpdateRequest(BaseModel):
    """POST /download_config 请求体。

    全部字段可选:
    - 为 ``None``(未传)→ 保留旧值;
    - 非 ``None`` → 覆盖为新值(含空串/空数组,用于显式清空)。

    数值字段使用 Pydantic ``ge/le`` 做入参校验;超界直接 422,避免静默截断。
    """

    output_dir: Optional[str] = None
    filename_template: Optional[str] = None
    http_proxy: Optional[str] = None
    po_token: Optional[str] = None
    visitor_data: Optional[str] = None
    cookie_base_dirs: Optional[List[str]] = None
    concurrency_limit: Optional[int] = Field(default=None, ge=1, le=8)
    retry_count: Optional[int] = Field(default=None, ge=0, le=10)
    socket_timeout: Optional[int] = Field(default=None, ge=5, le=300)


def _serialize(cfg: DownloadConfig) -> Dict[str, Any]:
    """``asdict`` 把 tuple 保留为 tuple;JSON 序列化自动转 list,前端拿到的是数组。"""
    payload = asdict(cfg)
    # 显式转 list,避免 FastAPI 某些中间件对 tuple 的兼容性差异
    payload["cookie_base_dirs"] = list(cfg.cookie_base_dirs)
    return payload


@router.get("/download_config")
def get_download_config() -> Dict[str, Any]:
    """回显当前下载器配置。"""
    settings = load_settings()
    return _serialize(settings.download)


@router.post("/download_config")
def update_download_config(req: DownloadConfigUpdateRequest) -> Dict[str, Any]:
    """写入下载器配置并回显。

    语义:
    - 字段为 ``None`` → 保留旧值;
    - 字段为具体值 → 覆盖(空串/空数组视为显式清空);
    - ``cookie_base_dirs`` 规范化:去空白项 + 去重 + 保序 + 存 tuple。
    """
    settings = load_settings()
    current = settings.download

    # cookie_base_dirs 规范化:list 入参 → 去空白/去重/保序,写入为 tuple
    next_cookie_dirs: tuple[str, ...] = current.cookie_base_dirs
    if req.cookie_base_dirs is not None:
        seen: list[str] = []
        for item in req.cookie_base_dirs:
            s = str(item or "").strip()
            if s and s not in seen:
                seen.append(s)
        next_cookie_dirs = tuple(seen)

    new_cfg = DownloadConfig(
        output_dir=req.output_dir if req.output_dir is not None else current.output_dir,
        filename_template=(
            req.filename_template if req.filename_template is not None else current.filename_template
        ),
        http_proxy=req.http_proxy if req.http_proxy is not None else current.http_proxy,
        po_token=req.po_token if req.po_token is not None else current.po_token,
        visitor_data=req.visitor_data if req.visitor_data is not None else current.visitor_data,
        cookie_base_dirs=next_cookie_dirs,
        concurrency_limit=(
            req.concurrency_limit if req.concurrency_limit is not None else current.concurrency_limit
        ),
        retry_count=req.retry_count if req.retry_count is not None else current.retry_count,
        socket_timeout=(
            req.socket_timeout if req.socket_timeout is not None else current.socket_timeout
        ),
    )

    save_settings(replace(settings, download=new_cfg))
    return _serialize(new_cfg)

