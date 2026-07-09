---
title: Track K · 视频笔记「入口收敛 + 回归修复」计划（交付 mimo v2.5 pro 执行）
status: done
owner: mimo（执行）/ 用户（拍板）
created: 2026-06-08
completed_date: 2026-06-11
strategy: 用户 2026-06-08 已定 —— **不重写、不新建项目**；在现有项目（后端 1.7w 行 / 前端 3.5w 行 / 884 提交）做**彻底删除式收敛**：保留所有底层能力，删掉多余创建入口与旧路径，只留「生成笔记 → note task → NoteShell」一套。再对齐 B 站流程修回归。
relates:
  - docs/plans/track-K-note-flow-blueprint.md（蓝图：内容处理 §2 + 视频 UI §3.5 + 差距清单附录 D）
  - 标杆：B 站视频（错误最少，作流程基准）+ ln 学习笔记页（播放/截帧/时间码能用，作能力来源）
---

# 0. 给 mimo 的总则（必读 · 红线）

1. **战略是「删除式收敛」，不是重写**。底层能力（下载器/ASR/VLM/note_assembler/NoteShell/导出/知识库）**全部保留**；删的只是「多余创建入口 + 旧的并行路径」。
2. **区分「能力」与「入口/路径」**——这是本计划最重要的判断：
   - ❌ 删：手动分析模式、音视频综合、课程笔记入口、独立 analyze 两段式链、旧结果页的笔记入口。
   - ✅ 留：`analyze`（截帧 VLM）作为 note task 的 **step**、ln 的能力组件（LNVideoPanel/HtmlView/MdView）、所有下载器/适配器、note_assembler、导出。
3. **删除安全协议**（每次删之前）：先 `grep -rn "<符号>" frontend/src backend` 看所有引用 → 改/删引用 → 再删定义 → `npx tsc --noEmit` + `pytest`（KMP_DUPLICATE_LIB_OK=TRUE .venv）→ 一步一 commit。
4. **改动前先解释、改完 1-2 句总结**；与本文不符、或要删的东西仍被别处使用，**停下问用户**（用户是编程新手）。
5. 工作区已有改动**保留**：① 6 个在途修复（video.url / LLM 注入 / b23 短链 / 图片渲染等）② 小红书视频分流（[pipeline_tasks.py:1273](backend/app/services/pipeline_tasks.py:1273)）。

---

# 1. 目标终态（一句话）

**加任何链接/文件 → 只有「生成笔记」一个入口 → 一个 note task（download→transcribe→analyze→note）→ NoteShell 展示**。视频笔记达到 ln 水平：单任务、标题对、能播放、能截帧入 md、能时间码跳转。

---

# 2. 现状·乱在哪（已核对代码）

- **创建端两套**：① noteMode「生成笔记」零配置（[AddMaterialModal.tsx:886](frontend/src/components/workspace/AddMaterialModal.tsx:886)）→ note task；② 手动选类型+勾分析（含音视频综合）→ analyze 两段式。
- **后端两套路径**：① [generate_note](backend/app/routes/workspaces.py:1726) → note task（一体化）；② [start_item_pipeline](backend/app/routes/workspaces.py:1611) → [_bridge_to_pipeline_payload](backend/app/routes/workspaces.py:1608) 视频→analyze + [_on_download_success](backend/app/routes/workspaces.py:207) 自动再建 analyze task（**「两个任务」根源**，注册见 [task_runner.py:153](backend/app/services/task_runner.py:153)）。
- **路由层已收敛**：[resolveItemRoute.ts](frontend/src/lib/resolveItemRoute.ts) 笔记向已统一 → NoteShell（这部分对了，保留）。

---

# 2.5 删除前能力抢救（重要：删之前先抢救可复用的）

**原则**：每个要删的东西，删前先问「里面有没有别处用得上的能力 / 逻辑」——**有就先迁移到合适位置再删，没有才直接删**。拿不准是否还有用的，**停下问用户**。

**已知抢救清单**（mimo 删前逐项确认）：

| 被删项 | 可抢救 / 借鉴的能力 | 去处 |
|---|---|---|
| 手动模式精细控制 | 总结路径（只看画面/只听字幕/音视频综合）、总结深度、识别背景提示词 | 评估接入 note task 或作「生成笔记」高级选项；确实用不上才删 |
| 截帧间隔 / 帧数 | 已在 ScreenshotPage 设置页（蓝图 §2「每几帧截图设置页设置」） | 已有，确认**不随手动模式误删** |
| **`av_synthesis` 后端** | `pdf_builder` / `docx_builder` / `obsidian_builder`（**PDF/docx 导出 = NoteShell 目前没有**，NoteShell 只有 md+Obsidian） | **保留 builder**，作 NoteShell 未来 PDF/docx 导出的基础；只删前端「综合笔记 feature」 |
| 旧结果页（Video/Audio/Image/Text ResultPage） | NoteShell 可能缺的展示（关键帧画廊、音频特定 UI 等） | 删前对比 NoteShell，缺的借鉴过去 |
| 课程笔记 ln 页 | `LNVideoPanel`/`HtmlView`/`MdView`/`LNTranscriptPanel` | 已在阶段 E 保留并迁移（删的是 ln **页面入口**，不是组件） |

---

# 3. 分阶段执行（每阶段独立 commit，做完验证再下一步）

