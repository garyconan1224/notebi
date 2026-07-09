---
title: Track K · 图片笔记 VLM-first 逐图理解与总结方案
status: ready
owner: Claude 桌面定方案 -> 小米 v2.5pro 终端执行 -> Codex 审查
created: 2026-06-18
scope: 图文/图片笔记的逐图视觉理解、图片类型分类、文字内容合并、必要图片插入、失败闸门
non_goals: 不安装 OCR 新依赖、不做自动裁图第一版、不改视频/音频笔记、不碰 remix/复刻、不改数据库 schema
---

# Track K · 图片笔记 VLM-first 逐图理解与总结方案

> 本计划只解决一件事：图片/图文笔记不能只把图片当附件；需要先用视觉模型逐图读内容，再决定哪些文字进入总结、哪些图片作为演示证据插入正文。
>
> 第一版优先用 VLM（视觉语言模型，例如 Qwen-VL），OCR 只保留为未来备用方向，不新增依赖。

---

## 0. 当前问题证据

本次实测 item：

```text
workspace: f325c4fe-3b1e-4fbb-8501-ddfc0574a750
item: dff5dea3-2ac5-4a0a-ae91-d4b0db8b77eb
url: /workspaces/f325c4fe-3b1e-4fbb-8501-ddfc0574a750/items/dff5dea3-2ac5-4a0a-ae91-d4b0db8b77eb/note
```

实际落盘结果：

- 下载到了 19 张图。
- `results.image_infos[*].ocr_text` 全为空。
- `results.image_infos[*].description` 全为空。
- `source.md` 只有：`（未找到可用的分析或转录内容，请检查前置步骤是否已执行）`
- `note.md` 也没有正文内容。
- 本机 `.venv` 未安装 `paddleocr/paddle`，当前 OCR 路径会失败并被吞掉。

结论：问题不是前端“不展示内容”，而是后端图集理解结果为空，导致总结没有语料。

---

## 1. 产品结论

图片笔记应按“逐图理解 -> 分类处理 -> 全局总结”走，而不是“先总结文字，最后堆图片”。

一张笔记里可能同时有多种图片：

- 文字型信息卡
- 软件界面演示截图
- 流程图 / 架构图
- 表格 / 图表
- 图标 / logo
- 装饰图 / 封面图
- 普通照片 / 产品图
- 混合图：大段文字里夹 UI、图标、示意图

每张图要单独判断，不同类型进入总结的方式不同。

---

## 2. 第一版处理策略

### 2.1 VLM-first，不新增 OCR 依赖

第一版每张图片都调用视觉模型，要求模型直接完成两件事：

1. 读出图中文字。
2. 判断图片类型和该怎么进入笔记。

不安装 PaddleOCR / RapidOCR / EasyOCR。OCR 可以以后作为备用路径补，但不是本轮目标。

### 2.2 混合图片先做“语义拆分”，不做自动裁图

用户关心的情况：

> 文字型图片里可能也有演示图标/截图，能不能只留下图标展示，文字部分用于分析？

判断：

- 第一版不要做自动裁图。原因是自动裁掉文字只保留图标/演示块，需要稳定的区域定位、坐标归一化、图片裁剪和渲染引用；不同小红书长图布局差异很大，VLM 返回 bbox 的稳定性也需要实测。
- 第一版做“语义拆分”：让 VLM 在一张图里分别识别文字内容和视觉证据。如果图片含有关键 UI/流程/图标，整张图仍可插到对应段落；同时图中文字进入总结语料。
- 后续增强再做“区域裁图”：当 VLM 能稳定返回 `visual_regions` 坐标时，用已有图片处理能力裁出图标/界面局部，作为轻量插图。这个作为 V1.1，不放进第一版。

这样第一版能先解决“图片文字没进总结”的核心问题，同时保留演示图的理解价值。

---

## 3. 图片类型与处理规则

| image_type | 说明 | 处理方式 |
|---|---|---|
| `text_card` | 小红书文字卡、信息卡、文章截图 | `extracted_text` 和 `content_summary` 进入总结语料；默认不插图 |
| `ui_demo` | 软件界面、操作步骤、前后对比截图 | 提炼操作步骤；图片插入到对应步骤附近 |
| `flow_diagram` | 流程图、架构图、关系图 | 提取节点/关系；保留图片作为结构证据 |
| `chart_table` | 表格、数据图、对比表 | 提取指标/趋势/结论；保留图片作为证据 |
| `icon_logo` | 图标、logo、品牌标识 | 只记录对象/品牌；通常不进入正文，除非用于说明某工具 |
| `decorative` | 封面、氛围图、无信息装饰图 | 跳过，不进总结 |
| `photo` | 普通照片、产品实拍 | 有信息则总结并插图；无信息则跳过 |
| `mixed` | 文字 + 演示截图/图标/流程混合 | 文字进入总结；关键视觉信息保留整图插入，后续再考虑局部裁图 |
| `unknown` | 模型判断不清 | 保守保留摘要，不强行插图 |

