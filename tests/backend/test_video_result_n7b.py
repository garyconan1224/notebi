from __future__ import annotations

"""N7b 路径 1 — 视频字幕直接总结结果契约测试。

覆盖：
  summary_path='subtitle' 时 get_item_result 返回 transcript 数组、summary、tracks_meta 正确
  transcript 为空时返回稳定结构
  frames 为空数组
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import workspaces as ws_module
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """每个测试用独立 data 目录。"""
    fake_data = tmp_path / "workspaces"
    monkeypatch.setattr(ws_module, "_store", WorkspaceStore(root=fake_data))
    app = FastAPI()
    app.include_router(ws_module.router)
    with TestClient(app) as c:
        yield c


def _create_video_workspace(client: TestClient) -> tuple[str, str]:
    """辅助：创建一个含视频素材的 workspace，返回 (ws_id, item_id)。"""
    ws = client.post("/workspaces", json={"name": "video-test"}).json()
    ws_id = ws["workspace_id"]
    rec = client.post(
        f"/workspaces/{ws_id}/items",
        json={"source": "url", "source_value": "https://example.com/test.mp4", "name": "test.mp4", "type": "video"},
    ).json()
    item_id = rec["items"][-1]["item_id"]
    return ws_id, item_id


def test_video_result_subtitle_summary_contract(client: TestClient) -> None:
    """N7b 路径 1: summary_path='subtitle' 时 transcript 必须是数组。"""
    ws_id, item_id = _create_video_workspace(client)

    # 模拟路径 1 任务结果写入 item.results
    ws_module._store.update_item(
        ws_id, item_id,
        results={
            "summary_path": "subtitle",
            "transcript": [{"t_sec": 0, "t_str": "00:00", "text": "测试转写内容"}],
            "summary": "测试摘要",
            "video_template": "教程",
            "json_outputs": [],
            "json_output_basenames": [],
            "json_output_dir": "",
        },
        status="done",
    )

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/result")
    assert resp.status_code == 200
    body = resp.json()

    # 核心契约
    assert body["source"] == "item_results"
    assert isinstance(body["transcript"], list), "transcript 必须是数组"
    assert len(body["transcript"]) == 1
    assert body["transcript"][0]["t_sec"] == 0
    assert body["transcript"][0]["t_str"] == "00:00"
    assert body["transcript"][0]["text"] == "测试转写内容"

    # summary
    assert body["summary"] == "测试摘要"
    assert body["summary_path"] == "subtitle"
    assert body["video_template"] == "教程"

    # frames 可为空数组
    assert isinstance(body["frames"], list)

    # tracks_meta
    assert "tracks_meta" in body
    assert body["tracks_meta"]["transcript_count"] == 1  # 段数，不是字符数
    assert body["tracks_meta"]["frame_count"] == 0


def test_video_result_subtitle_empty_transcript(client: TestClient) -> None:
    """N7b 路径 1: transcript 为空但 summary 有值时返回稳定结构。"""
    ws_id, item_id = _create_video_workspace(client)

    ws_module._store.update_item(
        ws_id, item_id,
        results={
            "summary_path": "subtitle",
            "transcript": [],
            "summary": "（转写结果为空，可能视频无人声内容）",
            "summary_error": "ASR 引擎未就绪",
            "json_outputs": [],
        },
        status="done",
    )

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/result")
    assert resp.status_code == 200
    body = resp.json()

    assert isinstance(body["transcript"], list)
    assert len(body["transcript"]) == 0
    assert isinstance(body["frames"], list)
    assert body["tracks_meta"]["transcript_count"] == 0


def test_video_result_subtitle_string_transcript_normalized(client: TestClient) -> None:
    """N7b 路径 1: 旧数据 transcript 为 string 时应被规范化为数组。"""
    ws_id, item_id = _create_video_workspace(client)

    # 模拟旧数据：transcript 是 string
    ws_module._store.update_item(
        ws_id, item_id,
        results={
            "summary_path": "subtitle",
            "transcript": "旧格式转写文本",
            "summary": "旧格式摘要",
            "json_outputs": [],
        },
        status="done",
    )

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/result")
    assert resp.status_code == 200
    body = resp.json()

    # 应被规范化为数组
    assert isinstance(body["transcript"], list)
    assert len(body["transcript"]) == 1
    assert body["transcript"][0]["text"] == "旧格式转写文本"
    assert body["transcript"][0]["t_sec"] == 0


def test_video_result_subtitle_multi_segment_transcript(client: TestClient) -> None:
    """N7b 路径 1: 多段 transcript 应逐行返回，每行带时间戳。"""
    ws_id, item_id = _create_video_workspace(client)

    ws_module._store.update_item(
        ws_id, item_id,
        results={
            "summary_path": "subtitle",
            "transcript": [
                {"t_sec": 0.0, "t_str": "00:00", "text": "第一段转写"},
                {"t_sec": 5.2, "t_str": "00:05", "text": "第二段转写"},
                {"t_sec": 12.8, "t_str": "00:12", "text": "第三段转写"},
            ],
            "summary": "测试摘要",
            "json_outputs": [],
        },
        status="done",
    )

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/result")
    assert resp.status_code == 200
    body = resp.json()

    assert isinstance(body["transcript"], list)
    assert len(body["transcript"]) == 3
    assert body["transcript"][0]["t_sec"] == 0.0
    assert body["transcript"][0]["t_str"] == "00:00"
    assert body["transcript"][1]["t_sec"] == 5.2
    assert body["transcript"][1]["t_str"] == "00:05"
    assert body["transcript"][2]["t_sec"] == 12.8
    assert body["transcript"][2]["t_str"] == "00:12"
    assert body["tracks_meta"]["transcript_count"] == 3


def test_video_result_subtitle_transcript_without_summary_is_real_data(client: TestClient) -> None:
    """N7b 路径 1: 无 API key 时只有清洗后 transcript，也应返回 item_results。"""
    ws_id, item_id = _create_video_workspace(client)

    ws_module._store.update_item(
        ws_id, item_id,
        results={
            "summary_path": "subtitle",
            "transcript": [{"t_sec": 0, "t_str": "00:00", "text": "清洗后转写"}],
            "summary": "",
            "json_outputs": [],
        },
        status="done",
    )

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/result")
    assert resp.status_code == 200
    body = resp.json()

    assert body["source"] == "item_results"
    assert body["summary_path"] == "subtitle"
    assert body["transcript"][0]["text"] == "清洗后转写"


def test_video_result_subtitle_duration_propagated(client: TestClient) -> None:
    """N7b 路径 1: duration_sec 从 task result 透传到 video.duration_sec 和 tracks_meta.total_sec。"""
    ws_id, item_id = _create_video_workspace(client)

    ws_module._store.update_item(
        ws_id, item_id,
        results={
            "summary_path": "subtitle",
            "transcript": [
                {"t_sec": 0.0, "t_str": "00:00", "text": "开头"},
                {"t_sec": 30.5, "t_str": "00:30", "text": "中间"},
                {"t_sec": 58.0, "t_str": "00:58", "text": "结尾"},
            ],
            "summary": "测试摘要",
            "duration_sec": 62.5,
            "json_outputs": [],
        },
        status="done",
    )

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/result")
    assert resp.status_code == 200
    body = resp.json()

    assert body["video"]["duration_sec"] == 62.5
    assert body["tracks_meta"]["total_sec"] == 62.5


def test_video_result_subtitle_no_duration_fallback(client: TestClient) -> None:
    """N7b 路径 1: 旧数据无 duration_sec 时 video.duration_sec 和 tracks_meta.total_sec 均为 0。"""
    ws_id, item_id = _create_video_workspace(client)

    ws_module._store.update_item(
        ws_id, item_id,
        results={
            "summary_path": "subtitle",
            "transcript": [{"t_sec": 0, "t_str": "00:00", "text": "旧数据"}],
            "summary": "旧摘要",
            "json_outputs": [],
        },
        status="done",
    )

    resp = client.get(f"/workspaces/{ws_id}/items/{item_id}/result")
    assert resp.status_code == 200
    body = resp.json()

    assert body["video"]["duration_sec"] == 0
    assert body["tracks_meta"]["total_sec"] == 0
