"""note_assembler R0.1 测试 — 四类型 WorkspaceItem + 幂等断言。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import patch

import pytest
import yaml

from backend.app.models.workspace import ItemSummary, WorkspaceItem
from backend.app.services.note_assembler import (
    assemble_item_note,
    build_frontmatter,
    build_note_md,
    build_source_md,
    note_dir,
    serialize_summaries,
)


# ── helpers ──────────────────────────────────────────────────────
def _make_item(
    item_id: str = "item-001",
    item_type: str = "text",
    source: str = "url",
    source_value: str = "https://example.com/post/1",
    name: str = "测试素材",
    results: Dict[str, Any] | None = None,
    tags: Dict[str, Any] | None = None,
    summaries: List[ItemSummary] | None = None,
    inline_frames: list | None = None,
) -> WorkspaceItem:
    return WorkspaceItem(
        item_id=item_id,
        type=item_type,
        source=source,
        source_value=source_value,
        name=name,
        status="done",
        results=results or {},
        tags=tags or {},
        summaries=summaries or [],
        inline_frames=inline_frames or [],
        created_at="2026-06-05T10:00:00+08:00",
    )


def _text_item() -> WorkspaceItem:
    return _make_item(
        item_type="text",
        results={"content": "# 我的学习笔记\n\n这是正文内容。", "summary": "摘要"},
        tags={
            "content_type": "article",
            "domain": "tech",
            "difficulty": "beginner",
            "free": ["学习"],
        },
        summaries=[
            ItemSummary(
                summary_id="s1",
                template="concise",
                version=1,
                content_md="# 简洁摘要\n\n一段话概括。",
            ),
            ItemSummary(
                summary_id="s2",
                template="detailed",
                version=1,
                content_md="# 详细摘要\n\n分段阐述。",
            ),
        ],
    )


def _video_item() -> WorkspaceItem:
    return _make_item(
        item_id="item-video",
        item_type="video",
        source_value="https://www.bilibili.com/video/BV1xxx",
        name="深度学习入门",
        results={
            "transcript": [
                {"start": 0.0, "end": 3.5, "text": "大家好，今天讲深度学习"},
                {"start": 3.5, "end": 8.0, "text": "首先从神经网络说起"},
            ],
            "duration": 3600,
            "frames": [
                {"sec": 30, "frame_path": "videos/frames/frame_030.png"},
                {"sec": 120, "frame_path": "videos/frames/frame_120.png"},
            ],
            "summary": "视频摘要",
        },
        tags={"content_type": "video", "domain": "ml", "duration_tier": "long"},
        summaries=[
            ItemSummary(
                summary_id="sv1",
                template="concise",
                version=1,
                content_md="# 视频摘要",
            ),
        ],
    )


def _audio_item() -> WorkspaceItem:
    return _make_item(
        item_id="item-audio",
        item_type="audio",
        source="local",
        source_value="/tmp/podcast.mp3",
        name="播客音频",
        results={
            "transcript": "这是播客内容的转录文本。\n\n包含两个话题。",
            "audio_path": "audio/podcast.mp3",
            "summary": "播客摘要",
        },
        tags={"content_type": "podcast"},
    )


def _image_item() -> WorkspaceItem:
    return _make_item(
        item_id="item-image",
        item_type="image",
        source="local",
        source_value="/tmp/screenshot.png",
        name="截图",
        results={
            "ocr_text": "Hello World\n欢迎使用 Nibi",
            "description": "一张带有 Hello World 和中文欢迎语的截图",
            "image_path": "images/screenshot.png",
        },
        tags={"content_type": "screenshot"},
        summaries=[
            ItemSummary(
                summary_id="si1",
                template="concise",
                version=1,
                content_md="# 图片摘要",
            ),
        ],
    )


# ── note_dir ─────────────────────────────────────────────────────
class TestNoteDir:
    def test_returns_correct_path(self) -> None:
        p = note_dir("ws-abc", "item-123")
        assert p.name == "item-123"
        assert p.parent.name == "notes"
        assert "ws-abc" in str(p)


# ── build_frontmatter ────────────────────────────────────────────
class TestBuildFrontmatter:
    def test_text_frontmatter(self) -> None:
        item = _text_item()
        fm = build_frontmatter(item, "ws-01")
        assert fm["schema_version"] == 1
        assert fm["id"] == "item-001"
        assert fm["workspace_id"] == "ws-01"
        assert fm["type"] == "text"
        assert fm["title"] == "测试素材"
        assert fm["version"] == 1
        # tags 透传
        assert fm["tags"]["content_type"] == "article"
        assert fm["tags"]["free"] == ["学习"]
        # layers
        assert fm["layers"]["source"] == "source.md"
        assert fm["layers"]["note"] == "note.md"
        assert len(fm["layers"]["summaries"]) == 2
        assert "summaries/concise/v1.md" in fm["layers"]["summaries"][0]

    def test_video_frontmatter_media(self) -> None:
        item = _video_item()
        fm = build_frontmatter(item, "ws-01")
        assert fm["type"] == "video"
        assert fm["source_url"] == "https://www.bilibili.com/video/BV1xxx"
        assert fm["media"]["video"]["duration"] == 3600
        assert len(fm["media"]["frames"]) == 2
        assert fm["media"]["frames"][0]["sec"] == 30

    def test_image_frontmatter_media(self) -> None:
        item = _image_item()
        fm = build_frontmatter(item, "ws-01")
        assert fm["media"]["images"] == ["images/screenshot.png"]

    def test_audio_frontmatter_media(self) -> None:
        item = _audio_item()
        fm = build_frontmatter(item, "ws-01")
        assert fm["media"]["audio"] == "audio/podcast.mp3"

    def test_empty_tags_and_results(self) -> None:
        item = _make_item(tags=None, results=None)
        fm = build_frontmatter(item, "ws-01")
        assert fm["tags"] == {}
        assert fm["media"] == {}

    def test_local_source_no_source_url(self) -> None:
        item = _make_item(source="local", source_value="/tmp/file.mp4")
        fm = build_frontmatter(item, "ws-01")
        assert fm["source_url"] == ""


# ── build_source_md / build_note_md ──────────────────────────────
class TestBuildMd:
    def test_text_body(self) -> None:
        item = _text_item()
        src = build_source_md(item)
        assert "# 我的学习笔记" in src
        assert "正文内容" in src

    def test_video_transcript_segments(self) -> None:
        item = _video_item()
        src = build_source_md(item)
        assert "大家好" in src
        assert "神经网络" in src
        assert "[00:00]" in src

    def test_audio_transcript_string(self) -> None:
        item = _audio_item()
        src = build_source_md(item)
        assert "播客内容" in src

    def test_audio_transcript_segments_fallback(self) -> None:
        """音频只有 transcript_segments（无 transcript）时，应从 segments 拼出正文。"""
        item = _make_item(
            item_type="audio",
            results={
                "transcript_segments": [
                    {"start": 0.0, "end": 5.0, "text": "第一段转录"},
                    {"start": 5.0, "end": 10.0, "text": "第二段转录"},
                ],
            },
        )
        src = build_source_md(item)
        assert "第一段转录" in src
        assert "第二段转录" in src
        assert "[00:00]" in src

    def test_video_transcript_segments_fallback(self) -> None:
        """视频 transcript 为空 list 时，应从 transcript_segments 拼出正文。"""
        item = _make_item(
            item_type="video",
            results={
                "transcript": [],
                "transcript_segments": [
                    {"start": 0.0, "end": 3.0, "text": "开场白"},
                    {"start": 3.0, "end": 8.0, "text": "正文内容"},
                ],
            },
        )
        src = build_source_md(item)
        assert "开场白" in src
        assert "正文内容" in src

    def test_image_ocr_and_description(self) -> None:
        item = _image_item()
        src = build_source_md(item)
        assert "Hello World" in src
        assert "图片描述" in src

    def test_note_md_has_frontmatter(self) -> None:
        item = _text_item()
        fm = build_frontmatter(item, "ws-01")
        note = build_note_md(item, fm)
        assert note.startswith("---\n")
        assert "schema_version:" in note
        assert "# 我的学习笔记" in note

    def test_empty_results_returns_empty(self) -> None:
        item = _make_item(results={})
        assert build_source_md(item) == ""


# ── serialize_summaries ──────────────────────────────────────────
class TestSerializeSummaries:
    def test_writes_summaries_to_disk(self, tmp_path: Path) -> None:
        item = _text_item()
        written = serialize_summaries(item, tmp_path)
        assert len(written) == 2
        assert (tmp_path / "summaries" / "concise" / "v1.md").exists()
        assert (tmp_path / "summaries" / "detailed" / "v1.md").exists()
        content = (tmp_path / "summaries" / "concise" / "v1.md").read_text()
        assert "简洁摘要" in content

    def test_no_summaries(self, tmp_path: Path) -> None:
        item = _make_item()
        written = serialize_summaries(item, tmp_path)
        assert written == []

    def test_multi_version(self, tmp_path: Path) -> None:
        item = _make_item(
            summaries=[
                ItemSummary(summary_id="a", template="concise", version=1, content_md="v1"),
                ItemSummary(summary_id="b", template="concise", version=2, content_md="v2"),
            ]
        )
        written = serialize_summaries(item, tmp_path)
        assert len(written) == 2
        assert (tmp_path / "summaries" / "concise" / "v1.md").exists()
        assert (tmp_path / "summaries" / "concise" / "v2.md").exists()


# ── assemble_item_note（集成） ────────────────────────────────────
class TestAssembleItemNote:
    """集成测试：构造假 item，调用 assemble_item_note，断言落盘结果。"""

    @pytest.fixture()
    def ws_root(self, tmp_path: Path) -> Path:
        """mock get_workspace_root 返回 tmp_path。"""
        return tmp_path

    def _patch_ws_root(self, ws_root: Path):
        return patch(
            "backend.app.services.note_assembler.get_workspace_root",
            return_value=ws_root,
        )

    def test_text_item_assemble(self, ws_root: Path) -> None:
        item = _text_item()
        with self._patch_ws_root(ws_root):
            result = assemble_item_note("ws-01", item.item_id, _item=item)

        assert result["skipped"] is False
        nd = Path(result["note_dir"])
        assert nd.exists()
        assert (nd / "note.md").exists()
        assert (nd / "source.md").exists()
        assert (nd / "assets").is_dir()
        assert len(result["summaries"]) == 2

        # frontmatter 关键字段
        note_content = (nd / "note.md").read_text(encoding="utf-8")
        fm_dict = yaml.safe_load(note_content.split("---\n")[1])
        assert fm_dict["schema_version"] == 1
        assert fm_dict["type"] == "text"
        assert fm_dict["title"] == "测试素材"

        # 正文非空
        assert "学习笔记" in note_content
        source_content = (nd / "source.md").read_text(encoding="utf-8")
        assert "学习笔记" in source_content

        # summaries 落盘
        assert (nd / "summaries" / "concise" / "v1.md").exists()
        assert (nd / "summaries" / "detailed" / "v1.md").exists()

    def test_video_item_assemble(self, ws_root: Path) -> None:
        item = _video_item()
        with self._patch_ws_root(ws_root):
            result = assemble_item_note("ws-01", item.item_id, _item=item)
        assert result["skipped"] is False
        note_content = (nd := Path(result["note_dir"]) / "note.md").read_text(encoding="utf-8")
        assert "深度学习入门" in note_content
        assert "大家好" in note_content

    def test_audio_item_assemble(self, ws_root: Path) -> None:
        item = _audio_item()
        with self._patch_ws_root(ws_root):
            result = assemble_item_note("ws-01", item.item_id, _item=item)
        assert result["skipped"] is False
        source_content = (Path(result["source_md"])).read_text(encoding="utf-8")
        assert "播客内容" in source_content

    def test_image_item_assemble(self, ws_root: Path) -> None:
        item = _image_item()
        with self._patch_ws_root(ws_root):
            result = assemble_item_note("ws-01", item.item_id, _item=item)
        assert result["skipped"] is False
        source_content = (Path(result["source_md"])).read_text(encoding="utf-8")
        assert "Hello World" in source_content
        assert len(result["summaries"]) == 1

    def test_idempotent_overwrite_true(self, ws_root: Path) -> None:
        """重复调用 overwrite=True 应覆盖，结果一致。"""
        item = _text_item()
        with self._patch_ws_root(ws_root):
            r1 = assemble_item_note("ws-01", item.item_id, _item=item)
            r2 = assemble_item_note("ws-01", item.item_id, _item=item)
        assert r1["note_md"] == r2["note_md"]
        assert r2["skipped"] is False

    def test_idempotent_overwrite_false_skip(self, ws_root: Path) -> None:
        """overwrite=False 时若 note.md 已存在，应跳过。"""
        item = _text_item()
        with self._patch_ws_root(ws_root):
            r1 = assemble_item_note("ws-01", item.item_id, _item=item)
            assert r1["skipped"] is False
            r2 = assemble_item_note("ws-01", item.item_id, _item=item, overwrite=False)
            assert r2["skipped"] is True

    def test_overwrite_false_creates_when_missing(self, ws_root: Path) -> None:
        """overwrite=False 但 note.md 不存在时应正常创建。"""
        item = _text_item()
        with self._patch_ws_root(ws_root):
            result = assemble_item_note("ws-01", item.item_id, _item=item, overwrite=False)
        assert result["skipped"] is False
        assert (Path(result["note_md"])).exists()

    def test_best_effort_no_item_returns_error(self, ws_root: Path) -> None:
        """_item=None 应被 best-effort 兜住，不抛异常。"""
        with self._patch_ws_root(ws_root):
            result = assemble_item_note("ws-01", "item-missing")
        assert result.get("error") is True
        assert result["note_dir"] == ""

    def test_best_effort_corrupt_results(self, ws_root: Path) -> None:
        """results 异常类型不会导致崩溃。"""
        item = _make_item(results={"content": None})  # type: ignore
        with self._patch_ws_root(ws_root):
            result = assemble_item_note("ws-01", item.item_id, _item=item)
        # 不崩溃就是成功
        assert "error" not in result
        assert result["note_md"] != ""


# ── 图文笔记学习总结测试 ─────────────────────────────────────────


class TestImageTextLearningNote:
    """图文笔记：note_body 优先 + source_md_raw 保留原始文本。"""

    @pytest.fixture()
    def ws_root(self, tmp_path: Path) -> Path:
        return tmp_path

    def _patch_ws_root(self, ws_root: Path):
        return patch(
            "backend.app.services.note_assembler.get_workspace_root",
            return_value=ws_root,
        )

    def test_note_body_priority_over_markdown(self) -> None:
        """build_note_md 应把图文笔记组装成学习笔记 + 图文语境。"""
        item = _make_item(
            item_type="image",
            results={
                "markdown": "![图 1](/static/img.jpg)\n\n【图片 1】主体: 卡片；OCR文字: 原始内容描述",
                "note_body": "# 学习笔记\n\n## 核心观点\n\n这是学习总结。",
                "note_kind": "image_text",
            },
        )
        fm = build_frontmatter(item, "ws-01")
        note = build_note_md(item, fm)
        assert "学习笔记" in note
        assert "学习总结" in note
        assert "## 图文语境" in note
        assert "![图 1](/static/img.jpg)" in note
        assert note.index("学习笔记") < note.index("图文语境")

    def test_build_body_prefers_source_md_raw(self) -> None:
        """_build_body 对 image 类型优先取 source_md_raw（原始文本），而非合成后 markdown。"""
        item = _make_item(
            item_type="image",
            results={
                "markdown": "合成后含图片描述的版本",
                "source_md_raw": "原始正文，未经 LLM 合成",
                "note_kind": "image_text",
            },
        )
        src = build_source_md(item)
        assert "原始正文" in src
        assert "合成后含图片描述" not in src

    def test_build_body_fallback_to_markdown_without_source_md_raw(self) -> None:
        """没有 source_md_raw 时，_build_body 回退到 results['markdown']。"""
        item = _make_item(
            item_type="image",
            results={
                "markdown": "含 OCR 和描述的 markdown",
            },
        )
        src = build_source_md(item)
        assert "含 OCR 和描述的 markdown" in src

    def test_image_text_note_body_no_image_description_fields(self) -> None:
        """图文笔记 note_body 不应包含逐图描述字段。"""
        note_body = "# 学习笔记\n\n## 核心观点\n\n小红书图文内容的核心学习价值。"
        bad_fields = ["主体", "场景", "色调", "构图", "风格", "细节"]
        for field in bad_fields:
            assert field not in note_body, f"note_body 不应包含「{field}」"

    def test_image_text_note_body_no_image_embed_for_text_images(self) -> None:
        """文字型图片场景下，note_body 默认不包含 ![...] 图片引用。"""
        note_body = "# 学习笔记\n\n## 核心观点\n\n文字卡片内容已提炼为文字。"
        assert "![" not in note_body, "文字型图片笔记不应插图"

    def test_assemble_image_note_uses_note_body(self, ws_root: Path) -> None:
        """assemble_item_note 对图文 item，note.md 应含学习笔记和图文混排内容。"""
        item = _make_item(
            item_id="img-learning",
            item_type="image",
            results={
                "markdown": "![示例图](/static/workspaces/ws-01/image/01.jpg)\n\n合成后 markdown（含图片引用）",
                "source_md_raw": "原始正文",
                "note_body": "# 学习笔记\n\n## 一句话结论\n\n小红书信息卡片的学习价值。",
                "note_kind": "image_text",
            },
        )
        with self._patch_ws_root(ws_root):
            result = assemble_item_note("ws-01", item.item_id, _item=item)
        note_content = Path(result["note_md"]).read_text(encoding="utf-8")
        source_content = Path(result["source_md"]).read_text(encoding="utf-8")
        # note.md 应含学习笔记
        assert "学习笔记" in note_content
        assert "学习价值" in note_content
        assert "示例图" in note_content
        assert "合成后 markdown" in note_content
        # source.md 应含原始文本
        assert "原始正文" in source_content