## 阶段 A · 前端入口收敛（只留「生成笔记」）

**目标**：AddMaterialModal 去掉手动分析模式，加链接/文件后默认且唯一走「生成笔记」。

删除目标（先 grep 全部引用再动）：
- `av_combined` scope 卡片 [AddMaterialModal.tsx:52](frontend/src/components/workspace/AddMaterialModal.tsx:52)
- `av_synthesis` feature [featuresToSteps.ts:142](frontend/src/lib/featuresToSteps.ts:142)、:68、:74、:158 + AddMaterialModal 的综合笔记联动（:534、:614、:1019、:1062、:1073）
- 手动分析区块：分析任务勾选（[:989-1268](frontend/src/components/workspace/AddMaterialModal.tsx:989)）、识别背景（:1270）等"非 noteMode"分支
- 让 `noteMode` 恒为 true（[:260](frontend/src/components/workspace/AddMaterialModal.tsx:260)）或直接删掉模式切换、只保留 [:886](frontend/src/components/workspace/AddMaterialModal.tsx:886) 起的生成笔记 UI

**验证**：加链接只看到「生成笔记」；搜不到 `av_synthesis`/`av_combined` 残留；`npx tsc --noEmit` 通过；`AddMaterialModal.test.tsx`/`preflightTasks.test.ts` 跟着更新。

## 阶段 B · 后端路径收敛（修「两个任务」）

**目标**：笔记只走 note task，**不再产生第二个 analyze 任务**。

步骤：
1. **git 二分定位**：`git log --oneline -40` 找"以前改成 1 个任务"的 commit；二分确认是哪次改动让视频又变两个（嫌疑：R4.1/R4.2 路由收口前后）。
2. **运行时定位 `/tmp/test.mp3`**：在 [`create_task`](backend/app/services/task_runner.py)（runner 创建任务入口）临时加 `print(task_type, payload, traceback.format_stack())`，跑一次 B 站视频，看那个 audio 任务是谁建的、source 路径哪来的。
3. **断掉旧链**：确认 [_on_download_success](backend/app/routes/workspaces.py:207) 自动建 analyze（:241）、[_bridge_to_pipeline_payload](backend/app/routes/workspaces.py:1608) 视频→analyze 是否还被笔记流程触发；笔记流程统一走 note task，**移除/隔离**这些对笔记的多余触发。⚠️ `analyze` 作为 note task 的 step 要留；删的是"独立 analyze task"。

**方案涉及路径取舍，定位后把改法发用户确认再动。**

**验证**：一个视频 = **一个任务**，无 /tmp/test.mp3；步骤走全 download→transcribe→analyze→note。

## 阶段 C · 旧结果页 / ln / av 入口下线

**目标**：所有"笔记"链接都进 NoteShell；删课程笔记、av-synthesis 等旧入口。

- 删入口（grep 引用后改）：视频结果页跳 `/ln` 的「课程笔记」按钮、`/av-synthesis` 入口、旧四类结果页（Video/Audio/Image/TextResultPage）的"看笔记"入口。
- ⚠️ **保留**：ln 的能力组件 `LNVideoPanel`/`HtmlView`/`MdView`/`LNTranscriptPanel`（NoteShell 复用，见阶段 E）；`replica` 复刻向路由（[resolveItemRoute.ts:17](frontend/src/lib/resolveItemRoute.ts:17)，复刻是另一功能，用户说先不动）。
- 区分 `av_synthesis`：前端「综合笔记 feature」删；后端 `backend/app/services/av_synthesis/`（md/pdf/docx/obsidian 渲染导出）**先确认是否被 NoteShell 导出复用**，被用就留、没用再删（grep `av_synthesis` 后端引用）。

**验证**：点任意素材/链接都落到 `/note`；旧入口按钮消失；tsc + pytest 通过。

## 阶段 D · 视频笔记对齐 B站流程 + 修回归

**基准**：所有视频（含小红书）走 B 站同款 note task 流程（错误最少）。

- **标题**（小红书是 ID）：note task 完成后用 `metadata.title`/`video_title` 回写 `item.name`（仅当 name 仍是 URL/ID 占位）。B 站靠 yt-dlp 文件名已对，小红书适配器已返回真实标题（[pipeline_tasks.py:1287](backend/app/services/pipeline_tasks.py:1287)）。
- **播放**（播不了）：note 端点 video 分支 [workspaces.py:3109](backend/app/routes/workspaces.py:3109) 现在扫 `videos/` 目录；改成**优先用 `results.video_file`** → `to_static_url()`（[:78](backend/app/routes/workspaces.py:78)），扫目录作 fallback。同步 result 端点（[:3253](backend/app/routes/workspaces.py:3253)）。⚠️ 回归测 B 站现有视频别改坏。
- **步骤显示太少**：前端进度页按任务**实际 steps** 渲染（`frontend/src/pages/result/ProcessingPage/` + [featuresToSteps.ts](frontend/src/lib/featuresToSteps.ts)），transcribe/analyze 都要显示。
- 小红书视频分流（已改 [pipeline_tasks.py:1273](backend/app/services/pipeline_tasks.py:1273)）保留。

**验证**：B 站 + 小红书视频都：单任务、标题对、能播放、步骤完整、出转写+截帧内容。

## 阶段 E · NoteShell 补齐 ln 能力 + 蓝图 UI（§3.5）

