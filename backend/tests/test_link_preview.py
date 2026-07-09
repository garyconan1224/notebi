"""tests for GET /link-preview"""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


# ── helpers ──────────────────────────────────────────────────────────────


@dataclass
class _FakeMeta:
    title: str = "B站视频标题"
    description: str = "B站视频简介"
    cover_url: str = "https://i0.hdslb.com/cover.jpg"


def _mock_get_meta(url: str) -> _FakeMeta:
    return _FakeMeta()


# ── B 站链接 → source=bili ───────────────────────────────────────────────


@patch("backend.app.routes.link_preview._HAS_BILI", True)
@patch(
    "backend.app.routes.link_preview.BilibiliNoCookieDownloader",
    create=True,
)
@patch(
    "backend.app.routes.link_preview.extract_bvid_from_url",
    return_value="BV1xx411c7mD",
)
def test_bili(mock_bvid, mock_dl_cls):
    mock_dl = MagicMock()
    mock_dl.get_meta.return_value = _FakeMeta()
    mock_dl_cls.return_value = mock_dl

    resp = client.get(
        "/link-preview",
        params={"url": "https://www.bilibili.com/video/BV1xx411c7mD"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "bili"
    assert body["title"] == "B站视频标题"
    assert body["description"] == "B站视频简介"
    assert "hdslb.com" in body["image_url"]


# ── 通用网页 og → source=og ─────────────────────────────────────────────


_OG_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="OG标题">
  <meta property="og:description" content="OG描述">
  <meta property="og:image" content="https://example.com/img.jpg">
</head>
<body></body>
</html>"""


@patch("backend.app.routes.link_preview._HAS_BILI", False)
@patch("httpx.AsyncClient.get")
def test_og(mock_get):
    mock_resp = MagicMock()
    mock_resp.text = _OG_HTML
    mock_resp.status_code = 200
    mock_resp.raise_for_status = MagicMock()
    mock_get.return_value = mock_resp

    resp = client.get("/link-preview", params={"url": "https://example.com/article"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "og"
    assert body["title"] == "OG标题"
    assert body["description"] == "OG描述"
    assert body["image_url"] == "https://example.com/img.jpg"


# ── 抓取失败 → source=fallback ──────────────────────────────────────────


@patch("backend.app.routes.link_preview._HAS_BILI", False)
@patch("httpx.AsyncClient.get", side_effect=Exception("timeout"))
def test_fallback(mock_get):
    resp = client.get("/link-preview", params={"url": "https://bad.example.com"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "fallback"
    assert body["title"] is None
    assert body["description"] is None
    assert body["image_url"] is None


# ── 空 url → 400 ────────────────────────────────────────────────────────


def test_empty_url():
    resp = client.get("/link-preview", params={"url": ""})
    assert resp.status_code == 400


# ── include_content=true → 返回 content + word_count ─────────────────────


_ARTICLE_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="文章标题">
  <meta property="og:description" content="文章描述">
</head>
<body>
  <article>
    <h1>文章标题</h1>
    <p>这是第一段正文内容，包含一些有意义的文字。</p>
    <p>这是第二段正文内容，继续提供更多细节和信息。</p>
    <p>这是第三段，用来测试 word_count 的计算是否正确。</p>
  </article>
</body>
</html>"""


@patch("backend.app.routes.link_preview._HAS_BILI", False)
@patch("backend.app.routes.link_preview._HAS_LOADER", True)
@patch("backend.app.routes.link_preview._load_url")
@patch("httpx.AsyncClient.get")
def test_include_content(mock_get, mock_load_url):
    # mock og 抓取
    mock_resp = MagicMock()
    mock_resp.text = _ARTICLE_HTML
    mock_resp.status_code = 200
    mock_resp.raise_for_status = MagicMock()
    mock_get.return_value = mock_resp

    # mock readability 正文提取
    from dataclasses import dataclass

    @dataclass
    class FakeDoc:
        title: str = "文章标题"
        content: str = "这是第一段正文内容，包含一些有意义的文字。\n\n这是第二段正文内容，继续提供更多细节和信息。\n\n这是第三段，用来测试 word_count 的计算是否正确。"
        char_count: int = 75

    mock_load_url.return_value = FakeDoc()

    resp = client.get(
        "/link-preview",
        params={"url": "https://example.com/article", "include_content": "true"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "og"
    assert body["title"] == "文章标题"
    assert "content" in body
    assert body["content"] != ""
    assert body["word_count"] > 0


@patch("backend.app.routes.link_preview._HAS_BILI", False)
@patch("backend.app.routes.link_preview._HAS_LOADER", True)
@patch("backend.app.routes.link_preview._load_url", side_effect=Exception("timeout"))
@patch("httpx.AsyncClient.get")
def test_include_content_extraction_fail(mock_get, mock_load_url):
    """正文提取失败时返回空 content，不报 500。"""
    mock_resp = MagicMock()
    mock_resp.text = _ARTICLE_HTML
    mock_resp.status_code = 200
    mock_resp.raise_for_status = MagicMock()
    mock_get.return_value = mock_resp

    resp = client.get(
        "/link-preview",
        params={"url": "https://example.com/article", "include_content": "true"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["source"] == "og"
    assert body["content"] == ""
    assert body["word_count"] == 0
