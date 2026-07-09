"""总结生成器：构造 prompt → 调 LLM → 返回 ItemSummary。"""

from __future__ import annotations

import json as _json
import logging
import re
import uuid
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)

from backend.app.models.workspace import ItemSummary, WorkspaceItem
from backend.app.services.summary_templates import get_template, TEMPLATES
from shared.config import DATA_DIR
from shared.settings_store import load_settings

# 所有 9 种模板 ID（配图规则注入目标）
_ALL_TEMPLATE_IDS = frozenset(TEMPLATES.keys())


def _is_image_text_item(item: WorkspaceItem) -> bool:
    results = item.results or {}
    return item.type == "image" and results.get("note_kind") == "image_text"


def _image_text_material(item: WorkspaceItem) -> Tuple[str, str, str]:
    """Return source text, composed markdown, and image notes for image-text items."""
    results = item.results or {}
    source_text = str(
        results.get("source_md_raw")
        or results.get("note_body")
        or results.get("content")
        or ""
    ).strip()
    composed_md = str(results.get("markdown") or "").strip()
    image_lines: List[str] = []
    for info in results.get("image_infos") or []:
        if not isinstance(info, dict):
            continue
        idx = int(info.get("idx") or len(image_lines) + 1)
        desc = str(info.get("description") or "").strip()
        ocr = str(info.get("ocr_text") or "").strip()
        static_url = str(info.get("static_url") or "").strip()
        parts = [f"图 {idx}"]
        if static_url:
            parts.append(static_url)
        if desc:
            parts.append(f"理解：{desc}")
        if ocr:
            parts.append(f"OCR：{ocr}")
        if len(parts) > 1:
            image_lines.append(" | ".join(parts))
    return source_text, composed_md, "\n".join(image_lines)


def _build_image_text_standard_prompt(
    item: WorkspaceItem,
    background: str = "",
) -> Tuple[str, str]:
    """Build a note-summary prompt for image-text posts, based on source.md."""
    results = item.results or {}
    # 优先使用 source_md_raw（VLM 构建的结构化源材料）；其次 fallback 到旧字段。
    source_md = str(
        results.get("source_md_raw")
        or results.get("source_text_enriched")
        or results.get("note_body")
        or results.get("content")
        or ""
    ).strip()

    system_prompt = (
        "你是图文笔记整理专家。请基于 source.md 材料生成一篇标准总结。\n"
        "严格规则：\n"
        "1. 只基于 source.md 内容做总结，不要编造原文没有的信息。\n"
        "2. 正文不能出现「图1 显示」「OCR」「图片描述」「视觉元素列表」等材料层调试词。\n"
        "3. 不要逐张描述图片外观、色调、构图、风格。\n"
        "4. 不要添加 [mm:ss] 这类视频时间戳。\n"
        "5. 如果内容明显是教程/工作流，可以组织成「掌握什么 / 前置条件 / 核心步骤 / 常见坑 / 验收方法」。\n"
        "6. 否则用「## 观点」「## 方法」「## 可带走的结论」等通用结构。\n"
        "7. 结尾给 3-5 条具体 takeaway。\n"
        "8. 只输出 Markdown，不要解释。"
    )
    sections: List[str] = []
    if background.strip():
        sections.append(f"【背景信息】\n{background.strip()}")
    if source_md:
        sections.append(f"【source.md 材料】\n{source_md[:12000]}")
    material = "\n\n".join(sections).strip()
    user_prompt = (
        "请基于 source.md 材料生成标准总结 Markdown。要求：\n"
        "1. 开头用 2-3 句概括这篇图文真正想表达什么。\n"
        "2. 用 `##` 分成 2-4 个主题，不要写时间点。\n"
        "3. 每个主题说明：原文观点是什么、图片补充了什么、对读者有什么启发。\n"
        "4. 保留关键概念、工具名、标签里的有效信息；过滤点赞关注等平台话术。\n"
        "5. 结尾写 `## 可带走的结论`，给 3-5 条具体 takeaway。\n\n"
        f"{material}"
    )
    return system_prompt, user_prompt


def _image_text_as_plain_text(item: WorkspaceItem) -> str:
    source_text, composed_md, image_notes = _image_text_material(item)
    return "\n\n".join(part for part in (source_text, composed_md, image_notes) if part.strip())


def _summary_source_text(item: WorkspaceItem) -> str:
    results = item.results or {}
    if _is_image_text_item(item):
        return _image_text_as_plain_text(item)
    raw_transcript = results.get("transcript", "")
    if isinstance(raw_transcript, list):
        raw_transcript = " ".join(
            seg.get("text", "") for seg in raw_transcript if isinstance(seg, dict)
        )
    return str(
        raw_transcript
        or results.get("content")
        or results.get("summary")
        or results.get("note_body")
        or results.get("markdown")
        or ""
    ).strip()


