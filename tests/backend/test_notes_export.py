"""R20 — 综合笔记多格式导出端点测试。

覆盖：
  POST happy path PDF / DOCX / Obsidian 返回正确 Content-Type
  POST 400 不支持的格式
  POST 404 workspace 不存在
  POST 404 综合笔记尚未生成
  md_parser 解析正确性
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routes import export as export_module
from backend.app.routes import workspaces as ws_module
from backend.app.services.av_synthesis.md_parser import parse_av_synthesis_md
from backend.app.services.workspace_store import WorkspaceStore


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """每个测试用独立 data 目录。"""
    fake_data = tmp_path / "workspaces"
    store = WorkspaceStore(root=fake_data)
    monkeypatch.setattr(ws_module, "_store", store)
    monkeypatch.setattr(export_module, "_store", store)
    app = FastAPI()
    app.include_router(ws_module.router)
    app.include_router(export_module.router)
    with TestClient(app) as c:
        yield c


SAMPLE_MD = """\
# 测试视频标题
> B站 · 测试作者 · 12:34 · 2026-05-29

![封面](cover.jpg)

## 全局摘要
这是一段测试摘要，用于验证解析器。

## 关键帧画廊
| 时刻 | 画面 | 场景描述 |
|---|---|---|
| 00:12 | ![](frames/001.jpg) | 开场画面 |
| 01:30 | ![](frames/002.jpg) | 核心讲解 |

## 章节正文
### 1. 引言（00:00~01:30）
![](frames/001.jpg)
> 这是第一段转写内容

**重点**：这是第一个要点

### 2. 核心内容（01:30~05:00）
![](frames/002.jpg)
> 这是第二段转写内容

**重点**：这是第二个要点

## 字幕原文
<details>
<summary>展开查看完整转写（含时间戳）</summary>

[00:00] 大家好
[00:12] 欢迎来到测试

</details>

## 最终综合
这是最终综合分析的内容。
"""


def test_parse_md_title():
    notes = parse_av_synthesis_md(SAMPLE_MD)
    assert notes.title == "测试视频标题"


def test_parse_md_meta():
    notes = parse_av_synthesis_md(SAMPLE_MD)
    assert notes.platform == "B站"
    assert notes.author == "测试作者"
    assert notes.duration_display == "12:34"
    assert notes.date_added == "2026-05-29"


def test_parse_md_summary():
    notes = parse_av_synthesis_md(SAMPLE_MD)
    assert "测试摘要" in notes.summary


def test_parse_md_gallery():
    notes = parse_av_synthesis_md(SAMPLE_MD)
    assert len(notes.gallery_rows) == 2
    assert notes.gallery_rows[0].timestamp_display == "00:12"
    assert notes.gallery_rows[0].image_path == "frames/001.jpg"
    assert notes.gallery_rows[0].scene_description == "开场画面"


def test_parse_md_chapters():
    notes = parse_av_synthesis_md(SAMPLE_MD)
    assert len(notes.chapters) == 2
    assert notes.chapters[0].title == "引言"
    assert notes.chapters[0].time_range == "00:00~01:30"
    assert notes.chapters[0].frame_path == "frames/001.jpg"
    assert "第一段转写" in notes.chapters[0].transcript_excerpt
    assert notes.chapters[0].highlights == "这是第一个要点"


def test_parse_md_transcript():
    notes = parse_av_synthesis_md(SAMPLE_MD)
    assert "大家好" in notes.full_transcript
    assert "欢迎来到测试" in notes.full_transcript


def test_parse_md_final_synthesis():
    notes = parse_av_synthesis_md(SAMPLE_MD)
    assert "最终综合分析" in notes.final_synthesis


def _create_workspace(client: TestClient) -> str:
    """创建 workspace 并写入 av_synthesis.md，返回 ws_id。"""
    ws = client.post("/workspaces", json={"name": "notes-export-test"}).json()
    ws_id = ws["workspace_id"]
    # 写入 av_synthesis.md 到 workspace 目录
    ws_root = Path(client.app.router._store.root if hasattr(client.app.router, "_store") else "")
    # 通过 store 获取实际路径
    from backend.app.routes.export import _store
    rec = _store.get(ws_id)
    from shared.config import get_workspace_root
    ws_dir = get_workspace_root(ws_id)
    ws_dir.mkdir(parents=True, exist_ok=True)
    (ws_dir / "av_synthesis.md").write_text(SAMPLE_MD, encoding="utf-8")
    return ws_id


def test_export_notes_pdf_content_type(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """PDF 导出返回 application/pdf。"""
    ws_id = _create_workspace(client)

    # Mock playwright to avoid needing chromium
    from unittest.mock import MagicMock, patch

    mock_page = MagicMock()
    mock_page.pdf.return_value = b"%PDF-1.4 fake"
    mock_browser = MagicMock()
    mock_browser.new_page.return_value = mock_page
    mock_pw = MagicMock()
    mock_pw.chromium.launch.return_value = mock_browser

    with patch("playwright.sync_api.sync_playwright") as mock_sync:
        mock_sync.return_value.__enter__ = MagicMock(return_value=mock_pw)
        mock_sync.return_value.__exit__ = MagicMock(return_value=False)
        resp = client.post(
            f"/workspaces/{ws_id}/notes/export",
            json={"format": "pdf"},
        )

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"


def test_export_notes_docx_content_type(client: TestClient):
    """DOCX 导出返回正确 MIME type。"""
    ws_id = _create_workspace(client)
    resp = client.post(
        f"/workspaces/{ws_id}/notes/export",
        json={"format": "docx"},
    )
    assert resp.status_code == 200
    assert "officedocument.wordprocessingml.document" in resp.headers["content-type"]


def test_export_notes_obsidian_content_type(client: TestClient):
    """Obsidian 导出返回 application/zip。"""
    ws_id = _create_workspace(client)
    resp = client.post(
        f"/workspaces/{ws_id}/notes/export",
        json={"format": "obsidian"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"


def test_export_notes_invalid_format(client: TestClient):
    """不支持的格式返回 400。"""
    ws_id = _create_workspace(client)
    resp = client.post(
        f"/workspaces/{ws_id}/notes/export",
        json={"format": "html"},
    )
    assert resp.status_code == 400


def test_export_notes_workspace_not_found(client: TestClient):
    """workspace 不存在返回 404。"""
    resp = client.post(
        "/workspaces/nonexistent/notes/export",
        json={"format": "pdf"},
    )
    assert resp.status_code == 404


def test_export_notes_no_synthesis(client: TestClient):
    """综合笔记尚未生成返回 404。"""
    ws = client.post("/workspaces", json={"name": "no-synth"}).json()
    ws_id = ws["workspace_id"]
    resp = client.post(
        f"/workspaces/{ws_id}/notes/export",
        json={"format": "pdf"},
    )
    assert resp.status_code == 404
