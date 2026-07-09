"""Link preview endpoint — 抓取网页 og 元数据，B 站走专用解析。"""

from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from lxml import html as lxml_html

try:
    from backend.app.downloaders.bilibili_nocookie import (
        BilibiliNoCookieDownloader,
        extract_bvid_from_url,
    )
    _HAS_BILI = True
except ImportError:
    _HAS_BILI = False

    def extract_bvid_from_url(url: str) -> None:  # type: ignore[misc]
        return None

try:
    from shared.text_loader import load_url as _load_url, load_pdf as _load_pdf, TextLoaderError
    _HAS_LOADER = True
except ImportError:
    _HAS_LOADER = False

try:
    from shared.xiaohongshu_share import (
        is_xiaohongshu_url_or_text as _is_xhs_url,
        resolve_xhs_share,
        parse_xhs_page,
    )
    _HAS_XHS = True
except ImportError:
    _HAS_XHS = False

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/link-preview", tags=["link-preview"])

# 通用浏览器 UA，防反爬
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)


def _extract_og(page_html: str) -> dict[str, Optional[str]]:
    """从 HTML 提取 og:title / og:description / og:image。"""
    try:
        tree = lxml_html.fromstring(page_html)
    except Exception:
        return {"title": None, "description": None, "image_url": None}

    def _og(prop: str) -> Optional[str]:
        # 同时匹配 property 和 name（覆盖 Vue/React SSR 站用 name="og:..." 的情况）
        nodes = tree.xpath(
            f'//meta[@property="og:{prop}"]/@content | //meta[@name="og:{prop}"]/@content'
        )
        return nodes[0].strip() if nodes and nodes[0].strip() else None

    # fallback: <title> 和 <meta name="description">
    title = _og("title")
    if not title:
        title_nodes = tree.xpath("//title/text()")
        title = title_nodes[0].strip() if title_nodes else None

    description = _og("description")
    if not description:
        desc_nodes = tree.xpath('//meta[@name="description"]/@content')
        description = desc_nodes[0].strip() if desc_nodes else None

    return {
        "title": title,
        "description": description,
        "image_url": _og("image"),
    }


@router.get("")
async def link_preview(
    url: str = Query(..., description="待预览的链接"),
    include_content: bool = Query(False, description="是否返回 readability 正文"),
):
    """抓取链接的 og 元数据。

    返回 { title, description, image_url, source }。
    source: "bili" | "og" | "fallback"

    当 include_content=True 时，额外返回 { content, word_count }。
    """
    if not url.strip():
        raise HTTPException(status_code=400, detail="url 参数不能为空")

    # ── B 站：走专用 downloader（如果可用）──
    if _HAS_BILI and extract_bvid_from_url(url):
        try:
            dl = BilibiliNoCookieDownloader()
            # get_meta 是同步阻塞调用（内含 tenacity 重试，B 站限流时可耗时数秒）。
            # 直接在 async 路由里调用会阻塞事件循环 → 添加素材弹框并发的 sniff/probe/重试
            # 请求被 uvicorn 拒为 503。放到线程池执行，避免阻塞。
            meta = await asyncio.to_thread(dl.get_meta, url)
            result = {
                "title": meta.title or None,
                "description": meta.description or None,
                "image_url": meta.cover_url or None,
                "source": "bili",
            }
            if include_content:
                result["content"] = ""
                result["word_count"] = 0
            return result
        except Exception as exc:
            logger.warning("B 站预览失败，降级到 og: %s", exc)
            # 降级到通用 og（B 站页面也有 og 标签）

    # ── 小红书：__INITIAL_STATE__ 专用解析（如果可用）──
    if _HAS_XHS and _is_xhs_url(url):
        try:
            _final_url, html = resolve_xhs_share(url)
            note = parse_xhs_page(html)
            image_list = note.get("imageList") or []
            image_url = ""
            if image_list:
                image_url = image_list[0].get("urlDefault") or image_list[0].get("url") or ""
                if image_url.startswith("//"):
                    image_url = "https:" + image_url
            result = {
                "title": note.get("title") or None,
                "description": note.get("desc") or None,
                "image_url": image_url or None,
                "source": "xhs",
            }
            if include_content:
                result["content"] = note.get("desc") or ""
                result["word_count"] = len(note.get("desc") or "")
            return result
        except Exception as exc:
            logger.warning("小红书预览失败，降级到 og: %s", exc)
            # 降级到通用 og

    # ── 通用网页：og 抓取 ──
    try:
        async with httpx.AsyncClient(
            timeout=10,
            follow_redirects=True,
            headers={"User-Agent": _UA},
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception as exc:
        logger.warning("网页抓取失败: %s", exc)
        result = {
            "title": None,
            "description": None,
            "image_url": None,
            "source": "fallback",
        }
        if include_content:
            result["content"] = ""
            result["word_count"] = 0
        return result

    # ── content-type 分流 ──
    content_type = resp.headers.get("content-type", "").lower()
    is_pdf = "application/pdf" in content_type or url.lower().endswith(".pdf")
    is_text = "text/plain" in content_type or url.lower().endswith(".md")

    # PDF：下载到临时文件 → load_pdf 提取
    if is_pdf and include_content:
        extract_result = _extract_pdf_content(resp.content, url)
        og = {
            "title": extract_result.get("title"),
            "description": None,
            "image_url": None,
            "source": "pdf",
        }
        og["content"] = extract_result["content"]
        og["word_count"] = extract_result["word_count"]
        og["parser"] = extract_result["parser"]
        if extract_result.get("warning"):
            og["warning"] = extract_result["warning"]
        return og

    # 纯文本 / Markdown：直接取文本
    if is_text and include_content:
        text = resp.text
        og = {
            "title": url.split("/")[-1] if "/" in url else url,
            "description": None,
            "image_url": None,
            "source": "text",
        }
        og["content"] = text
        og["word_count"] = len(text)
        og["parser"] = "plain_text"
        return og

    # HTML：现有 og + readability
    og = _extract_og(resp.text)

    if og["title"] or og["description"]:
        og["source"] = "og"
    else:
        og["source"] = "fallback"

    # ── 可选：readability 正文提取 ──
    if include_content:
        extract_result = _extract_content(url)
        og["content"] = extract_result["content"]
        og["word_count"] = extract_result["word_count"]
        og["parser"] = extract_result["parser"]
        if extract_result["warning"]:
            og["warning"] = extract_result["warning"]

    return og


def _extract_pdf_content(pdf_bytes: bytes, url: str) -> dict:
    """下载 PDF 到临时文件，用 text_loader.load_pdf 提取文本。"""
    if not _HAS_LOADER:
        logger.warning("text_loader 不可用，跳过 PDF 提取")
        return {"content": "", "word_count": 0, "parser": "none", "warning": "text_loader 不可用"}
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = Path(tmp.name)
        try:
            doc = _load_pdf(tmp_path)
            meta = getattr(doc, "meta", None)
            return {
                "content": doc.content,
                "word_count": doc.char_count,
                "parser": meta.get("parser", "pdf") if meta else "pdf",
                "title": doc.title,
                "warning": None,
            }
        finally:
            tmp_path.unlink(missing_ok=True)
    except TextLoaderError as exc:
        logger.warning("PDF 提取失败: %s", exc)
        return {"content": "", "word_count": 0, "parser": "pdf_failed", "warning": str(exc)}
    except Exception as exc:
        logger.warning("PDF 提取异常: %s", exc)
        return {"content": "", "word_count": 0, "parser": "pdf_failed", "warning": str(exc)}


def _extract_content(url: str) -> dict:
    """用 text_loader 提取正文，返回 {content, word_count, parser, warning}。"""
    if not _HAS_LOADER:
        logger.warning("text_loader 不可用，跳过正文提取")
        return {"content": "", "word_count": 0, "parser": "none", "warning": None}
    try:
        doc = _load_url(url, timeout=10)
        meta = getattr(doc, "meta", None)
        parser = meta.get("parser", "readability") if meta else "readability"
        return {"content": doc.content, "word_count": doc.char_count, "parser": parser, "warning": None}
    except TextLoaderError as exc:
        logger.warning("正文提取失败: %s", exc)
        # 微信公众号反爬失败 → 明确提示
        if "mp.weixin.qq.com" in url:
            return {
                "content": "",
                "word_count": 0,
                "parser": "wechat_failed",
                "warning": "该页面无法解析，请直接粘贴正文",
            }
        return {"content": "", "word_count": 0, "parser": "failed", "warning": str(exc)}
    except Exception as exc:
        logger.warning("正文提取异常: %s", exc)
        return {"content": "", "word_count": 0, "parser": "failed", "warning": str(exc)}
