"""summary_generator + workspace_store summary helpers 测试。"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from backend.app.models.workspace import ItemSummary, WorkspaceItem, WorkspaceRecord
from backend.app.services.summary_generator import build_prompt, generate_summary
from backend.app.services.workspace_store import WorkspaceStore


# ── 辅助 ────────────────────────────────────────────────────────


def _make_item(**overrides: object) -> WorkspaceItem:
    base = dict(
        item_id="item-1",
        type="video",
        source="local",
        source_value="/tmp/test.mp4",
        name="测试视频",
        status="done",
        results={"transcript": "这是转写文本内容。"},
    )
    base.update(overrides)
    return WorkspaceItem.from_dict(base)


def _make_store_with_item(item: WorkspaceItem | None = None) -> WorkspaceStore:
    """创建临时 WorkspaceStore 并写入一个 workspace + item。"""
    import tempfile, pathlib
    tmp = tempfile.mkdtemp()
    store = WorkspaceStore(root=pathlib.Path(tmp))
    rec = WorkspaceRecord(workspace_id="ws-1", name="测试工作空间")
    rec.items.append(item or _make_item())
    store.create(rec)
    return store


# ── build_prompt ────────────────────────────────────────────────


class TestBuildPrompt:
    def test_basic_prompt(self) -> None:
        item = _make_item()
        sys_p, usr_p = build_prompt(item, "concise")
        assert "简洁" in sys_p or "摘要" in sys_p
        assert "这是转写文本内容" in usr_p

    def test_background_prepended(self) -> None:
        item = _make_item()
        _, usr_p = build_prompt(item, "concise", background="这是背景信息")
        assert usr_p.startswith("【背景信息】")
        assert "这是背景信息" in usr_p
        assert "这是转写文本内容" in usr_p

    def test_empty_background_not_prepended(self) -> None:
        item = _make_item()
        _, usr_p = build_prompt(item, "concise", background="")
        assert not usr_p.startswith("【背景信息】")

    def test_fallback_to_summary_when_no_transcript(self) -> None:
        item = _make_item(results={"summary": "老总结内容"})
        _, usr_p = build_prompt(item, "concise")
        assert "老总结内容" in usr_p

    def test_all_template_ids(self) -> None:
        """9 个模板 id 都能构造 prompt 不报错。"""
        from backend.app.services.summary_templates import list_template_ids
        item = _make_item()
        for tid in list_template_ids():
            sys_p, usr_p = build_prompt(item, tid)
            assert sys_p  # 非空
            assert usr_p  # 非空

    def test_standard_embeds_segment_timestamps(self) -> None:
        """standard：分段 [mm:ss] 拼进 user_prompt，供 LLM 标注章节锚点。"""
        item = _make_item(results={"transcript": [
            {"t_sec": 0, "t_str": "00:00", "text": "开场介绍"},
            {"t_sec": 42, "t_str": "00:42", "text": "外观对比"},
        ]})
        _, usr_p = build_prompt(item, "standard", embed_frames=False)
        assert "[00:00] 开场介绍" in usr_p
        assert "[00:42] 外观对比" in usr_p

    def test_standard_char_count_excludes_timestamps(self) -> None:
        """standard：内容画像字数基于纯文本，不被时间戳字符污染。"""
        item = _make_item(results={"transcript": [
            {"t_sec": 42, "t_str": "00:42", "text": "外观对比四代机型"},
        ]})
        _, usr_p = build_prompt(item, "standard", embed_frames=False)
        assert "约 8 字" in usr_p  # "外观对比四代机型"=8 字，不含 [00:42]

    def test_non_standard_keeps_plain_transcript(self) -> None:
        """非 standard 模板维持纯文本拼接，不带时间戳。"""
        item = _make_item(results={"transcript": [
            {"t_sec": 42, "t_str": "00:42", "text": "外观对比"},
        ]})
        _, usr_p = build_prompt(item, "concise")
        assert "[00:42]" not in usr_p
        assert "外观对比" in usr_p

    def test_image_text_standard_uses_image_note_prompt(self) -> None:
        """图文 standard 总结应使用 source.md 材料，不走视频时间轴模板。"""
        item = _make_item(
            type="image",
            source_value="https://www.xiaohongshu.com/explore/test",
            name="手机捕捉和 Obsidian 整理",
            results={
                "note_kind": "image_text",
                "source_md_raw": "手机负责快速捕捉，Obsidian 负责长期整理。",
                "markdown": "![工作流图](/static/workflow.jpg)\n\n图片展示了移动端到桌面端的流程。",
                "image_infos": [
                    {
                        "idx": 1,
                        "description": "一张展示手机记录、桌面整理的工作流图",
                        "static_url": "/static/workflow.jpg",
                    }
                ],
            },
        )

        sys_p, usr_p = build_prompt(item, "standard", embed_frames=True)

        assert "图文笔记整理专家" in sys_p
        assert "手机负责快速捕捉" in usr_p
        # source.md 材料是唯一依据，不再单独注入 markdown 和 image_infos
        assert "source.md" in usr_p
        assert "章节时间戳锚点" not in sys_p + usr_p
        assert "视频时长" not in usr_p
        assert "[00:42]" not in usr_p

    def test_image_text_non_standard_uses_image_material(self) -> None:
        """图文非 standard 模板也应有真实图文内容兜底，而非空转写。"""
        item = _make_item(
            type="image",
            results={
                "note_kind": "image_text",
                "source_md_raw": "原文观点",
                "markdown": "图文混排内容",
            },
        )

        _, usr_p = build_prompt(item, "concise")

        assert "原文观点" in usr_p
        assert "图文混排内容" in usr_p

    def test_tool_recommendation_uses_text_image_material_without_images(self) -> None:
        """工具推荐模板：基于 source.md，不要求插图或时间点。"""
        item = _make_item(
            type="image",
            name="工具推荐",
            results={
                "note_kind": "image_text",
                "source_md_raw": "推荐一个 Markdown 移动端记录工具，适合做 Obsidian 输入层。",
                "markdown": "![工具截图](/static/tool.jpg)\n\n图片文字介绍：支持文字、图片、录音和语音转写。",
                "image_infos": [
                    {
                        "idx": 1,
                        "description": "一张工具功能介绍卡片，列出快速记录、图片、录音、语音转写等能力",
                        "ocr_text": "SiloNote：文字、图片、录音、语音转写，导出 Markdown",
                        "static_url": "/static/tool.jpg",
                    }
                ],
            },
        )

        sys_p, usr_p = build_prompt(item, "tool_recommendation")

        assert "工具推荐笔记整理专家" in sys_p
        assert "不要插入图片 Markdown" in sys_p
        assert "Markdown 移动端记录工具" in usr_p
        assert "source.md" in usr_p
        assert "适合谁使用" in usr_p
        assert "局限与注意" in usr_p
        assert "视频时间戳" in sys_p
        assert "章节时间戳锚点" not in sys_p + usr_p


# ── generate_summary（mock LLM）────────────────────────────────


class TestGenerateSummary:
    @patch("backend.app.services.summary_generator._call_llm")
    def test_returns_item_summary(self, mock_llm: MagicMock) -> None:
        mock_llm.return_value = ("# 摘要\n\n这是生成的摘要", "openai/gpt-4o")
        item = _make_item()
        result = generate_summary(item, "concise", background="背景")

        assert isinstance(result, ItemSummary)
        assert result.template == "concise"
        assert result.content_md == "# 摘要\n\n这是生成的摘要"
        assert result.model_used == "openai/gpt-4o"
        assert result.background_for_summary == "背景"
        assert result.summary_id  # uuid 非空
        assert result.version == 0  # 默认 0，调用方负责覆盖

    @patch("backend.app.services.summary_generator._call_llm")
    def test_llm_called_with_correct_prompts(self, mock_llm: MagicMock) -> None:
        mock_llm.return_value = ("output", "model")
        item = _make_item()
        generate_summary(item, "detailed")

        call_args = mock_llm.call_args
        sys_p, usr_p = call_args[0]
        assert "要点" in sys_p or "分析师" in sys_p
        assert "转写文本" in usr_p

    @patch("backend.app.services.summary_generator._call_llm")
    def test_image_text_standard_llm_prompt_is_type_specific(self, mock_llm: MagicMock) -> None:
        mock_llm.return_value = ("# 图文总结", "model")
        item = _make_item(
            type="image",
            results={
                "note_kind": "image_text",
                "source_md_raw": "图文原文",
                "markdown": "![图](/static/a.jpg)\n\n图文混排",
            },
        )

        generate_summary(item, "standard")

        sys_p, usr_p = mock_llm.call_args[0]
        assert "图文笔记整理专家" in sys_p
        assert "图文原文" in usr_p
        assert "章节时间戳锚点" not in sys_p + usr_p

    @patch("backend.app.services.summary_generator._call_llm")
    def test_tool_recommendation_llm_prompt_is_type_specific(self, mock_llm: MagicMock) -> None:
        mock_llm.return_value = ("# 工具推荐总结", "model")
        item = _make_item(
            type="image",
            results={
                "note_kind": "image_text",
                "source_md_raw": "工具推荐原文",
                "image_infos": [{"idx": 1, "ocr_text": "工具支持 Markdown 导出"}],
            },
        )

        generate_summary(item, "tool_recommendation")

        sys_p, usr_p = mock_llm.call_args[0]
        assert "工具推荐笔记整理专家" in sys_p
        assert "工具推荐原文" in usr_p
        # source.md 是唯一依据，image_infos 不再单独注入
        assert "source.md" in usr_p
        assert "章节时间戳锚点" not in sys_p + usr_p


# ── workspace_store summary helpers ─────────────────────────────


class TestWorkspaceStoreSummaryHelpers:
    def test_get_item(self) -> None:
        store = _make_store_with_item()
        item = store.get_item("ws-1", "item-1")
        assert item.item_id == "item-1"

    def test_get_item_not_found(self) -> None:
        store = _make_store_with_item()
        with pytest.raises(KeyError, match="item not found"):
            store.get_item("ws-1", "nonexistent")

    def test_next_version_for_template_first(self) -> None:
        store = _make_store_with_item()
        ver = store.next_version_for_template("ws-1", "item-1", "concise")
        assert ver == 0  # 首版 = v0

    def test_next_version_for_template_increment(self) -> None:
        store = _make_store_with_item()
        s1 = ItemSummary(summary_id="s1", template="concise", version=0)
        store.add_item_summary("ws-1", "item-1", s1)
        ver = store.next_version_for_template("ws-1", "item-1", "concise")
        assert ver == 1

    def test_next_version_different_templates_independent(self) -> None:
        store = _make_store_with_item()
        s1 = ItemSummary(summary_id="s1", template="concise", version=0)
        store.add_item_summary("ws-1", "item-1", s1)
        ver = store.next_version_for_template("ws-1", "item-1", "detailed")
        assert ver == 0  # 不同 template 独立计数，首版 = v0

    def test_add_item_summary(self) -> None:
        store = _make_store_with_item()
        s = ItemSummary(summary_id="s1", template="concise", version=1, content_md="内容")
        result = store.add_item_summary("ws-1", "item-1", s)
        assert result.summary_id == "s1"

        # 验证落盘后能读到
        item = store.get_item("ws-1", "item-1")
        assert len(item.summaries) == 1
        assert item.summaries[0].content_md == "内容"

    def test_delete_item_summary(self) -> None:
        store = _make_store_with_item()
        s1 = ItemSummary(summary_id="s1", template="concise", version=1)
        s2 = ItemSummary(summary_id="s2", template="concise", version=2)
        store.add_item_summary("ws-1", "item-1", s1)
        store.add_item_summary("ws-1", "item-1", s2)

        assert store.delete_item_summary("ws-1", "item-1", "s1") is True
        item = store.get_item("ws-1", "item-1")
        assert len(item.summaries) == 1
        assert item.summaries[0].summary_id == "s2"

    def test_delete_item_summary_not_found(self) -> None:
        store = _make_store_with_item()
        assert store.delete_item_summary("ws-1", "item-1", "nonexistent") is False


# ── _collect_frames（R3.4 嵌图链路）─────────────────────────────


class TestCollectFrames:
    """_collect_frames：带描述帧/无描述帧/空/串台 的取数逻辑。"""

    def test_frames_with_description(self) -> None:
        """results["frames"] 带 description → 直接返回。"""
        from backend.app.services.summary_generator import _collect_frames

        item = _make_item(results={
            "frames": [
                {"sec": 10, "description": "代码编辑器界面", "image_path": "/static/a.jpg"},
                {"sec": 30, "description": "终端输出结果", "image_path": "/static/b.jpg"},
            ],
        })
        out = _collect_frames(item)
        assert len(out) == 2
        assert out[0]["desc"] == "代码编辑器界面"
        assert out[0]["sec"] == 10.0
        assert out[0]["image_path"] == "/static/a.jpg"

    def test_frames_without_description_skipped(self) -> None:
        """results["frames"] 无 description 字段 → 走 fallback，无 json_outputs 时返回空。"""
        from backend.app.services.summary_generator import _collect_frames

        item = _make_item(results={
            "frames": [
                {"sec": 10, "image_path": "/static/a.jpg"},  # 缺 description
            ],
        })
        out = _collect_frames(item)
        assert out == []

    def test_empty_frames(self) -> None:
        """results 无 frames 且无 json_outputs → 返回空。"""
        from backend.app.services.summary_generator import _collect_frames

        item = _make_item(results={"transcript": "文本"})
        out = _collect_frames(item)
        assert out == []

    def test_frames_with_empty_description_skipped(self) -> None:
        """description 为空字符串的帧被跳过。"""
        from backend.app.services.summary_generator import _collect_frames

        item = _make_item(results={
            "frames": [
                {"sec": 10, "description": "", "image_path": "/static/a.jpg"},
                {"sec": 30, "description": "有效描述", "image_path": "/static/b.jpg"},
            ],
        })
        out = _collect_frames(item)
        assert len(out) == 1
        assert out[0]["desc"] == "有效描述"


# ── _postprocess_frames（R3.4 嵌图链路）────────────────────────


class TestPostprocessFrames:
    """_postprocess_frames：[[图N]]→![]() 替换 + 越界删除。"""

    def test_replace_valid_tags(self) -> None:
        """[[图0]] 和 [[图1]] 被替换为 markdown 图片。"""
        from backend.app.services.summary_generator import _postprocess_frames

        frames = [
            {"idx": 0, "sec": 10, "desc": "界面截图", "image_path": "/static/ws/videos/frames/f0.jpg"},
            {"idx": 1, "sec": 30, "desc": "输出结果", "image_path": "/static/ws/videos/frames/f1.jpg"},
        ]
        md = "前面内容\n\n[[图0]]\n\n中间内容\n\n[[图1]]\n\n后面内容"
        result = _postprocess_frames(md, frames)
        assert "![界面截图]" in result
        assert "![输出结果]" in result
        assert "[[图" not in result

    def test_out_of_bound_tag_removed(self) -> None:
        """越界的 [[图99]] 被删除，不报错。"""
        from backend.app.services.summary_generator import _postprocess_frames

        frames = [{"idx": 0, "sec": 10, "desc": "a", "image_path": "/static/x.jpg"}]
        md = "内容[[图0]]和[[图99]]"
        result = _postprocess_frames(md, frames)
        assert "[[图99]]" not in result
        assert "![a]" in result

    def test_no_frames_removes_all_tags(self) -> None:
        """frames 为空列表时，所有 [[图N]] 被清除。"""
        from backend.app.services.summary_generator import _postprocess_frames

        md = "内容[[图0]]和[[图1]]还有[[图2]]"
        result = _postprocess_frames(md, [])
        assert "[[图" not in result
        assert "内容" in result

    def test_no_tags_unchanged(self) -> None:
        """无 [[图N]] 标记时原样返回。"""
        from backend.app.services.summary_generator import _postprocess_frames

        md = "# 标题\n\n正文内容"
        result = _postprocess_frames(md, [{"idx": 0, "sec": 0, "desc": "a", "image_path": "/static/x.jpg"}])
        assert result == md


# ── build_image_text_note_prompt ──────────────────────────────────────

class TestBuildImageTextNotePrompt:
    """build_image_text_note_prompt 按 content_category 路由模板。"""

    def test_tutorial_uses_tutorial_template(self) -> None:
        from backend.app.services.summary_generator import build_image_text_note_prompt

        sys_p, usr_p = build_image_text_note_prompt("source content", "标题", "tutorial")
        assert "教程" in sys_p
        assert "🎯" in usr_p or "操作步骤" in usr_p

    def test_tool_recommendation_uses_tool_template(self) -> None:
        from backend.app.services.summary_generator import build_image_text_note_prompt

        sys_p, usr_p = build_image_text_note_prompt("source content", "标题", "tool_recommendation")
        assert "工具推荐" in sys_p
        assert "一句话判断" in usr_p

    def test_science_popularization_uses_science_template(self) -> None:
        from backend.app.services.summary_generator import build_image_text_note_prompt

        sys_p, usr_p = build_image_text_note_prompt("source content", "标题", "science_popularization")
        assert "科普" in sys_p
        assert "核心概念" in usr_p

    def test_unknown_defaults_to_standard(self) -> None:
        from backend.app.services.summary_generator import build_image_text_note_prompt

        sys_p, usr_p = build_image_text_note_prompt("source content", "标题", "unknown")
        assert "标准总结" in sys_p
        assert "source.md 材料" in usr_p

    def test_source_md_truncated_to_12000(self) -> None:
        from backend.app.services.summary_generator import build_image_text_note_prompt

        long_source = "x" * 20000
        _, usr_p = build_image_text_note_prompt(long_source, "标题", "unknown")
        # source content 应被截断到 12000 字符
        assert "x" * 12000 in usr_p
        assert "x" * 15000 not in usr_p


# ── _split_images_from_headings (#7) ───────────────────────────


class TestSplitImagesFromHeadings:
    """#7: 图片从标题行分离到独立行。"""

    def test_heading_with_trailing_image_split(self) -> None:
        from backend.app.services.summary_generator import _split_images_from_headings

        md = "## 搭建数据库 [12:30] ![截图](/static/shot.png)"
        result = _split_images_from_headings(md)
        assert result == "## 搭建数据库 [12:30]\n\n![截图](/static/shot.png)"

    def test_heading_without_image_unchanged(self) -> None:
        from backend.app.services.summary_generator import _split_images_from_headings

        md = "## 普通标题 [05:00]"
        result = _split_images_from_headings(md)
        assert result == md

    def test_image_in_body_unchanged(self) -> None:
        from backend.app.services.summary_generator import _split_images_from_headings

        md = "正文段落\n\n![图片](/static/a.jpg)\n\n更多正文"
        result = _split_images_from_headings(md)
        assert result == md

    def test_multiple_headings_with_images(self) -> None:
        from backend.app.services.summary_generator import _split_images_from_headings

        md = "## 章节一 [01:00] ![图1](/static/1.jpg)\n正文\n## 章节二 [02:00] ![图2](/static/2.jpg)"
        result = _split_images_from_headings(md)
        lines = result.split("\n")
        # 两处标题行都不含 ![
        for line in lines:
            if line.startswith("##"):
                assert "![" not in line

    def test_image_at_start_of_heading(self) -> None:
        """#7 真实 bug 形态：图在标题行开头。"""
        from backend.app.services.summary_generator import _split_images_from_headings

        md = "## ![截图@00:00](/static/shot.png)本地与线上对比 [04:02]"
        result = _split_images_from_headings(md)
        assert result == "## 本地与线上对比 [04:02]\n\n![截图@00:00](/static/shot.png)"
        # 标题行不含 ![
        assert "![" not in result.split("\n")[0]


