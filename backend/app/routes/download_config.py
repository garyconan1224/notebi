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
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel, Field, field_validator

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
    proxy_mode: Optional[Literal["inherit", "direct", "proxy"]] = None
    cookie_mode: Optional[Literal["none", "browser", "file"]] = None
    cookie_browser: Optional[str] = None
    cookie_profile: Optional[str] = None
    cookie_file_path: Optional[str] = None
    concurrency_limit: Optional[int] = Field(default=None, ge=1, le=8)
    retry_count: Optional[int] = Field(default=None, ge=0, le=10)
    socket_timeout: Optional[int] = Field(default=None, ge=5, le=300)

    @field_validator("filename_template")
    @classmethod
    def validate_template(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        from shared.download_helpers import validate_filename_template

        valid, message = validate_filename_template(value)
        if not valid:
            raise ValueError(message)
        return value


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
        proxy_mode = req.proxy_mode

    cookie_mode = current.cookie_mode
    if req.cookie_mode is not None:
        cookie_mode = req.cookie_mode

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


# ── Cookie 管理端点 ────────────────────────────────────────────────────────────


@router.post("/download_config/test-cookie")
def test_cookie() -> Dict[str, Any]:
    """测试当前 Cookie 配置可读性。

    只返回模式、浏览器、是否可读和提示，不返回 Cookie 内容。
    """
    from backend.app.services.cookie_config import test_browser_cookie, test_file_cookie

    settings = load_settings()
    cfg = settings.download

    if cfg.cookie_mode == "browser":
        return test_browser_cookie(cfg.cookie_browser, cfg.cookie_profile)
    elif cfg.cookie_mode == "file":
        return test_file_cookie()
    else:
        return {"mode": "none", "readable": True, "message": "Cookie 已禁用"}


@router.post("/download_config/import-cookie")
async def import_cookie(file: UploadFile = File(...)) -> Dict[str, Any]:
    """导入 Netscape 格式 cookies.txt。

    文件保存到应用私有目录并 chmod 0600。
    """
    from backend.app.services.cookie_config import import_cookie_file

    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return {"success": False, "stored_path": "", "error": "文件必须是 UTF-8 编码"}

    result = import_cookie_file(text)
    if result["success"]:
        # 导入成功后切换模式为 file
        settings = load_settings()
        new_cfg = DownloadConfig(
            output_dir=settings.download.output_dir,
            filename_template=settings.download.filename_template,
            proxy_mode=settings.download.proxy_mode,
            cookie_mode="file",
            cookie_browser=settings.download.cookie_browser,
            cookie_profile=settings.download.cookie_profile,
            cookie_file_path=result["stored_path"],
            concurrency_limit=settings.download.concurrency_limit,
            retry_count=settings.download.retry_count,
            socket_timeout=settings.download.socket_timeout,
        )
        save_settings(replace(settings, download=new_cfg))

    return result


@router.delete("/download_config/cookie")
def delete_cookie() -> Dict[str, Any]:
    """删除导入的 Cookie 文件并切回浏览器模式。"""
    from backend.app.services.cookie_config import delete_imported_cookie

    result = delete_imported_cookie()
    if result["success"]:
        # 切回浏览器模式
        settings = load_settings()
        new_cfg = DownloadConfig(
            output_dir=settings.download.output_dir,
            filename_template=settings.download.filename_template,
            proxy_mode=settings.download.proxy_mode,
            cookie_mode="browser",
            cookie_browser=settings.download.cookie_browser,
            cookie_profile=settings.download.cookie_profile,
            cookie_file_path="",
            concurrency_limit=settings.download.concurrency_limit,
            retry_count=settings.download.retry_count,
            socket_timeout=settings.download.socket_timeout,
        )
        save_settings(replace(settings, download=new_cfg))

    return result
