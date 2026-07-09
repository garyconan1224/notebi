---
title: Track K · 图文/视频总结呈现升级（渲染 + 内容双改）
status: ready
owner: Claude 终端定方案/验收 -> 小米 v2.5pro 终端执行 -> Codex 审查
created: 2026-06-18
scope: 总结渲染层（表格 CSS / 目录 TOC / callout / 模型档位）+ 内容层（note 正文按类型走模板 / 扩类型 / 图文视频差异化）
non_goals: 不改入口三选一与手动选模板 UI、不重写 Milkdown 编辑器内核、不装新依赖、不改数据库 schema、不动复刻/音频
---

# Track K · 图文/视频总结呈现升级

> 本计划解决一件事：让分类型总结「内容已生成对、但呈现很素 / 表格看不清 / 没目录」。

## 0. 研究结论（为什么这么改）

读了 BiliNote 全部 prompt 源码（`backend/app/gpt/prompt.py` + `prompt_builder.py`）后的反直觉结论：

- **BiliNote 的风格 prompt 极简**：9 种风格每种就一句话（教程 = “尽可能详细地记录教程，特别是关键点和重要结论步骤”），只有“小红书”写得花哨。它截图里 🎯🛠️表格/Step/💡/🔧/✅ 的丰富结构是**强模型（deepseek-v4-flash）自由发挥**的，不是 prompt 规定的。
- **我们的教程模板 prompt 已经比 BiliNote 细**（结构写死了）。所以**不要往“狂堆 prompt”方向走**。
- 真正“很素 / 看不清”的根因有 4 个，按影响排序：

| 现象 | 根因 | 批次 |
|---|---|---|
| 表格看不清 | 总结区有 `remark-gfm`（能渲成 `<table>`），但**缺表格边框 CSS** | 批1 |
| 没目录 | 总结视图 SummariesTab 无 TOC（前端无现成组件） | 批1 |
| 整体不够丰富 | summaries 默认用 Qwen3-8B（弱模型），BiliNote 用 deepseek-v4-flash | 批1 |
| note 正文素 | note.md 正文固定走 standard 模板；分类只影响“新建总结”默认项 | 批2 |

---

## 批1 · 渲染层（治标，改动小，立竿见影）

> 做完批1，现有教程总结（已含 emoji/表格语法）立刻变好看。

### 1.1 表格边框 CSS
- 落点：SummariesTab 主显示区 class `sm-main-content`（`frontend/src/components/SummariesTab.tsx:476`）对应的 css；以及 NoteShell 的 markdown 渲染区。
- 加 `table { border-collapse: collapse }` + `th/td { border + padding }` + 表头底色。可参考已有 `pages/results/LearningNotesPage/learning-notes.css` / `pages/result/text-result.css` 里现成的表格样式。
- 同时给 `> blockquote`（callout）加左边框 + 浅底色，让 `💡 关键提示` 更醒目。

### 1.2 总结目录 TOC
- 前端**无现成 TOC 组件**（`pages/result` 下未搜到），需新建。
- 从 `selected.content_md` 提取 `##` / `###` 标题 → 右侧目录列表 → 点击 `scrollIntoView` 到对应标题锚点。
- 加在 SummariesTab 主显示区右侧（视频笔记若已有类似实现，优先抽公共组件复用）。

### 1.3 summaries 默认模型换强档
- 现状：summaries 接口实测 `model_used = Qwen/Qwen3-8B`。
- 默认改 deepseek-v4 类强模型（落点：`NewSummaryModal` 默认 model / 后端 `generate_summary` 默认 / provider 默认模型）。
- ⚠️ 风险：强模型变慢，summaries 是同步接口，**确认前端请求超时（axios timeout）够长**，否则会前端超时报错。

---

## 批2 · 内容层（治本）

### 2.1 note 正文按 content_category 走模板
- 现状：note.md 正文由固定的图文学习笔记 prompt 生成（standard 性质），分类结果只写进 `summary_hint` 给“新建总结”用。
- 改：note 正文生成时读 `result.content_category`（tutorial / tool_recommendation / unknown），调 `summary_generator.build_prompt` 的对应模板生成正文，而非固定 standard。
- 先读：`pipeline_tasks._generate_image_text_learning_note` + `summary_generator.build_prompt`，复用已有 tutorial / tool_recommendation 模板，不重写。

### 2.2 扩充内容类型（增量，第一版可只补 1-2 个）
- 加 知识科普 / 好物种草 / 观点输出 等类型：信号词 + 对应模板。仿 `_TUTORIAL_SIGNALS` / `_build_image_text_tutorial_prompt` 套路。