对照蓝图 [§3.5 视频笔记](docs/plans/track-K-note-flow-blueprint.md) + 附录 D：

- **截帧入 md**（没了）：NoteShell 的 Markdown 编辑器挂载时 `nStore.getState().setCmView(view)`（对齐 ln 的 [MdView](frontend/src/pages/results/LearningNotesPage/MdView.tsx)），卸载清空。截图按钮已在 LNVideoPanel，注册后即可插入。NoteShell 编辑器现注释"不依赖 n"（[index.tsx](frontend/src/pages/result/NoteShell/index.tsx)）→ 改为注册。
- **正文时间码点击跳转**：NoteShell 阅读态用 ReactMarkdown，无时间码跳转；ln 的 [HtmlView](frontend/src/pages/results/LearningNotesPage/HtmlView.tsx:166) 有（replaceTsInString+onSeek）。接入等价能力，连到 NoteMediaCompanion 的 seek。
- **UI 布局**对照蓝图 §3.5：视频播放 + 实时字幕（并列、播放时字幕滚动）+ 标准总结/富文本切换 + 截帧 + md 时间码跳画面 + 右侧操作区（源md/换总结/AI问答/导出）。

**验证**：逐条对照蓝图 §3.5 + 附录 D 验证表。

---

# 4. 总验证清单（全做完后，B站 + 小红书各跑一遍）

- [x] 加链接只有「生成笔记」一个入口
- [x] **一个视频 = 一个任务**（无 /tmp/test.mp3）
- [x] 步骤完整走 download→transcribe→analyze→note
- [x] 标题是真实标题
- [x] 视频**能播放**
- [x] **截图插入**能写进 md
- [x] 字幕/转录轴点击跳播放器；正文时间码点击跳画面
- [x] 小红书图文、B站 opus **图文笔记没被改坏**
- [x] `npx tsc --noEmit` + `pytest` 全绿

---

# 5. 风险 / 待用户确认

1. **阶段 B 路径取舍**：删独立 analyze 链的具体改法，mimo 定位后发用户确认。
2. `av_synthesis` 后端导出是否被 NoteShell 复用——grep 确认再决定删留。
3. 删除跨多文件，**严格走删除安全协议**（grep 引用 → tsc/pytest → 分步 commit），任何"删了怕影响别处"的，停下问用户。
4. `replica` 复刻向、④图片/图文独立类型 = 本轮**不动**。

---

# 7. 第二轮补充修复（A–E 实测后 · 2026-06-08）

**A–E 已达成**：单入口 ✅ / 单任务 ✅ / 视频走完整流程(download→transcribe→analyze→note) ✅ / 能播放 ✅ / 保留项到位（PDF·docx·obsidian builder + ln 组件都在）✅。剩 4 类问题（用户 B站/抖音/小红书三平台实测）：

## 7.1 删除清理（残留）
`av_synthesis`/`av_combined` 仍残留：`types/workspace.ts`、`lib/featuresToSteps.ts`、`pages/result/ProcessingPage/StepProgress.tsx`、`pages/WorkbenchPage/PreflightDrawer.tsx`、`pages/WorkbenchPage/preflightTasks.ts`。
- mimo：逐个 `grep` 确认是死代码还是仍被引用；属已删手动模式的 → 删，类型/步骤定义里确实还需要的 → 留并注释。
- 验证：`grep` 无悬空引用；`npx tsc --noEmit` 通过。

## 7.2 标题全链路（最高优先，用户 3 条都指它）
**根因**：note task 真实标题只进 `result["video_title"]` + 改 workspace 名，**未回写 `item.name`**；note 端点 `title=item.name`（[workspaces.py:2104](backend/app/routes/workspaces.py:2104)/2138/2212）→ NoteShell 顶部显示 ID/BV 号。
- **修复 A（结果页标题，全平台）**：note task 完成后**回写 `item.name` = 真实标题**（B站 `video_title` / 抖音·小红书 `metadata.title`），仅当 name 仍是 URL/ID 占位时覆盖。→ 三平台结果页标题都对，B站"完成后变不对"也解决。
- **修复 B（处理中标题，抖音/小红书）**：适配器已解析到 title（小红书实测「亲测3个设计skills…」），确保传入任务、ProcessingPage 用真实标题而非域名。
- 验证：B站/抖音/小红书，处理中 + 结果页标题都是真实标题。

## 7.3 视频笔记布局（对齐蓝图 §3.5 + 用户设计图）
**现状**：视频笔记是通用「对照视图(左正文+右 source)+底部 companion」，未按蓝图。
**目标**（蓝图 §3.5）：左「视频播放 + 实时字幕」并列 → 右「标准总结 MD ↔ 富文本切换」→ md 时间码点击跳画面 → 右侧操作区（源md/换总结/AI问答/导出）。播放器+字幕在**显眼主区**，不是底部附属。
- mimo：按蓝图 §3.5 重排视频笔记布局（companion 现在 [index.tsx:892](frontend/src/pages/result/NoteShell/index.tsx:892)）。**改前可先发用户一版布局示意确认**。
- 验证：逐条对照蓝图 §3.5 + 用户设计图。