def _build_tool_recommendation_prompt(
    item: WorkspaceItem,
    background: str = "",
) -> Tuple[str, str]:
    """Build a tool recommendation summary prompt based on source.md."""
    results = item.results or {}
    # 优先使用 source.md（VLM 构建的结构化源材料）
    source_md = str(
        results.get("source_md_raw")
        or results.get("source_text_enriched")
        or results.get("content")
        or results.get("note_body")
        or ""
    ).strip()

    system_prompt = (
        "你是工具推荐笔记整理专家。请基于 source.md 材料，"
        "整理成一篇能帮助读者判断是否值得尝试的工具推荐总结。\n"
        "严格要求：\n"
        "1. 不要插入图片 Markdown，不要输出图片链接，不要写视频时间戳。\n"
        "2. 正文不能出现「OCR」「图片描述」「视觉元素」等材料调试词。\n"
        "3. 如果图片主要是文字，请把图中文字提炼成信息和判断，而不是描述图片本身。"
    )
    sections: List[str] = []
    if background.strip():
        sections.append(f"【背景信息】\n{background.strip()}")
    if source_md:
        sections.append(f"【source.md 材料】\n{source_md[:12000]}")
    material = "\n\n".join(sections).strip()
    user_prompt = (
        "请基于 source.md 材料生成「工具推荐」总结。输出 Markdown，按这个结构写：\n"
        "1. `## 一句话判断`：这个工具是什么，最值得关注的价值是什么。\n"
        "2. `## 解决的问题`：它试图解决什么具体痛点。\n"
        "3. `## 核心功能与亮点`：从材料中提炼功能，不要贴图。\n"
        "4. `## 适合谁使用`：列出 2-4 类适用人群或场景。\n"
        "5. `## 使用方式或工作流`：如果材料里有步骤/入口/流程，就整理出来；没有就写「材料未明确」。\n"
        "6. `## 局限与注意`：只基于材料指出可能限制、缺失信息或需要进一步确认的点。\n"
        "7. `## 是否值得尝试`：给出简短判断和下一步行动。\n\n"
        "注意：过滤点赞关注、话题标签等平台话术；不要编造价格、官网、下载地址或功能。"
        "如果材料里出现多个工具，用表格比较；如果只有一个工具，不要强行做表格。\n\n"
        f"{material}"
    )
    return system_prompt, user_prompt


def _build_image_text_tutorial_prompt(
    item: WorkspaceItem,
    background: str = "",
) -> Tuple[str, str]:
    """Build a tutorial/steps summary prompt for image-text items, based on source.md."""
    results = item.results or {}
    source_md = str(
        results.get("source_md_raw")
        or results.get("source_text_enriched")
        or results.get("content")
        or results.get("note_body")
        or ""
    ).strip()

    system_prompt = (
        "你是教程笔记整理专家。请基于 source.md 材料，"
        "整理成一篇可照着做的教程式总结。\n"
        "严格要求：\n"
        "1. 不要插入图片 Markdown，不要输出图片链接，不要写视频时间戳。\n"
        "2. 正文不能出现「OCR」「图片描述」「视觉元素」等材料调试词。\n"
        "3. 如果图片主要是文字，请把图中文字提炼成操作步骤，而不是描述图片本身。\n"
        "4. 材料中没有明确的信息不要编造，缺的步骤写「材料未明确」。"
    )
    sections: List[str] = []
    if background.strip():
        sections.append(f"【背景信息】\n{background.strip()}")
    if source_md:
        sections.append(f"【source.md 材料】\n{source_md[:12000]}")
    material = "\n\n".join(sections).strip()
    user_prompt = (
        "请基于 source.md 材料生成「步骤教程」总结。输出 Markdown，按这个结构写：\n"
        "1. `## 🎯 学完你将掌握`：要点列表，学习者视角的收获。\n"
        "2. `## 🛠️ 前置条件 / 所需工具`：**有多个工具/要求时用 Markdown 表格**（工具 | 版本/要求）；只有一个时用列表。\n"
        "3. `## 操作步骤`：有序 Step 编号，可照做；步骤多时分「### 基础操作」和「### 进阶操作」两层。\n"
        "4. `## 💡 关键提示`：用 `>` blockquote 写 tips / 替代方案。\n"
        "5. `## 🔧 常见坑`：列出易踩的坑和解决办法。\n"
        "6. `## ✅ 验收 / 测试方法`：怎么确认做对了。\n"
        "7. `## 可带走的结论`：3-5 条核心 takeaway。\n\n"
        "注意：材料中没有明确的步骤不要编造，写「材料未明确」；过滤点赞关注等平台话术。\n\n"
        f"{material}"
    )
    return system_prompt, user_prompt


