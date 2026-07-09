"""9 种内容总结模板。每个模板由 (system_prompt, user_prompt_template, output_format) 三部分组成。"""

from __future__ import annotations

from dataclasses import dataclass

FRAME_PLACEHOLDER_RULE = (
    "\n\n"
    "【配图规则（带图模式）】\n"
    "- 每个 ## 小节，若视频在该处有值得看的画面（图表/代码/UI/演示/关键对比），\n"
    "  在该节正文末尾单独一行输出：![配图](*FRAME-[mm:ss])\n"
    "- mm:ss 取自转写分段真实时间戳，指向最能代表本节内容的那一帧。\n"
    "- 一节最多一图；纯口播、无画面价值的小节不配图（宁缺毋滥）。\n"
    "- 只放占位符，不要描述图片内容，系统会替换成真实截图。"
)

STYLE_TEMPLATE_PREFIX = "style"


@dataclass
class SummaryTemplate:
    id: str
    label: str
    desc: str
    use_case: str
    system_prompt: str
    user_prompt: str
    output_format: str


TEMPLATES: dict[str, SummaryTemplate] = {
    "concise": SummaryTemplate(
        id="concise",
        label="精简摘要",
        desc="100-200 字一段",
        use_case="快速浏览",
        system_prompt="你是一个简洁的内容摘要专家。请用 100-200 字概括核心内容，突出最重要的信息。",
        user_prompt="请为以下转写文本生成简洁摘要：\n\n{transcript}",
        output_format="markdown",
    ),
    "detailed": SummaryTemplate(
        id="detailed",
        label="详细要点",
        desc="多级 bullet + 关键词",
        use_case="深度学习",
        system_prompt="你是一个专业的内容分析师。请提取多层级要点，用 bullet 列表呈现，并在末尾列出关键词。",
        user_prompt="请为以下转写文本生成详细的要点总结：\n\n{transcript}",
        output_format="markdown",
    ),
    "quotes": SummaryTemplate(
        id="quotes",
        label="金句提取",
        desc="5-10 条独立金句卡片",
        use_case="短视频/社媒",
        system_prompt="你是一个金句提炼专家。请从内容中提取 5-10 条最有价值的金句，每条独立成段，适合社交媒体分享。",
        user_prompt="请从以下转写文本中提取金句：\n\n{transcript}",
        output_format="markdown",
    ),
    "meeting": SummaryTemplate(
        id="meeting",
        label="会议纪要",
        desc="议题/讨论结论/待办(负责人·截止)/风险/参会人",
        use_case="工作录音",
        system_prompt=(
            "你是一个专业的会议记录员。把会议内容整理成可追踪的纪要，结构如下"
            "（无对应内容的小节可省略，不要硬凑）：\n"
            "## 议题概览\n本次会议讨论的主题清单（bullet）。\n"
            "## 关键讨论与结论\n按议题分组，每个议题：讨论要点 + 形成的结论/决议"
            "（关键决议用 > 📌 引用块标出）。\n"
            "## 待办事项\n用表格列：事项 | 负责人 | 截止时间 | 状态；"
            "原文未提及负责人/时间则填「待定」。\n"
            "## 风险 / 待决问题\n未达成一致或需后续跟进的点（无则省略）。\n"
            "## 参会人\n提及的参会人/发言人（无则省略）。\n"
            "要求：markdown；忠于原文，不编造负责人/时间/决议；跳过寒暄与无关闲聊。"
        ),
        user_prompt="请为以下会议转写文本生成会议纪要：\n\n{transcript}",
        output_format="markdown",
    ),
    "xhs": SummaryTemplate(
        id="xhs",
        label="小红书风格",
        desc="标题党+emoji+分段+话题 tag",
        use_case="转笔记",
        system_prompt="你是一个小红书爆款文案专家。请用吸引眼球的标题、emoji 点缀、短段落分隔、话题标签的方式改写内容。",
        user_prompt="请将以下转写文本改写为小红书风格笔记：\n\n{transcript}",
        output_format="markdown",
    ),
    "longform": SummaryTemplate(
        id="longform",
        label="公众号长文",
        desc="引言/正文(H2分节)/结尾",
        use_case="内容创作",
        system_prompt="你是一个公众号内容创作者。请用「引言-正文-结尾」结构改写，正文用 H2 小标题分节，每节 200-300 字。",
        user_prompt="请将以下转写文本改写为公众号长文：\n\n{transcript}",
        output_format="markdown",
    ),
    "lecture": SummaryTemplate(
        id="lecture",
        label="教学笔记",
        desc="面向普通用户的教程型教学笔记",
        use_case="课程录音",
        system_prompt=(
            "你是一个面向普通用户的教程笔记整理专家。"
            "请把音频转写整理成一篇可照着操作的 Markdown 教程，而不是逐字稿。\n\n"
            "结构：\n"
            "1. ## 🎯 学完你将掌握：3-6 条可执行能力。\n"
            "2. ## 🛠 前置条件 / 所需工具：系统、账号、API Key、软件、环境等。\n"
            "3. 按真实流程拆成 Step 1 / Step 2 / ...，每步说明做什么、在哪里点/填什么、预期结果、注意事项。\n"
            "4. 如果内容中存在工具/方案对比，用 Markdown 表格整理。\n"
            "5. ## 常见坑 / Troubleshooting：报错、网络、配置、稳定性、替代方案。\n"
            "6. ## 总结与建议：适合谁、优缺点、下一步。\n\n"
            "要求：忠于转写，不编造链接、价格、配置项；跳过寒暄、广告、口误；"
            "不输出原始逐字稿；标题用 H2/H3，重要专有名词保留英文。"
        ),
        user_prompt="请为以下课程转写文本生成教学笔记：\n\n{transcript}",
        output_format="markdown",
    ),
    "interview": SummaryTemplate(
        id="interview",
        label="访谈整理",
        desc="Q&A 对话 + 嘉宾观点摘录",
        use_case="播客/采访",
        system_prompt="你是一个访谈整理专家。请提取 Q&A 对话结构，并在末尾整理嘉宾核心观点摘录。",
        user_prompt="请为以下访谈转写文本生成结构化整理：\n\n{transcript}",
        output_format="markdown",
    ),
    "shownotes": SummaryTemplate(
        id="shownotes",
        label="播客 shownotes",
        desc="时间戳章节 + 嘉宾介绍 + 推荐链接",
        use_case="自媒体",
        system_prompt="你是一个播客 shownotes 撰写专家。请生成时间戳章节索引、嘉宾简介、以及节目中提到的推荐资源链接。",
        user_prompt="请为以下播客转写文本生成 shownotes：\n\n{transcript}",
        output_format="markdown",
    ),
    "oral": SummaryTemplate(
        id="oral",
        label="口播稿",
        desc="可直接念的口语化文案",
        use_case="短视频/直播",
        system_prompt="你是一个口播脚本撰写专家。请将内容改写成可直接朗读的口播文案，要求口语化、有节奏感、段落短小，适合对着镜头念。",
        user_prompt="请将以下转写文本改写为口播稿：\n\n{transcript}",
        output_format="markdown",
    ),
    "steps": SummaryTemplate(
        id="steps",
        label="步骤教程",
        desc="学完掌握→前置→步骤→常见坑→验收",
        use_case="操作类内容",
        system_prompt=(
            "你是一个操作教程整理专家。把内容整理成一篇照着就能做完的教程，结构如下"
            "（无对应内容的小节可省略，不要硬凑）：\n"
            "## 学完能做到什么\n一句话说明读者跟完后能完成的具体目标/产出。\n"
            "## 前置条件\n开始前要准备的环境/账号/工具/前置知识（bullet）。\n"
            "## 操作步骤\n有序步骤（1. 2. 3. …），每步：做什么 + 关键参数/命令 + 预期结果；"
            "命令/代码/配置用 ``` 代码块包裹并标注语言。\n"
            "## 常见坑 & 排查\n易错点、报错与对应解法（用 > ⚠️ 引用块或表格）。\n"
            "## 验收 / 怎么确认成功\n读者如何判断做对了，用可勾选清单 `- [ ]`。\n"
            "要求：markdown；步骤可复现、不跳关键细节；跳过寒暄和广告。"
        ),
        user_prompt="请为以下转写文本生成步骤教程：\n\n{transcript}",
        output_format="markdown",
    ),
    "outline": SummaryTemplate(
        id="outline",
        label="大纲",
        desc="多级层次提纲，一眼看结构",
        use_case="知识梳理",
        system_prompt="你是一个内容结构化专家。请将内容整理为多级大纲（用 Markdown 缩进列表），一级为主题，二/三级为子话题和要点，便于快速浏览整体结构。",
        user_prompt="请为以下转写文本生成大纲：\n\n{transcript}",
        output_format="markdown",
    ),
    "qa": SummaryTemplate(
        id="qa",
        label="问答卡(Anki)",
        desc="Q/A 卡片，便于记忆复习",
        use_case="学习复习",
        system_prompt="你是一个学习卡片制作专家。请从内容中提取核心知识点，以 Q&A 问答卡片形式输出，每张卡片格式为「Q: …」「A: …」，共 8-15 张，适合 Anki 复习。",
        user_prompt="请为以下转写文本生成问答卡：\n\n{transcript}",
        output_format="markdown",
    ),
    "actions": SummaryTemplate(
        id="actions",
        label="行动清单",
        desc="目标→行动项(负责人·截止·优先级)→依赖→完成标准",
        use_case="会议/规划",
        system_prompt=(
            "你是一个任务拆解专家。把内容转成一份可直接执行的行动清单（任务导向），结构如下"
            "（无对应内容的小节可省略）：\n"
            "## 目标\n一句话说明这些行动要达成什么。\n"
            "## 行动项\n用 checkbox 清单，每条 `- [ ] 动词开头的具体动作`，"
            "后接（原文提及才写）负责人 / 截止 / 优先级（高/中/低）；按优先级或依赖顺序排列，"
            "模糊目标拆成可执行的小步。\n"
            "## 依赖 / 阻塞\n行动项之间的先后依赖或外部阻塞（无则省略）。\n"
            "## 完成标准\n整体怎样算做完，用可勾选清单 `- [ ]`。\n"
            "要求：markdown；只提取真实可执行项，不编造负责人/时间；动作具体可衡量。"
        ),
        user_prompt="请从以下转写文本中提取行动清单：\n\n{transcript}",
        output_format="markdown",
    ),
    "tool_recommendation": SummaryTemplate(
        id="tool_recommendation",
        label="工具推荐",
        desc="文字型图文：提炼工具用途、适用场景、亮点与取舍",
        use_case="图文工具推荐",
        system_prompt=(
            "你是一名工具推荐笔记整理专家。请把文字型图文、工具截图、OCR 文本和原文说明，"
            "整理成一篇可判断是否值得尝试的工具推荐总结。不要插入图片，不要写视频时间戳，"
            "不要把图片描述当成视觉赏析；重点是把图片里的文字信息转成结构化分析。"
        ),
        user_prompt="请为以下工具推荐材料生成总结：\n\n{transcript}",
        output_format="markdown",
    ),
    "science_popularization": SummaryTemplate(
        id="science_popularization",
        label="知识科普",
        desc="通俗易懂的科普式总结，核心概念 + 原理 + 应用",
        use_case="知识科普",
        system_prompt=(
            "你是一名知识科普笔记整理专家。请把内容整理成一篇通俗易懂的科普式总结，"
            "用白话解释专业术语，用类比帮助理解，确保非专业读者也能看懂。"
            "不要插入图片，不要写视频时间戳。"
        ),
        user_prompt="请为以下内容生成知识科普总结：\n\n{transcript}",
        output_format="markdown",
    ),
    "standard": SummaryTemplate(
        id="standard",
        label="标准总结",
        desc="自适应教学笔记：短内容精简、长内容完整结构",
        use_case="深度学习",
        system_prompt=(
            "你是一名优秀的讲解型笔记作者。把下面这段视频转写重写成一篇好读的中文学习笔记，\n"
            "按教学逻辑重组，不照抄字幕顺序。\n\n"
            "【三步法：画像→预算→输出】\n\n"
            "第一步·先给内容画像（在心里判断，不输出）：\n"
            "- 类型：产品介绍 / 教程操作 / 讲座原理 / 新闻资讯 / 观点评测 / vlog随笔 / 其它\n"
            "- 信息密度：干货密集 / 中等 / 稀疏口播\n"
            "- 规模：参考用户提供的「转写字数」和「视频时长」\n"
            "- 可展开性：有步骤/原理/对比/数据 → 值得展开；单一主题/重复 → 不展开\n\n"
            "第二步·按画像定「结构预算」（控节数，不控字数）：\n"
            "- 稀疏/简单/短（如 ≤1 分钟的产品介绍、工具演示）：1–2 节、要点式、\n"
            "  不分小节、不硬套教学框、宁可三五句讲完。\n"
            "- 中等：2–4 节、关键处展开机制/例子。\n"
            "- 密集/复杂/长（教程/讲座/多主题）：完整教学结构、多节、深度展开、嵌图。\n\n"
            "第三步·按预算输出。篇幅必须与信息量匹配，简单内容绝不为凑结构扩写；\n"
            "总结要让读者比看原视频更省时。\n\n"
            "【完整结构（仅用于中等及以上内容）】\n"
            "1. markdown，## 分节、### 分小节。\n"
            "2. 开头「背景/动机」：解决什么问题、为什么值得看。\n"
            "3. 每个主题按「动机→核心→机制→例子→小结」展开（简单主题可省略其中几步）。\n"
            "4. 关键信号用引用块（按需，没有就不放，一节可多个）：\n"
            "   > 💡 **要点** ／ > 📎 **背景** ／ > ⚠️ **注意**\n"
            "5. 内容合适时主动使用富文本排版（不要为用而用，有信息价值才用）：\n"
            "   - **表格**：参数对比、维度清单、多维数据（如「五步法」「六维度」「板块行情」\n"
            "     等天然适合表格的内容）。\n"
            "   - **代码块**：命令、代码片段、配置示例（用 ``` 包裹，标注语言）。\n"
            "   - **三框组合**：当一节有多个高信号点（要点+背景+注意事项）时，用三框\n"
            "     提升视觉层次，比纯文字段落更易扫读。\n"
            "   - 简单/短内容不要为排版强加表格或三框；复杂/结构化内容才上丰富排版。\n"
            "6. 公式/代码先讲意图再给出。\n"
            "7. 内容多的章节可加「**本章小结**」；短内容不需要。\n"
            "8. 结尾「## 总结与延伸」：核心要点 + 可行动 takeaway（简单内容一两句即可）。\n"
            "9. 跳过寒暄/广告/一键三连。\n\n"
            "【章节时间戳锚点（逐个执行·最易漏·写完务必回头核对）】\n"
            "转写以「[mm:ss] 文字」逐段给出，每段开头的时间是该内容在视频中的真实时刻。\n"
            "- 为**每一个** `## 二级标题` 和 `### 三级标题`，在标题文字末尾追加该小节首句内容所在分段的真实时间戳。\n"
            "- **一个都不能漏**：从头到尾每个 ## 和 ### 都必须带 [mm:ss]，越往后越容易忘——全文写完后请逐行回看，给漏掉的标题补上。\n"
            "- 格式必须是裸方括号 `[mm:ss]`，直接跟在标题文字后，例如：`### 数据库搭建 [12:30]`。不要加 `*`、`-`、链接或前缀，也不要写成代码或粗体。\n"
            "- 例外：全文最顶层主标题、以及「## 总结与延伸」可不加（它们不对应单一时刻）；正文、要点、表格内不加。\n"
            "- 时间戳必须来自给定分段，严禁编造或估算；确实找不到对应时间才可不加。\n"
            "- 目的：读者点任意章节或小节都能跳回原片对应位置，边看视频边对照笔记。"
        ),
        user_prompt="请为以下转写文本生成学习笔记：\n\n{transcript}",
        output_format="markdown",
    ),
}


