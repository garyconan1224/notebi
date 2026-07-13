# AI Handoff

## 当前执行指针（2026-07-12）

- **当前任务**：音频统一笔记页改造，重点是“区分说话人总结”。
- **执行计划**：[`docs/plans/audio-speaker-aware-result-page-2026-07-12.md`](plans/audio-speaker-aware-result-page-2026-07-12.md)，当前 `status: done`。
- **用户授权**：本轮用户明确授权 Codex 执行；该授权只覆盖上述计划，不改变其它任务的默认角色边界。
- **强制停点**：实际代码、数据结构、接口、依赖、产品行为与计划不一致时，必须立即停下询问用户，不得自行假设。
- **产品重点**：新建总结中增加“普通总结 / 区分说话人总结”方式选择；说话人重命名后自动生成新总结版本，旧版本保持不变。
- **保留范围**：播放器、真实波形、转写、字幕编辑/翻译/导出、说话人识别、总结版本、NoteBi 笔记编辑/章节/导出/问 AI 等现有音频能力。
- **移除范围**：音乐分析、音乐转写、音乐模式、提示词页、人声分离。
- **页面范围**：只统一音频 `/note` 与 `/audio_detail`；视频、图片、文字页面不改。
- **已完成**：P0-B 总结契约已接入 `summary_mode`；区分说话人总结会校验音频说话人片段并将说话人/时间码送入总结提示词，相关后端测试 74 passed。
- **已完成**：P0-C 基础链路已让显式 `summary_mode=speaker_aware` 先做说话人识别再生成摘要；默认普通总结不变，相关回归 19 passed。
- **已完成**：P0-D 说话人映射保存后会为现有区分说话人总结排队生成新版本，历史版本保持不变；后端测试 14 passed。
- **已完成**：P0-E 的总结入口部分已接入：音频结果页与音频 NoteShell 的新建总结弹窗支持“普通总结 / 区分说话人总结”，风格模板仍可选；前端 181 tests passed，build 通过。
- **已完成**：P0-E 音频 `/note` 单页结果流已接入播放器、章节、转录、总结、笔记区；`speaker_map` 刷新回显，点击说话人 chip 可重命名并触发新总结版本；旧 `/audio_detail`/`audio_result` 仅兼容重定向。
- **已完成**：P0-F 真实波形已接入后端 `waveform_peaks`（240 个 RMS 峰值），前端播放器优先渲染真实内容；音频峰值单测通过。
- **已完成**：P0-G 音频专属音乐分析、音乐转写、音乐模式、人声分离、提示词入口已移除；视频音乐和视频/图片视觉提示词保留。
- **已完成**：P0-H 结果页/处理页新增音频错误分类与建议，设置 → 分析默认偏好 → 音频错误说明提供原因卡片；前端 183 tests、build 通过。
- **当前决策**：音频统一使用 `/note`；`/audio_detail` 只做兼容跳转。以 NoteShell 音频分支承载音频结果页 UI 与全部 NoteBi 能力，不嵌套两个完整页面。
- **本轮验收结论**：P0-A～P0-I 已完成。`/notes`、设置页、真实音频 `/note` 浏览器 smoke 无控制台错误；旧 `/audio_detail` 最终重定向到 `/note`；新建总结可选普通/区分说话人；音频错误说明卡片可见；真实 `.m4a` 可生成 240 个非均匀波形峰值。
- **当前下一步**：等待用户验收反馈；除非用户提出新范围，不继续扩大音频清理或改动视频/图片流程。

Last updated: 2026-07-12（**当前指针，给所有 AI 工具优先读取**）

## 当前事实（2026-07-09）

- **项目位置**：`/Users/conan/Desktop/notebi`。这是从 `/Users/conan/Desktop/nibi` 拆出的 NoteBi 独立目录。
- **当前分支**：`codex/qa-notebi-bootstrap`。本仓库由 Codex 初始化为本地接力仓库；不要把它当成原 `/Users/conan/Desktop/nibi` 的工作树。
- **产品模式**：默认 `VITE_PRODUCT_MODE=notebi`，前端端口 `5181`，后端端口 `8001`。
- **启动入口**：
  - 用户双击：`启动 NoteBi.command`
  - 终端完整启动：`./start-notebi.command`
  - 终端快速开发启动：`./dev-notebi.sh`
  - 停止：`停止 NoteBi.command` 或 `./stop-notebi.command`
- **当前拆分计划**：`docs/plans/NoteBi_Phase1.md`。该计划来自原 Nibi 分支 `codex/notebi-replicabi-product-mode`，目标是保留 note 产品能力、隔离 replica/storyboard/director/prompt-format 等复刻能力。
- **已确认搬入的接力文件**：`CLAUDE.md`、`AGENTS.md`、`docs/rules/`、`docs/plans/NoteBi_Phase1.md`、`docs/OUTSTANDING_TASKS.md` 均已在本目录可用。
- **当前验证目标**：保证独立启动器能启动 NoteBi，并保留视频 / 音频相关测试入口。完成后以 `git log --oneline -5` 为事实来源更新本文件。