def _build_image_text_science_prompt(
    item: WorkspaceItem,
    background: str = "",
) -> Tuple[str, str]:
    """Build a science popularization summary prompt for image-text items, based on source.md."""
    results = item.results or {}
    source_md = str(
        results.get("source_md_raw")
        or results.get("source_text_enriched")
        or results.get("content")
        or results.get("note_body")
        or ""
    ).strip()

    system_prompt = (
        "你是知识科普笔记整理专家。请基于 source.md 材料，"
        "整理成一篇通俗易懂的科普式总结。\n"
        "严格要求：\n"
        "1. 不要插入图片 Markdown，不要输出图片链接，不要写视频时间戳。\n"
        "2. 正文不能出现「OCR」「图片描述」「视觉元素」等材料调试词。\n"
        "3. 如果图片主要是文字，请把图中文字提炼成知识点，而不是描述图片本身。\n"
        "4. 把专业术语用白话解释一遍，确保非专业读者也能理解。"
    )
    sections: List[str] = []
    if background.strip():
        sections.append(f"【背景信息】\n{background.strip()}")
    if source_md:
        sections.append(f"【source.md 材料】\n{source_md[:12000]}")
    material = "\n\n".join(sections).strip()
    user_prompt = (
        "请基于 source.md 材料生成「知识科普」总结。输出 Markdown，按这个结构写：\n"
        "1. `## 这篇在讲什么`：2-3 句通俗概括核心知识点。\n"
        "2. `## 核心概念`：用表格或列表整理关键概念（概念 | 一句话解释）。\n"
        "3. `## 原理或机制`：拆解背后的逻辑或原理，用类比让读者更容易理解。\n"
        "4. `## 有什么用`：这些知识在实际生活/工作中如何应用。\n"
        "5. `## 常见误解`：用 `>` blockquote 列出常见误区和正确理解。\n"
        "6. `## 延伸阅读方向`：给出 2-3 个可以进一步了解的方向。\n\n"
        "注意：过滤点赞关注等平台话术；用通俗语言，避免堆砌术语。\n\n"
        f"{material}"
    )
    return system_prompt, user_prompt


def build_image_text_note_prompt(
    source_md: str,
    title: str,
    content_category: str,
) -> Tuple[str, str]:
    """为 pipeline_tasks._generate_image_text_learning_note 构造 prompt。

    根据 content_category 选择模板：tutorial / tool_recommendation / science_popularization / unknown(=standard)。
    复用已有模板的结构，不重写。
    """
    body = source_md[:12000]

    if content_category == "tutorial":
        sys_prompt = (
            "你是教程笔记整理专家。请基于 source.md 材料，"
            "整理成一篇可照着做的教程式总结。\n"
            "严格要求：\n"
            "1. 只基于 source.md 内容做总结，不要编造原文没有的信息。\n"
            "2. 正文不能出现「OCR」「图片描述」「视觉元素」等材料调试词。\n"
            "3. 不要逐张描述图片外观、色调、构图、风格。\n"
            "4. 材料中没有明确的信息不要编造，缺的步骤写「材料未明确」。"
        )
        user_prompt = (
            f"# 标题\n{title}\n\n"
            f"# source.md 材料\n{body}\n\n"
            "请基于 source.md 材料生成「步骤教程」总结。输出 Markdown，按这个结构写：\n"
            "1. `## 🎯 学完你将掌握`：要点列表，学习者视角的收获。\n"
            "2. `## 🛠️ 前置条件 / 所需工具`：**有多个工具/要求时用 Markdown 表格**（工具 | 版本/要求）；只有一个时用列表。\n"
            "3. `## 操作步骤`：有序 Step 编号，可照做；步骤多时分「### 基础操作」和「### 进阶操作」两层。\n"
            "4. `## 💡 关键提示`：用 `>` blockquote 写 tips / 替代方案。\n"
            "5. `## 🔧 常见坑`：列出易踩的坑和解决办法。\n"
            "6. `## ✅ 验收 / 测试方法`：怎么确认做对了。\n"
            "7. `## 可带走的结论`：3-5 条核心 takeaway。\n\n"
            "注意：材料中没有明确的步骤不要编造，写「材料未明确」；过滤点赞关注等平台话术。"
        )
    elif content_category == "tool_recommendation":
        sys_prompt = (
            "你是工具推荐笔记整理专家。请基于 source.md 材料，"
            "整理成一篇能帮助读者判断是否值得尝试的工具推荐总结。\n"
            "严格要求：\n"
            "1. 只基于 source.md 内容做总结，不要编造原文没有的信息。\n"
            "2. 正文不能出现「OCR」「图片描述」「视觉元素」等材料调试词。\n"
            "3. 不要逐张描述图片外观、色调、构图、风格。"
        )
        user_prompt = (
            f"# 标题\n{title}\n\n"
            f"# source.md 材料\n{body}\n\n"
            "请基于 source.md 材料生成「工具推荐」总结。输出 Markdown，按这个结构写：\n"
            "1. `## 一句话判断`：这个工具是什么，最值得关注的价值是什么。\n"
            "2. `## 解决的问题`：它试图解决什么具体痛点。\n"
            "3. `## 核心功能与亮点`：从材料中提炼功能，不要贴图。\n"
            "4. `## 适合谁使用`：列出 2-4 类适用人群或场景。\n"
            "5. `## 使用方式或工作流`：如果材料里有步骤/入口/流程，就整理出来；没有就写「材料未明确」。\n"
            "6. `## 局限与注意`：只基于材料指出可能限制、缺失信息或需要进一步确认的点。\n"
            "7. `## 是否值得尝试`：给出简短判断和下一步行动。\n\n"
            "注意：过滤点赞关注、话题标签等平台话术；不要编造价格、官网、下载地址或功能。"
            "如果材料里出现多个工具，用表格比较；如果只有一个工具，不要强行做表格。"
        )
    elif content_category == "science_popularization":
        sys_prompt = (
            "你是知识科普笔记整理专家。请基于 source.md 材料，"
            "整理成一篇通俗易懂的科普式总结。\n"
            "严格要求：\n"
            "1. 只基于 source.md 内容做总结，不要编造原文没有的信息。\n"
            "2. 正文不能出现「OCR」「图片描述」「视觉元素」等材料调试词。\n"
            "3. 不要逐张描述图片外观、色调、构图、风格。\n"
            "4. 把专业术语用白话解释一遍，确保非专业读者也能理解。"
        )
        user_prompt = (
            f"# 标题\n{title}\n\n"
            f"# source.md 材料\n{body}\n\n"
            "请基于 source.md 材料生成「知识科普」总结。输出 Markdown，按这个结构写：\n"
            "1. `## 这篇在讲什么`：2-3 句通俗概括核心知识点。\n"
            "2. `## 核心概念`：用表格或列表整理关键概念（概念 | 一句话解释）。\n"
            "3. `## 原理或机制`：拆解背后的逻辑或原理，用类比让读者更容易理解。\n"
            "4. `## 有什么用`：这些知识在实际生活/工作中如何应用。\n"
            "5. `## 常见误解`：用 `>` blockquote 列出常见误区和正确理解。\n"
            "6. `## 延伸阅读方向`：给出 2-3 个可以进一步了解的方向。\n\n"
            "注意：过滤点赞关注等平台话术；用通俗语言，避免堆砌术语。"
        )
    else:
        # unknown → 标准总结
        sys_prompt = (
            "你是图文笔记整理专家。任务：基于 source.md 材料生成标准总结笔记。\n"
            "严格规则：\n"
            "1. 只基于 source.md 内容做总结，不要编造原文没有的信息。\n"
            "2. 正文不能出现「图1 显示」「OCR」「图片描述」「视觉元素列表」等材料层调试词。\n"
            "3. 不要逐张描述图片外观、色调、构图、风格。\n"
            "4. 不要保留营销 CTA、话题标签、关注引导，除非它们对理解内容有价值。\n"
            "5. 不要添加 [mm:ss] 这类视频时间戳。\n"
            "6. 如果内容明显是教程/工作流，可以组织成「掌握什么 / 前置条件 / 核心步骤 / 常见坑 / 验收方法」。\n"
            "7. 否则用「## 观点」「## 方法」「## 可带走的结论」等通用结构。\n"
            "8. 结尾给 3-5 条具体 takeaway。\n"
            "9. 只输出 Markdown，不要解释。"
        )
        user_prompt = (
            f"# 标题\n{title}\n\n"
            f"# source.md 材料\n{body}\n\n"
            "请基于 source.md 生成标准总结 Markdown："
        )

    return sys_prompt, user_prompt


