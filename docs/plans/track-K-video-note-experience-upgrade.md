---
title: Track K · 视频笔记体验改造（对标 BiliNote）
status: done
owner: Claude(规划/落地+开工卡) + mimo v2.5pro(执行) + Codex(审查)
created: 2026-06-19
completed_date: 2026-06-21
commits: VN1=38041d5,9fd86c2; VN2=68ca0cd,aee22cd; VN3=7778f32,f051e8a; VN4.1=902da70,e7dbf73; VN4.2=75bfadb; VN4.3=e1030e3; VN4.4=7e9916c,95b39d2; VN5.1=c47481d; VN5.2=205d061; VN6=864c496（均 Codex 通过）
progress: 全部完成 ✅ VN1 合集 / VN2 弹窗 / VN3 处理页 / VN4 结果页工具栏+banner / VN5 说话人透传+tab / VN6 教程·会议·任务 contract。整条 BiliNote 视频笔记改造主线收尾（2026-06-21）。对账以 git 为准。
VN5 实测勘误（2026-06-21 Claude 核实）：① 服务路径是 note_assembler.normalize_transcript（非计划写的 workspaces.py ~2294）；② 「导出原文对照(txt)」**已存在**于 NoteShell 导出菜单（handleExportTranscript→downloadSubtitles srt with_speaker=true），VN5.2 不必重做导出，只做说话人 tab；③ 边界无 pyannote→speaker 恒缺，说话人 tab 条件式隐藏，VN5 净新增小。
context: 用户给 Codex 生成的调研原型 docs/design/bilinote-video-note-flow-review.html + BiliNote 截图，要求把顺滑流程叠加到 Nibi 可编辑 NoteShell。Claude 调查真实代码后确认约 60–70% 后端能力已存在，多为前端接线/重组。三条边界：不迁移 workspace/item、不改 schema、不装新依赖（说话人条件式降级）。
---

> 本文档即交接依据：① 给人看的计划（五份交付物）；② 给 mimo 看的逐 phase 执行提示词（§六）。
> **执行模型（三角色，见 [`docs/rules/agent-roles.md`](../rules/agent-roles.md)）**：Claude 规划+落地本文档+写开工卡 → mimo v2.5pro 按开工卡逐 phase 改代码/测试/commit → Codex 审查通过/不通过。Claude 不直接写业务代码。
> 原型对照：[`docs/design/bilinote-video-note-flow-review.html`](../design/bilinote-video-note-flow-review.html)；截图：`docs/design/assets/bilinote-video-note/`。

---

## Context（为什么做）

BiliNote 强在「链接→识别→简洁进度→结果页工具集中」的流畅链路；Nibi 强在 NoteShell 可编辑、视频/字幕/笔记联动。本次只改**体验、文案、界面编排**，把 Nibi 已有但「藏起来/没接线」的能力暴露成清晰流程，同时保住可编辑优势。

已确认决策（用户）：① 导出/AI 工具**只接线已有、其余禁用占位**；② 合集＝**改文案 + 新增合集浏览页**（后端不迁移）；③ 说话人**只做条件式 UI、不装 pyannote/HF_TOKEN**。

---

## 一、缺口核对表（原型需求 × 真实代码，均已 grep 验证）