## 7.4 实时字幕（没看到，没法测）
转录轴 `LNTranscriptPanel` 没显示/不明显。
- mimo：确认 NoteMediaCompanion 转录轴在视频笔记可见，播放时字幕跟随高亮（数据 `note.transcript` 已出，检查渲染/折叠）。
- 验证：播放视频，字幕区可见且随播放滚动。

## 7.5 执行顺序 + 总验证
顺序：**7.1 清理 → 7.2 标题 → 7.3 布局 → 7.4 字幕**，每步 commit + 验证。
三平台回归：单入口 / 单任务 / 标题对 / 能播放 / 字幕可见跟随 / 布局对齐 §3.5。布局这步较大、且涉及视觉，**mimo 改前发用户确认布局方案**。

---

# 8. 第三轮：NoteShell 视频笔记布局重构（对齐蓝图 §3.5 · 2026-06-08）

7.1–7.4 后**标题 ✅ / 单入口 ✅ / 能播放 ✅**。但 7.3 的布局（注释「三列直接用 ln 组件、不经过 NoteMediaCompanion」[index.tsx:33](frontend/src/pages/result/NoteShell/index.tsx:33)）**没对齐蓝图 §3.5**，且断了字幕联动，引出 7 个问题。本章**重做视频笔记布局**。

## 8.0 目标布局（对照蓝图 §3.5；mimo 照此实现，**改前先发用户确认一版示意**）

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← 返回   [真实标题] 视频   〔标准总结 ↔ 富文本 ↔ 源md对照〕    问AI  导出 │
├──────────────────────────┬───────────────────────────────┬──────────┤
│ 视频播放器                │ 标准总结的 MD（主笔记）          │ 操作区    │
│ [截图插入]                │  · 可切富文本                   │ · 源 md   │
│                          │  · md 时间码点击 → 跳视频画面     │ · 换总结  │
│ ── 实时字幕 ──            │                                │ · AI 问答 │
│ 字幕行（播放时高亮+滚动跟随）│                                │ · 导出    │
└──────────────────────────┴───────────────────────────────┴──────────┘
```

要点：① 播放器 + 字幕在**左主区并列**；② 中间是**标准总结 MD**（可切富文本）；③ **操作区收纳「源 md / 换总结 / AI问答 / 导出」**（不再是底部折叠条、也不是现在那条看不懂的最右侧栏）。

## 8.1 逐问题修复

| # | 现象 | 根因 / 修复方向 |
|---|---|---|
| 1 | 字幕轴不随播放跳转 | 7.3 视频改用裸 ln 组件、丢了 `currentTime` 联动 → **接回**播放器 `onTimeUpdate → currentTime → LNTranscriptPanel`（参考 [NoteMediaCompanion](frontend/src/pages/result/NoteShell/NoteMediaCompanion.tsx) 的双向联动），并自动滚动到当前行 |
| 2 | 点截图插入后字幕消失 | 截图插入触发 re-render 把字幕区卸载 → 字幕区状态/挂载与编辑解耦，截图不影响其显示 |
| 3 | 最右侧栏内容不对 | 那条侧栏（RefreshCw 等图标）→ **改成 8.0 的操作区**（源md/换总结/AI问答/导出），或删掉重做 |
| 4 | 总结风格/原始依据不该放底部 | 现为底部折叠 `SummariesPanel`([:447](frontend/src/pages/result/NoteShell/index.tsx:447))+`SourcePanel`([:405](frontend/src/pages/result/NoteShell/index.tsx:405)) → **收进操作区**：「换总结」开总结风格面板、「源 md」开 source 查看 |
| 5 | 对照时 md 无法翻动 | `CompareView`([:316](frontend/src/pages/result/NoteShell/index.tsx:316)) 滚动失效 → 修左右栏 `overflow-y:auto` + min-height:0 |
| 6 | md 应是「标准总结」+ 上面有「源md」入口 | 对照蓝图 §3 内容层：`source.md`(原始转写) → summaries(标准总结等风格) → `note.md`(主笔记)。**主区展示标准总结**，视图切换为〔标准总结 ↔ 富文本 ↔ 源md对照〕；「源 md」是入口不是默认主体 |
| 7 | 整体 UI 太丑 | 参考 [`docs/DESIGN_TOKENS.md`](docs/DESIGN_TOKENS.md) + [`docs/rules/code-style.md`](docs/rules/code-style.md) §UI + 蓝图：统一间距/圆角/层级/配色，三区留白对齐，不要硬拼 |

## 8.2 执行 + 验证
- 顺序：先 8.0 布局骨架（发用户确认）→ 再 8.1 各项交互 → 最后 8.1#7 美化。
- 验证：对照蓝图 §3.5 + 用户设计图逐条过；播放时字幕跟随高亮+滚动；截图插入后字幕仍在；操作区四项可用；对照可滚动；主区是标准总结。
- ⚠️ **8.0/8.1#7 涉及视觉，mimo 改前发用户一版布局/样式确认再动**，别闷头改完。

## 8.3 第三轮实测结果（Opus/Sonnet 已修 · 2026-06-08）

8.1 表里多数是**显示/交互**层，但用户实测后发现真凶在**后端数据**，已由 Opus 修掉并落 3 个 commit：

- `ae2b628` k-8.1：design tokens + 字幕类型 cast + CompareView 滚动 + 截图自动切模式（后撤）
- `cc6ba8a` k-8.2：**字幕格式根因** —— 后端返回 `{start,end}`、前端要 `{t_sec,t_str}`，字段名对不上 → 时间码不显示/点不动；GET 读 segments、PUT 读 string → 保存后「暂无字幕」。新增 `_normalize_note_transcript` 统一两接口。撤掉截图自动跳模式；中列标签改 `富文本/md格式`、删「源md对照」；问AI 移右列不盖 md。
- `cc6ba8a`+`4c84b88` k-8.3：**字幕时间码持久化** —— 原本只在内存 `item.results`，后端一重启即丢。`note_assembler` 落盘 `transcript.json`，GET/PUT 内存优先、空则从盘恢复。新增 4 测试，note 套件 65 全过。

实测确认：字幕时间码 ✅ 高亮跟随 ✅ 点击跳转 ✅ 截图不丢字幕 ✅。**问题 1/2/5 真正解决**。

---

# 9. 第四轮：NoteShell 视频笔记布局/交互细化（用户实测 8.x 后 · 2026-06-08）

8.x 把字幕根因修通后，用户对**布局摆放**提出 7 点细化反馈。本章把这 7 点落成 mimo 可执行项。

## 9.0 两个已确认的方向（开工前提，别再纠结）

1. **富文本 / md格式 语义（用户定 A）**：
   - **富文本 = 渲染态（ReactMarkdown），默认，只读** —— 美观、当导出预览看。
   - **md格式 = 源码态（CodeMirror），可编辑** —— 改字、截图插入都在这档。
   - 「能编辑的所见即所得富文本」需引入新库（TipTap/Lexical）+ md↔富文本 往返保真，**本期不做**，单独立 **R2.2 阶段**。终态可无缝去掉 md 档，但**现在保留两档**。
2. **点3「标准总结 + 设置切换」（用户定：只做前半）**：中间**只显示当前已应用的总结**（即 `note.md`）。「设置里切换默认总结模板」**后置**，本期 mimo **不碰后端总结生成**。

## 9.1 目标布局（视频笔记三列；mimo 照此实现）

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← 返回   [真实标题] 视频                                   [导出 ▾]     │  ← 点7：导出回右上角固定
├──────────────────────┬─────────────────────────────────┬────────────┤
│ 视频播放器            │ 〔富文本 | md格式〕 ← 点1：tab 在内容正上方   │ 操作区      │
│ [截图插入]            │ ┌─────────────────────────────┐ │ · 源 md ─→悬浮(点4)│
│                      │ │ 主体 = 当前已应用总结 note.md  │ │ · 总结列表  │
│ ── 实时字幕 ──        │ │ 富文本(渲染·默认) / md格式(可编辑)│ │   点选→替换主体│
│ 00:00 高亮跟随        │ │                              │ │   下方版本切换(点5)│
│                      │ └─────────────────────────────┘ │            │
│                      │  目录（富文本态时显示）            │            │
└──────────────────────┴─────────────────────────────────┴────────────┘
                                                  〔💬 问 AI〕← 点6：悬浮泡泡（仿任务队列）
```