def build_prompt(
    item: WorkspaceItem,
    template_id: str,
    background: str = "",
    embed_frames: bool = True,
    max_embed_frames: int = 0,
) -> Tuple[str, str]:
    """构造 (system_prompt, user_prompt)。

    背景信息拼到 user_prompt 前面作为前置上下文（零侵入模板）。
    standard 模板额外注入「关键帧清单」（若有截帧数据）。
    embed_frames=False 时跳过帧注入；max_embed_frames>0 时限制帧数。
    """
    if template_id == "tool_recommendation":
        return _build_tool_recommendation_prompt(item, background)
    if _is_image_text_item(item) and template_id in ("steps", "tutorial"):
        return _build_image_text_tutorial_prompt(item, background)
    if _is_image_text_item(item) and template_id == "science_popularization":
        return _build_image_text_science_prompt(item, background)
    if _is_image_text_item(item) and template_id == "standard":
        return _build_image_text_standard_prompt(item, background)

    tpl = get_template(template_id)
    system_prompt = tpl.system_prompt
    raw_transcript = (item.results or {}).get("transcript", "")
    seg_list = raw_transcript if isinstance(raw_transcript, list) else None
    # 纯文本版本：用于字数统计、非 standard 模板，以及无分段时的兜底
    if seg_list is not None:
        plain_text = " ".join(
            seg.get("text", "") for seg in seg_list if isinstance(seg, dict)
        )
    else:
        plain_text = raw_transcript
    if not plain_text.strip():
        plain_text = (item.results or {}).get("content", "")
    if not plain_text.strip():
        plain_text = (item.results or {}).get("summary", "")
    if not plain_text.strip() and _is_image_text_item(item):
        plain_text = _image_text_as_plain_text(item)

    # standard 额外用「[mm:ss] 文字」分段版本喂 LLM，使其能在 ## 章节标题后标注
    # 真实时间戳；其他模板维持纯文本，零影响。
    if template_id == "standard" and seg_list:
        parts = []
        for seg in seg_list:
            if not isinstance(seg, dict):
                continue
            text = str(seg.get("text", "")).strip()
            if not text:
                continue
            ts = str(seg.get("t_str") or "").strip()
            if not ts:
                sec = int(float(seg.get("t_sec", 0) or 0))
                ts = f"{sec // 60:02d}:{sec % 60:02d}"
            parts.append(f"[{ts}] {text}")
        transcript = "\n".join(parts) or plain_text
    else:
        transcript = plain_text

    user_prompt = tpl.user_prompt.format(transcript=transcript)

    # R3.6: 计算视频时长（供后续 metadata 和配图 cap 使用）
    duration_sec = 0
    if not _is_image_text_item(item):
        raw_seg = (item.results or {}).get("transcript_segments", [])
        if isinstance(raw_seg, list) and raw_seg:
            last_seg = raw_seg[-1]
            if isinstance(last_seg, dict):
                duration_sec = float(last_seg.get("t_sec") or last_seg.get("start") or 0)

    # R3.6: standard 模板注入「内容画像」元数据（转写字数 + 视频时长）
    if template_id == "standard" and not _is_image_text_item(item):
        char_count = len(plain_text)
        if duration_sec > 0:
            mm, ss = divmod(int(duration_sec), 60)
            duration_str = f"{mm}分{ss}秒" if mm else f"{ss}秒"
        else:
            duration_str = "未知"
        meta = (
            f"【内容画像参考】\n"
            f"- 转写字数：约 {char_count} 字\n"
            f"- 视频时长：约 {duration_str}\n"
        )
        user_prompt = f"{meta}\n{user_prompt}"

    # R3.2: 含步骤/要点/教学的风格注入关键帧清单（若有截帧数据）
    # R3.11: embed_frames=False 时跳过
    # R3.16: max_embed_frames=0 不再表示「无限」（那会把所有帧塞进 prompt → 图太多），
    #        改为按时长自适应封顶；_collect_frames 已过价值闸门+去重，再按 cap 均匀采样。
    # Stage A #9: 扩展到 detailed/lecture/steps（这几个含步骤/要点/教学，配图有意义）
    if template_id in {"standard", "detailed", "lecture", "steps"} and embed_frames and not _is_image_text_item(item):
        frames = _collect_frames(item)  # 已过价值闸门 + 去重，idx 连续
        cap = max_embed_frames if max_embed_frames > 0 else _adaptive_frame_cap(
            duration_sec, len(frames)
        )
        if cap > 0 and len(frames) > cap:
            frames = _evenly_sample_frames(frames, cap)
        if frames:
            lines = []
            for f in frames:
                mm = int(f["sec"]) // 60
                ss = int(f["sec"]) % 60
                lines.append(f"[图{f['idx']} @{mm:02d}:{ss:02d}] {f['desc']}")
            frame_list = "\n".join(lines)
            user_prompt = (
                f"{user_prompt}\n\n"
                f"【关键帧清单】（已剔除过渡/重复画面，共 {len(frames)} 张候选）\n"
                f"以下是从视频中精选的画面。**配图原则**：\n"
                f"- ✅ **应该配图**：演示操作、代码展示、UI界面、数据图表、关键步骤、对比示例、重要结论\n"
                f"- ❌ **不要配图**：纯口播、过渡画面、与正文重复、无信息画面\n\n"
                f"使用 `[[图N]]` 插入配图（N=帧号），整篇可只配几张甚至不配。\n"
                f"`[[图N]]` 必须独占一行，不要放在 `##` 标题行里。\n\n"
                f"{frame_list}"
            )
        else:
            # B: 无可用截图，明确告知 LLM 不要生成配图说明
            user_prompt = (
                f"{user_prompt}\n\n"
                f"⚠️ 本次无可用截图。不要在笔记中写「此图为…」「附：…界面示例」等配图说明，"
                f"也不要使用 `[[图N]]`。只基于转写文字生成纯文本笔记。"
            )

    if background.strip():
        user_prompt = f"【背景信息】\n{background.strip()}\n\n{user_prompt}"

    # Stage 4: 带图模式 → 9 种模板全部注入配图规则（*FRAME-[mm:ss] 占位符）
    if embed_frames and not _is_image_text_item(item) and template_id in _ALL_TEMPLATE_IDS:
        from backend.app.services.summary_templates import FRAME_PLACEHOLDER_RULE
        system_prompt = system_prompt + FRAME_PLACEHOLDER_RULE

    return system_prompt, user_prompt