| # | 原型/需求点 | 真实现状 | 缺口 | Phase |
|---|---|---|---|---|
| 1 | 加链接后即时视频详情卡 | `sniffUrl` 已返回 `platform/title/thumbnail/possible_types`；`probeDuration` 返回时长；AddMaterialModal 已调用但只显示「已识别为X」文字 | **零后端**，纯前端渲染富卡片 | VN2 |
| 2 | 「合集」替代「工作空间」+ 入口 | UI 用「工作空间/素材」；后端 workspace/item | 文案改名 + 新增合集浏览页 | VN1 |
| 3 | 区分发言人 / 说话人模式 | `audio_analyzer.run_diarization`（缺 HF_TOKEN/pyannote 时 graceful 返 None）、`assign_speakers_to_segments`、`speaker_map`、`update_speaker_map` 端点；但 `VideoResultTranscriptLine` 无 speaker、`LNTranscriptPanel` 无 UI | 后端串 speaker 进视频转录；前端条件式 tab | VN5 |
| 4 | 生成中页够简单（5 步） | 已有 `StepProgress`+`deriveSteps`+`LiveLog`；进度 0–1 float；pipeline 步骤 = download/transcribe/analyze/note | 核对 5 步映射；技术日志折进高级详情 | VN3 |
| 5 | 结果页保留可编辑 | NoteShell 已 Milkdown 三列联动 | ✅ 保留 | — |
| 6 | v1/v2 版本切换 | `ItemSummary.version` + `list_summaries`(按 version) + `create_summary`(`next_version_for_template` 自增) 全有；SummariesTab 已内嵌 | 顶栏版本快切；重新生成=新版本 | VN4 |
| 7 | 导出：md/原文/PDF/Word/长图/PPT/沉浸式 | NoteShell 下拉只有 md+Obsidian；转录导出端点已存在(`format`+`with_speaker`) | 接线 md/原文/Obsidian；其余**禁用占位** | VN4 |
| 8 | AI 工具：原文对照/思维导图/海报/重新生成 | 原文对照面板 + AI chat 已有；导图/海报无 | 接线原文对照+重新生成；导图/海报**占位** | VN4 |
| 9 | 原文对照顶部直接导出 | 转录导出端点已有；面板无按钮 | 加按钮接现有端点 | VN5 |
| 10 | 左侧功能栏 + 合集 | 侧栏存在 | 文案改名 + 合集入口 | VN1 |
| 11 | 译文模式 | 无翻译链路 | **占位**灰显 | VN5 |

**结论**：Codex 原型在视觉/概念层覆盖完整，未细化的全是工程落地（字段/状态映射/降级/版本复用/导出真伪/错误态）——本计划补齐。

---

## 一·补 · 结果页结构澄清（VN4/VN5 改哪个页 —— 2026-06-19 用户纠偏）

Nibi 有两套结果页，**VN4/VN5 只在第一套（笔记结果页）增量改，不碰第二套（复刻页）**：

| 页面 | 路由 | 文件 | 说明 | 本计划 |
|---|---|---|---|---|
| **笔记结果页（统一）** | `/note` | `pages/result/NoteShell/index.tsx` | 视频笔记 + 图文笔记的实际消费页，内部 `isVideoNote`(L895) / `isImageNote`(L1016) 两分支 | ✅ 在此增量改 |
| 复刻页（旧独立结果页） | `/video_detail`、`/image_detail` | `VideoResultPage.tsx`、`ImageResultPage.tsx` | H 系列 1:1 复刻设计稿，主要给「复刻 / replica」任务走 | ❌ 不碰 |

落点要点：
- BiliNote 复刻原型 HTML 仅作**视觉参考**，不照搬重做 NoteShell 布局。
- NoteShell **顶栏区（约 L820–892）视频/图文两分支共用** → 版本下拉 / 导出菜单 / AI 工具放顶栏，两类笔记一次通吃，不用各写一遍。
- **视频专属**（仅 `isVideoNote` 分支）：视频 banner+原视频跳转、原文对照说话人模式（图文无 transcript/视频，不显示这些）。
- 两分支都已内嵌 `SummariesTab`（版本面板已存在），VN4 版本快切复用它，不新造。

---

## 二、分阶段实施计划（每 phase = 1 commit/会话；mimo 逐张开工卡执行）

- **VN1 · 合集语义 + 侧栏 + 合集浏览页** [简单·mimo]
  UI 文案「工作空间/素材」→显示「合集/笔记」（只改 label，不改变量/接口）；侧栏「合集」入口 → 新增 `CollectionsPage`（复用 `listWorkspaces` 数据 → 合集卡片网格 + 「未归类」收纳态）。
