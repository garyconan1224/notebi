"""图片代理路由（独立挂载，供前端远程封面走 Referer 拉取）。"""

from __future__ import annotations

import re

import httpx
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api", tags=["image-proxy"])


@router.get("/image_proxy")
def image_proxy(url: str) -> StreamingResponse:
    """代理拉取图片（带 Referer，绕过 B 站防盗链）。直接返回图片流，不包装。

    仅允许 http/https 目标；响应 content-type 必须为 image/*；
    成功响应附带短缓存头，避免封面重复拉取。
    """
    target = (url or "").strip()
    if not target or not re.fullmatch(r"https?://[^\s]+", target):
        return StreamingResponse(
            iter([b"invalid url"]), status_code=400, media_type="text/plain"
        )

    headers = {
        "Referer": "https://www.bilibili.com/",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0 Safari/537.36"
        ),
    }
    try:
        resp = httpx.get(target, headers=headers, timeout=15.0, follow_redirects=True)
    except Exception as err:  # noqa: BLE001
        return StreamingResponse(
            iter([str(err).encode("utf-8")]), status_code=502, media_type="text/plain"
        )

    content_type = resp.headers.get("content-type", "application/octet-stream")
    if not content_type.lower().startswith("image/"):
        return StreamingResponse(
            iter([b"not an image"]), status_code=400, media_type="text/plain"
        )

    return StreamingResponse(
        iter([resp.content]),
        status_code=resp.status_code,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )
