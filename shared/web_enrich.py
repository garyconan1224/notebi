"""
联网补全：通过 DuckDuckGo 检索文本摘要与产品图 URL，并尽量下载图片字节供多模态模型使用。
说明：结果来自公开网页摘录，可能存在滞后或不准确，仅作创作辅助。
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

import requests
from PIL import Image
from tenacity import retry, stop_after_attempt, wait_exponential

# 与检索相关的可调参数（也可挪到 config.py）
WEB_TEXT_QUERIES_MAX: int = 4  # 文本检索轮数上限
WEB_TEXT_HITS_PER_QUERY: int = 5
WEB_IMAGE_MAX: int = 6
WEB_IMAGE_MAX_BYTES: int = 4 * 1024 * 1024
WEB_MARKDOWN_MAX_CHARS: int = 8000
WEB_FALLBACK_NOTICE: str = (
    "联网结果不足，已降级为本地创作模式：请优先依赖手填卖点、上传参考图与本地知识库。"
)

_FETCH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}


@dataclass
class WebEnrichment:
    """一次联网补全的结构化结果。"""

    markdown: str
    images: List[Tuple[bytes, str]] = field(default_factory=list)
    text_sources: List[str] = field(default_factory=list)
    image_urls_tried: List[str] = field(default_factory=list)


def _build_queries(product_name: str, user_hint: str) -> List[str]:
    name = (product_name or "").strip()
    hint = (user_hint or "").strip()
    base = [
        f"{name} 手机 参数 配置 价格",
        f"{name} 手机 官方 发布 亮点",
        f"{name} 评测 影像 续航 卖点",
        f"{name} 手机 规格 上市",
    ]
    if hint:
        base.insert(0, f"{name} 手机 {hint}")
    seen: set[str] = set()
    out: List[str] = []
    for q in base:
        q = q.strip()
        if not q or q in seen:
            continue
        seen.add(q)
        out.append(q)
        if len(out) >= WEB_TEXT_QUERIES_MAX:
            break
    return out[:WEB_TEXT_QUERIES_MAX]


def _collect_text_snippets(queries: Sequence[str]) -> Tuple[str, List[str]]:
    try:
        from duckduckgo_search import DDGS
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("请先安装依赖：pip install duckduckgo-search") from e

    lines: List[str] = []
    sources: List[str] = []
    with DDGS() as ddgs:
        for q in queries:
            try:
                it = ddgs.text(q, max_results=WEB_TEXT_HITS_PER_QUERY)
                for r in it:
                    title = (r.get("title") or "").strip()
                    body = (r.get("body") or "").strip()
                    href = (r.get("href") or "").strip()
                    if not body and not title:
                        continue
                    chunk = body[:900] + ("…" if len(body) > 900 else "")
                    lines.append(
                        f"- **{title or '（无标题）'}**\n"
                        f"  {chunk}\n"
                        f"  来源: {href or '未知'}"
                    )
                    if href:
                        sources.append(href)
            except Exception:
                continue
    md = "## 联网检索摘录（文本）\n\n" + ("\n".join(lines) if lines else "_（未获取到有效文本结果，可稍后再试或更换关键词）_")
    if len(md) > WEB_MARKDOWN_MAX_CHARS:
        md = md[:WEB_MARKDOWN_MAX_CHARS] + "\n\n…（已截断）"
    return md, sources


def _collect_image_urls(product_name: str, user_hint: str) -> List[str]:
    from duckduckgo_search import DDGS

    name = (product_name or "").strip()
    hint = (user_hint or "").strip()
    q = f"{name} 手机 产品图 官方"
    if hint:
        q = f"{name} 手机 {hint}"
    urls: List[str] = []
    with DDGS() as ddgs:
        try:
            it = ddgs.images(q, max_results=WEB_IMAGE_MAX + 4)
            for r in it:
                u = (r.get("image") or r.get("thumbnail") or "").strip()
                if u.startswith("https://") or u.startswith("http://"):
                    urls.append(u)
                if len(urls) >= WEB_IMAGE_MAX:
                    break
        except Exception:
            pass
    # 去重保序
    seen: set[str] = set()
    out: List[str] = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _guess_mime_from_bytes(data: bytes) -> str:
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(data) >= 6 and (data[:6] in (b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


@retry(
    reraise=True,
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=1, max=6),
)
def _download_image(url: str) -> Optional[Tuple[bytes, str]]:
    r = requests.get(url, headers=_FETCH_HEADERS, timeout=20)
    r.raise_for_status()
    data = r.content
    if not data or len(data) > WEB_IMAGE_MAX_BYTES:
        return None
    ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    if ctype.startswith("image/"):
        mime = ctype if ctype in ("image/jpeg", "image/png", "image/webp", "image/gif") else "image/jpeg"
    else:
        mime = _guess_mime_from_bytes(data)
    # 用 Pillow 尝试解码，过滤损坏或非图像内容
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception:
        return None
    return data, mime


def enrich_product(product_name: str, user_hint: str = "") -> WebEnrichment:
    """
    根据产品名（及可选补充词）执行联网检索：
    - 文本：多条查询合并为 Markdown，含可能的卖点 / 价格描述 / 参数线索；
    - 图片：尝试下载若干张参考图，供多模态模型与分镜参考。
    """
    queries = _build_queries(product_name, user_hint)
    text_md, sources = _collect_text_snippets(queries)
    img_urls = _collect_image_urls(product_name, user_hint)

    images: List[Tuple[bytes, str]] = []
    tried = list(img_urls)
    for url in img_urls:
        if len(images) >= WEB_IMAGE_MAX:
            break
        try:
            got = _download_image(url)
            if got:
                images.append(got)
        except Exception:
            continue

    img_md_lines = ["## 联网检索参考图（URL）", ""]
    for u in img_urls[:WEB_IMAGE_MAX]:
        img_md_lines.append(f"- {u}")
    if len(img_md_lines) <= 2:
        img_md_lines.append("_（未获取到图片链接）_")

    full_md = text_md + "\n\n" + "\n".join(img_md_lines)
    if not sources and not img_urls:
        full_md += f"\n\n## 降级提示\n\n- {WEB_FALLBACK_NOTICE}"
    elif not sources:
        full_md += f"\n\n## 降级提示\n\n- 文本检索为空。{WEB_FALLBACK_NOTICE}"
    elif not images:
        full_md += f"\n\n## 降级提示\n\n- 图片下载为空。{WEB_FALLBACK_NOTICE}"
    if len(full_md) > WEB_MARKDOWN_MAX_CHARS + 500:
        full_md = full_md[: WEB_MARKDOWN_MAX_CHARS + 500] + "\n\n…（已截断）"

    return WebEnrichment(
        markdown=full_md,
        images=images,
        text_sources=sources,
        image_urls_tried=tried,
    )