- **VN2 · 新建视频笔记弹窗（三段式 + 即时视频卡）** [mimo，UI 多]
  AddMaterialModal 重排 ①视频源 / ②生成设置 / ③输出与归类；①粘贴后渲染富视频卡（封面/标题/平台/时长/「链接有效」）；②风格(接 templates)+画面理解+补充说明+**区分发言人开关**(仅 UI+payload)；③存入合集+导出预设；sniff 失败/空态处理。
- **VN3 · 处理中页简洁化 + 5 步映射** [mimo]
  默认只显示 视频卡+「正在生成」+预计剩余+5 步进度+友好提示；映射：排队=PENDING / 下载=download(0.02–0.10) / 转录=transcribe(0.10–0.30) / 生成=analyze+note(0.30–0.99) / 完成=SUCCESS；LiveLog+资源指标折进「高级详情」；FAILED→重试、CANCELLED→可重新生成、保留 AWAITING_CONFIRM。
- **VN4 · 结果页工具栏（NoteShell 共用顶栏 + 视频专属 banner）** [需 Claude 协助·跨文件多]
  改 `NoteShell/index.tsx`（不碰复刻页）。**共用顶栏(L820–892，视频+图文都受益)**：版本下拉(读 list_summaries 点选切换；重新生成=create_summary 新版本不覆盖)、导出菜单接线 md/原文/Obsidian + 其余禁用占位、AI 工具菜单接线原文对照+重新生成 + 导图/海报占位。**视频专属(isVideoNote 分支 L895)**：视频 banner + 原视频跳转。
- **VN5 · 原文对照说话人模式 + 顶部导出（仅 isVideoNote 分支）** [需 Claude 协助·改后端]
  只动视频笔记分支（图文无转录不涉及）。后端：transcript 组装(`workspaces.py` ~2294 normalize_transcript / transcript_segments)透传 `speaker`；前端 `VideoResultTranscriptLine.speaker?` + LNTranscriptPanel 模式 tab（说话人**仅有数据才显示**、原文默认、译文占位）+ 顶部导出按钮接 `format/with_speaker` 端点。
- **VN6 · 教程 contract 调优 + 回归** [可独立排期]
  确认教程类(`lecture`/`steps`)稳定输出 学完掌握/前置条件/步骤/常见坑/验收；视频默认走教程 contract；补窄测试 + 全链路回归。

> 顺序：VN1→VN2→VN3→VN4→VN5；VN6 可并行或最后。VN4/VN5 跨文件多，mimo 若改动超 5 文件或与计划不符，按 agent-roles §4 停下求证/升级 Claude。

---

## 二·补 · 笔记功能区分矩阵 + VN4/VN5 详细拆解（2026-06-19 用户要「区分笔记功能」）

> 前提：复刻(replica) 目前只是**占位按钮**，所有实际功能都做「笔记」。笔记分视频笔记 / 图文笔记两类，在 NoteShell 内 `isVideoNote`(L895) / `isImageNote`(L1016) 两分支渲染。

### 功能区分矩阵

| 结果页功能 | 视频笔记 | 图文笔记 | 落点 | 现状 | VN |
|---|---|---|---|---|---|
| 版本切换 v1/v2 | ✅ | ✅ | 共用顶栏 | SummariesTab 已有版本数据，无顶栏快切 | VN4.1 |
| 导出菜单 | ✅ | ✅ | 共用顶栏 | 仅 md+Obsidian | VN4.2 |
| AI 工具菜单 | ✅(含原文对照) | ✅(无原文对照) | 共用顶栏 | 问 AI 已有 | VN4.3 |
| 视频 banner + 原视频跳转 | ✅ | — | 视频分支(L895) | 无 | VN4.4 |
| 原文对照(transcript) | ✅ | — | 视频左列 | 已有，缺 speaker/导出 | VN5 |
| 说话人模式 | ✅ | — | 视频左列 | 无 | VN5 |
| 图集浏览 | — | ✅ | 图文左列 | 已有，**不动** | — |
| 正文编辑(Milkdown)/TOC | ✅ | ✅ | 中列 | 已有，保留 | — |
| 问 AI | FloatingAskAi | NoteChatDrawer | — | 已有，保留 | — |

