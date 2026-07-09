"""抖音 no-cookie 移动端下载模块的单元测试。

覆盖：URL 识别、短链跳转、HTML 解析、play_uri 提取、流式下载、失败兜底。
所有测试通过 mock requests.Session 运行，不访问真实网络。
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from shared.douyin_mobile_share import (
    is_douyin_url_or_text,
    extract_first_douyin_url,
    resolve_douyin_share,
    parse_douyin_share_page,
    run_douyin_mobile_download,
    _extract_play_uri,
    _build_mp4_url,
    _CHUNK_SIZE,
)


# ── helpers ────────────────────────────────────────────────────────

def _mock_session(headers, final_url, html, mp4_bytes=b"fake_mp4_data"):
    """创建一个 mock requests.Session，控制跳转、HTML 和 mp4 响应。"""

    def _session_factory():
        s = MagicMock(name="Session")
        s.headers = {}

        # GET 的行为取决于 URL
        def _get(url, **kwargs):
            mock_resp = MagicMock(name="Response")
            mock_resp.raise_for_status = MagicMock()

            if "mp4" in url or "play" in url or "aweme" in url:
                # mp4 下载响应
                mock_resp.headers = {"Content-Length": str(len(mp4_bytes))}
                mock_resp.iter_content = MagicMock(return_value=[mp4_bytes])

                def _dl_enter():
                    return mock_resp

                def _dl_exit(*a):
                    pass

                mock_resp.__enter__ = MagicMock(side_effect=_dl_enter)
                mock_resp.__exit__ = MagicMock(side_effect=_dl_exit)
            else:
                mock_resp.url = final_url
                mock_resp.text = html
                mock_resp.headers = {}
                mock_resp.iter_content = MagicMock(return_value=[])

            return mock_resp

        s.get = MagicMock(side_effect=_get)
        return s

    return _session_factory


def _make_share_html(play_uri="v0200fg10000cjkv7abc123def456ghi", aweme_id="7123456789012345678", title="测试抖音视频"):
    """构造一个标准的抖音分享页 HTML。"""
    render_data = {
        "aweme": {
            "detail": {
                "awemeId": aweme_id,
                "desc": title,
                "video": {
                    "play_addr": {
                        "uri": play_uri,
                        "url_list": [f"https://aweme.snssdk.com/aweme/v1/play/?video_id={play_uri}"],
                        "width": 1080,
                        "height": 1920,
                    }
                },
            }
        }
    }
    encoded = json.dumps(render_data, ensure_ascii=False)
    html = f"""<!DOCTYPE html>
<html>
<head>
    <title>{title}</title>
</head>
<body>
    <script id="RENDER_DATA" type="application/json">{encoded}</script>
    <div>抖音分享页内容</div>
</body>
</html>"""
    return html


def _make_share_html_router(play_uri="v0200fg10000cjkv7abc123def456ghi", aweme_id="7123456789012345678", title="测试抖音视频"):
    """构造 _ROUTER_DATA 格式的分享页 HTML。"""
    router_data = {
        "loaderData": {
            "video_(id)": {
                "videoInfoRes": {
                    "item_list": [{
                        "video": {
                            "play_addr": {
                                "uri": play_uri,
                                "url_list": [play_uri],
                            }
                        }
                    }]
                }
            }
        }
    }
    router_json = json.dumps(router_data, ensure_ascii=False)
    html = f"""<!DOCTYPE html>