# ── 智能配图：价值闸门 + 去重 + 自适应限量（治「图太多 / 不够智能」）──────
# 低信息画面描述（价值闸门）：这些帧对理解无帮助，不进配图候选。
_LOW_VALUE_FRAME_DESCS = {
    "纯色过渡帧", "纯色画面", "过渡帧", "黑屏", "黑场", "纯黑画面",
    "白屏", "白场", "无画面内容", "无内容", "画面模糊", "模糊画面",
}


def _is_low_value_frame(desc: str) -> bool:
    """价值闸门：描述极短 / 属于过渡·纯色等无信息画面 → 不配图。"""
    d = (desc or "").strip()
    if len(d) <= 2:
        return True
    return d in _LOW_VALUE_FRAME_DESCS


def _frames_too_similar(a: str, b: str, threshold: float = 0.86) -> bool:
    """相邻帧画面描述高度相似 → 视为重复画面，去重。"""
    a, b = (a or "").strip(), (b or "").strip()
    if not a or not b:
        return False
    return SequenceMatcher(None, a, b).ratio() >= threshold


def _filter_and_dedup_frames(
    frames: List[Dict[str, object]],
) -> List[Dict[str, object]]:
    """价值闸门 + 相邻去重 + 重编号 idx。

    重编号保证 idx 与列表位置一致，使 build_prompt 的 [[图N]] 与
    _postprocess_frames 的 frames[N] 始终指向同一帧（采样只取子集、保留 idx）。
    """
    cleaned: List[Dict[str, object]] = []
    for fr in frames:
        desc = str(fr.get("desc") or "")
        if _is_low_value_frame(desc):
            continue
        if cleaned and _frames_too_similar(desc, str(cleaned[-1].get("desc") or "")):
            continue
        cleaned.append(fr)
    for n, fr in enumerate(cleaned):
        fr["idx"] = n
    return cleaned