区分原则：**共用顶栏(L820–892)** 放版本/导出/AI 工具 → 两类笔记一次通吃；**视频专属** = banner/原文对照/说话人；**图文专属** = 图集(不动)。

### VN4 详细拆解（结果页顶栏工具栏；共用 + 视频专属）

- **VN4.1 版本下拉**（共用顶栏）：读 `list_summaries` 列 v1/v2… 点选切换当前展示版本；复用 SummariesTab 版本数据不新造；「重新生成」→ `create_summary` 自增版本、不覆盖旧版。
- **VN4.2 导出菜单**（共用顶栏）：现有 md+Obsidian 上接线「原文对照(txt)」(视频可用，接 `format/with_speaker`)；PDF/Word/长图/PPT/沉浸式 = 禁用占位+tooltip。
- **VN4.3 AI 工具菜单**（共用顶栏）：原文对照(视频→聚焦 transcript；图文→该项不显示)、重新生成(带设置)、思维导图/总结海报 = 占位。
- **VN4.4 视频 banner**（仅 isVideoNote L895）：标题+平台+「原视频」跳转(复用 `note.media.video.url`/`source_url`)。

> VN4.1–4.4 都以前端为主，可逐个小 commit 交 mimo；建议顶栏(4.1–4.3)1–2 个 commit + banner(4.4)1 个 commit。

### VN5 详细拆解（原文对照说话人 + 导出；仅视频笔记）

- **VN5.1 后端 speaker 透传**：`workspaces.py` ~2294 normalize_transcript 把 segment 的 `speaker` 串进每行；确认 pipeline `assign_speakers_to_segments` 已写回 transcript_segments；加有/无 speaker 两路单测。
- **VN5.2 前端说话人模式**：`VideoResultTranscriptLine` 加 `speaker?`；`LNTranscriptPanel` 加模式 tab(说话人仅有数据才显示、原文默认、译文灰显占位) + 顶部「导出原文对照」按钮接 `format/with_speaker`。

---

## 三、需要改的文件列表

| Phase | 文件 |
|---|---|
| VN1 | 侧栏/AppShell 导航组件（含「工作台/知识库」的布局）；新增 `frontend/src/pages/CollectionsPage/index.tsx` + 路由；散落「工作空间/素材」label（grep 定位，只改显示文本） |
| VN2 | `frontend/src/components/workspace/AddMaterialModal.tsx`；`frontend/src/services/workspaces.ts`（`StagedConfig`/payload 加 `diarize`/`style`/`collection`）；视频卡 css |
| VN3 | `frontend/src/pages/result/ProcessingPage/index.tsx`；`.../ProcessingPage/ln.ts`(deriveSteps)；`StepProgress.tsx`；`__tests__/StepProgress.test.tsx` |
| VN4 | `pages/result/NoteShell/index.tsx`（**共用顶栏 L820–892**：版本/导出/AI 工具；**isVideoNote 分支 L895**：视频 banner）；`SummariesTab.tsx` / `NewSummaryModal.tsx`；`workspaces.ts`（接 list_summaries/转录导出）。**不碰 VideoResultPage/ImageResultPage 复刻页** |
| VN5 | `NoteShell` 的 **isVideoNote 分支**（视频专属）；`backend/app/routes/workspaces.py`（~2294 透传 speaker）；`backend/app/services/pipeline_tasks.py`（确认 assign_speakers 写回 transcript_segments）；`LNTranscriptPanel.tsx`；`workspaces.ts`（`VideoResultTranscriptLine.speaker?`）；说话人分组 css |
| VN6 | `backend/app/services/summary_templates.py` / `summary_generator.py`；`backend/tests/test_summary_generator.py` |