## 下一步候选（按优先级）

1. **继续 NoteBi Phase 1 验收**：按 `docs/plans/NoteBi_Phase1.md` 检查 product mode、kind filtering、replica cleanup、导航/设置/结果页隔离是否完整。
2. **做真实素材回归**：视频和音频处理链路需要用户提供或指定可用素材；无真实素材时只能跑 smoke/unit 测试，不能宣称完整业务通过。
3. **清理残留 Nibi 文案**：README、启动器、规则文档里的旧项目名只改协作/启动层；业务 UI 文案是否从 Nibi 统一换成 NoteBi，需要用户确认后再做。

## 当前禁止事项

- 不要把本目录当作 `/Users/conan/Desktop/nibi` 继续开发。
- 不要主动 push；本地接力仓库没有默认远端。
- 不要改 `.env` 里的密钥值，不要提交 `data/`、`.local/`、`.venv/`、`frontend/node_modules/`。
- 不要默认恢复 replica/storyboard/director/prompt-format 到 NoteBi 主导航。

---

## 归档参考：原 Nibi 当前事实（2026-07-03）

- **当前分支 `codex/opensource-prep`**（非 main，未 push）。以 `git log --oneline` 为准。
- **本会话（2026-07-03）主题：开源发布准备 + 收尾三批未提交功能。**
- **本会话新增 3 个 commit（分支 `codex/opensource-prep`）：**
  - `f210c7f` **feat(X接入)**：X/Twitter 帖子接入——`url_sniffer`/`platforms` 收录 x.com/twitter.com；`shared/twitter_share.py` 匿名抓取（syndication API 图文 + yt-dlp 视频）；`note_assembler` 将帖子正文作为「原帖背景」前置进 note.md；覆盖 `test_twitter_share` / `test_mixed_note_pipeline`。
  - `65582bb` **feat(字幕翻译)**：`LNTranscriptPanel` 翻译按钮 + 目标语言 + 落盘缓存；后端 `/workspaces` 翻译端点（分块+并发+模型候选+force 重译）；provider 增 request timeout 透传；覆盖 `test_transcript_translation`。
  - `96cf722` **chore(开源)**：CONTRIBUTING / SECURITY / SUPPORT + PR 模板 + frontend-build workflow + issue 模板/lint/qa-e2e 调整 + `docs/GITHUB_RELEASE_CHECKLIST.md`。
- **在此之前已提交（39848da 及以下）**：ASR 繁转简统一到 asr_router 出口、字幕翻译落盘、混合笔记前端入口、总结配图 Stage 4、`chore: prepare repository for open source`。
- **验证状态**：后端 `.venv/bin/pytest`（根 venv，非 backend/.venv）新增 4 组测试 **42 passed** ✅；前端 `pnpm build` ✅。⚠️ 注意：可用 venv 是**项目根 `.venv`**，`backend/.venv` 缺 faiss/httpx 不可用。
- **未做 commit 级独立过审**：3 个 commit 是按主题从同一棵工作树拆的，只验证了最终整树 build+测试；若 Codex 要逐 commit 审，需另开干净 worktree。
- **下一步**：开源发布清单（`docs/GITHUB_RELEASE_CHECKLIST.md`）——① 敏感信息扫描（rg 扫 key + gitleaks 扫历史）；② CI 三连 `py_compile`/`compileall`/前端 build；③ 建私有仓库→push→Actions 绿→最后转 public（**push 需用户明确点头**）。

---

## 当前事实（2026-07-02，已归档）

- **当前分支 `feat/global-knowledge`**（非 main）。以 `git log --oneline` 为准。
- **本会话（2026-07-02）已完成的四批 + 一个根因修复：**
  - **下载卡死根因修复**（`32858bf`）：`.local/backend_tasks.json` 曾达 40MB，每个进度 tick 全量重写 + fsync 把下载线程饿死到几十 B/s。修法=进度回调节流 + append_log 节流 + dev.sh 的 `--reload` 限定只监视 `backend/shared`。下载从 ETA 数小时 → 2.4–4.5s。
  - **A（task1-4）**：删资料库「批量分析」按钮(`005a61a`)、资料库头部删「查看合集」(`36dbb78`)、首页最近任务回归修复(`b224588`，list_tasks 改为只排除 trashed 工作空间)、合集详情精简+融合重做(`86bd255`/`d052878`/`df34fab`/`4e939e9`)。
  - **B（task5-7）**：task_store 改「一任务一文件」+ 迁移(`2865a50`)、清理测试任务(`d775df4` + `scripts/cleanup_test_tasks.py`)。374→79 真实任务。
  - **C（global-knowledge）**：导航删资料库/加全局知识库(`abd2423`)、嵌入+重排模型可配置(`548280d`)、全局知识库问答页(`c7f4869`)。
  - **D（本批，2026-07-02 待提交）**：知识库支持选合集范围(`workspace_ids`)、设置页供应商+模型合并+默认模型区、笔记按类型导出媒体（视频/音频/图）、复刻砍 story/compete 只留提示词复刻并打磨（卡片化+一键全复制+导出提示词脚本）。
