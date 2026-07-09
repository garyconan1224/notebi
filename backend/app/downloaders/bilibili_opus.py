"""B站 opus 图文动态适配器（移动端 __INITIAL_STATE__ 方案）。

请求 m.bilibili.com 移动端页面，提取 window.__INITIAL_STATE__ 内嵌 JSON，
解析标题、正文段落、图片。与 shared/xiaohongshu_share.py 同套路。

不依赖 bilibili_nocookie，不走 opus/detail API（WBI 签名仍 -352 风控）。
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

# ── 常量 ──────────────────────────────────────────────────────────

_MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 "
    "Mobile/15E148 Safari/604.1"
)
_SESSION_TIMEOUT = 15

_OPUS_ID_RE = re.compile(r"/opus/(\d+)")
_INITIAL_STATE_RE = re.compile(r"window\.__INITIAL_STATE__\s*=\s*")


# ── 公共入口 ──────────────────────────────────────────────────────

def fetch_bilibili_opus(url: str) -> Dict[str, Any]:
    """获取 B站 opus 图文动态内容。

    Args:
        url: B站 opus 链接，支持 www/m.bilibili.com 或 b23.tv 短链

    Returns:
        {"ok": True, "title": str, "content": str, "images": list[str], "kind_hint": str, "meta": dict}
        或 {"ok": False, "error": str}
    """
    opus_id = _extract_opus_id(url)
    if not opus_id:
        return {"ok": False, "error": f"无法从 URL 提取 opus_id: {url}"}

    # 先尝试移动端 __INITIAL_STATE__
    try:
        html = _fetch_mobile_page(opus_id)
    except requests.RequestException as e:
        return {"ok": False, "error": f"请求 m.bilibili.com 失败: {e}"}

    state = _extract_initial_state(html)
    if not state:
        return {"ok": False, "error": "未找到 window.__INITIAL_STATE__，页面结构可能已变"}

    result = _parse_opus_state(state)
    # fallback：移动端 __INITIAL_STATE__ 中 detail 为 None 时，尝试桌面端
    if not result.get("ok") and "opus.detail" in (result.get("error") or ""):
        try:
            html2 = _fetch_desktop_page(opus_id)
            state2 = _extract_initial_state(html2)
            if state2:
                result2 = _parse_opus_state(state2)
                if result2.get("ok"):
                    return result2
        except Exception:
            pass
    return result


def download_opus_images(
    image_urls: List[str],
    output_dir: str,
) -> List[str]:
    """下载 opus 图片到本地目录，返回本地路径列表。

    与 shared/xiaohongshu_share.py 的图片下载模式对齐：
    存到 data/workspaces/<ws>/image/<opus_id>/01.jpg 等。

    Args:
        image_urls: 远程图片 URL 列表
        output_dir: 本地存储目录（已创建）

    Returns:
        成功下载的本地文件路径列表
    """
    if not image_urls:
        return []

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update({"User-Agent": _MOBILE_UA, "Referer": "https://www.bilibili.com/"})
    saved: list[str] = []

    for i, url in enumerate(image_urls):
        try:
            ext = Path(urlparse(url).path).suffix.lower() or ".jpg"
            if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
                ext = ".jpg"
            local_path = out / f"{i + 1:02d}{ext}"
            resp = session.get(url, timeout=_SESSION_TIMEOUT)
            resp.raise_for_status()
            local_path.write_bytes(resp.content)
            saved.append(str(local_path))
        except Exception as e:
            logger.warning("opus 图片下载失败 [%s]: %s", url, e)

    return saved


# ── 内部实现 ──────────────────────────────────────────────────────

def _extract_opus_id(url: str) -> Optional[str]:
    """从 URL 提取 opus_id（纯数字）。支持 www/m.bilibili.com 和 b23.tv。"""
    m = _OPUS_ID_RE.search(url)
    return m.group(1) if m else None


def _fetch_mobile_page(opus_id: str) -> str:
    """请求 m.bilibili.com 移动端页面，返回 HTML。"""
    url = f"https://m.bilibili.com/opus/{opus_id}"
    session = requests.Session()
    session.headers.update({
        "User-Agent": _MOBILE_UA,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    resp = session.get(url, timeout=_SESSION_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def _fetch_desktop_page(opus_id: str) -> str:
    """请求 www.bilibili.com 桌面端页面，返回 HTML（fallback）。"""
    url = f"https://www.bilibili.com/opus/{opus_id}"
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    resp = session.get(url, timeout=_SESSION_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def _extract_initial_state(html: str) -> Optional[dict]:
    """从 HTML 中提取 window.__INITIAL_STATE__ JSON 对象。

    使用 json.JSONDecoder().raw_decode 而非正则贪婪匹配，
    避免 JSON 字符串内嵌 } 导致提前截断。
    """
    m = _INITIAL_STATE_RE.search(html)
    if not m:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(html, m.end())
        return obj
    except json.JSONDecodeError as e:
        logger.warning("__INITIAL_STATE__ JSON 解析失败: %s", e)
        return None


def _parse_opus_state(state: dict) -> Dict[str, Any]:
    """从 __INITIAL_STATE__ 中提取标题、正文、图片。"""
    detail = (state.get("opus") or {}).get("detail")
    if not detail:
        return {"ok": False, "error": "__INITIAL_STATE__ 中缺少 opus.detail"}

    # 标题
    title = (detail.get("basic") or {}).get("title", "")
    # 去掉 B站自动追加的 " - 哔哩哔哩" 后缀
    title = re.sub(r"\s*-\s*哔哩哔哩$", "", title).strip()

    # 正文 + 图片：遍历 modules 找 MODULE_TYPE_CONTENT
    modules = detail.get("modules") or []
    md_parts: list[str] = []
    images: list[str] = []

    for mod in modules:
        if mod.get("module_type") != "MODULE_TYPE_CONTENT":
            continue
        paragraphs = (mod.get("module_content") or {}).get("paragraphs") or []
        for para in paragraphs:
            _extract_paragraph(para, md_parts, images)
        break  # 只取第一个 content 模块

    content = "\n\n".join(md_parts).strip()
    if not content:
        return {"ok": False, "error": "opus 正文为空，页面结构可能已变"}

    kind_hint = "image_text" if images else "text"
    return {
        "ok": True,
        "title": title or "B站图文",
        "content": content,
        "images": images,
        "kind_hint": kind_hint,
        "meta": detail,
    }


def _extract_paragraph(para: dict, md_parts: list[str], images: list[str]) -> None:
    """递归提取单个段落的文本和图片，追加到 md_parts / images。"""
    ptype = para.get("para_type")

    if ptype == 1:
        # 文本段落
        _extract_text_nodes(para.get("text", {}).get("nodes", []), md_parts)

    elif ptype == 2:
        # 图片段落
        for pic in (para.get("pic") or {}).get("pics") or []:
            url = pic.get("url", "")
            if url:
                images.append(url)
                md_parts.append(f"![]({url})")

    elif ptype == 5:
        # 列表段落：list.children[] 每项的 children[] 是子段落
        for i, item in enumerate((para.get("list") or {}).get("children") or []):
            prefix = f"{i + 1}. " if (para.get("list") or {}).get("ordered") else "- "
            item_parts: list[str] = []
            for child in item.get("children") or []:
                _extract_paragraph(child, item_parts, images)
            if item_parts:
                md_parts.append(prefix + "\n  ".join(item_parts))

    elif ptype == 8:
        # 标题段落
        heading_nodes = (para.get("heading") or {}).get("nodes") or []
        heading_parts: list[str] = []
        _extract_text_nodes(heading_nodes, heading_parts)
        if heading_parts:
            level = (para.get("heading") or {}).get("level", 2)
            md_parts.append(f"{'#' * min(level, 6)} {''.join(heading_parts)}")


def _extract_text_nodes(nodes: list[dict], parts: list[str]) -> None:
    """提取文本节点列表，追加到 parts。"""
    for node in nodes:
        ntype = node.get("type", "")
        if ntype == "TEXT_NODE_TYPE_WORD":
            words = (node.get("word") or {}).get("words", "")
            if words:
                parts.append(words)
        elif ntype == "TEXT_NODE_TYPE_RICH":
            rich = node.get("rich") or {}
            text = rich.get("text", "")
            jump = rich.get("jump_url", "")
            if jump:
                if jump.startswith("//"):
                    jump = "https:" + jump
                parts.append(f"[{text}]({jump})")
            elif text:
                parts.append(text)
