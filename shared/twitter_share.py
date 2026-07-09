"""X (Twitter) 无 cookie 适配器。

零新依赖（仅 requests），不带用户 cookie。
方法：cdn.syndication.twimg.com 公开 API，匿名可用。

Syndication API 返回完整的帖子正文、图片、视频信息，
无需 cookie/API key。

token 算法：n = (int(id) / 1e15) * π，取 JS Number.toString(36) 去掉 "0." 和 "."。
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import time
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

# ── 常量 ──────────────────────────────────────────────────────────

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_REQUEST_TIMEOUT = 15
_DOWNLOAD_TIMEOUT = 120
_CHUNK_SIZE = 1024 * 64  # 64 KiB
_SYNDICATION_BASE = "https://cdn.syndication.twimg.com/tweet-result"

# X 域名匹配
_TWITTER_DOMAIN_RE = re.compile(
    r"(?:x\.com|twitter\.com)",
    re.IGNORECASE,
)
_TWITTER_URL_RE = re.compile(
    r"https?://[^\s\"'<>]*(?:x\.com|twitter\.com)/\w+/status/\d+[^\s\"'<>]*",
    re.IGNORECASE,
)
_TWEET_ID_RE = re.compile(r"/status/(\d+)", re.IGNORECASE)


# ── token 算法 ────────────────────────────────────────────────────

def _syndication_token(tweet_id: str) -> str:
    """生成 syndication API 所需的 token。

    算法：n = (int(tweet_id) / 1e15) * π，
    取 JS Number.toString(36) 结果，
    去掉 "0." 和 "."。
    """
    n = (int(tweet_id) / 1e15) * math.pi

    # 模拟 JS Number.toString(36)
    # JS 对浮点数的 toString(36)：整数部分和小数部分分别转 base36
    int_part = int(n)
    frac_part = n - int_part

    chars = "0123456789abcdefghijklmnopqrstuvwxyz"

    # 整数部分 → base36
    if int_part == 0:
        int_str = "0"
    else:
        parts = []
        _ip = int_part
        while _ip > 0:
            parts.append(chars[_ip % 36])
            _ip //= 36
        int_str = "".join(reversed(parts))

    # 小数部分 → base36（JS 取约 8 位有效精度）
    frac_parts = []
    _fp = frac_part
    for _ in range(8):
        _fp *= 36
        digit = int(_fp)
        frac_parts.append(chars[digit] if digit < 36 else "z")
        _fp -= digit
        if _fp == 0:
            break

    raw = int_str + "." + "".join(frac_parts)
    # 去掉 "0." 和 "."
    return raw.replace("0.", "").replace(".", "")


# ── 公共判断 ──────────────────────────────────────────────────────

def is_twitter_url_or_text(text: str) -> bool:
    """判断输入是否包含 X/Twitter 域名。"""
    return bool(_TWITTER_DOMAIN_RE.search(text or ""))


def extract_first_twitter_url(text: str) -> str:
    """从文本中提取第一个 X/Twitter URL，未找到返回空字符串。"""
    m = _TWITTER_URL_RE.search(text or "")
    return m.group(0) if m else ""


def extract_tweet_id(url_or_text: str) -> str:
    """从 URL 中提取 tweet ID。未找到返回空字符串。"""
    m = _TWEET_ID_RE.search(url_or_text or "")
    return m.group(1) if m else ""


# ── 抓取 ──────────────────────────────────────────────────────────

def fetch_twitter_meta(url: str) -> dict:
    """调 syndication API，返回原始 tweet 数据的规范化视图。

    返回:
        {
            "ok": bool,
            "tweet_id": str,
            "text": str,           # 帖子正文
            "has_video": bool,
            "has_photos": bool,
            "photos": list[dict],  # 图片列表（含 media_url_https）
            "video": dict | None,  # 视频信息（含 variants）
            "author": str,         # 作者 screen_name
            "author_name": str,    # 作者显示名
            "created_at": str,     # ISO 时间
            "lang": str,
            "raw": dict,           # 原始 API 响应
            "error": str,
        }
    """
    result: dict = {
        "ok": False,
        "tweet_id": "",
        "text": "",
        "has_video": False,
        "has_photos": False,
        "photos": [],
        "video": None,
        "author": "",
        "author_name": "",
        "created_at": "",
        "lang": "",
        "raw": {},
        "error": "",
    }

    tweet_id = extract_tweet_id(url)
    if not tweet_id:
        result["error"] = "未在 URL 中找到 tweet ID"
        return result

    result["tweet_id"] = tweet_id
    token = _syndication_token(tweet_id)

    try:
        resp = requests.get(
            f"{_SYNDICATION_BASE}",
            params={"id": tweet_id, "token": token, "lang": "en"},
            headers={"User-Agent": _BROWSER_UA},
            timeout=_REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            result["error"] = f"Syndication API 返回 {resp.status_code}（可能为私密/受限帖子）"
            logger.warning("Syndication API non-200 for %s: %s", tweet_id, resp.status_code)
            return result

        data = resp.json()
    except requests.RequestException as e:
        result["error"] = f"Syndication API 请求失败: {e}"
        logger.warning("Syndication API request failed for %s: %s", tweet_id, e)
        return result
    except json.JSONDecodeError as e:
        result["error"] = f"Syndication API 返回非 JSON: {e}"
        logger.warning("Syndication API JSON parse failed for %s: %s", tweet_id, e)
        return result

    result["raw"] = data

    text = data.get("text") or ""
    if not text:
        result["error"] = "该 X 帖子不可匿名访问（可能为私密/受限）"
        return result

    result["ok"] = True
    result["text"] = text

    user_data = data.get("user") or {}
    result["author"] = user_data.get("screen_name", "")
    result["author_name"] = user_data.get("name", "")
    result["created_at"] = data.get("created_at", "")
    result["lang"] = data.get("lang", "")

    # 判断是否有视频
    video_data = data.get("video")
    if isinstance(video_data, dict) and video_data:
        result["has_video"] = True
        result["video"] = video_data

    # 检查 mediaDetails 中的视频
    media_details = data.get("mediaDetails") or []
    for media in media_details:
        if isinstance(media, dict) and media.get("type") == "video":
            result["has_video"] = True
            if result["video"] is None:
                result["video"] = media
        elif isinstance(media, dict) and media.get("type") == "photo":
            result["has_photos"] = True

    # photos 字段
    photos = data.get("photos") or []
    if photos:
        result["has_photos"] = True
        result["photos"] = photos

    return result


def _safe_filename(name: str, max_len: int = 80) -> str:
    """将文本转为安全文件名。"""
    cleaned = re.sub(r'[\\/:*?"<>|\n\r\t]', "_", name).strip("_. ")
    return cleaned[:max_len] if cleaned else "twitter_tweet"


def _download_file(
    url: str,
    save_path: str,
    session: requests.Session,
    log: Callable[[str], None] | None = None,
) -> bool:
    """下载单个文件到指定路径。返回是否成功。"""
    headers = {
        "User-Agent": _BROWSER_UA,
        "Referer": "https://x.com/",
        "Accept": "*/*",
    }
    try:
        with session.get(url, headers=headers, stream=True, timeout=_DOWNLOAD_TIMEOUT) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0

            with open(save_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=_CHUNK_SIZE):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)

        # 校验
        if not os.path.isfile(save_path) or os.path.getsize(save_path) == 0:
            if log:
                log(f"⚠️ 下载文件为空: {save_path}")
            return False
        return True
    except Exception as e:
        if log:
            log(f"⚠️ 下载失败 {url}: {e}")
        return False


def run_twitter_download(
    *,
    url_or_text: str,
    output_dir: str,
    log: Callable[[str], None] | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
    speed_callback: Callable[[str], None] | None = None,
) -> dict:
    """X 帖子无 cookie 下载（视频交给 yt-dlp，这里只处理图文帖）。

    返回格式对齐 run_xiaohongshu_download():
        {"ok": bool, "save_path": str, "file_name": str,
         "error": str, "error_full": str, "percent": float,
         "tweet_meta": dict}  # 额外：帖子元数据（含 text）
    """
    def _log(msg: str) -> None:
        logger.info(msg)
        if log:
            log(msg)

    try:
        _log("🐦 X 帖子：获取 syndication 数据…")
        meta = fetch_twitter_meta(url_or_text)
        if not meta.get("ok"):
            return {
                "ok": False,
                "save_path": "",
                "file_name": "",
                "error": meta.get("error") or "X 帖子解析失败",
                "error_full": meta.get("error") or "",
                "percent": 0.0,
                "tweet_meta": {},
            }

        text = meta.get("text", "")
        tweet_id = meta.get("tweet_id", "")
        title = (text[:80] if text else "X 帖子").replace("\n", " ")
        author = meta.get("author", "")
        _log(f"   ✓ 作者: @{author}")
        _log(f"   ✓ 正文: {len(text)} 字符")
        _log(f"   ✓ 有视频: {meta.get('has_video')} | 有图: {meta.get('has_photos')}")

        session = requests.Session()
        session.headers.update({
            "User-Agent": _BROWSER_UA,
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })

        safe_title = _safe_filename(title)

        # ── 含图片：下载图集 ──
        photos = meta.get("photos") or []
        if photos and not meta.get("has_video"):
            note_dir = os.path.join(output_dir, f"twitter_{tweet_id}" if tweet_id else safe_title)
            os.makedirs(note_dir, exist_ok=True)

            _log(f"⬇️ 下载 {len(photos)} 张图片…")
            saved_files = []
            for i, photo in enumerate(photos):
                img_url = photo.get("media_url_https") or photo.get("url") or ""
                if not img_url:
                    continue
                # 取原始尺寸：去掉 _normal 或直接用 :orig
                img_url = re.sub(r"_\w+\.(jpg|png|jpeg)$", r".\1", img_url)
                img_url = img_url + ":orig" if ":orig" not in img_url else img_url

                ext = ".jpg"
                if ".png" in img_url.lower():
                    ext = ".png"
                elif ".jpeg" in img_url.lower():
                    ext = ".jpeg"

                img_path = os.path.join(note_dir, f"{i + 1:02d}{ext}")
                if _download_file(img_url, img_path, session, log=_log):
                    saved_files.append(img_path)
                    pct = (i + 1) / len(photos)
                    if progress_callback:
                        progress_callback(pct, f"{i + 1}/{len(photos)} 张图片")
                    _log(f"   ✓ [{i + 1}/{len(photos)}] {os.path.basename(img_path)}")

            _log(f"✅ 图文帖下载完成: {len(saved_files)}/ {len(photos)} 张图片")
            return {
                "ok": True,
                "save_path": note_dir,
                "file_name": os.path.basename(note_dir),
                "error": "",
                "error_full": "",
                "percent": 100.0,
                "tweet_meta": {
                    "type": "photo",
                    "title": title,
                    "desc": text,
                    "tweet_id": tweet_id,
                    "author": author,
                    "author_name": meta.get("author_name", ""),
                    "image_count": len(saved_files),
                },
            }

        # ── 纯文字帖（无图无视频）：返回正文供 LLM 总结 ──
        _log("📝 纯文字帖 → 提取正文")
        return {
            "ok": True,
            "save_path": "",
            "file_name": "",
            "error": "",
            "error_full": "",
            "percent": 100.0,
            "tweet_meta": {
                "type": "text",
                "title": title,
                "desc": text,
                "tweet_id": tweet_id,
                "author": author,
                "author_name": meta.get("author_name", ""),
            },
        }

    except Exception as e:
        _log(f"❌ X 帖子下载失败: {e}")
        return {
            "ok": False,
            "save_path": "",
            "file_name": "",
            "error": str(e)[:400],
            "error_full": str(e),
            "percent": 0.0,
            "tweet_meta": {},
        }


# ── 图文路径（保持向后兼容）──────────────────────────────────────

def fetch_twitter(url: str) -> dict:
    """图文路径便捷函数：只返回帖子的结构化文本数据，不下载图片。

    图片下载走主路径 run_twitter_download()。

    返回:
        {
            "ok": bool,
            "title": str,           # 帖子正文前 80 字符
            "paragraphs": [str],    # 帖子正文段落
            "images": [str],        # 图片远程 URL 列表（不下载到本地）
            "error": str,
        }
    """
    meta = fetch_twitter_meta(url)
    if not meta.get("ok"):
        return {
            "ok": False,
            "title": "",
            "paragraphs": [],
            "images": [],
            "error": meta.get("error", "未知错误"),
        }

    text = meta.get("text", "")
    paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    title = text[:80] if text else "X 帖子"
    # 返回图片远程 URL（不下载，主路径 run_twitter_download 负责下载）
    photos = meta.get("photos") or []
    image_urls = [p.get("media_url_https", "") for p in photos if p.get("media_url_https")]

    return {
        "ok": True,
        "title": title,
        "paragraphs": paragraphs,
        "images": image_urls,
        "error": "",
    }