- **Claude 验收本会话发现并修复的 bug**：`GET /providers` 因返回值改 dict 但返回类型注解仍是 list → 500；`services/providers.ts` 未适配 dict 结构会崩。两处已修，`/providers` 恢复 200，前端 build 通过。
- **验证状态**：前端 `npm run build` ✅；后端 import ✅(131 路由)；task_store/knowledge/provider 相关 pytest ✅；`/providers`、`/knowledge/ask(带范围)`、健康检查 ✅。
- **本会话计划文档**（docs/plans/）：`home-sync-download-speed-library-timeout-2026-07-02.md`、`library-header-recenttasks-collection-detail-2026-07-02.md`、`task-store-refactor-and-cleanup-2026-07-02.md`、`global-knowledge-nav-embedding-rerank-2026-07-02.md`、`knowledge-scope-settings-export-replica-2026-07-02.md`（均已执行）。
- **下一步**：① D 批 + 两处修复提交（待用户确认是否 push / merge）；② 待定新需求。复刻 story/compete 已砍；本地离线嵌入/重排模型留作后续。

---

### 📦 归档参考（2026-06-23 及更早）

> **2026-06-23 更新（④15 左侧导航重塑完成）；下方为 2026-06-21 及更早。**

- **基线 git `3ee64a2`（main）**；fix.py / fix_lint.py 已清理（2026-06-22）。
- **19 条手测反馈按分类推进**（来源 `docs/test-reports/manual-local-video-2026-06-21.md`）：
  - ✅ 阻断(17,1) + ① 封面/图/信息缺失(3,7,18,19) 全 **done**
  - ✅ ② 结果页编辑器：6,13,7b,图文升级,10,11,12 **done**（已执行待 Codex 审）
  - ✅ ④15 左侧导航重塑 **done**（`AppShell.tsx` 宽展开式导航 + 折叠/展开 localStorage 记住，6 可用 + 2 占位，Playwright 25+16 全绿）
  - ④ 添加布局：**2,14 待小米执行**（计划+提示词已给）；16 待规划
  - ③ 笔记风格(5,8,9)、📋 板块化(4)：待规划
- **当前下一步**：① 等小米回报 2/14（过 Codex 审）；② Claude 调研+计划 **④16 字幕直取**(B站/YouTube CC→pipeline 后端独立大功能) → **③5/8/9**(等10落地，与总结/版本交叉) → 📋4。

---

### 📦 归档参考（2026-06-21 及更早，非当前下一步）