---

## 4. VLM 输出协议

每张图要求返回严格 JSON，不要 markdown 代码块：

```json
{
  "image_type": "text_card | ui_demo | flow_diagram | chart_table | icon_logo | decorative | photo | mixed | unknown",
  "extracted_text": "按阅读顺序提取图中文字，没有则空字符串",
  "content_summary": "这张图表达的知识点或信息价值，80-200字",
  "action_steps": ["如果是演示/教程图，提取操作步骤"],
  "key_entities": ["工具名、功能名、对象名、指标名"],
  "visual_elements": ["图中对理解有价值的界面、图标、流程、表格、对比区域"],
  "visual_value": "high | medium | low",
  "embed_decision": "merge_text | embed_image | skip",
  "insert_hint": "适合放到哪个主题段落，例如：操作台设计、输入输出模块、工作流配置",
  "confidence": 0.0
}
```

### 4.1 embed_decision 规则

- `merge_text`：文字型图。把文字和总结合入语料，不插图片。
- `embed_image`：演示图、流程图、表格图、混合图里有关键视觉证据。把图片放到相关段落。
- `skip`：装饰、重复、无信息图。

### 4.2 mixed 图规则

如果一张图既有大段文字，又有关键 UI/图标/流程：

- `extracted_text` 必须提取文字。
- `visual_elements` 必须列出值得保留的视觉元素。
- `embed_decision` 可为 `embed_image`，第一版插整图。
- 不要让最终总结逐字复述原图；要提炼成可读笔记。

---

## 5. 总结输入组织

图集分析完成后，生成一个内部语料：

```markdown
# 原始文字
<小红书正文 / 标题 / 描述>

# 图片理解结果
## 图 1 · text_card · merge_text
- 图中文字：...
- 知识点：...
- 关键对象：...
- 建议段落：...

## 图 2 · ui_demo · embed_image
- 图中文字：...
- 操作步骤：...
- 视觉元素：...
- 图片：/static/...
- 建议段落：...
```

学习笔记生成时基于这份语料，而不是只基于原始正文。

最终 note.md 结构建议：

```markdown
# 学习笔记

## 一句话结论

## 核心观点

## 方法 / 流程

## 操作示例

<必要时插入 ui_demo / flow_diagram / chart_table / mixed 图片>

## 可复用做法

## 注意点

## 我可以怎么用
```

---

## 6. 质量闸门

不能再出现“19 张图下载成功，但内容为空还算成功”的情况。

第一版加三个闸门：

1. 如果 `note_kind == image_text` 且有图片，但全部图片的 `extracted_text/content_summary/visual_elements` 都为空，则任务应标记为失败或至少在结果里写入明确错误：`图片理解失败，缺少可总结内容`。
2. 如果 VLM 单张失败，不影响其他图片；但最终要统计失败数量。
3. 如果所有图都是 `decorative/skip` 且原始文字为空，则不要生成假总结。

---

## 7. 建议改动范围

只改后端图片笔记主链路和对应测试：

- `backend/app/services/pipeline_tasks.py`
  - 新增或替换图集分析函数，例如 `_analyze_image_for_note(...)`
  - 调整 `analyze_image_file(...)` 或新增 note 专用函数，避免影响单图结果页
  - `handle_note_task` 的 `image_text` 分支改为使用 VLM-first 结果生成 `source_text_from_download` 和 `note_body`
- `tests/backend/test_pipeline_tasks.py`
  - 增加 mock VLM 返回 JSON 的单测
  - 覆盖 text_card / ui_demo / mixed / 全空失败闸门

不改：

- 不改 `handle_image_task` 的结果页逻辑，避免影响已有图片详情页。
- 不改视频笔记。
- 不安装新库。
- 不改数据库 schema。

---

## 8. 验收标准

### 8.1 后端数据

对本次小红书图文链接重新生成后：

- `results.images` 有图片列表。
- `results.image_infos[*]` 不再只有空 `description/ocr_text`。
- 每张图至少有：
  - `image_type`
  - `extracted_text` 或 `content_summary` 或 `visual_elements`
  - `embed_decision`
- `source.md` 不再是“未找到可用内容”。
- `note.md` 能总结 Obsidian 个人知识工作台主题。

### 8.2 内容质量

最终笔记应该能体现：

- Obsidian 首页为什么需要改造成个人知识工作台。
- 操作台、今日行动、今日输入、今日输出等核心模块。
- 如果图里有 UI 演示，图片应出现在对应段落附近，而不是全部堆到末尾。
- 文字型图片的正文内容要进入总结，不能只显示图片。

### 8.3 测试

至少跑：

```bash
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend/test_pipeline_tasks.py -q
```

如果改动触及更多公共逻辑，再补跑：

```bash
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend -q
```

---

## 9. 给小米 v2.5pro 终端的执行提示词

