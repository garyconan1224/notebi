"""tests for GET /api/image_proxy（图片代理加固）"""

from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


class _FakeImageResp:
    def __init__(self, content=b"img", status_code=200, content_type="image/jpeg"):
        self.content = content
        self.status_code = status_code
        self.headers = {"content-type": content_type}


@patch("httpx.get", return_value=_FakeImageResp())
def test_image_proxy_ok_with_cache_header(mock_get):
    resp = client.get(
        "/api/image_proxy",
        params={"url": "https://i0.hdslb.com/cover.jpg"},
    )
    assert resp.status_code == 200
    assert resp.content == b"img"
    assert resp.headers["cache-control"] == "public, max-age=3600"
    assert mock_get.call_args[0][0] == "https://i0.hdslb.com/cover.jpg"


@patch("httpx.get")
def test_image_proxy_rejects_non_http_scheme(mock_get):
    resp = client.get(
        "/api/image_proxy",
        params={"url": "file:///etc/passwd"},
    )
    assert resp.status_code == 400
    mock_get.assert_not_called()


@patch("httpx.get", return_value=_FakeImageResp(content_type="text/html"))
def test_image_proxy_rejects_non_image_content_type(mock_get):
    resp = client.get(
        "/api/image_proxy",
        params={"url": "https://example.com/page"},
    )
    assert resp.status_code == 400


@patch("httpx.get", side_effect=Exception("boom"))
def test_image_proxy_returns_502_on_upstream_error(mock_get):
    resp = client.get(
        "/api/image_proxy",
        params={"url": "https://example.com/a.jpg"},
    )
    assert resp.status_code == 502