右列瘦身后**只剩**：源md(悬浮触发) + 总结列表(点选替换+版本)。**问AI、导出移出右列**。

## 9.2 七点逐项落地（含精确锚点，mimo 别重写整文件，按点改）

| # | 用户要求 | 现状锚点 | 改法 |
|---|---|---|---|
| 1 | 富文本/md格式 切换移到**中间内容正上方**，与内容同板块 | 现在顶栏 [index.tsx:800-818](frontend/src/pages/result/NoteShell/index.tsx:800) | 把这段 segmented 切换从顶栏**移到中列容器顶部**，做成中列局部 tab 栏（贴着内容上沿、同一边框内）。顶栏只留 返回/标题/类型/导出 |
| 2 | 默认**富文本**(渲染只读) | 默认 viewMode 来自 localStorage/`'read'` | 视频笔记**默认 `read`（=富文本）**；两档：富文本=`read`(ReactMarkdown)、md格式=`edit`(CodeMirror 可编辑)。视频笔记不再出现 `compare` |
| 3 | 中间=当前已应用总结(note.md)；设置切换后置 | 中间已渲染 `note.md` ✓ | **保持**。本期不做设置切换、不碰后端 |
| 4 | 源md 点击**弹悬浮框**（现在内联太挤） | 右列内联展开 [index.tsx:1009-1021](frontend/src/pages/result/NoteShell/index.tsx:1009) | 新建 `SourceMdModal`（**仿** [TranscriptPreviewModal](frontend/src/components/workspace/TranscriptPreviewModal.tsx)：`position:fixed` 遮罩 + 居中卡片 + onClose）。点「源md」→开弹层显示 `note.source_md`，宽松排版、可滚动 |
| 5 | 右侧选总结**直接替换中间**；下方版本切换 | 右列 [SummariesTab](frontend/src/components/SummariesTab.tsx)（已按 template 分组 + version） | 让总结列表**点某条直接 `handleApplyToNote`**（替换 note.md 主体）；同模板多版本在其下 `v1/v2` 可切。复用 SummariesTab 的 `groupByTemplate`，把「需先勾再应用」改成「点即应用 + 高亮当前」 |
| 6 | 问AI 改**悬浮**（仿任务队列） | 占右列 [index.tsx:1043-1050](frontend/src/pages/result/NoteShell/index.tsx:1043) | 新建悬浮泡泡，**仿** [FloatingTaskQueue](frontend/src/components/FloatingTaskQueue.tsx)（`position:fixed; right:24; bottom:24; zIndex:38` 按钮→popover）。popover 内嵌 [NoteChatDrawer](frontend/src/components/NoteChatDrawer.tsx)。**从右列移除问AI** |
| 7 | 导出回**右上角固定** | 视频在右列 [:1052-1071](frontend/src/pages/result/NoteShell/index.tsx:1052)；非视频已在顶栏 [:856-890](frontend/src/pages/result/NoteShell/index.tsx:856) | 删掉顶栏导出的 `!isVideoNote &&` 条件，让导出按钮对**所有类型**都在顶栏右上角；右列移除导出 |