```text
你是执行者，只按下面任务改代码。
不要重新规划，不要全项目调查，不要开 subagent。

启动只跑：
git status --short --branch
git log --oneline -5
git branch --show-current

如果当前分支不是 main，或有与本任务无关的未提交改动，先停下来报告，不要继续。

先读：
1. CLAUDE.md 顶部规则
2. docs/AI_HANDOFF.md 前 80 行
3. docs/rules/agent-roles.md
4. docs/plans/track-K-image-vlm-first-note-plan.md

任务目标：
把图文/图片笔记改成 VLM-first 逐图理解链路。当前问题是小红书图集虽然下载到 19 张图，但 image_infos 的 ocr_text/description 全空，source.md/note.md 变成“未找到可用内容”。第一版不要安装 OCR 新依赖，优先用当前视觉模型（例如 Qwen-VL）逐图提取文字、判断图片类型、决定文字合并或图片插入。

实现范围：
1. 只改后端图片笔记链路，重点在 backend/app/services/pipeline_tasks.py。
2. 不改 handle_image_task 的单图结果页逻辑，避免影响图片详情页。
3. 不改视频/音频笔记，不碰 remix/复刻，不改数据库 schema。
4. 不安装 PaddleOCR/RapidOCR/EasyOCR 等新依赖。

具体实现：
1. 为 image_text note 新增一个 note 专用图片分析函数，例如 _analyze_image_for_note(image_path, vision_model, api_key, log)，每张图调用视觉模型，要求返回严格 JSON：
   {
     "image_type": "text_card | ui_demo | flow_diagram | chart_table | icon_logo | decorative | photo | mixed | unknown",
     "extracted_text": "按阅读顺序提取图中文字，没有则空字符串",
     "content_summary": "这张图表达的知识点或信息价值，80-200字",
     "action_steps": ["如果是演示/教程图，提取操作步骤"],
     "key_entities": ["工具名、功能名、对象名、指标名"],
     "visual_elements": ["图中对理解有价值的界面、图标、流程、表格、对比区域"],
     "visual_value": "high | medium | low",
     "embed_decision": "merge_text | embed_image | skip",
     "insert_hint": "适合放到哪个主题段落",
     "confidence": 0.0
   }

2. image_type 处理规则：
   - text_card：文字和 content_summary 进入总结语料，默认不插图。
   - ui_demo：提炼操作步骤，图片插到对应步骤附近。
   - flow_diagram/chart_table：提取结构/指标/结论，保留图片。
   - icon_logo/decorative：通常跳过，除非和工具说明强相关。
   - mixed：文字进入总结；关键视觉元素保留整图插入。第一版不做自动裁图。

3. 在 handle_note_task 的 image_text 分支中：
   - 对 images_from_download 逐张调用 note 专用 VLM 分析。
   - 构造 image_infos，保留兼容字段 description/ocr_text/static_url，同时新增 image_type/extracted_text/content_summary/action_steps/key_entities/visual_elements/visual_value/embed_decision/insert_hint/confidence。
   - 用这些结果构造 source_text_from_download，必须包含原始正文 + 每张图的提取文字/知识点/插入建议。
   - _generate_image_text_learning_note 的输入必须使用“原文 + 图片理解结果”，不能只用 raw_source_text。

4. 质量闸门：
   - note_kind == image_text 且有图片，但所有图片的 extracted_text/content_summary/visual_elements 都为空时，不要生成“未找到可用内容”的假成功；返回明确错误或让任务失败，错误文案包含“图片理解失败，缺少可总结内容”。
   - 单张图片分析失败不影响其他图片，但最终结果里要能看出失败图片为空或 skipped。

5. 混合图片说明：
   - 用户关心“文字型图片里也有演示图标/截图，能否只留下图标展示，文字做分析”。第一版不做自动裁图，因为需要稳定 bbox 和裁剪验证；先用 VLM 做语义拆分：文字进总结，关键视觉元素用整图插入对应段落。不要实现自动裁图。

测试要求：
1. 在 tests/backend/test_pipeline_tasks.py 增加 mock 单测，覆盖：
   - text_card：VLM 返回 extracted_text，最终 source_text/note input 含这段文字，embed_decision=merge_text。
   - ui_demo：返回 action_steps + embed_image，结果保留 static_url 和插图决策。
   - mixed：文字 + visual_elements 同时保留。
   - 全部 VLM 返回空：触发“图片理解失败，缺少可总结内容”闸门。
2. 跑：
   KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend/test_pipeline_tasks.py -q
3. 如果改动影响公共函数，再跑：
   KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend -q

验收重点：
1. 对小红书图文笔记，results.image_infos 不能再全是空 description/ocr_text。
2. source.md 不能再是“未找到可用内容”。
3. note.md 要能总结图片文字内容，并把演示型/流程型图片放到对应总结位置。
4. 不新增依赖，不改 schema，不改视频笔记。

完成后回复：
- 改了哪些文件
- 关键实现说明
- 测试命令和结果
- commit hash（如果本轮允许 commit）
- 给 Codex 的审查提示词
```