- **本地视频 E2E 重测完成（2026-06-21 22:30）**：Bug #2 修复（commit `1225566`）经 Playwright 真实 UI 验证——路由修复生效（`/start` → `note` task），但 download 步骤暴露新 Bug #3：`_download_note_source` 本地分支查找 `{workspace_root}/videos/`，而上传文件在 `{workspace_root}/`（`pipeline_tasks.py:1334` vs `workspaces.py:1556`）。B/D 仍 ❌，需修 Bug #3 后再重测。报告 `docs/test-reports/e2e-2026-06-21.md`。
- **BiliNote 视频笔记改造主线（VN1–VN6）全部完成（2026-06-21）**：合集语义 / 新建弹窗三段式 / 处理页 5 步 / 结果页工具栏+视频 banner / 说话人透传+条件式 tab / 教程·会议·任务模板 contract 升级。计划 `docs/plans/track-K-video-note-experience-upgrade.md`（status: done）。同会话另修首页 Composer 上移、识别视频封面、最近任务卡封面、workspace 命名统一为「合集」。
- **结果页「占位」判断已勘误（2026-06-21 Claude 代码核实）**：下方「用户最新产品判断」称"只有视频完整、音频/图片/文本结果页占位"——**已过期失真**。实测 `AudioResultPage` / `ImageResultPage` / `TextResultPage` **均功能丰富、已注册路由、零占位/TODO 痕迹**（波形播放/说话人改名/逐句字幕编辑/字幕导出/正文编辑保存/联想·改写·翻译/版本栈/多文对比…）。原「Step 3 占位→可用」基本无事可做；真正可选的演进是把 NoteShell 统一笔记从 beta 升为默认入口（更大产品决策，未定）。
- **Milkdown 图片渲染误报已勘误（2026-06-17，`7780f27`）**：`docs/plans/track-K-milkdown-image-render.md` 浏览器实锤复核，ProseMirror DOM img=7（抖音）/ img=4（B站②），非产品 bug，是 E2E 断言时机误报。已更新 E2E 报告，计划卡归档 done。
- **Step 2 E2E 全流程回归已完成（2026-06-16～17）**：抖音（带图+不带图）、B站②（带图+不带图）、小红书（图文）三平台实测均通过；YouTube/本地视频未测（用户未提供素材）。报告 `docs/test-reports/e2e-2026-06-16.md`。~~已知遗留：时间戳 chip click seek 不生效（DOM 元素存在但 currentTime 不变）~~ → **已复核（2026-06-17）：产品正常，原失败为 E2E 脚本 JS 合成 click 误报（ProseMirror 需真实 mousedown→click 事件链，JS 合成 click 绕过了内部状态初始化）**。B站②带图 item workspaceId 完整 UUID：`26965fa0-f14e-490f-8413-6c8244f784ab`。
- **Track K「E2E 收口 + 总结时间戳锚点」已合入 main（2026-06-16，`e6a76e2`→`5643a55`）**：Milkdown 集成后又做两批——①k-summary 标准总结在 `##`/`###` 标题嵌真实 `[mm:ss]` 跳转锚点（修全 00:00、6 模板精简、md源码视图也可点击跳转）；②E2E 测试测出的 7 个收口修复（转写时间戳 `[Xs]→[mm:ss]`、静态URL `quote` 编码修 hashtag 文件名 404、截图插入在 Milkdown 模式可用、问AI钮避让、gitignore 截图产物、补 `a4b8359` 漏改的测试断言）。后端 pytest 全绿 + 前端 build 通过。收口卡 `docs/plans/track-K-commit-e2e-fixes.md`。
- **Milkdown 所见即所得编辑器三阶段集成已合入 main（2026-06-12，`ec4f574`→`e7dfe66`）**：视频笔记 NoteShell 从「富文本只读 + CodeMirror 源码」升级为 Milkdown WYSIWYG 直接编辑；保留 md格式/源md对照/导出/自动保存，时间码 `[mm:ss]` 可点击跳转视频且落盘裸文本。过程修复光标跳走、首次编辑不保存、时间码转义、dead code 阻塞 build 四个边界 bug，build + 128 测试 + playwright 全验过。计划见 `docs/plans/track-K-milkdown-integration.md`。
- **Track K 视频笔记「入口收敛 + 回归修复」已合入 main**：阶段 A-E + R1-R4 + 9.x 布局 + segment_refiner + R3 标准总结已完成。
- **协作分工已调整**：Claude 桌面版 Code 做计划/调查/写小米执行提示词；Claude Code 终端 + 小米 v2.5pro 做实际代码、测试、commit；Codex 做验收审查。
- **用户最新产品判断**：结果页目前只有视频完整；音频/图片/文本结果页仍可视为后续功能完成项。内容多走 RAG，内容少走 search；`av_synthesis` 与 `music_teaching` 和当前笔记能力重复，暂不继续。
- **现场状态以 git 为准**：新会话先跑 `git status --short --branch && git log --oneline -5`。如果有未提交改动，先判断是否属于本次任务，不要擅自覆盖。

## 下一步候选（按优先级）

1. **修 Bug #3 + 重测本地视频 B/D**：`_download_note_source` 本地分支查找目录错误（`pipeline_tasks.py:1334` 查 `{ws}/videos/`，文件在 `{ws}/`）。修好后用同素材重测 B（带图）/ D（不带图）。**当前唯一明确待办**。
2. ~~Step 3：音频/图片/文本结果页从占位走向可用~~ → **已勘误（2026-06-21）：三页实际已丰富、非占位，此项基本无任务**。若要演进 = NoteShell 统一笔记 beta 升默认入口（更大决策，需用户先定）。

## 归档禁止事项

- 不要默认全项目体检、通读全部代码、并行调研或开多个 subagent。
- 不要只看本文件下面的历史日志决定下一步。
- 不要把 `docs/ROADMAP.md` / `docs/EXECUTION_PLAN.md` 当启动必读全文；需要时按关键词片段读取。
- Claude 桌面做完计划后，必须给出可直接复制给小米 v2.5pro 的执行提示词；小米完成后，必须给出可直接复制给 Codex 的审查提示词。

---

## 历史日志（归档，不作为当前下一步依据）

以下内容仅保留历史记录。判断当前任务时，优先看上方“当前事实 / 下一步候选 / 当前禁止事项”。

## 🟢 当前状态（2026-06-02）

**全部主线工作已合入 `main`，工作区干净，不 push origin。F1（IP.9 流程缺口补齐）阶段的 F3.1 / F3.2 已落地。**

主干（输入链接 → 任务 → 文字 / 图片 / 音频 / 视频落地 → 结果页 → 浮动任务面板）已端到端打通。最近两步：

