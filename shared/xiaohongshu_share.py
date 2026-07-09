"""小红书无 cookie 适配器。

零新依赖（仅 requests），不带用户 cookie。
方法：分享短链 → 重定向拿 xsec_token → GET HTML → 正则抠 __INITIAL_STATE__ → JSON 解析。

参考：MIT bnchiang96/xiaohongshu-importer
"""

from __future__ import annotations

import json
import logging
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
_SESSION_TIMEOUT = 15
_DOWNLOAD_TIMEOUT = 120
_CHUNK_SIZE = 1024 * 64  # 64 KiB

# 小红书域名匹配
_XHS_DOMAIN_RE = re.compile(
    r"(?:xiaohongshu\.com|xhslink\.com|xhslink\.cn)",
    re.IGNORECASE,
)
_XHS_URL_RE = re.compile(
    r"https?://[^\s\"'<>]*(?:xiaohongshu\.com|xhslink\.com|xhslink\.cn)[^\s\"'<>]*",
    re.IGNORECASE,
)

# __INITIAL_STATE__ 提取
_INITIAL_STATE_RE = re.compile(
    r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*</script>",
    re.DOTALL,
)

# undefined → null 清洗（JSON 不支持 undefined）
# 只匹配不在引号内的 undefined（JS 关键字），不替换 JSON 字符串值中的 "undefined"
_UNDEFINED_RE = re.compile(r'(?<!")\bundefined\b(?!")')


# ── 公共判断 ──────────────────────────────────────────────────────

def is_xiaohongshu_url_or_text(text: str) -> bool:
    """判断输入是否包含小红书域名。"""
    return bool(_XHS_DOMAIN_RE.search(text or ""))


def extract_first_xhs_url(text: str) -> str:
    """从文本中提取第一个小红书 URL，未找到返回空字符串。"""
    m = _XHS_URL_RE.search(text or "")
    return m.group(0) if m else ""


# ── 短链解析 ──────────────────────────────────────────────────────

def resolve_xhs_share(url_or_text: str) -> tuple[str, str]:
    """解析小红书短链/分享文本，返回 (final_url, html)。

    跟随重定向拿到带 xsec_token 的最终 URL，同时返回页面 HTML。
    """
    url = extract_first_xhs_url(url_or_text)
    if not url:
        raise ValueError("未在输入文本中找到小红书 URL")

    session = requests.Session()
    session.headers.update({
        "User-Agent": _BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })

    try:
        resp = session.get(
            url,
            timeout=_SESSION_TIMEOUT,
            allow_redirects=True,
        )
        resp.raise_for_status()
        final_url = resp.url
        logger.debug("xhs share resolved: %s → %s", url, final_url)
        return final_url, resp.text
    except requests.RequestException as e:
        raise RuntimeError(f"小红书短链跳转失败: {url} — {e}") from e


# ── HTML 解析 ─────────────────────────────────────────────────────

def _clean_json(raw: str) -> str:
    """清洗 JSON 字符串：undefined → null。"""
    return _UNDEFINED_RE.sub("null", raw)