## 9.3 执行顺序 + 验证 + 红线

- **顺序**：先点7+点1（顶栏/中列 tab 归位，骨架）→ 点6+点4（抽出悬浮：问AI/源md）→ 点5（总结点选替换+版本）→ 最后统一过 DESIGN_TOKENS 美化。每步可 `npx tsc --noEmit` + `vite build` 自检，分小 commit。
- **红线（别破坏 8.x 已修好的）**：
  - ❌ 不准动后端 `note_assembler.py` / `workspaces.py` 的 transcript 逻辑（字幕格式+持久化刚修好）。
  - ❌ 不准动 `LNVideoPanel` 的截图逻辑、`LNTranscriptPanel` 的 `t_sec/t_str` 联动。
  - ❌ 不引入新库（WYSIWYG 是 R2.2，不在本期）。
  - ✅ 改动集中在 `NoteShell/index.tsx` + 2 个新组件（SourceMdModal、问AI 悬浮）。
- **验证**：富文本/md tab 在中列顶部、默认富文本 ✓；导出在右上角 ✓；问AI 悬浮泡泡、不盖 md ✓；源md 弹悬浮框 ✓；右侧点总结→中间替换、版本可切 ✓；字幕时间码/高亮/点击跳转**仍正常**（回归 8.x）✓。
- ⚠️ **视觉部分（悬浮泡泡/弹层/美化）mimo 先发用户一版示意确认再细抠**。

---

# 10. 第五轮：总结体系 + 字幕编辑 + source.md 增强（用户实测 9.x 后 · 2026-06-08）

9.x 布局做完后，用户提 5 点，集中在「内容质量 + 编辑能力」，**大量动后端**。本章拆 3 个独立子阶段，**每阶段单独 commit + 验收再下一个**。

> 📎 **R2 实测后续 · 问题 2（字幕一段 20 秒太长）已拆为独立执行卡**：[`docs/plans/track-K-segment-refiner-plan.md`](track-K-segment-refiner-plan.md)（引擎无关字幕切分层 `segment_refiner`，不引入新 ASR 库）。问题 1（双击保存失败）已修于 commit `1aa619e`；问题 3（source.md 视频元数据）非新视频 bug，元数据已在 [pipeline_tasks.py:520](../../backend/app/services/pipeline_tasks.py:520) 接好，仅旧数据无。

## 10.0 已确认决策（开工前提）

1. **点1 总结面板**：右侧列表**只管「看 + 切」**，「新建总结」收进弹窗。
2. **点2 版本**：每个模板**首版 = v0**，重生成 = v1/v2…；每个版本**可改自定义名**。
3. **点5 标准总结**：新建「标准总结」模板（学 wdkns 教学化结构）+ **自动嵌入关键帧截图**（图文并茂）。
4. 点3（字幕双击编辑→同步 source.md）、点4（source.md 加视频元数据）按下方规划，复用现成接口。

## 10.1 三子阶段划分（不准跨阶段顺手做，破坏 git 颗粒度）

| 阶段 | 内容 | 主要文件 | 风险 |
|---|---|---|---|
| **R1** 总结面板交互 | 点1 + 点2 | SummariesTab.tsx、models/workspace.py、workspaces.py(summaries) | 中 |
| **R2** 字幕编辑闭环 + source.md | 点3 + 点4 | LNTranscriptPanel.tsx、NoteShell、workspaces.py(transcript)、note_assembler.py、pipeline_tasks.py | 中 |
| **R3** 标准总结·嵌帧 | 点5 | summary_templates.py、summary_generator.py | 高（prompt+嵌图） |

## 10.2 阶段 R1 · 总结面板（点1 + 点2）

**点1 前端**（[SummariesTab.tsx](frontend/src/components/SummariesTab.tsx)）：重做成两块——
- 【版本列表】每条 = `模板名 · v{n}`（或自定义名），**点一下立即应用到中间正文**（复用 `onApplyToNote`），高亮当前应用项；同模板多版本并排可切。**去掉**现在内联的 模板chips / 「选择其他模板」下拉 / 背景输入框 / 生成按钮。
- 【+ 新建总结】按钮 → 弹窗（仿 [FramePickerModal](frontend/src/components/FramePickerModal.tsx) 的 modal 风格）：模板选择 + 可选「补充背景」textarea + 「生成」。生成成功→关弹窗、新版本进列表。

**点2 后端**：
- [models/workspace.py](backend/app/models/workspace.py) `ItemSummary` 加 `name: str = ""`（含 `to_dict`/`from_dict`）。
- 版本从 0 起：改 `_store.next_version_for_template`，**首版返回 0**（现在从 1）。
- 新增改名接口：`PATCH /workspaces/{ws}/items/{item}/summaries/{summary_id}`，body `{name}`，设 `summary.name`。