- **F3.1**（`47d63e4`）：VLM 帧分析停滞检测，疑似限流时提示用户（底层 `sf_client` 已自动重试）✅
- **F3.2**（`7bea1dd`）：浮动任务面板失败展示复用 `errorCategories` 友好文案 + 原始错误 tooltip ✅

**剩余（都不急，按 ROADMAP §2+§11 决定优先级）**：

1. **[C] 复刻 · AI 导演** —— ⛔ 阻塞：需先补设计稿，未动工。
2. **[D] 开源准备** —— 未动工。
3. **F3.1 可选增强**：把「停滞**推断**」升级成「**确知**限流透出」（拿到真实限流信号再提示，而非靠超时推断）；属未来增强，非必须。

**下一步指引**：新会话先跑 `git log --oneline -20` 对账，再打开 `docs/ROADMAP.md` §2（6-track 全景）+ §11（推荐顺序）决定做哪个，**不要只看本文件「下一步」旧段拍脑袋**（下方 5-22 的清单是历史日志，已过期，仅留档）。

---

## 启动必读

每次新会话先对账，不要直接相信本文件：

```bash
git status --short --branch
git log --oneline -10
git branch --show-current
```

然后按顺序读：

1. `AGENTS.md`
2. `docs/WORKFLOW.md`
3. `docs/SPEC.md`
4. `docs/EXECUTION_PLAN.md`
5. **`docs/ROADMAP.md`**（2026-05-21 新增——长期升级路线图，6 条 track 全景视图）
6. `docs/design/`（如需视觉对照）
7. 本文件「下一步」段

涉及用户流程图时，Claude Code 终端先读 `docs/flows/README.md` 和对应 `docs/flows/*.md`，必要时再看 PNG。

---

## 2026-05-20 一日完成清单

**H 系列设计稿 1:1 复刻**（merge 入 main）：
- H1 Workbench 工作台首页（5 子任务）
- H2 Taskboard 任务中心 9 Tab（4 子任务）
- H3 Processing 处理中（含 SSE 接线）
- H4 Results 4 子结果页（视/音/图/文 CSS 改造）
- H5 Storyboard 分镜页（D2 方案 A markdown 直展，shot 网格留 [C]）

**Integration Pass（IP.1~IP.8）**——把"死按钮死参数"全部接通：
- IP.1 Composer 高级参数透传到 Preflight
- IP.2 Composer 上传按钮接 AddMaterialModal
- IP.3 TaskboardHead 编辑背景接 BackgroundEditor
- IP.4 TagsTab 加编辑能力
- IP.5 Storyboard 触发入口（MaterialCard 菜单）
- IP.6 Composer 工作空间选择真传后端
- IP.7 **PreflightDrawer 真接 workspace 流程 + LLM 自动建空间**（修阻塞 bug）
- IP.8 Connection Audit：Compare Tab / 顶栏 system stats / 提示词风格 select / 资料库入口 / 快速抽字幕 / N4 复核

**清理与修复**：
- 后端 bug：TaskRunner.append_log 缺失（download 任务从此能跑）
- IP.8.6-fix：N4 默认勾选 4 处对齐设计稿
- H2.6：删除旧 WorkspaceDetail.tsx + WorkspaceSearchBar.tsx（-680 行）

**当前 local main**：`7ec9914 merge: feat/phase-r11-design-sync-canonicalize into main`；R12 在 `feat/phase-r12-processing-page-replica` 完成，尚未 merge。

---

## 2026-05-21 调整方向

用户决议：**不去 [C] / [D]**，先把现有功能跟流程图对齐打磨。流程图文本镜像在 `docs/flows/*.md`，源 PNG 在 `docs/conversation-inputs/2026-05-18-spec-merge/`。新长期路线图 `docs/ROADMAP.md` 6 条 track 已落盘。

**IP.9 Flow Gaps 已完成**（5 个 commit 合入 main）：
- IP.9.1 Results 总览页（s05）+ 修跳转 bug + 路由重命名
- IP.9.2 N8b 音频前端 6 任务勾选 + 结果页对应区块
- IP.9.3 N7b 视频路径选择 UI（3 路径 + 视频类型模板）
- IP.9.fix align Tier A UI with pipeline payloads

**N7b 路径 1 已完成**（2026-05-21，3 个 commit 合入 main）：
- `f17c04a` feat(N7b): 视频路径 1 字幕直接总结后端
- `aac4578` fix(N7b): ResultsOverview 正确返回路径 1 字幕总结结果
- `9e8667e` fix(N7b): transcript 数组契约修复 + 前端防御 + 测试
- transcript 数组契约已对齐（string → VideoResultTranscriptLine[]）

**N7b 路径 1 UI 收口**（2026-05-21）：
- PreflightDrawer 加摘要路径选择（tasks.summary.path = "subtitle"）
- VideoResultPage 路径 1 空态修复（字幕总结模式：summary + transcript 展示）
- VideoResult 类型扩展（summary_path / summary / video_template）
- 文档残留修复（待提交 → 9e8667e）