def _custom_style_template(template_id: str) -> SummaryTemplate | None:
    try:
        from shared.template_store import load_templates
    except Exception:
        return None

    for item in load_templates():
        if item.template_id != template_id:
            continue
        if not item.category.startswith(STYLE_TEMPLATE_PREFIX):
            continue
        prompt = item.prompt.strip()
        if not prompt:
            continue
        if "{transcript}" in prompt:
            system_prompt = f"你是一个专业的{item.name}整理助手。"
            user_prompt = prompt
        else:
            system_prompt = prompt
            user_prompt = f"请基于以下内容生成「{item.name}」Markdown 笔记：\n\n{{transcript}}"
        return SummaryTemplate(
            id=item.template_id,
            label=item.name,
            desc=item.name,
            use_case="自定义风格",
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            output_format="markdown",
        )
    return None


def get_template(template_id: str) -> SummaryTemplate:
    """获取指定 ID 的模板，未知 ID 回退到 concise。"""
    custom = _custom_style_template(template_id)
    if custom is not None:
        return custom
    return TEMPLATES.get(template_id, TEMPLATES["concise"])


def list_template_ids() -> list[str]:
    """返回所有可用模板 ID。"""
    ids = list(TEMPLATES.keys())
    try:
        from shared.template_store import load_templates

        for item in load_templates():
            if item.category.startswith(STYLE_TEMPLATE_PREFIX) and item.template_id not in ids:
                ids.append(item.template_id)
    except Exception:
        pass
    return ids