def _adaptive_frame_cap(duration_sec: float, n_candidates: int, hard_max: int = 8) -> int:
    """配图「候选清单长度」上限：候选已过价值闸门+去重，这里仅封顶防「图太多」。

    替代旧的 max_embed_frames=0「不限制」语义（那会把所有帧塞进 prompt → 图太多）。
    短视频候选少 → 全给；候选多 → 封顶 hard_max，让 LLM 在精选里按需插（宁缺毋滥）。
    超长视频（>12min）按每 5min +1 微放宽，仍封顶 12。
    """
    cap = hard_max
    if duration_sec and duration_sec > 720:
        cap = min(12, hard_max + round((duration_sec - 720) / 300))
    return min(cap, n_candidates) if n_candidates else 0


def _evenly_sample_frames(
    frames: List[Dict[str, object]], cap: int,
) -> List[Dict[str, object]]:
    """按时间顺序均匀采样到 cap 张，保留每帧原 idx（与 _postprocess 全集对齐）。"""
    if cap <= 0:
        return []
    if len(frames) <= cap:
        return frames
    step = len(frames) / cap
    return [frames[min(len(frames) - 1, int(i * step))] for i in range(cap)]


def _collect_frames(item: WorkspaceItem) -> List[Dict[str, object]]:
    """收集关键帧信息：优先从 results["frames"]，兜底从 json_outputs 文件。

    返回前统一过价值闸门 + 去重（_filter_and_dedup_frames）。
    """
    results = item.results or {}

    # 优先：已物化的 frames（路由层 _materialize_video_results_from_analyze 产出）
    raw_frames = results.get("frames") or []
    if raw_frames and isinstance(raw_frames[0], dict) and "description" in raw_frames[0]:
        out = []
        for i, fr in enumerate(raw_frames):
            desc = str(fr.get("description") or fr.get("description_zh") or "").strip()
            if not desc:
                continue
            img = str(fr.get("image_path") or fr.get("frame_image_path") or "")
            sec = float(fr.get("sec") or 0)
            out.append({"idx": i, "sec": sec, "desc": desc[:200], "image_path": img})
        if out:
            return _filter_and_dedup_frames(out)

    # 兜底：从 json_outputs 文件读取（handle_note_task 存的路径）
    json_paths = results.get("json_outputs") or []
    if not json_paths:
        out = []
    else:
        out = []
        for jp in json_paths:
            try:
                data = _json.loads(Path(jp).read_text(encoding="utf-8"))
            except Exception:
                continue
            for i, fr in enumerate(data.get("frames", [])):
                desc = str(fr.get("description_zh") or fr.get("description") or "").strip()
                if not desc:
                    continue
                ts = str(fr.get("timestamp") or "00:00:00")
                sec = _ts_to_sec(ts)
                # 尝试从 frames/ 目录找对应图片
                img = _find_frame_image(jp, i)
                out.append({"idx": len(out), "sec": sec, "desc": desc[:200], "image_path": img})

    # 如果还没有 frames，尝试从 default_project 的分析报告目录查找
    if not out:
        out = _collect_frames_from_default_project(item)

    # 收集 ln-screenshots/ 手动截图（用户在视频播放器中截取的）
    # 注意：WorkspaceItem 没有 workspace_id 属性，需要从其他地方获取
    # 这里暂时跳过，因为需要修改 WorkspaceItem 模型
    # ws_id = item.workspace_id or ""
    # item_id = item.item_id or ""
    # if ws_id:
    #     from shared.config import get_workspace_root
    #     ws_root = get_workspace_root(ws_id)
    #     ln_shots_dir = ws_root / "ln-screenshots"
    #     if ln_shots_dir.is_dir():
    #         for shot_file in sorted(ln_shots_dir.glob("shot-*.png")):
    #             # 文件名格式：shot-XXXXXX-HHMMSS.png，XXXXXX 是秒数
    #             parts = shot_file.stem.split("-")
    #             if len(parts) >= 2:
    #                 try:
    #                     sec = float(parts[1])
    #                 except ValueError:
    #                     sec = 0.0
    #             else:
    #                 sec = 0.0
    #             img_url = f"/static/workspaces/{ws_id}/ln-screenshots/{shot_file.name}"
    #             out.append({
    #                 "idx": len(out),
    #                 "sec": sec,
    #                 "desc": f"用户截图 @{int(sec)//60:02d}:{int(sec)%60:02d}",
    #                 "image_path": img_url,
    #             })

    return _filter_and_dedup_frames(out)