def _extract_initial_state(html: str) -> Optional[dict]:
    """从 HTML 中提取 window.__INITIAL_STATE__ JSON 对象。"""
    m = _INITIAL_STATE_RE.search(html)
    if not m:
        return None
    raw = m.group(1)
    cleaned = _clean_json(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning("__INITIAL_STATE__ JSON 解析失败: %s", e)
        return None


def _extract_note_from_state(state: dict) -> Optional[dict]:
    """从 __INITIAL_STATE__ 中提取笔记详情。

    路径：state.note.noteDetailMap[noteId].note
    """
    note_section = state.get("note")
    if not isinstance(note_section, dict):
        return None

    detail_map = note_section.get("noteDetailMap")
    if not isinstance(detail_map, dict):
        return None

    # noteDetailMap 的 key 就是 noteId，取第一个
    for _note_id, detail in detail_map.items():
        if isinstance(detail, dict):
            note = detail.get("note")
            if isinstance(note, dict):
                return note

    return None


def _extract_og_fallback(html: str) -> dict:
    """降级：从 <title> 和 og: 标签提取基础信息。"""
    result: dict = {"title": "", "desc": "", "type": "normal"}

    # <title>
    title_m = re.search(r"<title>(.*?)</title>", html, re.DOTALL)
    if title_m:
        result["title"] = title_m.group(1).strip()

    # og:description
    desc_m = re.search(
        r'<meta\s[^>]*property\s*=\s*["\']og:description["\'][^>]*content\s*=\s*["\']([^"\']*)["\']',
        html,
        re.IGNORECASE,
    )
    if desc_m:
        result["desc"] = desc_m.group(1).strip()

    # og:image
    img_m = re.search(
        r'<meta\s[^>]*property\s*=\s*["\']og:image["\'][^>]*content\s*=\s*["\']([^"\']*)["\']',
        html,
        re.IGNORECASE,
    )
    if img_m:
        result["imageList"] = [{"urlDefault": img_m.group(1).strip()}]

    return result


def parse_xhs_page(html: str) -> dict:
    """解析小红书页面 HTML，返回笔记元数据。

    返回至少包含：
        title: str        - 笔记标题
        desc: str         - 笔记正文
        type: str         - "normal"(图文) 或 "video"
        imageList: list   - 图集 [{urlDefault, ...}, ...]
        video: dict|None  - 视频信息 {url, cover, ...}
        noteId: str       - 笔记 ID
    """
    state = _extract_initial_state(html)
    if state:
        note = _extract_note_from_state(state)
        if note:
            return {
                "title": note.get("title", ""),
                "desc": note.get("desc", ""),
                "type": note.get("type", "normal"),
                "imageList": note.get("imageList") or [],
                "video": note.get("video") if note.get("type") == "video" else None,
                "noteId": note.get("noteId") or note.get("id", ""),
                "source": "initial_state",
            }

    # 降级到 og 标签
    logger.info("__INITIAL_STATE__ 提取失败，降级到 og 标签")
    fallback = _extract_og_fallback(html)
    fallback["source"] = "og_fallback"
    fallback["noteId"] = ""
    fallback.setdefault("imageList", [])
    fallback.setdefault("video", None)
    return fallback


# ── 下载 ──────────────────────────────────────────────────────────

def _safe_filename(name: str, max_len: int = 80) -> str:
    """将标题转为安全文件名。"""
    cleaned = re.sub(r'[\\/:*?"<>|\n\r\t]', "_", name).strip("_. ")
    return cleaned[:max_len] if cleaned else "xhs_note"


def _format_speed(bytes_per_sec: float) -> str:
    """将字节/秒格式化为人类可读的速度字符串。"""
    if bytes_per_sec >= 1024 * 1024:
        return f"{bytes_per_sec / (1024 * 1024):.1f}MiB/s"
    elif bytes_per_sec >= 1024:
        return f"{bytes_per_sec / 1024:.1f}KiB/s"
    else:
        return f"{bytes_per_sec:.0f}B/s"


def _download_file(
    url: str,
    save_path: str,
    session: requests.Session,
    log: Callable[[str], None] | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
    speed_callback: Callable[[str], None] | None = None,
) -> bool:
    """下载单个文件到指定路径。返回是否成功。"""
    headers = {
        "User-Agent": _BROWSER_UA,
        "Referer": "https://www.xiaohongshu.com/",
        "Accept": "*/*",
    }
    try:
        with session.get(url, headers=headers, stream=True, timeout=_DOWNLOAD_TIMEOUT) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            start_time = time.time()

            with open(save_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=_CHUNK_SIZE):
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


def run_xiaohongshu_download(
    *,
    url_or_text: str,
    output_dir: str,
    log: Callable[[str], None] | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
    speed_callback: Callable[[str], None] | None = None,
) -> dict:
    """小红书无 cookie 下载。

    返回格式对齐 run_ytdlp_download():
        {"ok": bool, "save_path": str, "file_name": str,
         "error": str, "error_full": str, "percent": float,
         "note_meta": dict}  # 额外：笔记元数据
    """
    def _log(msg: str) -> None:
        logger.info(msg)
        if log:
            log(msg)

    try:
        # 1. 解析短链 + 获取 HTML
        _log("📕 小红书短链解析中…")
        final_url, html = resolve_xhs_share(url_or_text)
        _log(f"   → {final_url}")

        # 2. 解析页面
        _log("📄 解析笔记页面…")
        meta = parse_xhs_page(html)
        title = meta.get("title", "") or "小红书笔记"
        desc = meta.get("desc", "")
        note_type = meta.get("type", "normal")
        note_id = meta.get("noteId", "")

        _log(f"   ✓ 标题: {title}")
        _log(f"   ✓ 类型: {'图文' if note_type == 'normal' else '视频'}")
        _log(f"   ✓ 来源: {meta.get('source', 'unknown')}")

        session = requests.Session()
        session.headers.update({
            "User-Agent": _BROWSER_UA,
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })

        safe_title = _safe_filename(title)

        # ── 图文笔记：下载图集 ──
        if note_type == "normal" or note_type != "video":
            image_list = meta.get("imageList") or []
            if not image_list:
                return {
                    "ok": False,
                    "save_path": "",
                    "file_name": "",
                    "error": "图文笔记未找到图片",
                    "error_full": f"noteId={note_id}, imageList 为空",
                    "percent": 0.0,
                    "note_meta": meta,
                }

            # 创建笔记子目录
            note_dir = os.path.join(output_dir, safe_title or f"xhs_{note_id}")
            os.makedirs(note_dir, exist_ok=True)

            _log(f"⬇️ 下载 {len(image_list)} 张图片…")
            saved_files = []
            for i, img_info in enumerate(image_list):
                img_url = (
                    img_info.get("urlDefault")
                    or img_info.get("url")
                    or img_info.get("urlPre")
                    or ""
                )
                if not img_url:
                    continue

                # 确保 URL 有协议
                if img_url.startswith("//"):
                    img_url = "https:" + img_url

                ext = ".jpg"
                img_path = os.path.join(note_dir, f"{i + 1:02d}{ext}")
                if _download_file(img_url, img_path, session, log=_log):
                    saved_files.append(img_path)
                    pct = (i + 1) / len(image_list)
                    if progress_callback:
                        progress_callback(pct, f"{i + 1}/{len(image_list)} 张图片")
                    _log(f"   ✓ [{i + 1}/{len(image_list)}] {os.path.basename(img_path)}")

            if not saved_files:
                return {
                    "ok": False,
                    "save_path": "",
                    "file_name": "",
                    "error": "所有图片下载失败",
                    "error_full": f"尝试了 {len(image_list)} 张图片",
                    "percent": 0.0,
                    "note_meta": meta,
                }

            # 保存笔记正文为 markdown
            if desc:
                md_path = os.path.join(note_dir, "笔记正文.md")
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(f"# {title}\n\n{desc}\n")
                _log(f"   ✓ 笔记正文已保存")

            _log(f"✅ 图文笔记下载完成: {len(saved_files)} 张图片 → {note_dir}")
            return {
                "ok": True,
                "save_path": note_dir,
                "file_name": os.path.basename(note_dir),
                "error": "",
                "error_full": "",
                "percent": 100.0,
                "note_meta": meta,
            }

        # ── 视频笔记 ──
        video_info = meta.get("video") or {}
        video_url = (
            video_info.get("url")
            or video_info.get("media", {}).get("stream", {}).get("h264", [{}])[0].get("masterUrl", "")
            or ""
        )

        # 也尝试从 imageList 取封面
        image_list = meta.get("imageList") or []
        cover_url = ""
        if image_list:
            cover_url = image_list[0].get("urlDefault") or image_list[0].get("url") or ""

        if not video_url:
            # 降级：保存元数据 + 封面，标记视频 URL 缺失
            _log("⚠️ 未提取到视频 URL，保存元数据和封面")
            note_dir = os.path.join(output_dir, safe_title or f"xhs_{note_id}")
            os.makedirs(note_dir, exist_ok=True)

            if cover_url:
                if cover_url.startswith("//"):
                    cover_url = "https:" + cover_url
                cover_path = os.path.join(note_dir, "cover.jpg")
                _download_file(cover_url, cover_path, session, log=_log)

            if desc:
                md_path = os.path.join(note_dir, "笔记正文.md")
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(f"# {title}\n\n{desc}\n")

            return {
                "ok": False,
                "save_path": note_dir,
                "file_name": os.path.basename(note_dir),
                "error": "视频笔记未提取到视频 URL（已保存封面和正文）",
                "error_full": f"video_info={json.dumps(video_info, ensure_ascii=False)[:500]}",
                "percent": 0.0,
                "note_meta": meta,
            }

        # 下载视频
        if video_url.startswith("//"):
            video_url = "https:" + video_url

        filename = f"{safe_title}.mp4" if safe_title else f"xhs_{note_id}.mp4"
        save_path = os.path.join(output_dir, filename)

        # 去重
        base, ext = os.path.splitext(filename)
        counter = 1
        while os.path.exists(save_path):
            save_path = os.path.join(output_dir, f"{base}_{counter}{ext}")
            counter += 1

        _log("⬇️ 开始下载视频…")
        if _download_file(video_url, save_path, session, log=_log,
                          progress_callback=progress_callback,
                          speed_callback=speed_callback):
            _log(f"✅ 视频下载完成: {os.path.basename(save_path)} ({os.path.getsize(save_path)} bytes)")
            return {
                "ok": True,
                "save_path": save_path,
                "file_name": os.path.basename(save_path),
                "error": "",
                "error_full": "",
                "percent": 100.0,
                "note_meta": meta,
            }
        else:
            return {
                "ok": False,
                "save_path": "",
                "file_name": "",
                "error": "视频下载失败",
                "error_full": f"url={video_url}",
                "percent": 0.0,
                "note_meta": meta,
            }

    except Exception as e:
        _log(f"❌ 小红书下载失败: {e}")
        return {
            "ok": False,
            "save_path": "",
            "file_name": "",
            "error": str(e)[:400],
            "error_full": str(e),
            "percent": 0.0,
            "note_meta": {},
        }