**N7b 路径 3 骨架已联调**：PROCESSING→ACTIVE 轮询 + JSON fence 容错 + 中文文件名处理已实现并合入 main。真实视频 generate_content 受 Gemini free tier 视频配额限制（503/429），需升级付费或换时段重试。
**N8b 待实现**：音频 librosa 分析（6 维度切分）

具体执行索引去 `docs/ROADMAP.md` §3~§8 看对应 track，再去 plan md 看子任务步骤。

---

## 下一步（按 ROI 排序，明天接力会话直接选）

### 🥇 当前立即下一步：E2E bugfix S0（音视频端到端冒烟已跑，7 问题待修）

- E2E 报告：[`docs/e2e-test/E2E_TEST_REPORT.md`](e2e-test/E2E_TEST_REPORT.md)（已 commit `267d426`，含 29 张截图 + Opus 4.7 用 codegraph 定位的 P1 根因）
- 修复计划：[`docs/plans/phase-e2e-bugfix-2026-05-29.md`](plans/phase-e2e-bugfix-2026-05-29.md)（S0.1-S0.8，每个 step 独立分支）
- 必修：S0.1 `/subtitles` 删 demo 兜底 + S0.2 audio_result 认 transcript_segments + S0.3 visual_only 禁 SRT 按钮 + S0.4 ResultsOverview React key
- 然后进 [`phase-handoff-mimo-2026-05-29.md`](plans/phase-handoff-mimo-2026-05-29.md) S1 清理 → S6 R20
- N7b 路径3 Gemini 骨架已联调（PROCESSING→ACTIVE + JSON fence + 中文文件名），**真实视频 generate_content 受 free tier 配额限制**，需付费升级或换时段重试

### ✅ Phase L 资料库聚合页（2026-05-22 已完成）

- L1~L4 全部合入 main（`826c311` / `249e2f0` / `d5e5a7e` / `cd41720`）
- 侧边栏「资料库」已从 `/search` 改为 `/library`
- 功能：chip 筛选（全部/视频/音频/图片/文字/工作空间） + 6 种排序 + grid/list 切换 + 状态持久化
- ItemCard → Results / WorkspaceCard → Taskboard 下钻正常
- 缩略图优先级链：平台封面 > 视频首帧 > 类型图标
- 批量删除 + 单项删除 + 选择模式（进入选择模式不自动全选，点卡片任意位置切换选中）
- 验证：后端 pytest / 前端 test / 前端 build / `/library` 浏览器结构化冒烟通过；full lint 仍被项目存量规则挡住

### ✅ F1.6 字幕清洗基础版（2026-05-22 已完成）

- `shared/transcript_cleaner.py`：规则去填充词 + 去重复行 + 合并短句 + LLM 润色（修错字/标点/专有名词）
- 已集成到 `_run_subtitle_summary()` 路径 1 流程：ASR → 清洗 → 总结
- 26 个单测全绿，163 个后端测试无回归
- Commit：`629fe60 fix(F1.6): allow subtitle path without API key`

### ✅ F2 路径 1 时间戳 + duration 修复（2026-05-22 已完成）

- `2700349` fix(F2): 路径 1 transcript 时间戳丢失——Whisper segments 保留并透传
- `b9eab81` fix(F2): align cleaned transcript text with segments
- `653c286` fix(F2): propagate subtitle path duration to result
  - `_run_subtitle_summary` 返回 `duration_sec`（从 segments 最大 end 推导）
  - `get_item_result` 透传到 `video.duration_sec` 和 `tracks_meta.total_sec`
  - 旧数据（无 duration_sec）fallback 到 0
- `7efd459` fix(test): e2e_qa.py 适配当前 FastAPI 架构（移除 Streamlit 遗留引用）
- `6502b3a` docs: AGENTS.md 补充项目指令 section header
- 169 个后端测试全绿，e2e_qa 12/12 全通过

### ✅ F2 Bug3 yt-dlp 格式降级重试（2026-05-22 已完成）

- `shared/video_download_ytdlp.py`：`run_ytdlp_download()` 增加格式降级链
  - 降级顺序：首选格式 → `bv*+ba/b`（B站 DASH）→ `bestvideo+bestaudio/best`（YouTube DASH）→ `worst`（兜底）
  - 每个格式尝试完整的 cookie/proxy/browser 组合后再降级
  - 所有格式失败时 `error_full` 包含完整降级链路信息
- `tests/backend/test_video_download_ytdlp.py`：6 个单测覆盖首选成功、fallback 成功、全失败保留错误、去重、非可重试错误触发降级
- **冒烟测试**：真实 B站 URL `BV1qA5j6jEJC` 下载成功
  - `best` 格式在 B站不可用（6 次 attempt 均 "format not available"）
  - B站 format-stripping 自动降级成功 → 产出 AV1 852×480 / 2.4 MB / 70.8s
  - 175 个后端测试全绿（+6 new），e2e_qa 12/12 全通过