def _collect_frames_from_default_project(item: WorkspaceItem) -> List[Dict[str, object]]:
    """从 default_project 的分析报告目录中收集 frames 数据。

    当 item.results 没有 frames 数据时，尝试从 default_project 的 videos 目录中
    查找对应的分析报告，读取视觉数据 JSON 中的 frames。
    """
    from shared.config import get_workspace_root

    # 获取视频标题或 source_value
    source_value = item.source_value or ""
    title = item.name or ""

    # 尝试从 default_project 的 videos 目录查找分析报告
    default_ws_root = get_workspace_root("default_project")
    videos_dir = default_ws_root / "videos"
    if not videos_dir.is_dir():
        return []

    out = []
    # 遍历所有分析报告目录
    for report_dir in videos_dir.glob("*_分析报告"):
        json_files = list(report_dir.glob("*_视觉数据.json"))
        if not json_files:
            continue

        # 检查是否与当前 item 相关（通过标题或 BV 号匹配）
        dir_name = report_dir.name.replace("_分析报告", "")
        is_match = False
        if title and dir_name in title:
            is_match = True
        elif source_value:
            # 从 source_value 提取 BV 号
            import re
            bv_match = re.search(r"BV[0-9A-Za-z]+", source_value)
            if bv_match and bv_match.group() in dir_name:
                is_match = True

        if not is_match:
            continue

        # 读取视觉数据 JSON
        for json_file in json_files:
            try:
                data = _json.loads(json_file.read_text(encoding="utf-8"))
            except Exception:
                continue

            frames_data = data.get("frames", [])
            for i, fr in enumerate(frames_data):
                desc = str(fr.get("content_zh") or fr.get("description_zh") or "").strip()
                if not desc:
                    continue
                ts = str(fr.get("timestamp") or "00:00:00")
                sec = _ts_to_sec(ts)
                # 从 frames/ 目录找对应图片
                img = _find_frame_image(str(json_file), i)
                out.append({"idx": len(out), "sec": sec, "desc": desc[:200], "image_path": img})

    return out


def _ts_to_sec(ts: str) -> float:
    """'00:01:30' → 90.0"""
    parts = ts.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(ts)
    except (ValueError, IndexError):
        return 0.0


def _find_frame_image(json_path: str, idx: int) -> str:
    """从 json 定位分析报告目录下的 frames/ 找第 idx 帧图片。

    复用 _locate_analyze_report_dir 同款路径探测：
    - json_data/<stem>_视觉数据.json → videos/<stem>_分析报告/frames/
    - json_path.parent/<stem>_分析报告/frames/
    - json_path.parent/frames/（旧产物）
    """
    jp = Path(json_path)
    json_stem = jp.stem.replace("_视觉数据", "")
    parent = jp.parent

    frames_dir = None
    for candidate_dir in [
        parent / f"{json_stem}_分析报告" / "frames",
        parent.parent / "videos" / f"{json_stem}_分析报告" / "frames",
        parent / "frames",
    ]:
        if candidate_dir.is_dir():
            frames_dir = candidate_dir
            break
    if not frames_dir:
        return ""

    # 按文件名排序取第 idx 个
    all_imgs = sorted(frames_dir.glob("*.jpg")) + sorted(frames_dir.glob("*.png"))
    if idx < len(all_imgs):
        return str(all_imgs[idx])
    return ""


def _remove_orphan_image_descs(md: str) -> str:
    """B2: 无截图时删除 LLM 幻觉生成的孤立配图说明。

    删除两种模式：
    1. `## 附：…界面/截图示例…[时间戳]` 标题行（紧接着的「此图为…」段也一并删）
    2. 独立的「此图为…」段落

    注意：只删含「界面/截图/配图」的配图说明标题，不误删正常「附：代码示例」等。
    """
    # 1. 标题行含「附：」+「界面/截图/配图」+「示例」（LLM 为不存在的图生成的说明标题）
    md = re.sub(
        r"^[ \t]*#{1,6}\s+附：.*(?:界面|截图|配图).*示例.*\n(?:[ \t]*\n)*(?:[ \t]*此图为[^\n]*\n(?:[ \t]*\n)*)?",
        "",
        md,
        flags=re.MULTILINE,
    )
    # 2. 独立的「此图为…」段落（标题已被删或原就无标题）
    md = re.sub(r"^[ \t]*此图为[^\n]*\n?", "", md, flags=re.MULTILINE)
    return md.rstrip("\n")


def _postprocess_frames(content_md: str, frames: List[Dict[str, object]]) -> str:
    """把 LLM 输出中的 [[图N]] 替换为 ![desc](/static/path)。越界的删掉。"""
    if not frames:
        # 没有帧数据，删掉所有 [[图N]] 引用 + 孤立配图说明（B2 兜底）
        md = re.sub(r"\[\[图\d+]\]", "", content_md)
        return _remove_orphan_image_descs(md)

    def _replace(m: re.Match) -> str:
        # [[图N]] → 提取 N
        tag = m.group(0)  # e.g. [[图3]]
        num_str = re.search(r"\d+", tag)
        if not num_str:
            return ""
        n = int(num_str.group())
        if 0 <= n < len(frames):
            fr = frames[n]
            img_path = str(fr.get("image_path") or "")
            desc = str(fr.get("desc") or "")
            # 转 /static/ URL
            static_url = _to_static_url(img_path)
            if static_url:
                return f"![{desc[:60]}]({static_url})"
            return ""  # 图片不存在，删掉引用
        return ""  # 越界，删掉

    return _split_images_from_headings(
        re.sub(r"\[\[图\d+]\]", _replace, content_md)
    )


_HEADING_IMG_ANYWHERE_RE = re.compile(
    r"^(#{1,6}\s+)(.*?)\s*(!\[[^\]]*\]\([^)]+\))\s*(.*)$"
)


