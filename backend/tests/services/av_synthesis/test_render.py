"""render_av_synthesis_md 单测。"""

from backend.app.services.av_synthesis.render import (
    AVSynthesisContext,
    Chapter,
    GalleryRow,
    render_av_synthesis_md,
)


def _make_full_context() -> AVSynthesisContext:
    """构造包含所有字段的测试上下文。"""
    return AVSynthesisContext(
        title="Python 入门",
        platform="Bilibili",
        author="UP主",
        duration_display="10:30",
        date_added="2026-05-27",
        cover_path="cover.jpg",
        summary="本视频介绍了 Python 基础语法。",
        gallery_rows=[
            GalleryRow("00:12", "frames/001.jpg", "开场画面"),
            GalleryRow("02:34", "frames/008.jpg", "代码演示"),
        ],
        chapters=[
            Chapter(
                title="引言",
                time_range="00:00~01:20",
                frame_path="frames/002.jpg",
                transcript_excerpt="大家好，今天我们学 Python",
                highlights="Python 是最流行的入门语言",
            ),
            Chapter(
                title="变量与类型",
                time_range="01:20~05:00",
                highlights="int / str / list 三种基本类型",
            ),
        ],
        full_transcript="[00:00] 大家好\n[00:05] 今天我们学 Python",
        final_synthesis="Python 语法简洁，适合初学者。",
    )


def test_renders_all_five_sections():
    """渲染结果包含 5 个 H2 段落。"""
    md = render_av_synthesis_md(_make_full_context())
    for section in ["全局摘要", "关键帧画廊", "章节正文", "字幕原文", "最终综合"]:
        assert f"## {section}" in md, f"缺少 ## {section}"


def test_renders_title_and_meta():
    """标题和元信息正确渲染。"""
    md = render_av_synthesis_md(_make_full_context())
    assert "# Python 入门" in md
    assert "Bilibili · UP主 · 10:30 · 2026-05-27" in md


def test_renders_gallery_table():
    """画廊表格包含两行数据。"""
    md = render_av_synthesis_md(_make_full_context())
    assert "| 00:12 |" in md
    assert "| 02:34 |" in md
    assert "开场画面" in md


def test_renders_chapters():
    """章节正文包含编号和时间范围。"""
    md = render_av_synthesis_md(_make_full_context())
    assert "### 1. 引言（00:00~01:20）" in md
    assert "### 2. 变量与类型（01:20~05:00）" in md
    assert "Python 是最流行的入门语言" in md


def test_renders_transcript_in_details():
    """字幕原文包裹在 <details> 标签中。"""
    md = render_av_synthesis_md(_make_full_context())
    assert "<details>" in md
    assert "</details>" in md
    assert "[00:00] 大家好" in md


def test_minimal_context():
    """只填必填字段 title 也能正常渲染，不报错。"""
    ctx = AVSynthesisContext(title="测试")
    md = render_av_synthesis_md(ctx)
    assert "# 测试" in md
    assert "## 全局摘要" in md