**点2 前端**：版本标签显示 `v0/v1/…`；有自定义名时显示名（双击或小图标→改名输入框→调改名接口）。

**R1 验收**：右侧列表点选即换中间正文；新建走弹窗；版本从 v0 起；能改名且持久。

> **R1 实际落地（2026-06-08，已 merge main）**：点1 列表+新建弹窗 ✅、点2 版本 v0/改名 ✅，**用户额外加了「总结生成时选模型 + Tavily 联网搜索」整套**（providerStore 双下拉 + Tavily 设置页/测试连接 + search_web 开关）。这部分独立于 R2，R2 锚点不受影响。

## 10.3 阶段 R2 · 字幕编辑闭环 + source.md 增强（点3 + 点4）

**点3 字幕双击编辑**——基础设施已有，别重造：
- 后端接口已存在：`PATCH .../transcript/segments/{idx}`（[workspaces.py:2937](backend/app/routes/workspaces.py:2937)），写 `edited_text` 进 `results["transcript_segments"]`。
- 前端交互已存在：[AudioResultPage](frontend/src/pages/result/AudioResultPage.tsx) 已实现「双击某行→编辑→保存 `n`(edited_text)」，service `editTranscriptSegment`([workspaces.ts:513](frontend/src/services/workspaces.ts:513))。
- **要做**：① 前端把这套双击编辑搬到视频笔记左侧 [LNTranscriptPanel](frontend/src/pages/results/LearningNotesPage/LNTranscriptPanel.tsx)（双击行→inline 输入→调 editTranscriptSegment→刷新该行显示 edited_text）。② 后端扩展 `update_transcript_segment`：写完 results 后**额外两步**——(a) 同步更新 note 目录 `transcript.json`（把该行改后的文字落盘，扛重启，对应 8.3）；(b) **重建 source.md**（用 edited_text 优先，调 `build_source_md`/`assemble_item_note`），让「源md 内容也跟着调整」。
- **⚠️ edited_text 必须三处一致生效**（否则改了白改）：
  1. **字幕轴显示**：`normalize_transcript`([note_assembler.py](backend/app/services/note_assembler.py)) 输出的 `text` 改为 `edited_text or text`（**这是允许的加法改动**，不破坏 {t_sec,t_str,text} 契约）。
  2. **source.md**：`build_source_md` 拼接转写时也 `edited_text or text`。
  3. **transcript.json**：编辑接口落盘时带上 edited_text（或直接存改后的 text）。
- **可行性已验证**：PATCH 接口存在（[workspaces.py:2937](backend/app/routes/workspaces.py:2937)）、AudioResultPage 双击编辑存在（[onDoubleClick:548](frontend/src/pages/result/AudioResultPage.tsx:548)）、`result["description"]`@1559 是**帧 VLM 描述**与点4 无关（点4 仍需 plumb 视频简介/作者）。

**点4 source.md 更详细**：
- plumb 元数据：[pipeline_tasks.py](backend/app/services/pipeline_tasks.py) 下载回调现在只把 `video_title`/`cover_thumbnail` 写进 result（:517/:520）；补上 `description`/`author`/`upload_date`（B站 [bilibili_nocookie.py:189](backend/app/downloaders/bilibili_nocookie.py:189) 的 VideoMeta 已有这些字段）。
- [build_source_md](backend/app/services/note_assembler.py:220)（注：8.3 加 helper 后行号下移）顶部加「视频信息」头：
  ```
  ## 视频信息
  - 链接：{source_url}
  - 标题：{title}
  - 作者：{author}
  - 时长：{duration} / 发布：{upload_date}

  > {description}

  ## 转写正文
  …（现有转写，edited_text 优先）
  ```

**R2 验收**：视频笔记双击字幕能改字；改完源md 里那句也变；重启后改动还在；source.md 顶部有链接/作者/简介。

## 10.4 阶段 R3 · 标准总结（2026-06-08 实测后拆分：R3.1 纯文字 / R3.2 嵌帧后置）

> ⚠️ **拆分原因（用户 2026-06-08 拍板）**：原计划「standard 模板 + 嵌关键帧」一锅做，但实测发现**嵌关键帧的前置根本不成立**，且帧字段契约四方断裂（见 R3.2）。故拆开：先交付纯文字版（数据齐全、立即可用），嵌图单列后置。

### R3.1 · 纯文字「标准总结」模板（status: ready，可立即执行）

**只新增一个教学化模板，不嵌图、不改生成器**——数据源是现成的 `transcript`，走 R1 已有的 `generate_summary` 流程。