---

## 四、数据 / API 变更说明

**新增字段（无破坏、向后兼容）**
- transcript 行新增可选 `speaker?: str`（仅 diarization 产出时存在；前端按存在性降级）。
- preflight/start payload 透传可选 `diarize`(bool)——复用现有 `voiceprint→speaker_diarize` 通道(`workspaces.py` L1753 已有映射)，**不新增端点**。

**复用现有端点（零新增）**：`POST /sniff-url`、`/probe-duration`、`GET/POST .../summaries`(自增 version)、现有转录导出(`format`+`with_speaker`)、`PATCH .../speaker_map`。

**新增前端状态**：Modal(`diarizeOn`/`selectedStyle`/`selectedCollection`/`exportPreset`/卡片态)；NoteShell(`versionList`/`activeVersion`/菜单开合/占位 disabled)；Transcript(`transcriptMode`/`hasSpeaker`)。

**不变更**：DB schema、workspace/item 模型、auth/加密/key。占位功能（PDF/Word/长图/PPT/沉浸式/导图/海报/译文）**不接后端**，仅灰显「敬请期待」。

---

## 五、测试 / 验收清单

**自动化**：`StepProgress.test.tsx`(5 步映射)；`test_summary_generator.py`(教程 contract)；transcript speaker 透传单测(有/无两路)；前端 `tsc`+`pnpm build`；后端 `pytest`(`.venv`+`KMP_DUPLICATE_LIB_OK=TRUE`)。

**手动截图验收**（`./dev.sh` 起真实前后端，禁猜 API，对照原型分节）：
- [ ] VN1 侧栏「合集」→浏览页，卡片来自真实 workspace
- [ ] VN2 粘贴 B站链接 ≤几秒出现视频卡；三段式
- [ ] VN3 处理中默认简洁 5 步；高级详情可展开；FAILED 有重试
- [ ] VN4 版本下拉切 v1/v2；接线项可用、占位灰显；banner 跳原片
- [ ] VN5 无 speaker→只有原文模式无报错；顶部导出工作
- [ ] 回归：图文/音频/文本笔记 + 已合入 VLM-first 链路不破坏

每 phase 存 1 张关键截图(viewport)到 `docs/design/assets/bilinote-video-note/`。

---

## 六、给 mimo v2.5pro 的逐 Phase 执行提示词（开工卡）

> 通用头（每张卡都先贴这段）：
> ```text
> 你是执行者，只按本任务改代码。不要重新规划、不要全项目调查、不要开 subagent。
> 启动只跑：git status --short --branch && git log --oneline -5
> 只读与本任务直接相关文件；>300 行文件先 rg 定位再 sed 片段读。
> 完成后跑相关测试，提交一个 commit。核对该 commit 能否过审，必须在干净 checkout/worktree 上跑（先 stash 隔离其它未提交改动）——脏树全绿会掩盖 commit 破损。
> 最后回复：改了哪些文件（文件名须与 git diff 实际一致）、测试结果、commit hash，并给出可复制给 Codex 的审查提示词。
> 红线：不迁移 workspace/item、不改 DB schema、不装新依赖；只改显示文案不改变量名/接口；改动超 5 文件或与计划不符就停下求证。
> ```

**VN1 开工卡**：把 UI 可见的「工作空间/素材」文案改为「合集/笔记」（只改 label 字符串）；新建 `frontend/src/pages/CollectionsPage/index.tsx`，复用 `listWorkspaces` 渲染合集卡片网格（名称/笔记数/最近更新/标签 + 「未归类」态），侧栏「合集」入口指向它并注册路由。验收：侧栏进合集页、卡片真实数据、后端零改、`tsc` 过。