- **Commit**：`53620b9` fix(F2): yt-dlp format fallback retry chain

### ✅ F1.7 URL 规整 + 真实前端冒烟（2026-05-22 已完成）

- 前端 `frontend/src/lib/url.ts`：`normalizeMediaUrl()` 处理纯 BV 号/缺 scheme/追踪参数/尾斜杠
- 后端 `_normalize_media_url()` + `_normalize_url_for_dedup()` 兜底
- `platforms.ts::detectPlatform()` scheme 容错
- 冒烟验证：后端 curl 确认追踪参数被剥离；前端平台检测 Bilibili 正确
- 新增 15 个单测（前端 6 + 后端 9），全量 183 通过
- **Commit**：`170ec0b` feat(F1.7): URL 规整——前后端双端清洗追踪参数 + 去重标准化

### ✅ F2 真端到端冒烟测试（2026-05-22 已完成 8/10）

**结果**：8/10 URL 通过，3 个 Bug 已修。详细记录在 `docs/plans/archive/phase-f2-smoke.md`。

**已修 Bug**：
- `00bc28c` Bug A：task_runner 硬编码 DOWNLOAD → 按 task_type 映射初始状态
- `489cc76` Bug B：preflight 布尔型标志未触发 N7b 路径 → 兜底 `summary_path="subtitle"`
- `c366226` Bug C：本地文件显示名覆盖实际文件名 → local source 始终用 source_value 取文件名

**URL 验证结果**：
| # | 平台 | 状态 |
|---|------|------|
| 1-3 | B站 x3 | ✅ 全链路通 |
| 4 | YouTube | ✅ 代理已配，N7b 通 |
| 5 | YouTube Shorts | ✅ VLM 路径（空 preflight 默认 VLM 非 N7b，已知行为） |
| 6-8 | 小红书/抖音/微信 | ⏳ 缺真实 URL |
| 9 | 本地 .mp4 | ✅ N7b 路径1，转录+总结正确 |
| 10 | 本地 .mp3 | ✅ 音频管道通，VAD 对歌曲误判（known limitation） |

### ✅ V2.2/V2.3 视频输出格式选择 + 提示词模板（2026-05-23 已完成）

- V2.2 输出格式 UI：PreflightDrawer 路径 1 增加 4 种格式 radio（摘要/要点/金句/段落改写）
- V2.3 后端 4 套 prompt 模板：`_OUTPUT_FORMAT_PROMPTS` dict，`_build_video_summary_prompt` 按 `output_format` 切换
- `output_format` 通过 preflight → `_augment_video_analyze_payload` → `_run_subtitle_summary` 全链路透传
- 旧数据兼容：未传 `output_format` 默认 `summary`（原摘要逻辑）
- 新增 5 个测试，全量 239 后端 test + 15 前端 test + build 通过

### ✅ V3.2 视频模板设置页 CRUD（2026-05-23 已完成）

- `shared/template_store.py`：JSON 持久化层，CRUD + duplicate
- `backend/app/routes/templates.py`：5 个端点（GET/POST/PUT/DELETE/duplicate）
- `backend/app/services/pipeline_tasks.py`：`list_video_templates()` 合并内置 + 用户自定义
- `frontend/src/pages/SettingPage/VideoTemplatesPage.tsx`：列表 + 新建/编辑模态 + 内置保护
- `frontend/src/store/templateStore.ts`：zustand 缓存，PreflightDrawer 自动拉取
- 路由 `/settings/video-templates` + SettingsShell Tab 已注册
- 测试：20 个 V3.2 后端测试覆盖 CRUD happy/error/空白输入路径，全量 259 passed / 2 skipped
- `_build_video_summary_prompt` 已改用 `list_video_templates()` 动态模板

### ✅ V3.3 LLM 自动检测视频模板（2026-05-23 已完成）

- `backend/app/services/pipeline_tasks.py`：新增 `_detect_video_template(title, transcript_preview)`，用默认 LLM 单轮分类，失败兜底 `其它`
- `_run_subtitle_summary`：`video_template="auto"` 时先检测，再把 `detected_template` 写入 task result
- `PreflightDrawer`：路径 1 默认提交 `video_template="auto"`，不点下拉即可触发自动检测
- `VideoResultPage`：有检测结果时显示「自动识别：xxx」
- 测试：后端全量 265 passed / 2 skipped；前端 build + vitest 通过；full lint 仍被 47 个存量 error 挡住
- 已知后续增强：同一 item 重新执行时暂不缓存检测结果，会重新调用一次 LLM

### 🥇 下一步：Track A 音频深化

按 `docs/ROADMAP.md` §11，V2 + V3 完成后继续做 **A2 + A3 + A4（音频深化）**；`[C] AI 导演` 与 `[D] 开源准备` 仍排在后面，暂不启动。

