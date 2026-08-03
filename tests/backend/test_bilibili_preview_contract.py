"""Q1-A：B 站 BV 号大小写与 link preview 契约。

覆盖计划 Q1 红灯 1/2：
- extract_bvid_from_url 保留 BV payload 大小写（BV1YUG36pEdp 不得被整体 upper）；
- link preview 用该 BV 号返回真实 image_url 契约；
- B 站 API JSON 解析失败时记录 HTTP 状态 / content-type / 有长度上限的响应摘要，
  且不得记录 cookie / token。
"""

from __future__ import annotations

import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.downloaders.bilibili_nocookie import extract_bvid_from_url

BV_URL = "https://www.bilibili.com/video/BV1YUG36pEdp"


class TestExtractBvidCase:
    def test_payload_case_preserved(self):
        """BV payload 大小写敏感，必须原样保留（整体 upper 会得到无效 BV）。"""
        assert extract_bvid_from_url(BV_URL) == "BV1YUG36pEdp"

    def test_lowercase_prefix_normalized_payload_kept(self):
        """仅规范 b/v 前缀为 BV，payload 不动。"""
        assert (
            extract_bvid_from_url("https://www.bilibili.com/video/bv1YUG36pEdp")
            == "BV1YUG36pEdp"
        )

    def test_bare_bvid_case_preserved(self):
        assert extract_bvid_from_url("BV1YUG36pEdp") == "BV1YUG36pEdp"


class TestLinkPreviewBiliContract:
    def test_image_url_preserved_and_bvid_case_kept(self, monkeypatch):
        """link-preview 走 B 站专用解析：image_url 原样返回，且下传的 BV 保留大小写。"""
        from backend.app.downloaders.base import VideoMeta
        from backend.app.routes import link_preview as lp

        seen_bvids: list[str] = []

        class _FakeDownloader:
            def get_meta(self, video_url: str) -> VideoMeta:
                seen_bvids.append(extract_bvid_from_url(video_url))
                return VideoMeta(
                    video_id="BV1YUG36pEdp",
                    title="示例视频",
                    description="",
                    duration=120,
                    cover_url="https://i0.hdslb.com/bfs/archive/cover.jpg",
                    author="up",
                    platform="bilibili",
                    view_count=1,
                    upload_date="2026-08-01",
                    tags=[],
                    raw_info={},
                )

        monkeypatch.setattr(lp, "BilibiliNoCookieDownloader", _FakeDownloader)

        app = FastAPI()
        app.include_router(lp.router)
        client = TestClient(app)

        resp = client.get("/link-preview", params={"url": BV_URL})
        assert resp.status_code == 200
        body = resp.json()
        assert body["source"] == "bili"
        assert body["image_url"] == "https://i0.hdslb.com/bfs/archive/cover.jpg"
        assert seen_bvids == ["BV1YUG36pEdp"]


class TestBiliJsonFailureLog:
    def test_json_failure_logs_status_content_type_and_bounded_summary(self, caplog):
        """JSON 解析失败不能只留 JSONDecodeError：要有 status/content-type/有限摘要，
        且不记录 cookie/token。"""
        from backend.app.downloaders.bilibili_nocookie import _parse_api_json

        body = (
            "cookie=hunter token=hunter2 authorization=Bearer abc123 "
            "SESSDATA=secret-sess <html>风控</html>"
            + "A" * 300
            + "SECRET_TAIL"
        )

        class _Resp:
            status_code = 412
            headers = {
                "content-type": "text/html; charset=utf-8",
                "Set-Cookie": "SESSDATA=secret-sess",
            }
            text = body

            def json(self):
                raise json.JSONDecodeError("Expecting value", body, 0)

        with caplog.at_level(
            logging.WARNING, logger="backend.app.downloaders.bilibili_nocookie"
        ):
            with pytest.raises(json.JSONDecodeError):
                _parse_api_json(_Resp(), context="获取视频信息")

        message = " ".join(r.getMessage() for r in caplog.records)
        assert "412" in message
        assert "text/html" in message
        # 有长度上限的摘要：超出部分不得进入日志
        assert "SECRET_TAIL" not in message
        # 脱敏：敏感值即使位于摘要开头，也不得出现在日志。
        assert "hunter" not in message
        assert "hunter2" not in message
        assert "abc123" not in message
        assert "secret-sess" not in message
