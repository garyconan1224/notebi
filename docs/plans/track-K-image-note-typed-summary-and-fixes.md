---
title: Track K · 图文笔记「分类型总结落地 + 链路生效修复」
status: ready
owner: Claude 终端定方案 -> 小米 v2.5pro 执行 -> Codex 审查
created: 2026-06-18
scope: 让 VLM-first 图文链路真正生效（治 LLM 超时回退 + 修自动分类写入）、新增图文「教程」总结模板、打磨「工具推荐」自动识别、修 processing 页结果跳转 404、清理 source.md 多余 tab
non_goals: 不改入口三选一（已实现）、不改手动选模板 UI（已实现）、不装 OCR 新依赖、不改 DB schema、不做自动裁图、不碰视频/音频/复刻
---

# Track K · 图文笔记「分类型总结落地 + 链路生效修复」

> 一句话目标：图文笔记按内容类型（工具推荐 / 教程 / 通用）自动套不同总结模板；文字型图片只提取文字、不堆图；让这条已写好的链路真正跑起来，并修掉演示暴露的几个 bug。

---

## 0. 背景与现状（重要：很多东西已实现，别重做）

2026-06-18 三个提交（`6df35cd` 意图分流 / `dd54324` VLM-first / `2e9d540` source.md+标准总结）已经把骨架搭好，但一直没真正生效，原因是**后端跑今早 10:25 的旧进程（手动起、无 --reload）**，且 note task 内 LLM 总结 **45s 超时回退**到纯文本兜底。

### 已实现、本轮不要动
- ✅ 入口三选一：`AddMaterialModal.tsx:79-82`（选「笔记」后第③步：自动/视频/图文/音频）。
- ✅ 手动选模板：`NewSummaryModal.tsx:19-22`（标准 / 工具推荐 / 步骤教程 + 更多下拉）。
- ✅ VLM-first 逐图分析：`pipeline_tasks.py:1703 _analyze_image_for_note`，分支调用 `:2375`。
- ✅ 工具推荐模板：`summary_generator.py:125 _build_tool_recommendation_prompt`（结构完整，已要求不插图）。
- ✅ 图文标准模板：`summary_generator.py:56 _build_image_text_standard_prompt`。

### 本轮实测证据（dev.sh 重启后端、加载新代码后）
测试 item：`88ca314a-6f3a-4706-97cb-e9231e482af0`（「AI任务单模板」，7 图，workspace `f325c4fe-3b1e-4fbb-8501-ddfc0574a750`）。

- 日志 7/7 张 `type=text_card | 提取文字 | 决策=merge_text` → VLM-first 生效 ✓
- `source.md` = 图里真实文字（任务单正文），不再是「图片长什么样」描述 ✓
- note task 标准总结 **45s 超时回退**（模型 DeepSeek-V3）→ note.md 变纯文本兜底 ⚠️
- 手动调 `POST /summaries {template:tool_recommendation}`（模型 Qwen3-8B，**无超时**）→ 工具推荐总结质量良好 ✓
- `content_category=None`：自动分类**没写入** ⚠️
- processing 页「查看结果」→ `/workspaces/default_project/...` → **404** ⚠️
- `source.md` 段间有多余 `\t` ⚠️

---

## P0 让链路真正生效（看到效果的前提）

### P0.1 治 note task 总结超时回退
- **现象**：note task 内「图文语境合成 / 标准总结生成」45s 超时回退。超时封装在 `pipeline_tasks.py:1942 _chat_with_timeout`，超时值 `:1932 _image_text_llm_timeout_sec`（默认 45、上限 120）。
- **根因**：note task 用的是 generate-note 注入的 chat 默认模型（实测 DeepSeek-V3），慢，45s 不够；而 summaries 接口用 Qwen3-8B 同步 5-15s 成功。
- **改法（建议组合，择优）**：
  1. note task 图文总结改走更快模型档（与 summaries 对齐，如 Qwen3-8B 类；参考 BiliNote 教程用 deepseek-v4-flash 快模型同样不超时），或
  2. 把 image_text 总结超时默认从 45s 调到 90-120s（常量/payload `image_text_llm_timeout_sec`），并
  3. 保留超时兜底，但确保正常网络下「标准总结/工具推荐」能成功，不再轻易掉进纯文本兜底。
