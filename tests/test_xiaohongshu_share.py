"""小红书适配器单元测试。

测试解析逻辑（不需要网络），以及两个实测链接的端到端验证。
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest

from shared.xiaohongshu_share import (
    _clean_json,
    _extract_initial_state,
    _extract_note_from_state,
    _extract_og_fallback,
    extract_first_xhs_url,
    is_xiaohongshu_url_or_text,
    parse_xhs_page,
    resolve_xhs_share,
    run_xiaohongshu_download,
)


# ── 域名判断 ──────────────────────────────────────────────────────

class TestIsXiaohongshuUrl:
    def test_xhslink_short(self):
        assert is_xiaohongshu_url_or_text("http://xhslink.com/o/3w7r5xADEqD")

    def test_xhslink_with_text(self):
        assert is_xiaohongshu_url_or_text("看看这个 http://xhslink.com/o/abc 有意思")

    def test_xiaohongshu_domain(self):
        assert is_xiaohongshu_url_or_text("https://www.xiaohongshu.com/explore/abc123")

    def test_not_xhs(self):
        assert not is_xiaohongshu_url_or_text("https://www.douyin.com/video/123")

    def test_empty(self):
        assert not is_xiaohongshu_url_or_text("")

    def test_none(self):
        assert not is_xiaohongshu_url_or_text(None)


class TestExtractFirstXhsUrl:
    def test_extract_from_text(self):
        text = "分享一篇笔记 http://xhslink.com/o/3w7r5xADEqD 快来看"
        url = extract_first_xhs_url(text)
        assert url == "http://xhslink.com/o/3w7r5xADEqD"

    def test_no_url(self):
        assert extract_first_xhs_url("没有链接") == ""

    def test_direct_url(self):
        url = "https://www.xiaohongshu.com/explore/abc123"
        assert extract_first_xhs_url(url) == url


# ── JSON 清洗 ─────────────────────────────────────────────────────

class TestCleanJson:
    def test_undefined_to_null(self):
        raw = '{"key": undefined, "nested": {"a": undefined}}'
        cleaned = _clean_json(raw)
        data = json.loads(cleaned)
        assert data["key"] is None
        assert data["nested"]["a"] is None

    def test_no_undefined(self):
        raw = '{"key": "value"}'
        assert _clean_json(raw) == raw

    def test_undefined_in_string_preserved(self):
        # "undefined" 作为字符串值不应被替换
        raw = '{"key": "undefined"}'
        cleaned = _clean_json(raw)
        data = json.loads(cleaned)
        assert data["key"] == "undefined"


# ── __INITIAL_STATE__ 提取 ────────────────────────────────────────

class TestExtractInitialState:
    def test_extract_valid(self):
        html = '''
        <html><body>
        <script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"abc":{"note":{"title":"test"}}}}}</script>
        </body></html>
        '''
        state = _extract_initial_state(html)
        assert state is not None
        assert state["note"]["noteDetailMap"]["abc"]["note"]["title"] == "test"

    def test_extract_with_undefined(self):
        html = '''
        <script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"abc":{"note":{"title":"test","video":undefined}}}}}</script>
        '''
        state = _extract_initial_state(html)
        assert state is not None
        assert state["note"]["noteDetailMap"]["abc"]["note"]["video"] is None

    def test_no_initial_state(self):
        html = "<html><body>no script here</body></html>"
        assert _extract_initial_state(html) is None

    def test_invalid_json(self):
        html = '<script>window.__INITIAL_STATE__={invalid json}</script>'
        assert _extract_initial_state(html) is None


# ── 笔记提取 ──────────────────────────────────────────────────────

class TestExtractNoteFromState:
    def test_extract_image_note(self):
        state = {
            "note": {
                "noteDetailMap": {
                    "note123": {
                        "note": {
                            "noteId": "note123",
                            "title": "图文笔记",
                            "desc": "正文内容",
                            "type": "normal",
                            "imageList": [
                                {"urlDefault": "https://img.xhs.com/1.jpg"},
                                {"urlDefault": "https://img.xhs.com/2.jpg"},
                            ],
                        }
                    }
                }
            }
        }
        note = _extract_note_from_state(state)
        assert note is not None
        assert note["title"] == "图文笔记"
        assert note["type"] == "normal"
        assert len(note["imageList"]) == 2

    def test_extract_video_note(self):
        state = {
            "note": {
                "noteDetailMap": {
                    "vid456": {
                        "note": {
                            "noteId": "vid456",
                            "title": "视频笔记",
                            "desc": "视频描述",
                            "type": "video",
                            "video": {"url": "https://v.xhs.com/video.mp4"},
                            "imageList": [{"urlDefault": "https://img.xhs.com/cover.jpg"}],
                        }
                    }
                }
            }
        }
        note = _extract_note_from_state(state)
        assert note is not None
        assert note["type"] == "video"
        assert note["video"]["url"] == "https://v.xhs.com/video.mp4"

    def test_no_note_section(self):
        assert _extract_note_from_state({}) is None
        assert _extract_note_from_state({"note": {}}) is None
        assert _extract_note_from_state({"note": {"noteDetailMap": {}}}) is None


# ── OG 降级 ──────────────────────────────────────────────────────

class TestExtractOgFallback:
    def test_with_title_and_desc(self):
        html = '''
        <html>
        <head>
            <title>笔记标题 - 小红书</title>
            <meta property="og:description" content="这是描述">
            <meta property="og:image" content="https://img.xhs.com/cover.jpg">
        </head>
        </html>
        '''
        result = _extract_og_fallback(html)
        assert result["title"] == "笔记标题 - 小红书"
        assert result["desc"] == "这是描述"
        assert len(result["imageList"]) == 1

    def test_minimal(self):
        html = "<html><head><title>最小页面</title></head></html>"
        result = _extract_og_fallback(html)
        assert result["title"] == "最小页面"
        assert result["desc"] == ""


# ── 完整解析 ──────────────────────────────────────────────────────

class TestParseXhsPage:
    def test_with_initial_state(self):
        html = '''
        <html><body>
        <script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"n1":{"note":{
            "noteId":"n1","title":"标题","desc":"正文","type":"normal",
            "imageList":[{"urlDefault":"https://img.xhs.com/1.jpg"}]
        }}}}}</script>
        </body></html>
        '''
        result = parse_xhs_page(html)
        assert result["title"] == "标题"
        assert result["desc"] == "正文"
        assert result["source"] == "initial_state"
        assert len(result["imageList"]) == 1

    def test_fallback_to_og(self):
        html = '''
        <html><head>
            <title>OG标题 - 小红书</title>
            <meta property="og:description" content="OG描述">
        </head></html>
        '''
        result = parse_xhs_page(html)
        assert result["title"] == "OG标题 - 小红书"
        assert result["desc"] == "OG描述"
        assert result["source"] == "og_fallback"


# ── 端到端（需要网络）─────────────────────────────────────────────

@pytest.mark.skipif(
    os.environ.get("SKIP_NETWORK_TESTS", "0") == "1",
    reason="跳过网络测试",
)
class TestE2E:
    """用两个实测链接跑通完整流程。"""

    XHS_IMAGE_URL = "http://xhslink.com/o/3w7r5xADEqD"
    XHS_VIDEO_URL = "http://xhslink.com/o/c7LCUZRTFn"

    def test_resolve_image_share(self):
        """图文笔记：短链解析 + HTML 解析。"""
        final_url, html = resolve_xhs_share(self.XHS_IMAGE_URL)
        assert "xiaohongshu.com" in final_url
        assert len(html) > 1000

        meta = parse_xhs_page(html)
        assert meta["title"], "应提取到标题"
        assert meta["imageList"], "图文笔记应有图片列表"
        assert meta["source"] == "initial_state"

    def test_resolve_video_share(self):
        """视频笔记：短链解析 + HTML 解析。"""
        final_url, html = resolve_xhs_share(self.XHS_VIDEO_URL)
        assert "xiaohongshu.com" in final_url
        assert len(html) > 1000

        meta = parse_xhs_page(html)
        assert meta["title"], "应提取到标题"
        assert meta["source"] == "initial_state"

    def test_download_image_note(self):
        """图文笔记：完整下载流程。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = run_xiaohongshu_download(
                url_or_text=self.XHS_IMAGE_URL,
                output_dir=tmpdir,
            )
            assert result["ok"], f"下载应成功: {result.get('error')}"
            assert os.path.isdir(result["save_path"]), "图文笔记应返回目录"
            # 目录内应有图片
            files = os.listdir(result["save_path"])
            img_files = [f for f in files if f.endswith((".jpg", ".jpeg", ".png", ".webp"))]
            assert len(img_files) > 0, f"应有图片文件，实际: {files}"

    def test_download_video_note(self):
        """视频笔记：完整下载流程。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = run_xiaohongshu_download(
                url_or_text=self.XHS_VIDEO_URL,
                output_dir=tmpdir,
            )
            # 视频可能下载失败（需要实际视频 URL），但至少应返回 note_meta
            assert result.get("note_meta"), "应返回笔记元数据"
            if result["ok"]:
                assert os.path.isfile(result["save_path"]), "视频应返回文件路径"
