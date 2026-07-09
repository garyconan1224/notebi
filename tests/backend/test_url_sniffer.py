"""F4.1 sniff-url 端点测试——覆盖已知平台 + 未知 URL 降级。"""

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)

SNIFF_URL = "/workspaces/sniff-url"


class TestSniffUrlKnownPlatforms:
    """策略 1：已知平台 URL 路径模式——零网络开销。"""

    def test_bilibili_video_url(self):
        resp = client.post(SNIFF_URL, json={"url": "https://www.bilibili.com/video/BV1qA5j6jEJC"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_type"] == "video"
        assert "audio" in data["possible_types"]
        assert data["platform"] == "bilibili"

    def test_bilibili_read_url(self):
        resp = client.post(SNIFF_URL, json={"url": "https://www.bilibili.com/read/cv12345678"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_type"] == "text"
        assert data["platform"] == "bilibili"

    def test_youtube_url(self):
        resp = client.post(SNIFF_URL, json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_type"] == "video"
        assert data["platform"] == "youtube"

    def test_youtube_shorts_url(self):
        resp = client.post(SNIFF_URL, json={"url": "https://www.youtube.com/shorts/abc123"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_type"] == "video"
        assert data["platform"] == "youtube"

    def test_weixin_article_url(self):
        resp = client.post(SNIFF_URL, json={"url": "https://mp.weixin.qq.com/s/test123"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_type"] == "text"
        assert data["platform"] == "weixin"

    def test_xiaohongshu_discovery_url(self):
        resp = client.post(SNIFF_URL, json={"url": "https://www.xiaohongshu.com/discovery/item/abc"})
        assert resp.status_code == 200
        data = resp.json()
        # M6 起小红书收敛为 text（图文笔记），下载后 PROBE 阶段再细分 image_text
        assert data["primary_type"] == "text"
        assert data["platform"] == "xiaohongshu"

    def test_douyin_url(self):
        resp = client.post(SNIFF_URL, json={"url": "https://www.douyin.com/video/123456"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_type"] == "video"
        assert data["platform"] == "douyin"


class TestSniffUrlByExtension:
    """策略 1.5：URL 扩展名判断（非已知平台）。"""

    def test_image_direct_link(self):
        resp = client.post(SNIFF_URL, json={"url": "https://example.com/photo.jpg"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_type"] == "image"
        assert data["platform"] is None

    def test_audio_direct_link(self):
        resp = client.post(SNIFF_URL, json={"url": "https://cdn.example.com/track.mp3"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_type"] == "audio"
        assert data["platform"] is None


class TestSniffUrlFallback:
    """策略 3：完全不可识别场景降级。"""

    def test_empty_url_rejected(self):
        resp = client.post(SNIFF_URL, json={"url": ""})
        assert resp.status_code == 422

    def test_unknown_domain_fallback_to_video(self):
        """未知域名且无 HTTP 访问时降级为 video，confident=False。"""
        resp = client.post(SNIFF_URL, json={"url": "https://totally-unknown-xyz.example/foo"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_type"] == "video"
        assert data["confident"] is False
        assert "error" in data

    def test_pure_bv_fallback_to_video(self):
        """纯 BV 号没有域名信息，降级为 video，confident=False。"""
        resp = client.post(SNIFF_URL, json={"url": "BV1qA5j6jEJC"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["primary_type"] == "video"
        assert data["confident"] is False