**VN2 开工卡**：重排 `AddMaterialModal.tsx` 为 ①视频源/②生成设置/③输出与归类；①粘贴后用现有 `sniffUrl`+`probeDuration` 渲染富视频卡（封面/标题/平台/时长/「链接有效」徽标）；②加笔记风格下拉(接 summary_templates)、区分发言人开关(仅 UI+payload `diarize`)、补充说明；③存入合集(workspace 选择)+导出预设；处理 sniff 失败/未输入空态。`workspaces.ts` 的 StagedConfig/payload 加可选字段透传。验收：B站链接出卡、三段式、`tsc` 过。

**VN3 开工卡**：`ProcessingPage/index.tsx` 默认只显示 视频卡+「正在生成」+预计剩余+5 步进度+提示；`ln.ts` 的 `deriveSteps` 按映射（排队=PENDING/下载=download/转录=transcribe/生成=analyze+note/完成=SUCCESS）；LiveLog+资源折进「高级详情」折叠；FAILED 加重试、CANCELLED 可重新生成。更新 `StepProgress.test.tsx`。验收：默认简洁、详情可展开、测试过。

**VN4 开工卡**[需 Claude 协助]：改 `pages/result/NoteShell/index.tsx`（**不是 VideoResultPage/ImageResultPage 复刻页**）。NoteShell 顶栏区(约 L820–892)是视频/图文**共用**的——放顶栏两类笔记一次通吃：版本下拉(读 `list_summaries` 列 v1/v2 点选切换；重新生成走 `create_summary` 新版本)、导出菜单接线 md/原文(txt)/Obsidian + PDF/Word/长图/PPT/沉浸式禁用占位+tooltip、AI 工具菜单接线原文对照(聚焦抽屉)+重新生成 + 导图/海报占位。视频 banner+原视频跳转只加在 `isVideoNote` 分支(L895)。复刻原型 HTML 仅视觉参考、别重做布局。**跨文件多，超 5 文件或卡住就升级 Claude**。验收：视频+图文笔记顶栏都出现版本/导出/AI 工具、占位灰显、视频笔记有 banner 跳转、复刻页(/video_detail)未被动。

**VN5 开工卡**[需 Claude 协助·改后端]：只动 NoteShell 的 `isVideoNote` 分支（视频笔记结果页；图文无转录不涉及，别动 isImageNote 分支）。后端 `workspaces.py` transcript 组装(~2294 normalize_transcript)透传 segment 的 `speaker`；前端 `VideoResultTranscriptLine` 加 `speaker?`，`LNTranscriptPanel.tsx` 加模式 tab（说话人**仅有数据显示**、原文默认、译文灰显占位）+ 顶部导出按钮接 `format/with_speaker`。加 speaker 透传单测。验收：无 speaker 不报错只有原文模式、导出工作、图文结果页不受影响、`pytest` 过。

**VN6 开工卡**：调 `summary_templates.py`/`summary_generator.py` 让教程类(`lecture`/`steps`)稳定输出 学完掌握/前置条件/步骤/常见坑/验收，视频默认走教程 contract；更新 `test_summary_generator.py`；跑全链路回归。验收：教程结构稳定、测试过。

---

## 七、落地与推进流程

1. ✅ 本文档已落地 `docs/plans/track-K-video-note-experience-upgrade.md`。
2. ✅ `docs/EXECUTION_PLAN.md` Track K 段已注册 K·VN1–VN6 六行待办。
3. 把 VN1 开工卡交给 mimo v2.5pro 终端执行。
4. 此后每 phase：mimo 执行 → Codex 审查（通过/不通过/需补充验证）→ 回 Claude 勾 EXECUTION_PLAN + 更新本文档 frontmatter `commits` + COMPLETED_WORK.md 追加。

> 风险边界：严守不迁移/不改 schema/不装依赖；文案只动显示层；占位明确灰显；每 phase 单独 commit 保 git 颗粒度。
