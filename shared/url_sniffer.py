"""
URL 内容类型嗅探——不下载实际内容，仅基于 URL 路径模式 + HTTP 响应头推断。

策略三层（命中即停）：
  1. 已知平台 URL 路径正则匹配（零网络开销）
  2. HTTP HEAD → Content-Type 头判断；text/html 时 GET 前 64KB 读 og: 元标签
  3. fallback：按平台默认值兜底，无平台信息时返回 "video"

所有公开函数保证不抛异常——调用方不需要 try/except。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

# ── 平台域名关键词 → (平台名, 默认 primary_type, 默认 possible_types) ──
_PLATFORM_DOMAIN_MAP: dict[str, tuple[str, str, list[str]]] = {
    "bilibili.com": ("bilibili", "video", ["video", "audio"]),
    "b23.tv": ("bilibili", "video", ["video", "audio"]),
    "youtube.com": ("youtube", "video", ["video"]),
    "youtu.be": ("youtube", "video", ["video"]),
    "douyin.com": ("douyin", "video", ["video"]),
    "kuaishou.com": ("kuaishou", "video", ["video"]),
    "xiaohongshu.com": ("xiaohongshu", "text", ["text"]),
    "xhslink.com": ("xiaohongshu", "text", ["text"]),
    "weixin.qq.com": ("weixin", "text", ["text"]),
    "x.com": ("twitter", "video", ["video", "image_text"]),
    "twitter.com": ("twitter", "video", ["video", "image_text"]),
}

# ── 已知平台的 URL 路径模式（比域名默认值更精细） ──
# 格式：(compiled_regex, primary_type, possible_types)
_PLATFORM_PATH_RULES: dict[str, list[tuple[re.Pattern, str, list[str]]]] = {
    "bilibili": [
        (re.compile(r"/video/", re.IGNORECASE), "video", ["video", "audio"]),
        (re.compile(r"/opus/", re.IGNORECASE), "image_text", ["image_text"]),
        (re.compile(r"/read/", re.IGNORECASE), "text", ["text"]),
        (re.compile(r"/audio/", re.IGNORECASE), "audio", ["audio"]),
        (re.compile(r"/bangumi/", re.IGNORECASE), "video", ["video", "audio"]),
        (re.compile(r"/list/", re.IGNORECASE), "video", ["video", "audio"]),
    ],
    "youtube": [
        (re.compile(r"/watch", re.IGNORECASE), "video", ["video"]),
        (re.compile(r"/shorts/", re.IGNORECASE), "video", ["video"]),
        (re.compile(r"/playlist", re.IGNORECASE), "video", ["video"]),
    ],
    "weixin": [
        (re.compile(r"/s/", re.IGNORECASE), "text", ["text"]),
        (re.compile(r"/mp/", re.IGNORECASE), "text", ["text"]),
    ],
}

# ── HTTP 请求配置 ──
_HEAD_TIMEOUT = 10  # HEAD 请求超时（秒）
_GET_SNIFF_TIMEOUT = 15  # GET 嗅探超时（秒）
_GET_SNIFF_BYTES = 65536  # 读前 64KB 足够拿到 <head> 段
_HTML_SNIFF_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
}

# ── og: / title 提取正则 ──
_OG_TYPE_RE = re.compile(
    r'<meta\s[^>]*(?:property|name)\s*=\s*["\']og:type["\'][^>]*content\s*=\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_OG_TITLE_RE = re.compile(
    r'<meta\s[^>]*(?:property|name)\s*=\s*["\']og:title["\'][^>]*content\s*=\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_OG_IMAGE_RE = re.compile(
    r'<meta\s[^>]*(?:property|name)\s*=\s*["\']og:image["\'][^>]*content\s*=\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_OG_VIDEO_RE = re.compile(
    r'<meta\s[^>]*(?:property|name)\s*=\s*["\']og:video["\'][^>]*content\s*=\s*["\']([^"\']+)["\']',
    re.IGNORECASE,
)
_OG_IMAGE_RE_REV = re.compile(
    r'<meta\s[^>]*content\s*=\s*["\']([^"\']+)["\'][^>]*(?:property|name)\s*=\s*["\']og:image["\']',
    re.IGNORECASE,
)
_TITLE_TAG_RE = re.compile(r"<title>([^<]+)</title>", re.IGNORECASE)

# 图片 / 音视频直链的 Content-Type 前缀映射
_CONTENT_TYPE_PREFIX_MAP: dict[str, str] = {
    "video/": "video",
    "audio/": "audio",
    "image/": "image",
    "application/pdf": "text",
    "text/": "text",
}

# 图片直链的 URL 后缀
_IMAGE_EXTENSIONS: frozenset[str] = frozenset({
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".ico", ".tiff", ".avif",
})
_AUDIO_EXTENSIONS: frozenset[str] = frozenset({
    ".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a", ".opus", ".wma",
})
_VIDEO_EXTENSIONS: frozenset[str] = frozenset({
    ".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".wmv", ".m4v",
})


@dataclass
class SniffResult:
    """URL 嗅探结果。"""

    primary_type: str  # "video" | "audio" | "image" | "text"
    possible_types: list[str] = field(default_factory=list)
    platform: Optional[str] = None
    title: Optional[str] = None
    thumbnail: Optional[str] = None
    content_type_header: Optional[str] = None
    confident: bool = True  # 纯兜底时为 False，已知平台/og: 命中为 True

    def to_dict(self) -> dict:
        return {
            "primary_type": self.primary_type,
            "possible_types": self.possible_types,
            "platform": self.platform,
            "title": self.title,
            "thumbnail": self.thumbnail,
            "content_type_header": self.content_type_header,
            "confident": self.confident,
        }


def _resolve_platform(hostname: str) -> tuple[Optional[str], Optional[str], list[str]]:
    """根据 hostname 查找平台信息。返回 (platform_name, default_type, default_possible_types)。"""
    host_lower = hostname.lower().removeprefix("www.")
    for domain_key, (plat_name, def_type, def_possible) in _PLATFORM_DOMAIN_MAP.items():
        if domain_key in host_lower or host_lower in domain_key:
            return plat_name, def_type, list(def_possible)
    return None, None, []


def _sniff_by_url_path(url_path: str, platform: str) -> Optional[tuple[str, list[str]]]:
    """策略 1：URL 路径模式匹配。命中返回 (primary_type, possible_types)，未命中返回 None。"""
    rules = _PLATFORM_PATH_RULES.get(platform, [])
    for pattern, primary, possible in rules:
        if pattern.search(url_path):
            return primary, list(possible)
    return None


def _sniff_by_extension(url_path: str) -> Optional[str]:
    """根据 URL 路径的扩展名判断类型。"""
    path_lower = url_path.lower()
    # 去掉 query string 和 fragment
    for sep in ("?", "#"):
        idx = path_lower.find(sep)
        if idx >= 0:
            path_lower = path_lower[:idx]
    for ext in _VIDEO_EXTENSIONS:
        if path_lower.endswith(ext):
            return "video"
    for ext in _AUDIO_EXTENSIONS:
        if path_lower.endswith(ext):
            return "audio"
    for ext in _IMAGE_EXTENSIONS:
        if path_lower.endswith(ext):
            return "image"
    return None


def _sniff_by_content_type(content_type: str) -> Optional[str]:
    """策略 2：根据 HTTP Content-Type 头映射到素材类型。html 返回 None（需要进一步解析）。"""
    ct = content_type.lower().split(";")[0].strip()
    if ct in ("text/html", "application/xhtml+xml"):
        return None  # 需要读 HTML 元标签
    for prefix, item_type in _CONTENT_TYPE_PREFIX_MAP.items():
        if ct.startswith(prefix):
            return item_type
    return None


def _extract_html_meta(html_chunk: str) -> dict:
    """从 HTML 片段中提取 og: 元标签和 title。"""
    meta: dict = {}
    # og:type（可能包含 "video" / "article" 等提示）
    m = _OG_TYPE_RE.search(html_chunk)
    if m:
        meta["og_type"] = m.group(1).strip()
    # og:title（优先级高于 <title>）
    m = _OG_TITLE_RE.search(html_chunk)
    if m:
        meta["title"] = m.group(1).strip()
    # og:image（反序兜底：content 在 property/name 之前的情况）
    m = _OG_IMAGE_RE.search(html_chunk) or _OG_IMAGE_RE_REV.search(html_chunk)
    if m:
        meta["thumbnail"] = m.group(1).strip()
    # og:video（如果页面嵌了视频）
    m = _OG_VIDEO_RE.search(html_chunk)
    if m:
        meta["og_video"] = m.group(1).strip()
    # <title> 兜底
    if not meta.get("title"):
        m = _TITLE_TAG_RE.search(html_chunk)
        if m:
            meta["title"] = m.group(1).strip()
    return meta


def _http_head(url: str) -> Optional[requests.Response]:
    """发送 HEAD 请求，失败返回 None。"""
    try:
        resp = requests.head(
            url,
            headers=_HTML_SNIFF_HEADERS,
            timeout=_HEAD_TIMEOUT,
            allow_redirects=True,
        )
        resp.raise_for_status()
        return resp
    except Exception:
        logger.debug("HEAD request failed for %s", url, exc_info=True)
        return None


def _http_get_sniff(url: str) -> Optional[str]:
    """发送 GET 请求，只读前 64KB，返回 HTML 文本。失败返回 None。"""
    try:
        resp = requests.get(
            url,
            headers=_HTML_SNIFF_HEADERS,
            timeout=_GET_SNIFF_TIMEOUT,
            allow_redirects=True,
            stream=True,
        )
        resp.raise_for_status()
        chunk = b""
        for data in resp.iter_content(chunk_size=8192):
            chunk += data
            if len(chunk) >= _GET_SNIFF_BYTES:
                break
        # 尝试 UTF-8 解码，失败用 latin-1
        for encoding in ("utf-8", "latin-1"):
            try:
                return chunk.decode(encoding)
            except (UnicodeDecodeError, LookupError):
                continue
        return chunk.decode("utf-8", errors="replace")
    except Exception:
        logger.debug("GET sniff failed for %s", url, exc_info=True)
        return None


def sniff_url(url: str) -> SniffResult:
    """嗅探 URL 的内容类型，不下载实际内容文件。

    三层策略：
      1. 已知平台 URL 路径模式
      2. HTTP HEAD → Content-Type；text/html 时 GET 读 og: 标签
      3. fallback（平台默认值或 "video"）

    此函数保证不抛异常。
    """
    raw = url.strip()
    if not raw:
        return SniffResult(primary_type="video", possible_types=["video"], confident=False)

    # 解析 URL
    try:
        parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    except Exception:
        return SniffResult(primary_type="video", possible_types=["video"], confident=False)

    hostname = (parsed.hostname or "").lower().removeprefix("www.")
    url_path = parsed.path or "/"

    # ── 策略 1: 已知平台路径模式 ──
    platform, default_type, default_possible = _resolve_platform(hostname)

    # 小红书：图文/视频需解析页面区分（分享链接自带 xsec_token，免 cookie；失败降级 text）
    if platform == "xiaohongshu":
        try:
            from shared.xiaohongshu_share import resolve_xhs_share, parse_xhs_page
            _, _xhs_html = resolve_xhs_share(raw)
            _xhs_type = (parse_xhs_page(_xhs_html) or {}).get("type", "normal")
            _xhs_pt = "video" if _xhs_type == "video" else "text"
            return SniffResult(primary_type=_xhs_pt, possible_types=[_xhs_pt], platform="xiaohongshu")
        except Exception:
            return SniffResult(primary_type="text", possible_types=["text"], platform="xiaohongshu")

    # X (Twitter)：调 syndication API 区分视频帖 vs 图文帖
    if platform == "twitter":
        try:
            from shared.twitter_share import fetch_twitter_meta
            _tw_meta = fetch_twitter_meta(raw)
            if _tw_meta.get("ok") and _tw_meta.get("has_video"):
                return SniffResult(primary_type="video", possible_types=["video", "image_text"], platform="twitter")
            return SniffResult(primary_type="text", possible_types=["text"], platform="twitter")
        except Exception:
            return SniffResult(primary_type="video", possible_types=["video", "image_text"], platform="twitter")

    if platform:
        path_result = _sniff_by_url_path(url_path, platform)
        if path_result:
            primary, possible = path_result
            return SniffResult(
                primary_type=primary,
                possible_types=possible,
                platform=platform,
            )
        # 已知平台但无路径匹配 → 用平台默认值（不发起 HTTP 请求，已知平台 O(1) 判断足够准）
        return SniffResult(
            primary_type=default_type,
            possible_types=list(default_possible),
            platform=platform,
        )

    # ── 策略 1.5: URL 扩展名判断（非已知平台）──
    ext_result = _sniff_by_extension(url_path)
    if ext_result:
        return SniffResult(
            primary_type=ext_result,
            possible_types=[ext_result],
        )

    # ── 策略 2: HTTP HEAD → Content-Type ──
    head_resp = _http_head(raw)
    if head_resp is not None:
        content_type = head_resp.headers.get("Content-Type", "")
        ct_result = _sniff_by_content_type(content_type)

        if ct_result is not None:
            # 非 HTML 类型，直接返回
            return SniffResult(
                primary_type=ct_result,
                possible_types=[ct_result],
                content_type_header=content_type,
            )

        # text/html → 读页面 og: 元标签
        html = _http_get_sniff(raw)
        if html:
            meta = _extract_html_meta(html)
            # og:video 存在 → 页面包含视频
            if meta.get("og_video"):
                return SniffResult(
                    primary_type="video",
                    possible_types=["video"],
                    title=meta.get("title"),
                    thumbnail=meta.get("thumbnail"),
                    content_type_header=content_type,
                )
            # og:type 包含 article / post → 文本
            og_type = meta.get("og_type", "").lower()
            if og_type in ("article", "post", "blog"):
                return SniffResult(
                    primary_type="text",
                    possible_types=["text"],
                    title=meta.get("title"),
                    thumbnail=meta.get("thumbnail"),
                    content_type_header=content_type,
                )
            # 有 og:image 且无视频 → 可能是图文混合页
            if meta.get("thumbnail") and not meta.get("og_video"):
                return SniffResult(
                    primary_type="text",
                    possible_types=["text", "image"],
                    title=meta.get("title"),
                    thumbnail=meta.get("thumbnail"),
                    content_type_header=content_type,
                )
            # 纯文本页
            return SniffResult(
                primary_type="text",
                possible_types=["text"],
                title=meta.get("title"),
                thumbnail=meta.get("thumbnail"),
                content_type_header=content_type,
            )

        # HTML 但 GET 失败 → 按 text 兜底
        return SniffResult(
            primary_type="text",
            possible_types=["text"],
            content_type_header=content_type,
        )

    # ── 策略 3: 完全 fallback ──
    return SniffResult(primary_type="video", possible_types=["video"], confident=False)
