from __future__ import annotations

"""Downloader(yt-dlp) 配置端点。

S1 冻结契约：
- GET  /download_config 回显当前 AppSettings.download
- PATCH /download_config 字段级 patch(None 沿用/非 None 覆盖)
- POST /download_config/test-cookie 测试 Cookie 可读性
- POST /download_config/import-cookie 导入 cookies.txt
- DELETE /download_config/cookie 删除导入的 Cookie 文件

已移除：po_token、visitor_data、cookie_base_dirs、http_proxy。
"""

from dataclasses import asdict, replace
from typing import Any, Dict, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from shared.settings_store import (
    DownloadConfig,
    load_settings,
    save_settings,
)

router = APIRouter(tags=["download"])


class DownloadConfigUpdateRequest(BaseModel):
    """PATCH /download_config 请求体。

    全部字段可选:
    - 为 ``None``(未传)→ 保留旧值;
    - 非 ``None`` → 覆盖为新值(含空串,用于显式清空)。

    数值字段使用 Pydantic ``ge/le`` 做入参校验;超界直接 422。
    """

    output_dir: Optional[str] = None
    filename_template: Optional[str] = None
    proxy_mode: Optional[str] = None
    cookie_mode: Optional[str] = None
    cookie_browser: Optional[str] = None
    cookie_profile: Optional[str] = None
    cookie_file_path: Optional[str] = None
    concurrency_limit: Optional[int] = Field(default=None, ge=1, le=8)
    retry_count: Optional[int] = Field(default=None, ge=0, le=10)
    socket_timeout: Optional[int] = Field(default=None, ge=5, le=300)


def _serialize(cfg: DownloadConfig) -> Dict[str, Any]:
    """asdict 把 tuple 保留为 tuple；JSON 序列化自动转 list。"""
    return asdict(cfg)


@router.get("/download_config")
def get_download_config() -> Dict[str, Any]:
    """回显当前下载器配置。"""
    settings = load_settings()
    return _serialize(settings.download)


@router.patch("/download_config")
def update_download_config(req: DownloadConfigUpdateRequest) -> Dict[str, Any]:
    """写入下载器配置并回显。

    语义:
    - 字段为 ``None`` → 保留旧值;
    - 字段为具体值 → 覆盖(空串视为显式清空)。
    """
    settings = load_settings()
    current = settings.download

    # 枚举字段校验
    proxy_mode = current.proxy_mode
    if req.proxy_mode is not None:
        proxy_mode = req.proxy_mode if req.proxy_mode in ("inherit", "direct", "proxy") else "inherit"  # type: ignore[assignment]

    cookie_mode = current.cookie_mode
    if req.cookie_mode is not None:
        cookie_mode = req.cookie_mode if req.cookie_mode in ("none", "browser", "file") else "browser"  # type: ignore[assignment]

    new_cfg = DownloadConfig(
        output_dir=req.output_dir if req.output_dir is not None else current.output_dir,
        filename_template=(
            req.filename_template if req.filename_template is not None else current.filename_template
        ),
        proxy_mode=proxy_mode,
        cookie_mode=cookie_mode,
        cookie_browser=req.cookie_browser if req.cookie_browser is not None else current.cookie_browser,
        cookie_profile=req.cookie_profile if req.cookie_profile is not None else current.cookie_profile,
        cookie_file_path=req.cookie_file_path if req.cookie_file_path is not None else current.cookie_file_path,
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


# 兼容旧 POST 方法（重定向到 PATCH 逻辑）
@router.post("/download_config")
def update_download_config_post(req: DownloadConfigUpdateRequest) -> Dict[str, Any]:
    """兼容旧 POST 方法。"""
    return update_download_config(req)

