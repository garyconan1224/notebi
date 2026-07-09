"""
抖音 no-cookie 优先下载路径——通过 iPhone UA 跟随短链跳转到分享页，
解析页面内嵌的 videoInfoRes 拿到无水印 mp4 地址后流式下载。

此模块是 yt-dlp 的轻量前置 fallback，不依赖 cookie / 浏览器自动化。
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from collections.abc import Callable
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ── 常量 ──────────────────────────────────────────────────────────

_IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/18.0 Mobile/15E148 Safari/604.1"
)

_DOUYIN_DOMAIN_RE = re.compile(
    r"(?:v\.douyin\.com|douyin\.com|iesdouyin\.com|dy\.com)",
    re.IGNORECASE,
)
_DOUYIN_URL_RE = re.compile(
    r"https?://(?:v\.douyin\.com|www\.douyin\.com|www\.iesdouyin\.com|dy\.com)/[^\s]+",
    re.IGNORECASE,
)

# 分享页内嵌 JS 中提取视频信息的正则
# 抖音分享页把视频元数据藏在 <script id="RENDER_DATA" type="application/json"> 或
# window._ROUTER_DATA 里。两种都要试。
_RENDER_DATA_RE = re.compile(
    r'<script[^>]*id\s*=\s*["\']RENDER_DATA["\'][^>]*>(.*?)</script>',
    re.DOTALL,
)
# 视频播放地址 JSON 字段路径片段（藏在嵌套 dict 里）
_PLAY_ADDR_KEY = "play_addr"
_VIDEO_PLAY_INFO_KEY = "videoPlayInfo"

_SESSION_TIMEOUT = 30
_CHUNK_SIZE = 1024 * 1024  # 1 MiB


# ── URL 识别 ──────────────────────────────────────────────────────

def is_douyin_url_or_text(text: str) -> bool:
    """判断输入是否包含抖音域名。"""
    return bool(_DOUYIN_DOMAIN_RE.search(text or ""))


def extract_first_douyin_url(text: str) -> str:
    """从文本中提取第一个抖音 URL，未找到返回空字符串。"""
    m = _DOUYIN_URL_RE.search(text or "")
    return m.group(0) if m else ""


# ── 短链解析 ──────────────────────────────────────────────────────

def resolve_douyin_share(url_or_text: str) -> str:
    """以 iPhone UA 跟随抖音短链重定向，返回最终 iesdouyin.com 目标 URL。

    输入可以是纯 URL 或包含 URL 的分享口令文本。
    返回最终的 https://www.iesdouyin.com/share/video/... 地址。
    """
    url = extract_first_douyin_url(url_or_text)
    if not url:
        raise ValueError("未在输入文本中找到抖音 URL")

    session = requests.Session()
    session.headers.update({
        "User-Agent": _IPHONE_UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })

    try:
        resp = session.get(
            url,
            timeout=_SESSION_TIMEOUT,
            allow_redirects=True,
            stream=False,
        )
        resp.raise_for_status()
        final_url = resp.url
        logger.debug("douyin share resolved: %s → %s", url, final_url)
        return final_url
    except requests.RequestException as e:
        raise RuntimeError(f"抖音短链跳转失败: {url} — {e}") from e


# ── 分享页解析 ────────────────────────────────────────────────────

def _deep_find(obj, key: str, max_depth: int = 10):
    """深度遍历嵌套 dict/list 查找指定 key，返回第一个匹配值。"""
    if max_depth <= 0:
        return None
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                return v
            result = _deep_find(v, key, max_depth - 1)
            if result is not None:
                return result
    elif isinstance(obj, list):
        for item in obj:
            result = _deep_find(item, key, max_depth - 1)
            if result is not None:
                return result
    return None


def _extract_balanced_json(html: str, start_pos: int) -> Optional[str]:
    """从 html[start_pos] 处（应为 '{'）开始，平衡括号提取完整 JSON 字符串。

    处理 JSON 字符串内的转义，避免花括号干扰计数。
    """
    if start_pos >= len(html) or html[start_pos] != "{":
        return None

    depth = 0
    in_string = False
    escape = False

    for i in range(start_pos, len(html)):
        ch = html[i]

        if escape:
            escape = False
            continue

        if in_string:
            if ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return html[start_pos : i + 1]

    return None


def _try_extract_uri_from_json(data) -> Optional[str]:
    """从已解析的 JSON dict 中尝试提取 play_addr.uri。"""
    if not isinstance(data, dict):
        return None

    # 主路径：play_addr → uri 优先（无缘无水印），url_list[0] 兜底（可能带 playwm）
    play_addr = _deep_find(data, _PLAY_ADDR_KEY)
    if isinstance(play_addr, dict):
        uri = play_addr.get("uri")
        if isinstance(uri, str) and uri:
            return uri
        url_list = play_addr.get("url_list")
        if isinstance(url_list, list) and url_list and isinstance(url_list[0], str):
            return url_list[0]

    # 备用：videoInfoRes.item_list[0].video.play_addr
    video_info = _deep_find(data, _VIDEO_PLAY_INFO_KEY)
    if isinstance(video_info, dict):
        uri = _try_extract_uri_from_json(video_info)
        if uri:
            return uri

    return None


def _extract_play_uri(html: str) -> Optional[str]:
    """从抖音分享页 HTML 中提取 play_addr.uri。

    优先走 RENDER_DATA JSON（新版页面），
    再用平衡括号法提取 _ROUTER_DATA 兜底。
    """
    # 策略 1：<script id="RENDER_DATA" type="application/json">
    render_match = _RENDER_DATA_RE.search(html)
    if render_match:
        raw = render_match.group(1)
        try:
            from urllib.parse import unquote
            decoded = unquote(raw)
            data = json.loads(decoded)
        except (json.JSONDecodeError, UnicodeDecodeError):
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                data = None
        uri = _try_extract_uri_from_json(data)
        if uri:
            return uri

    # 策略 2：window._ROUTER_DATA = {...}（平衡括号提取）
    for marker in ("window._ROUTER_DATA", "_ROUTER_DATA"):
        idx = html.find(marker)
        if idx < 0:
            continue
        # 找到 '=' 后的 '{'
        eq_pos = html.find("=", idx)
        if eq_pos < 0:
            continue
        brace_pos = html.find("{", eq_pos)
        if brace_pos < 0:
            continue

        json_str = _extract_balanced_json(html, brace_pos)
        if not json_str:
            continue

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            continue

        uri = _try_extract_uri_from_json(data)
        if uri:
            return uri

    return None


def parse_douyin_share_page(html: str) -> dict:
    """解析抖音分享页 HTML，返回视频元数据字典。

    返回至少包含:
        play_uri: str  - 视频播放地址的 URI 片段
        title: str     - 视频标题（可能为空）
        aweme_id: str  - 视频 aweme_id（可能为空）
    """
    result: dict = {"play_uri": "", "title": "", "aweme_id": ""}

    # 提取播放 URI
    play_uri = _extract_play_uri(html)
    if play_uri:
        result["play_uri"] = play_uri

    # 尝试从 _ROUTER_DATA JSON 提取标题和 aweme_id
    for marker in ("window._ROUTER_DATA", "_ROUTER_DATA"):
        idx = html.find(marker)
        if idx < 0:
            continue
        eq_pos = html.find("=", idx)
        if eq_pos < 0:
            continue
        brace_pos = html.find("{", eq_pos)
        if brace_pos < 0:
            continue
        json_str = _extract_balanced_json(html, brace_pos)
        if not json_str:
            continue
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            continue

        if not result["aweme_id"]:
            item_list = _deep_find(data, "item_list")
            if isinstance(item_list, list) and item_list:
                first = item_list[0]
                if isinstance(first, dict):
                    result["aweme_id"] = first.get("aweme_id", "")

        if not result["title"]:
            desc = _deep_find(data, "desc")
            if isinstance(desc, str) and desc:
                result["title"] = desc
        break

    # fallback: <title> 标签
    if not result["title"]:
        title_m = re.search(r"<title>(.*?)</title>", html, re.DOTALL)
        if title_m:
            result["title"] = title_m.group(1).strip()

    # fallback: canoncial URL 路径中的 aweme_id
    if not result["aweme_id"]:
        aweme_m = re.search(r"/video/(\d+)", html)
        if aweme_m:
            result["aweme_id"] = aweme_m.group(1)

    return result


# ── 下载 ──────────────────────────────────────────────────────────

def _build_mp4_url(play_uri: str) -> str:
    """将 play_addr.uri 拼为完整 mp4 播放地址。"""
    uri = play_uri.strip()
    if uri.startswith("http"):
        return uri
    return f"https://www.iesdouyin.com/aweme/v1/play/?video_id={uri}&ratio=1080p&line=0"


def _format_speed(bytes_per_sec: float) -> str:
    """将字节/秒格式化为人类可读的速度字符串。"""
    if bytes_per_sec >= 1024 * 1024:
        return f"{bytes_per_sec / (1024 * 1024):.1f}MiB/s"
    elif bytes_per_sec >= 1024:
        return f"{bytes_per_sec / 1024:.1f}KiB/s"
    else:
        return f"{bytes_per_sec:.1f}B/s"


def run_douyin_mobile_download(
    *,
    url_or_text: str,
    output_dir: str,
    log: Callable[[str], None] | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
    speed_callback: Callable[[str], None] | None = None,
) -> dict:
    """抖音无 cookie 下载优先路径。

    返回格式对齐 run_ytdlp_download():
        {"ok": bool, "save_path": str, "file_name": str,
         "error": str, "error_full": str, "percent": float}
    """
    def _log(msg: str) -> None:
        logger.info(msg)
        if log:
            log(msg)

    try:
        # 1. 解析短链
        _log("🔍 抖音短链解析中…")
        final_url = resolve_douyin_share(url_or_text)
        _log(f"   → {final_url}")

        # 2. 获取分享页 HTML
        session = requests.Session()
        session.headers.update({
            "User-Agent": _IPHONE_UA,
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })

        _log("📄 获取分享页…")
        resp = session.get(final_url, timeout=_SESSION_TIMEOUT)
        resp.raise_for_status()
        html = resp.text

        # 3. 解析 HTML 提取视频地址
        meta = parse_douyin_share_page(html)
        play_uri = meta.get("play_uri", "")
        if not play_uri:
            return {
                "ok": False,
                "save_path": "",
                "file_name": "",
                "error": "抖音分享页解析失败：未提取到视频播放地址",
                "error_full": "分享页 HTML 中未找到 play_addr.uri 或 videoInfoRes",
                "percent": 0.0,
            }

        mp4_url = _build_mp4_url(play_uri)
        title = meta.get("title", "douyin_video")
        aweme_id = meta.get("aweme_id", "")
        _log(f"   ✓ 标题: {title}")
        _log(f"   ✓ aweme_id: {aweme_id}")

        # 4. 下载视频流
        _log("⬇️ 开始下载…")
        safe_title = re.sub(r'[\\/:*?"<>|]', "_", title)[:80]
        filename = f"{safe_title}.mp4" if safe_title else f"douyin_{aweme_id}.mp4"
        save_path = os.path.join(output_dir, filename)

        # 去重：如果同名文件已存在，加序号
        base, ext = os.path.splitext(filename)
        counter = 1
        while os.path.exists(save_path):
            save_path = os.path.join(output_dir, f"{base}_{counter}{ext}")
            counter += 1

        dl_headers = {
            "User-Agent": _IPHONE_UA,
            "Referer": "https://www.douyin.com/",
            "Accept": "*/*",
        }

        with session.get(mp4_url, headers=dl_headers, stream=True, timeout=120) as dl_resp:
            dl_resp.raise_for_status()
            total = int(dl_resp.headers.get("Content-Length", 0))

            with open(save_path, "wb") as f:
                downloaded = 0
                start_time = time.time()
                for chunk in dl_resp.iter_content(chunk_size=_CHUNK_SIZE):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total > 0:
                            pct = min(99.0, downloaded / total * 100)
                            elapsed = time.time() - start_time
                            if progress_callback:
                                progress_callback(
                                    min(0.99, downloaded / total),
                                    f"{pct:.0f}% · {_format_speed(downloaded / elapsed) if elapsed > 0 else '0B/s'}",
                                )
                            if speed_callback and elapsed > 0:
                                speed_callback(_format_speed(downloaded / elapsed))
                            if int(pct) % 20 == 0:
                                _log(f"   {pct:.0f}% ({downloaded}/{total})")

        # 校验文件
        if not os.path.isfile(save_path) or os.path.getsize(save_path) == 0:
            return {
                "ok": False,
                "save_path": "",
                "file_name": "",
                "error": "抖音下载完成但文件为空",
                "error_full": f"save_path={save_path} size={os.path.getsize(save_path) if os.path.isfile(save_path) else 0}",
                "percent": 0.0,
            }

        _log(f"✅ 下载完成: {os.path.basename(save_path)} ({os.path.getsize(save_path)} bytes)")
        return {
            "ok": True,
            "save_path": save_path,
            "file_name": os.path.basename(save_path),
            "error": "",
            "error_full": "",
            "percent": 100.0,
        }

    except Exception as e:
        _log(f"❌ 抖音下载失败: {e}")
        return {
            "ok": False,
            "save_path": "",
            "file_name": "",
            "error": str(e)[:400],
            "error_full": str(e),
            "percent": 0.0,
        }