- **验收**：重跑 88ca314a 与一条 19 图 item，`note.md` 是模板总结而非「纯文本兜底，N 段原文」。

### P0.2 修自动分类未写入
- **现象**：`content_category` / `default_summary_template` 落盘为 None。
- **根因排查方向**：`pipeline_tasks.py:1900 _classify_image_text_content` 疑似在「总结超时回退」路径被跳过，或结果未写回 `item.results` 落盘。
- **改法**：无论总结成功还是回退，都要调用分类，并把 `content_category` + `default_summary_template` 写入 `item.results` 落盘；结果页「新建总结」默认选中 `default_summary_template`。
- **验收**：AI任务单这类内容 → `content_category=tool_recommendation`；结果页新建总结默认选中「工具推荐」。

### P0.3 修 processing 页结果跳转 404
- **现象**：`/processing/{task_id}` 点「查看结果」→ `/workspaces/default_project/items/{id}/note` → 404；从 `/library` 进则正确。
- **根因**：`ProcessingPage/index.tsx:70-72` `workspaceId = taskPayload.workspace_id ?? taskResult.workspace_id ?? task.project_id`；从 task_id 进入未取到 payload.workspace_id 时回退 `project_id`（=`default_project`）。`:354 const wid = workspaceId ?? 'default'` 据此拼 URL。
- **改法**：确保 processing 页能拿到 note task 的真实 `workspace_id`（generate-note 已把 `workspace_id` 写进 task payload，确认前端 task 详情接口返回并被正确读取）；**结果页跳转禁止回退到 `project_id` 作为 workspace**。取不到真实 workspace 时宁可跳 `/library` 兜底。
- **验收**：processing 页点「查看结果」进入正确 `/workspaces/{真实ws}/items/{id}/note`，不 404。

---

## P1 新增图文「教程」总结

### P1.1 后端图文教程模板（参考 BiliNote「教程」模板）
- 在 `summary_generator.py` 新增 `_build_image_text_tutorial_prompt`（仿 `_build_tool_recommendation_prompt`）。
- 结构（emoji 小标题，对标 BiliNote 教程输出）：
  - `## 🎯 学完你将掌握`（要点列表，学习者视角的收获）
  - `## 🛠️ 前置条件 / 所需工具`（**有多个工具/要求时用 Markdown 表格**：工具 \| 版本/要求）
  - `## 操作步骤`（有序 Step 编号、可照做；步骤多时分「基础操作 / 进阶操作」两层）
  - `## 💡 关键提示`（用 `>` callout 写 tips / 替代方案）
  - `## 🔧 常见坑`
  - `## ✅ 验收 / 测试方法`
  - `## 可带走的结论`
- 规则：图文场景**不插图**、图里是文字就提炼成步骤、不写 `[mm:ss]` 时间戳、不出现「OCR / 图片描述」等调试词；材料没有的不编造（缺的步骤写「材料未明确」）。
- `build_prompt:170` 路由加分支：`_is_image_text_item(item)` 且 `template_id in {"steps","tutorial"}` → 用教程模板。

### P1.2 分类器加教程识别
- `_classify_image_text_content` 增加 tutorial 分支：教程信号词（步骤 / 教程 / 第一步 / 如何 / 怎么做 / 操作 / 配置 / 安装 / 设置 / 流程…）命中则 `content_category=tutorial`、`default_summary_template=steps`。
- 明确 tool_recommendation 与 tutorial 的判定优先级（建议教程信号更强时优先 tutorial），互斥不要同时命中。

### P1.3 前端 steps 与后端对齐
- `NewSummaryModal` 的「步骤教程」(`steps`) 选项确保传 `template=steps` → 命中后端图文教程模板。
- `AddMaterialModal` 图文笔记描述去掉「OCR」字样（现已 VLM-first，无 OCR）：`image_text` 项 desc 改为「逐图视觉理解 + 文字提取 + 按类型总结」之类。

---

## P2 打磨工具推荐识别
- `_TOOL_SIGNALS`（`pipeline_tasks.py:1889`）关键词命中 ≥3 过于宽松（「笔记 / AI / 模板 / 功能」几乎万能命中），易误判。第一版收紧：提高阈值 / 加权 / 加排除词；后续可改为一次轻量 LLM 基于 `source.md` 判类型。
- 清理 `source.md` 段间多余 `\t`：在构造 source_text 处对每段 `strip()`（`pipeline_tasks.py` source.md 构造段，约 `:2411` 起）。

