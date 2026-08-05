"""summary_generator 后处理单测：证据区清理 / 章节对齐采样 / 用户截图收集"""

from __future__ import annotations

from backend.app.models.workspace import WorkspaceItem
from backend.app.services.summary_generator import (
    _chapter_aligned_sample_frames,
    _collect_user_screenshots,
    _remove_standalone_evidence_sections,
)


def _frame(sec: float, desc: str = "画面") -> dict:
    return {"idx": int(sec), "sec": sec, "desc": desc, "image_path": f"/static/f{int(sec)}.jpg"}


def test_remove_standalone_evidence_section_keeps_inline_images():
    md = (
        "## 正文\n\n文字 ![inline](/static/a.jpg)\n\n"
        "## 章节画面证据\n\n![e1](/static/e1.jpg)\n\n![e2](/static/e2.jpg)\n\n"
        "## 下一节\n\n正文2"
    )
    cleaned = _remove_standalone_evidence_sections(md)
    assert "章节画面证据" not in cleaned
    assert "/static/e1.jpg" not in cleaned
    assert "/static/e2.jpg" not in cleaned
    assert "![inline](/static/a.jpg)" in cleaned
    assert "## 下一节" in cleaned
    assert "正文2" in cleaned


def test_remove_standalone_evidence_section_noop_without_heading():
    md = "## 正文\n\n文字 ![x](/static/a.jpg)"
    assert _remove_standalone_evidence_sections(md) == md


def test_chapter_aligned_sample_picks_nearest_frame_per_chapter():
    frames = [_frame(0), _frame(10), _frame(20), _frame(40), _frame(70)]
    chapters = [
        {"start": 5, "end": 25, "title": "A"},
        {"start": 35, "end": 60, "title": "B"},
    ]
    picked = _chapter_aligned_sample_frames(frames, chapters, 8)
    assert [fr["sec"] for fr in picked] == [10, 40]


def test_chapter_aligned_sample_falls_back_to_even():
    frames = [_frame(i * 5) for i in range(20)]
    picked = _chapter_aligned_sample_frames(frames, [], 8)
    assert len(picked) == 8


def test_collect_user_screenshots(tmp_path, monkeypatch):
    shots_dir = tmp_path / "ln-screenshots"
    shots_dir.mkdir()
    (shots_dir / "shot-000090-001500.png").write_bytes(b"x")

    import shared.config

    monkeypatch.setattr(shared.config, "get_workspace_root", lambda _ws: tmp_path)

    item = WorkspaceItem(
        item_id="i-1",
        type="video",
        source="url",
        source_value="https://example.com/v",
        results={"workspace_id": "ws-1"},
    )
    out: list[dict] = []
    _collect_user_screenshots(item, out)
    assert len(out) == 1
    assert out[0]["sec"] == 90
    assert out[0]["image_path"].startswith("/static/workspaces/ws-1/ln-screenshots/")
    assert "用户截图" in out[0]["desc"]


def test_collect_user_screenshots_skips_without_workspace_id():
    item = WorkspaceItem(
        item_id="i-1",
        type="video",
        source="url",
        source_value="https://example.com/v",
        results={},
    )
    out: list[dict] = []
    _collect_user_screenshots(item, out)
    assert out == []