### ✅ A4 字幕导出（2026-05-23 已完成）

- 后端：`GET /workspaces/{workspace_id}/items/{item_id}/subtitles?format=srt|vtt|ass`
- 格式：`.srt` / `.vtt` / `.ass`，支持 `segments` / `transcript_segments` / display `transcript(t_sec)` 三类结果结构
- 数据源：优先读 task overlay，其次读 `item.results`；demo result 页有占位字幕时，导出端点也保持一致 fallback
- 前端：AudioResultPage / VideoResultPage 增加「字幕」下拉导出按钮
- 额外修复：`auto-create` 去掉同步 LLM 命名，避免 15s 前端超时
- 验证：后端全量 268 passed / 2 skipped；前端 build + vitest 通过；full lint 仍被 47 个存量 error 挡住

### ✅ A3 无人声切音乐模式（2026-05-23 已完成）

- 后端：`AWAITING_CONFIRM` 状态 + `POST /pipeline/tasks/{id}/confirm-music` 端点 + 任务重提交机制
- VAD 分叉：speech_ratio < 20% + 未勾音乐分析 → 弹窗；已勾 → 直接音乐分析；music_mode_confirmed 重跑 → 跳过 ASR
- A3.3：`segment_audio()` + `analyze_music_segments()`（librosa onset + RMS 能量分段）+ 前端分段卡片网格（6 维度）
- 前端：`MusicModeConfirmModal`（Radix Dialog）+ ProcessingPage 接入 + AudioResultPage banner + 默认 music tab
- LLM 逐段 enrich（风格/情绪/乐器/氛围）留作 A3.3b 后续
- 测试：11 个 A3 单测通过；全量 279 passed / 2 skipped

单 agent 串行建议：
1. **Track T 文字深化**：先做 T1 文字结果页升级。用户已拍板两条硬要求：
   - 点击金句 / 要点必须精确跳到左侧原文位置；金句需 substring 校验，要点需 `source_excerpt` 锚点，不能做近似跳转。
   - 「改写 · 翻译」tab 内做逐段对照：左原文段落，右当前改写 / 译文，按段落序号稳定对齐。

### 🥈 补 #6~#8 URL + 收口 F2

用户提供小红书、抖音、微信公众号各一个真实 URL，跑完 F2 剩余 3 个，然后：
1. 更新 `phase-f2-smoke.md` 完工标准全打勾
2. ROADMAP §3 F2 打 `[x]`
3. 决策下一步：F3 错误体验优化 或 A1/V1/I1 并行

### 🥉 路线选择（待定）

**路线 A：[C] AI 导演**（4-7 天，Opus 体力活）
- 需先补完整 director 设计（当前 system_design v1.1 缺交互细节）
- 拍板生成模型 API 选型（Midjourney / Flux / SD / Sora）
- 内容：Style 报告 + Storyboard shot 网格升级 + 生成预览 + .fcpxml 导出 + A/B Compare 视频版

**路线 B：[D] 开源准备**（2-3 天）
- 加密 / CI / push 策略解除 / 仓库整理
- 让项目能被外人 clone 跑起来
- 是 v1.0.0 发布的前置

### 🥉 独立小活（任意穿插，不影响冒烟路线）

- **N7b 路径 3** 视频模型直接分析（骨架已联调，真实视频 generate_content 受 Gemini free tier 配额限制）
- **N8b** 音频前端交互（6-8h，无人声切音乐弹窗 / 说话人修正 / 6 维度切分）

---

## 决策与约定速查

- **Push 策略**：暂缓所有 `git push origin`，等做到 `[D]` 阶段统一推。本地 main 越来越领先 origin/main 是预期状态
- **Phase merge 默认**：完工默认 merge 进 main，开新 phase 默认上一个已 merge
- **Tag 策略**：不按 SemVer 自动打，等"功能都差不多"统一打（那时就是开源时刻）
- **模型分配**：
  - 简单/模板/git/CSS → ⭐ deepseek v4-pro（Claude Code + ccswitch，便宜优先；v4-flash 太弱别当默认）
  - 中等多文件 React → Sonnet 4.6
  - 跨 5+ 文件 / 状态机 / 加密 → Opus 4.7
- **设计稿源**：当前 Nibi 视觉以 Open Design 导出的本地原型和 `frontend/src/styles/nibi-tokens.css` 为准；`docs/design/` 只作为旧设计快照参考

---

## 已知风险 / TODO

- N7b / N8b 仍延后，独立可做
- StoryboardPage 当前是 markdown 直展，shot-by-shot 网格留给 [C]
- 「导出 .fcpxml」/「生成预览」按钮显式禁用 + PHASE C pill
- 视频对比（image_compare / text_compare 已通，但视频/音频对比后端无接口）
- 设计稿「12 屏概览」/ AI 导演侧栏 仍禁用，等 [C]