def _split_images_from_headings(md: str) -> str:
    """#7: 把标题行里的 ![图](url) 拆到独立行，防止图片嵌进标题渲染不出。

    覆盖两种 LLM 输出形态：
    - `## 标题文字 [mm:ss] ![图](url)`  （图在末尾）
    - `## ![图](url)标题文字 [mm:ss]`  （图在开头）
    """
    lines = md.split("\n")
    out: list[str] = []
    for line in lines:
        m = _HEADING_IMG_ANYWHERE_RE.match(line)
        if m:
            prefix, before, img_tag, after = m.groups()
            title_text = (before + after).strip()
            if title_text:
                out.append(f"{prefix}{title_text}")
            else:
                out.append(prefix.rstrip())
            out.append("")
            out.append(img_tag)
        else:
            out.append(line)
    return "\n".join(out)


def _to_static_url(path: str) -> str:
    """本地绝对路径 → /static/... URL。"""
    if not path:
        return ""
    if path.startswith("/static/"):
        return path
    try:
        p = Path(path).resolve()
        data_resolved = DATA_DIR.resolve()
        if str(p).startswith(str(data_resolved)):
            rel = p.relative_to(data_resolved)
            return f"/static/{rel.as_posix()}"
    except (ValueError, OSError):
        pass
    return ""


def _call_llm(
    system_prompt: str,
    user_prompt: str,
    provider_id: str = "",
    model: str = "",
) -> Tuple[str, str]:
    """同步调用 LLM，返回 (content, model_used)。

    provider_id/model 可选覆盖：为空时走默认 profile。
    """
    from src.vidmirror.core.providers import ChatRequest
    from src.vidmirror.core.providers.registry import create_default_registry

    settings = load_settings()
    registry = create_default_registry()

    if provider_id:
        # 用户指定了 provider
        profile = next(
            (p for p in settings.providers if p.id == provider_id and p.enabled),
            None,
        )
        if profile is None:
            raise RuntimeError(f"provider 不存在或未启用: {provider_id}")
    else:
        profile = registry.resolve_default_profile(settings, "chat")

    provider = registry.build(profile)
    chat_model = model.strip() if model else str(
        profile.default_models.get("chat") or ""
    ).strip()
    if not chat_model:
        raise RuntimeError("未配置 chat model")

    text = provider.chat(ChatRequest(
        model=chat_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
        max_tokens=4000,
    ))
    model_used = f"{profile.id}/{chat_model}"
    return text, model_used


def generate_summary(
    item: WorkspaceItem,
    template_id: str,
    background: str = "",
    provider_id: str = "",
    model: str = "",
    search_web: bool = False,
    embed_frames: bool = True,
    max_embed_frames: int = 0,
) -> ItemSummary:
    """生成一份总结并返回 ItemSummary（不负责持久化）。

    search_web=True 时，先用内容关键词联网搜索，结果拼入 prompt。
    """
    # ── 联网搜索（可选） ──────────────────────────────────
    search_context = ""
    if search_web:
        from backend.app.services.web_search import (
            format_search_context,
            search_web_context,
        )

        # 用标题/背景/内容前 200 字构造搜索关键词
        title = (item.results or {}).get("title") or ""
        transcript = (
            _image_text_as_plain_text(item)
            if _is_image_text_item(item)
            else (item.results or {}).get("transcript", "")
        )
        if isinstance(transcript, list):
            transcript = " ".join(
                seg.get("text", "") for seg in transcript if isinstance(seg, dict)
            )
        query = title or background[:100] or transcript[:200]
        if query.strip():
            search_results = search_web_context(query.strip(), max_results=5)
            search_context = format_search_context(search_results)

    system_prompt, user_prompt = build_prompt(
        item, template_id, background,
        embed_frames=embed_frames, max_embed_frames=max_embed_frames,
    )

    # 搜索结果拼到 user_prompt 前面
    if search_context:
        user_prompt = f"{search_context}\n\n{user_prompt}"
        logger.info("联网搜索上下文已拼入 prompt（%d 字）", len(search_context))

    content_md, model_used = _call_llm(
        system_prompt, user_prompt,
        provider_id=provider_id, model=model,
    )

    # R3.2: 后处理 — [[图N]] → ![desc](/static/path)
    # ⚠️ 这里的模板集合必须与上面「注入配图提示」的集合（约 line 450）保持一致，
    # 否则会出现「LLM 标了 [[图N]] 却没被替换成真图」（#3 教学笔记没图的根因）。
    if template_id in {"standard", "detailed", "lecture", "steps"}:
        frames = _collect_frames(item)
        content_md = _postprocess_frames(content_md, frames)

    # Stage 4: 通用占位符后处理 — *FRAME-[mm:ss] → 真图 URL
    # video 类素材且有 frames 时才替换；无 frames 时占位符直接清除
    if not _is_image_text_item(item) and embed_frames:
        from backend.app.services.frame_placeholder import resolve_frame_placeholders
        frames_raw = _collect_frames(item)
        content_md = resolve_frame_placeholders(content_md, frames_raw)

    return ItemSummary(
        summary_id=str(uuid.uuid4()),
        template=template_id,
        version=0,  # 调用方负责设置正确 version
        background_for_summary=background,
        content_md=content_md,
        model_used=model_used,
    )