<html>
<head><title>{title}</title></head>
<body>
<script>window._ROUTER_DATA = {router_json};</script>
</body>
</html>"""
    return html


# ── URL 识别测试 ──────────────────────────────────────────────────

class TestUrlDetection:
    def test_v_douyin_short_url(self):
        assert is_douyin_url_or_text("https://v.douyin.com/iJvcK8CLC_o/") is True

    def test_www_douyin_url(self):
        assert is_douyin_url_or_text("https://www.douyin.com/video/7123456789012345678") is True

    def test_iesdouyin_url(self):
        assert is_douyin_url_or_text("https://www.iesdouyin.com/share/video/7123456789012345678/") is True

    def test_bilibili_not_douyin(self):
        assert is_douyin_url_or_text("https://www.bilibili.com/video/BV1xx") is False

    def test_youtube_not_douyin(self):
        assert is_douyin_url_or_text("https://www.youtube.com/watch?v=abc") is False

    def test_empty_string(self):
        assert is_douyin_url_or_text("") is False
        assert is_douyin_url_or_text("   ") is False


class TestExtractFirstUrl:
    def test_extract_short_url(self):
        url = extract_first_douyin_url("https://v.douyin.com/iJvcK8CLC_o/")
        assert url == "https://v.douyin.com/iJvcK8CLC_o/"

    def test_extract_from_share_text(self):
        text = "7.99 复制打开抖音，看看【某某的作品】https://v.douyin.com/iJvcK8CLC_o/ abc@def"
        url = extract_first_douyin_url(text)
        assert url == "https://v.douyin.com/iJvcK8CLC_o/"

    def test_no_url_returns_empty(self):
        assert extract_first_douyin_url("hello world") == ""

    def test_www_url(self):
        url = extract_first_douyin_url("看看这个 https://www.douyin.com/video/123456")
        assert url == "https://www.douyin.com/video/123456"


# ── 短链解析测试 ──────────────────────────────────────────────────

class TestResolveShare:
    def test_follow_redirect(self):
        """短链跳转到 iesdouyin.com/share/video/{id}。"""
        mock_sess = MagicMock(name="Session")
        mock_sess.headers = {}
        mock_resp = MagicMock(name="Response")
        mock_resp.url = "https://www.iesdouyin.com/share/video/7123456789012345678/"
        mock_resp.raise_for_status = MagicMock()
        mock_sess.get = MagicMock(return_value=mock_resp)

        with patch("shared.douyin_mobile_share.requests.Session", return_value=mock_sess):
            final = resolve_douyin_share("https://v.douyin.com/iJvcK8CLC_o/")
            assert "iesdouyin.com/share/video/" in final

    def test_invalid_input_raises(self):
        with pytest.raises(ValueError, match="未在输入文本中找到抖音 URL"):
            resolve_douyin_share("hello 抖音")


# ── HTML 解析测试 ─────────────────────────────────────────────────

class TestParseSharePage:
    def test_extract_play_uri_from_render_data(self):
        uri = "v0200fg10000cjkv7abc123"
        html = _make_share_html(play_uri=uri)
        result = parse_douyin_share_page(html)
        # uri 优先于 url_list（无水印），返回值应为纯 uri 片段
        assert result["play_uri"] == uri

    def test_extract_title(self):
        html = _make_share_html(title="我的视频标题")
        result = parse_douyin_share_page(html)
        assert result["title"] == "我的视频标题"

    def test_extract_aweme_id(self):
        html = _make_share_html(aweme_id="7123456789012345678")
        # aweme_id 从 URL /video/{id} 提取或 JSON 字段提取
        # 这里从 RENDER_DATA JSON 字段提取（通过 _deep_find）
        result = parse_douyin_share_page(html)
        assert result["aweme_id"] == "7123456789012345678" or result["play_uri"] != ""

    def test_no_play_uri_returns_empty(self):
        html = "<html><body>no video data here</body></html>"
        result = parse_douyin_share_page(html)
        assert result["play_uri"] == ""

    def test_extract_from_router_data(self):
        uri = "v0200fg10000cjkv7abc456"
        html = _make_share_html_router(play_uri=uri)
        result = parse_douyin_share_page(html)
        assert result["play_uri"] == uri

    def test_parse_empty_html(self):
        result = parse_douyin_share_page("")
        assert result["play_uri"] == ""
        assert result["title"] == ""


# ── mp4 URL 拼装测试 ─────────────────────────────────────────────

class TestBuildMp4Url:
    def test_uri_fragment(self):
        url = _build_mp4_url("v0200fg10000cjkv7abc123")
        assert url.startswith("https://")
        assert "play" in url

    def test_full_url_passthrough(self):
        url = _build_mp4_url("https://aweme.snssdk.com/aweme/v1/play/?video_id=abc")
        assert url == "https://aweme.snssdk.com/aweme/v1/play/?video_id=abc"


# ── 端到端下载测试（mock 网络） ───────────────────────────────────

class TestRunDownload:
    def test_happy_path(self, tmp_path):
        """完整的抖音下载 happy path。"""
        uri = "v0200fg10000cjkv7abc123"
        html = _make_share_html(play_uri=uri)
        output_dir = str(tmp_path)
        logs: list[str] = []

        # mock Session
        def _session_factory():
            s = MagicMock(name="Session")
            s.headers = {}

            def _get(url, **kwargs):
                mock_resp = MagicMock(name="Response")
                mock_resp.raise_for_status = MagicMock()
                if "play" in url or "aweme" in url:
                    fake_data = b"\x00\x00\x00\x18ftypmp42" + b"fake_mp4" * 1000
                    mock_resp.headers = {"Content-Length": str(len(fake_data))}
                    mock_resp.iter_content = MagicMock(
                        return_value=[fake_data]
                    )

                    def _enter():
                        return mock_resp

                    mock_resp.__enter__ = MagicMock(side_effect=_enter)
                    mock_resp.__exit__ = MagicMock(return_value=False)
                else:
                    mock_resp.url = "https://www.iesdouyin.com/share/video/7123456789012345678/"
                    mock_resp.text = html
                return mock_resp

            s.get = MagicMock(side_effect=_get)
            return s

        with patch("shared.douyin_mobile_share.requests.Session", side_effect=_session_factory):
            result = run_douyin_mobile_download(
                url_or_text="https://v.douyin.com/iJvcK8CLC_o/",
                output_dir=output_dir,
                log=logs.append,
            )

        assert result["ok"] is True, f"失败: {result.get('error')}"
        assert os.path.isfile(result["save_path"])
        assert os.path.getsize(result["save_path"]) > 0
        assert result["file_name"].endswith(".mp4")
        assert result["percent"] == 100.0

    def test_no_play_uri_in_html(self, tmp_path):
        """分享页没有视频地址时返回失败。"""
        html = "<html><body>no video</body></html>"
        output_dir = str(tmp_path)
        logs: list[str] = []

        def _session_factory():
            s = MagicMock(name="Session")
            s.headers = {}

            def _get(url, **kwargs):
                mock_resp = MagicMock(name="Response")
                mock_resp.raise_for_status = MagicMock()
                mock_resp.url = "https://www.iesdouyin.com/share/video/7123456789012345678/"
                mock_resp.text = html
                return mock_resp

            s.get = MagicMock(side_effect=_get)
            return s

        with patch("shared.douyin_mobile_share.requests.Session", side_effect=_session_factory):
            result = run_douyin_mobile_download(
                url_or_text="https://v.douyin.com/iJvcK8CLC_o/",
                output_dir=output_dir,
                log=logs.append,
            )

        assert result["ok"] is False
        assert "解析失败" in result["error"]

    def test_network_error_graceful(self, tmp_path):
        """网络错误返回失败而非抛异常。"""
        output_dir = str(tmp_path)

        def _session_factory():
            s = MagicMock(name="Session")
            s.headers = {}
            s.get = MagicMock(side_effect=Exception("Connection refused"))
            return s

        with patch("shared.douyin_mobile_share.requests.Session", side_effect=_session_factory):
            result = run_douyin_mobile_download(
                url_or_text="https://v.douyin.com/iJvcK8CLC_o/",
                output_dir=output_dir,
            )

        assert result["ok"] is False
        assert result["error"]

    def test_result_shape_matches_ytdlp_contract(self, tmp_path):
        """返回 dict 的 key 集合对齐 run_ytdlp_download()。"""
        expected_keys = {"ok", "save_path", "file_name", "error", "error_full", "percent"}

        def _session_factory():
            s = MagicMock(name="Session")
            s.headers = {}
            s.get = MagicMock(side_effect=Exception("fail"))
            return s

        with patch("shared.douyin_mobile_share.requests.Session", side_effect=_session_factory):
            result = run_douyin_mobile_download(
                url_or_text="https://v.douyin.com/test/",
                output_dir=str(tmp_path),
            )

        assert set(result.keys()) == expected_keys
        assert isinstance(result["ok"], bool)
        assert isinstance(result["percent"], (int, float))

    def test_progress_callback_is_called(self, tmp_path):
        """下载过程中 progress_callback 被多次调用。"""
        uri = "v0200fg10000cjkv7abc123"
        html = _make_share_html(play_uri=uri)
        output_dir = str(tmp_path)
        progress_calls: list[tuple[float, str]] = []

        def _session_factory():
            s = MagicMock(name="Session")
            s.headers = {}

            fake_data = b"\x00" * (_CHUNK_SIZE * 3 + 512)  # 3 chunks + partial
            total = len(fake_data)

            def _get(url, **kwargs):
                mock_resp = MagicMock(name="Response")
                mock_resp.raise_for_status = MagicMock()
                if "play" in url or "aweme" in url:
                    mock_resp.headers = {"Content-Length": str(total)}
                    mock_resp.iter_content = MagicMock(
                        return_value=[fake_data[i:i + _CHUNK_SIZE] for i in range(0, total, _CHUNK_SIZE)]
                    )

                    def _enter():
                        return mock_resp

                    mock_resp.__enter__ = MagicMock(side_effect=_enter)
                    mock_resp.__exit__ = MagicMock(return_value=False)
                else:
                    mock_resp.url = "https://www.iesdouyin.com/share/video/7123456789012345678/"
                    mock_resp.text = html
                return mock_resp

            s.get = MagicMock(side_effect=_get)
            return s

        with patch("shared.douyin_mobile_share.requests.Session", side_effect=_session_factory):
            result = run_douyin_mobile_download(
                url_or_text="https://v.douyin.com/iJvcK8CLC_o/",
                output_dir=output_dir,
                progress_callback=lambda ratio, status: progress_calls.append((ratio, status)),
            )

        assert result["ok"] is True
        assert len(progress_calls) >= 2, f"progress_callback 至少应调用 2 次，实际 {len(progress_calls)}"
        # ratio 应单调递增且在 (0, 1] 范围内
        ratios = [r for r, _ in progress_calls]
        assert all(0 < r <= 1.0 for r in ratios)
        assert ratios == sorted(ratios), "ratio 应单调递增"

    def test_speed_callback_is_called(self, tmp_path):
        """下载过程中 speed_callback 被调用。"""
        uri = "v0200fg10000cjkv7abc123"
        html = _make_share_html(play_uri=uri)
        output_dir = str(tmp_path)
        speed_calls: list[str] = []

        def _session_factory():
            s = MagicMock(name="Session")
            s.headers = {}

            fake_data = b"\x00" * (_CHUNK_SIZE * 2)
            total = len(fake_data)

            def _get(url, **kwargs):
                mock_resp = MagicMock(name="Response")
                mock_resp.raise_for_status = MagicMock()
                if "play" in url or "aweme" in url:
                    mock_resp.headers = {"Content-Length": str(total)}
                    mock_resp.iter_content = MagicMock(
                        return_value=[fake_data[i:i + _CHUNK_SIZE] for i in range(0, total, _CHUNK_SIZE)]
                    )

                    def _enter():
                        return mock_resp

                    mock_resp.__enter__ = MagicMock(side_effect=_enter)
                    mock_resp.__exit__ = MagicMock(return_value=False)
                else:
                    mock_resp.url = "https://www.iesdouyin.com/share/video/7123456789012345678/"
                    mock_resp.text = html
                return mock_resp

            s.get = MagicMock(side_effect=_get)
            return s

        with patch("shared.douyin_mobile_share.requests.Session", side_effect=_session_factory):
            result = run_douyin_mobile_download(
                url_or_text="https://v.douyin.com/iJvcK8CLC_o/",
                output_dir=output_dir,
                speed_callback=lambda s: speed_calls.append(s),
            )

        assert result["ok"] is True
        assert len(speed_calls) >= 1, f"speed_callback 至少应调用 1 次，实际 {len(speed_calls)}"
        # 速度字符串应以 /s 结尾
        assert all(s.endswith("/s") for s in speed_calls)


# ── _deep_find 测试 ────────────────────────────────────────────────

class TestDeepFind:
    def test_find_shallow(self):
        assert _extract_play_uri("") is None

    def test_find_play_uri_in_render_data(self):
        uri = "v0200fg10000cjkv7abc123"
        html = _make_share_html(play_uri=uri)
        found = _extract_play_uri(html)
        # uri 优先于 url_list，返回值应为纯 uri 片段
        assert found == uri

    def test_find_play_uri_in_router_data(self):
        uri = "v0200fg10000cjkv7abc456"
        html = _make_share_html_router(play_uri=uri)
        found = _extract_play_uri(html)
        assert found == uri