# ── Part B: 无截图时清理孤立配图说明 ────────────────────────────


class TestBuildPromptNoFramesConstraint:
    """B1: frames 空时 build_prompt 注入「不要配图说明」约束。"""

    def test_no_frames_constraint_in_user_prompt(self) -> None:
        item = _make_item()
        _, usr_p = build_prompt(item, "standard", embed_frames=True)
        assert "本次无可用截图" in usr_p
        assert "此图为" in usr_p  # 约束中提到了要禁止的模式

    def test_with_frames_no_constraint(self) -> None:
        """有帧数据时不注入无图约束。"""
        from backend.app.services.summary_generator import _collect_frames

        item = _make_item(results={
            "transcript": "内容",
            "frames": [
                {"idx": 0, "sec": 10, "description": "界面", "image_path": "/tmp/f0.jpg"},
            ],
        })
        with patch.object(
            __import__("backend.app.services.summary_generator", fromlist=["_collect_frames"]),
            "_collect_frames",
            return_value=[{"idx": 0, "sec": 10, "desc": "界面", "image_path": "/tmp/f0.jpg"}],
        ):
            _, usr_p = build_prompt(item, "standard", embed_frames=True)
            assert "本次无可用截图" not in usr_p


class TestRemoveOrphanImageDescs:
    """B2: _remove_orphan_image_descs 清理 LLM 幻觉配图说明。"""

    def test_removes_heading_with_shici_and_description(self) -> None:
        """## 附：xx界面示例 + 此图为 段 → 全删。"""
        from backend.app.services.summary_generator import _remove_orphan_image_descs

        md = "## 总结\n\n正文\n\n## 附：Billy Note 配置界面示例 [04:56]\n\n此图为 Billy Note 的配置界面截图。\n\n## 延伸\n\n更多内容。"
        result = _remove_orphan_image_descs(md)
        assert "附：" not in result
        assert "此图为" not in result
        assert "## 总结" in result
        assert "## 延伸" in result
        assert "正文" in result

    def test_removes_standalone_ci_tu_wei_paragraph(self) -> None:
        """无标题的独立「此图为…」段 → 删除。"""
        from backend.app.services.summary_generator import _remove_orphan_image_descs

        md = "## 开头\n\n内容\n\n此图为视频中某个画面的截图。\n\n## 结尾\n\n更多。"
        result = _remove_orphan_image_descs(md)
        assert "此图为" not in result
        assert "## 开头" in result
        assert "## 结尾" in result

    def test_preserves_heading_without_shici(self) -> None:
        """## 附：xxx（无「示例」）→ 保留。"""
        from backend.app.services.summary_generator import _remove_orphan_image_descs

        md = "## 附：2026 年度总结 [05:30]\n\n正文。"
        result = _remove_orphan_image_descs(md)
        assert "附：2026 年度总结" in result

    def test_preserves_code_example_heading(self) -> None:
        """## 附：代码示例 / 配置示例（无「界面/截图」）→ 保留。"""
        from backend.app.services.summary_generator import _remove_orphan_image_descs

        md = "## 附：代码示例 [03:20]\n\nprint('hello')\n\n## 附：配置示例\n\nsettings = {}"
        result = _remove_orphan_image_descs(md)
        assert "附：代码示例" in result
        assert "附：配置示例" in result

    def test_preserves_normal_content(self) -> None:
        """正常内容不受影响。"""
        from backend.app.services.summary_generator import _remove_orphan_image_descs

        md = "## 学习笔记\n\n这是一篇正常笔记，没有配图说明。"
        result = _remove_orphan_image_descs(md)
        assert result == md


class TestPostprocessFramesOrphanCleanup:
    """B2 兜底：_postprocess_frames frames 空时清理孤立配图说明。"""

    def test_empty_frames_removes_orphan_descs(self) -> None:
        from backend.app.services.summary_generator import _postprocess_frames

        md = "## 学习笔记\n\n正文\n\n## 附：Billy Note 配置界面示例 [04:56]\n\n此图为截图。"
        result = _postprocess_frames(md, [])
        assert "附：" not in result
        assert "此图为" not in result
        assert "## 学习笔记" in result

    def test_nonempty_frames_keeps_content(self) -> None:
        """有帧时不触发孤立配图说明清理。"""
        from backend.app.services.summary_generator import _postprocess_frames

        frames = [{"idx": 0, "sec": 10, "desc": "a", "image_path": "/static/x.jpg"}]
        md = "## 笔记\n\n[[图0]]"
        result = _postprocess_frames(md, frames)
        assert "![a]" in result