---

## 测试要求
```bash
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend/test_pipeline_tasks.py tests/backend/test_summary_generator.py -q
```
- 前端 `pnpm build` 通过。
- 新增单测覆盖：教程模板生成、分类器 tutorial 分支、分类写入（成功路径 + 超时回退路径都要写入 content_category）。
- 真机（必须先 `./dev.sh` 重启加载新代码）：跑「AI任务单(工具类)」+ 一条「教程类」图文，验：note.md 是模板总结、自动分类正确、结果页默认模板正确、processing 页「查看结果」不 404。

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
3. docs/rules/agent-roles.md
4. docs/plans/track-K-image-note-typed-summary-and-fixes.md（本计划，含 P0/P1/P2）

重要前提：入口三选一(AddMaterialModal)、手动选模板(NewSummaryModal)、VLM-first 逐图分析、工具推荐/标准模板都已实现，不要重做。本轮只做 P0/P1/P2 与三个 bug 修复。

按顺序做，每个 P 做完自测再做下一个：
P0.1 治 note task 图文总结 45s 超时回退（换快模型/调大超时到 90-120s/确保正常网络下不掉纯文本兜底）。参照：summaries 接口用 Qwen3-8B 同步不超时。
P0.2 修自动分类未写入：无论总结成功或回退都调用 _classify_image_text_content 并把 content_category + default_summary_template 写入 item.results 落盘。
P0.3 修 ProcessingPage 结果跳转 404：确保拿到 note task 真实 workspace_id；禁止回退 project_id 作为结果页 workspace，取不到则跳 /library。
P1.1 新增 summary_generator._build_image_text_tutorial_prompt + build_prompt 路由 (image_text 且 template in {steps,tutorial})。教程模板结构（emoji 小标题，对标 BiliNote）：🎯学完你将掌握 / 🛠️前置条件·所需工具(多项用表格) / 操作步骤(Step编号，多则分基础·进阶) / 💡关键提示(callout) / 🔧常见坑 / ✅验收方法 / 可带走的结论。不插图、不编造、缺的写「材料未明确」。
P1.2 _classify_image_text_content 加 tutorial 识别（教程信号词），写 default_summary_template=steps。
P1.3 前端 steps→后端教程模板对齐；AddMaterial 图文描述去掉「OCR」字样。
P2 收紧 _TOOL_SIGNALS 判定（提高阈值/加权/排除词）；清理 source.md 段间多余 \t。

不要做：装新依赖、改 DB schema、改入口三选一与手动选模板 UI、动视频/音频/复刻。

测试：
KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend/test_pipeline_tasks.py tests/backend/test_summary_generator.py -q
前端 pnpm build。
真机：./dev.sh 重启 → 跑工具类 + 教程类各一条图文，验 note.md 模板总结/自动分类/结果页默认模板/processing 不 404。

完成后回复：改了哪些文件、关键实现说明、测试命令与结果、commit hash（若本轮允许 commit）、给 Codex 的审查提示词。
```

## 给 Codex 的审查提示词（小米完成后用）

```text
请审查本轮「图文笔记分类型总结落地 + 链路生效修复」改动。审查重点：
1. P0.1 note task 图文总结不再轻易 45s 超时回退（确认模型/超时改动合理，兜底仍在）。
2. P0.2 content_category/default_summary_template 在「总结成功」与「超时回退」两条路径都写入 item.results 并落盘；结果页默认选中对应模板。
3. P0.3 ProcessingPage 不再用 project_id(default_project) 作为结果页 workspace；取不到真实 workspace 跳 /library，不产生 404。
4. P1 图文教程模板结构合理、不插图、不复述图片外观；build_prompt 对 image_text+steps/tutorial 路由正确；分类器 tutorial 与 tool_recommendation 互斥与优先级清晰。
5. P2 _TOOL_SIGNALS 判定收紧后不再对普通图文误判工具推荐；source.md 无多余 tab。
6. 测试断言反映新行为；pytest + pnpm build 全绿。
```