1. **后端**：[summary_templates.py](backend/app/services/summary_templates.py) `TEMPLATES` 加 `standard`（`SummaryTemplate(system_prompt, user_prompt, output_format="markdown")`）。`user_prompt` 复用其它模板同款 `{transcript}` 注入即可。**不动 [summary_generator.py](backend/app/services/summary_generator.py)**（纯文字模板和现有 14 个走同一条路；后端 `list_template_ids()` 自动收录，`_ensure_valid_template` 自动放行）。

   system_prompt（对齐 wdkns `bilibili-render-pdf` 教学结构：motivation→core→mechanism→example→takeaway + 三类高亮框 + 本章小结）：

   ```
   你是一名优秀的讲解型笔记作者。把下面这段视频转写重写成一篇结构化中文学习笔记——
   不是按字幕时间堆砌，而是重组成有教学逻辑的讲解。要求：
   1. 用 markdown，## 分节、### 分小节。
   2. 开头一段「背景/动机」：这视频解决什么问题、为什么值得看。
   3. 每个主题按「动机→核心思想→机制/原理→例子或证据→小结」展开，过渡自然，不要流水账。
      不要照抄字幕顺序，按教学逻辑重组（有意图、有对比、有递进）。
   4. 关键信号用引用块（对齐 wdkns 教学三框，一节可放多个、不限一框）：
      > 💡 **要点** — 必记核心：定义、中心论点、关键机制小结、算法关键步骤。
      > 📎 **背景** — 前置/旁支知识：前置提醒、术语对比、设计权衡、建立直觉的类比。
      > ⚠️ **注意** — 易错点/常见误解：隐藏假设、误导直觉、实现陷阱、把错误直觉与正确做法对照。
   5. 公式/代码先用大白话讲意图，再给出。
   6. 每个主要章节结尾加一行「**本章小结**」浓缩该节。
   7. 结尾 ## 总结与延伸：作者收尾 + 你提炼的核心要点 + 可行动 takeaway。
   8. 跳过寒暄/广告/一键三连。
   ```

2. **前端**：在 R1 的「新建总结」弹窗模板清单里加一项「标准总结」（label + 一句描述，`template=standard`）。定位执行时 `rg` 模板选项定义处；后端动态放行，前端只需补展示项。

3. **R3.1 验收**：新建 `standard` 总结 → 结构化教学笔记（有背景/动机、分节、💡📎⚠️ 三框、每节本章小结、末尾总结与延伸）；中列默认展示；可在总结面板与其它模板切换。

### R3.2 · 标准总结·嵌关键帧（status: blocked，依赖前置，R3.1 验收后再展开）

**实测发现的偏差（2026-06-08，勿照原计划开工）**：

| 原假设 | 现实 |
|---|---|
| `results["frames"]` 是可嵌的关键帧 | 只存每视频**第一帧**缩略图，字段 `{frame_image, frame_image_path}`，无描述无时间 |
| 帧有 `description_zh`/`sec` | 带描述的帧在 `*_视觉数据.json`，字段是 `description_zh`/**`timestamp`**/image |
| `note_assembler` 已支持帧 | 它读 `{sec, frame_path}`，与 pipeline 写入字段对不上 → `media.frames` 是坏数据 |
| 视频笔记有帧可嵌 | 实测该 B 站笔记：**无 frames 目录、无视觉 JSON、`media.frames=[]`** |

**根因**：截帧(`FRAMES`)+视觉分析(`VLM`)是 preflight 可选分析任务（[tasks.py:20](backend/app/models/tasks.py:20)），视频笔记未默认启用 → 零关键帧。

**R3.2 必做的前置（按序）**：
- **前置①**：打通「视频笔记 → 截帧+VLM → note 带关键帧」——确认 note pipeline 是否跑 analyze step、preflight 默认是否勾 FRAMES/VLM（涉及速度/成本，**改默认前问用户**）。
- **前置②**：统一关键帧字段契约一份（建议 `{sec, desc, image_path}`），对齐 pipeline 写入（[pipeline_tasks.py:1113](backend/app/services/pipeline_tasks.py:1113)）↔ note_assembler 读取（[note_assembler.py:104](backend/app/services/note_assembler.py:104)）↔ 视觉 JSON（`description_zh`/`timestamp`）。**这是修一个已存在的链路 bug，独立成 commit**。
- **本体**：standard 加嵌图变体——`generate_summary` 对 standard 注入「关键帧清单」（数据源 = 视觉 JSON，**不是** `results["frames"]`）+ 生成后把 `[[图N]]` post-process 成 `![desc](/static…)`，越界帧号删掉。

**R3.2 验收**：勾了截帧的视频笔记，standard 正文按内容嵌入对应关键帧图，图文并茂。

> 📎 **R3.1/R3.2 实测后续（2026-06-09）→ 独立执行卡**：[`docs/plans/track-K-R3-followup-plan.md`](track-K-R3-followup-plan.md)。用户实测反馈两点拆为 **R3.3**（standard 纯文字「太啰嗦」→ 自适应简略，先做）+ **R3.4**（嵌图实测 0 图 → 修帧串台/无描述链路，后做）。富文本无图段落重复渲染 bug 已修于 `946474d`。

## 10.5 红线 + 通用要求

- 每阶段：`cd frontend && npx tsc --noEmit && vite build` + `.venv/bin/python -m pytest`（动后端就跑 note/summary 套件）过了再 commit；commit `feat(k-10.Rx): …`。
- ❌ 不准动 8.x 的 transcript 格式/持久化核心（`_normalize_note_transcript`/`_note_transcript`），点3 是**在其上加同步**，不是改它。
- ❌ 不引入新库（点5 嵌帧用现有 markdown 图片语法，不要富文本编辑器）。
- ❌ 单阶段跨文件超 6 个先停下问用户。
- ⚠️ 点1 弹窗/点5 排版**涉及视觉，先发用户一版再细抠**。