### 2.3 图文 vs 视频差异化（增强，可后置）
- 借鉴 BiliNote「格式开关（目录/截图/AI总结）与风格分离」：把目录/配图作为可勾选项，视频/图文各自默认不同。

---

## 验收标准

- 渲染：教程总结表格有边框可读、右侧有目录可跳转、`💡` callout 有样式。
- 内容：教程类图文的 note **正文**直接是教程结构（🎯/🛠️/步骤/…），不再是 standard。
- 模型：换强档后总结更丰富，且不前端超时。
- 测试：`KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend/test_pipeline_tasks.py backend/tests/test_summary_generator.py -q` 全绿；`pnpm build` 通过。
- 真机：`./dev.sh` 重启 → 跑教程类 + 工具类各一条图文，结果页总结看表格/目录/正文模板。

---

## 给小米 v2.5pro 终端的执行提示词

```text
你是执行者，只按下面任务改代码。不要重新规划、不要全项目调查、不要开 subagent。

启动只跑：
git status --short --branch
git log --oneline -5
git branch --show-current
若当前分支不是 main 或有与本任务无关的未提交改动，先停下报告。

先读：
1. CLAUDE.md 顶部规则
2. docs/AI_HANDOFF.md 前 80 行
3. docs/plans/track-K-summary-presentation-upgrade.md（本计划）
4. 相关代码：frontend/src/components/SummariesTab.tsx、backend/app/services/summary_generator.py、backend/app/services/pipeline_tasks.py 的 _generate_image_text_learning_note

重要前提：分类型总结 prompt（standard/tool_recommendation/tutorial）+ 自动分类已实现且验收通过。本轮只做「呈现升级」，不要重写 prompt 结构。

按批次做，每批做完自测再做下一批：

批1（渲染层，先做）：
1.1 表格 CSS：给 SummariesTab 主显示区(sm-main-content)和 NoteShell markdown 区加 table/th/td 边框+border-collapse+表头底色+单元格 padding；> blockquote 加左边框+浅底色。可参考 pages/results/LearningNotesPage/learning-notes.css 的表格样式。
1.2 目录 TOC：新建组件，从 content_md 提取 ##/### 标题生成右侧目录，点击 scrollIntoView 跳转；加到 SummariesTab 主区。视频笔记若有类似实现优先抽公共组件。
1.3 summaries 默认模型换 deepseek-v4 档：改默认 model（NewSummaryModal/后端 generate_summary/provider 默认）；确认前端 summaries 请求 axios timeout 够长（强模型更慢），不够则调大。

批2（内容层）：
2.1 note 正文按类型走模板：_generate_image_text_learning_note 读 result.content_category（tutorial/tool_recommendation/unknown），调 summary_generator.build_prompt 对应模板生成正文，复用已有模板不重写；unknown 仍走 standard。
2.2（增量，可只补 1 个）扩 1 个新内容类型（如 知识科普）：仿 _TUTORIAL_SIGNALS + _build_image_text_*_prompt。

不要做：装新依赖、改 DB schema、改入口三选一与手动选模板 UI、重写 Milkdown 内核、动视频/音频/复刻。

测试：
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend/test_pipeline_tasks.py backend/tests/test_summary_generator.py -q
前端 pnpm build。
真机：./dev.sh 重启 → 跑教程类+工具类各一条图文，验总结表格边框/目录/callout/正文按类型。

完成后回复：改了哪些文件、关键实现说明、测试命令与结果、commit hash（若允许）、给 Codex 的审查提示词。
```

## 给 Codex 的审查提示词

```text
请审查 Track K「总结呈现升级」改动，计划见 docs/plans/track-K-summary-presentation-upgrade.md。
审查重点：
1. 批1.1 表格/callout CSS 是否只作用于总结/笔记 markdown 渲染区，未污染全局样式。
2. 批1.2 新建 TOC 组件：标题提取/锚点跳转是否健壮（重复标题、空标题、特殊字符）；是否与视频笔记目录重复造轮子（应抽公共组件）。
3. 批1.3 默认模型切换是否可被用户设置覆盖；前端 summaries 请求超时是否随强模型调大，避免误报失败。
4. 批2.1 note 正文按 content_category 选模板：unknown 兜底 standard；不破坏既有 note 生成链路与超时兜底；tutorial/tool 模板复用而非重写。
5. 测试是否覆盖「正文按类型生成」；前端 build 通过；视频/音频笔记未被波及。
```
