# 结果页 1:1 还原设计稿 — 执行计划（首批：笔记结果页 视频/音频/图片/文本）

status: ready
日期：2026-06-27
分支：`feat/exp-redesign-p1`
执行者：小米（终端）｜审查：Codex｜计划：Claude

---

## 0. 背景与目标

用户在 Open Design 桌面版重做了 Nibi 全套 UI（总设计稿 `nibi-all-pages.html`，16 个页面）。
当前 React 项目已完成 Goal 1（Nibi token + 组件样式层）、Goal 2（页面层视觉迁移），
但结果页只迁了一半（工作区有未提交的 NoteShell + result CSS 半成品）。

**本计划只做首批：把「笔记结果页」按设计稿 1:1 还原**，即用户打开一篇学习笔记时看到的页面，
共 4 类媒体形态：视频 / 音频 / 图片 / 文本。

---

## 1. 关键事实（开工前必读，避免改错文件）

### 1.1 默认笔记结果页是 NoteShell，不是 4 个 *ResultPage

`frontend/src/lib/resolveItemRoute.ts`：

- **笔记向（intent ≠ replica）→ `/note`（NoteShell）** ← 用户实际看到的就是这个
- 复刻向（intent === replica）→ `video_detail / audio_detail / image_result / text_result`（4 个 *ResultPage）

所以 **首批主战场是 `NoteShell`**。`VideoResultPage / AudioResultPage / ImageResultPage / TextResultPage`
服务复刻向（对应设计稿 `pg-replica`），**不在首批**，本轮不要动它们的布局。

### 1.2 NoteShell 已按媒体类型分 3 种 workbench（已是统一笔记页）

`frontend/src/pages/result/NoteShell/index.tsx`：

| itemType | 判定 | 当前 workbench 容器类 | 对应设计稿页面 |
|---|---|---|---|
| video | `isVideoNote`（index.tsx:587） | `.nibi-note-workbench--video`（:948） | `pg-note` 2035-2187 |
| image | `isImageNote`（index.tsx:589） | `.nibi-note-workbench--image`（:1006） | `pg-image` 2310-2422 |
| audio | `itemType==='audio'`（:1158 用 NoteMediaCompanion） | `.nibi-note-workbench--generic`（:1113） | `pg-audio` 2188-2309 |
| text | 兜底 | `.nibi-note-workbench--generic`（:1113） | `pg-text` 2423-2546 |

子组件：
- `NoteMediaCompanion.tsx`（视频/音频媒体伴随，播放器+转录）
- `NoteAudioPanel.tsx`（音频面板）
- `MilkdownEditor.tsx`（右栏结构化笔记正文编辑器）
- `FloatingAskAi.tsx` / `SourceMdModal.tsx`

样式：`NoteShell/note-shell.css`（已用 `nibi-note-*` 命名 + `--audio/--image/--text` 变体）。

### 1.3 起点干净

`pnpm -C frontend build` 当前 **✓ 通过（exit 0，291ms）**。未提交半成品可直接固化为本轮起点。

### 1.4 设计源位置

```
/Users/conan/Library/Application Support/Open Design/namespaces/release-stable/data/projects/2bfc4c3c-b63e-49f2-ad5c-a0e210cfdb3e/nibi-all-pages.html
```

- 在**浏览器打开**该 HTML，左侧导航切到对应页面看渲染（页面映射在源码 3325-3340）。
- 或直接读源码段：视频 2035-2187 / 音频 2188-2309 / 图片 2310-2422 / 文本 2423-2546；
  结果页相关 CSS 类定义从约 723 行起（`.note-page/.note-left/.note-right/.note-bar/.note-player...`）。

---

## 2. 尺度与红线（用户已拍板，所有 Stage 通用）

**还原尺度 = 视觉/布局/文案 1:1，数据接真实：**

1. **视觉/布局/文案 1:1 对齐设计稿**：颜色、字体（得意黑只进标题、Inter 正文、JetBrains Mono 元信息）、圆角、间距、分栏比例、区块顺序、按钮位置、中文文案，都照设计稿。
2. **数据接真实**：设计稿里有数据支撑的元素（标题、标签、转录、章节、图片、提示词、meta、正文）→ 照做并接**真实后端数据**，不用设计稿里的示例文案。
3. **设计稿没画、但当前/后端已有的真实功能 → 保留，不要砍**（如逐句字幕编辑、说话人、版本栈、导出、问 AI 等）。
4. **设计稿有、但当前没有数据/功能支撑的 → 先做占位（disabled / 空态），并在本文件「§7 后续待办」登记，逐步完善**。不凭空造假数据、假功能。

**红线（违反即打回）：**

- 不改业务契约：`resolveItemRoute` 路由、`generateNote / savePreflight / startItemPipeline` payload、结果页数据 contract、`note.media` 结构。
- 不动 4 个 `*ResultPage` 的布局（复刻向，非首批）；只有当它们引用了被改的公共 CSS/token 导致回归时才同步修。
- 不改后端、数据库、API key、鉴权。
- 不在脏工作树上 commit；每个 Stage 改完先 `pnpm -C frontend build` 通过再提交。
- 每个 Stage **最多集中改一组相关文件**（见各 Stage「涉及文件」），不要一次跨 5 个以上业务文件。
- 不删旧路由兼容 redirect；不把复制/导出/AI 工具重复放到多个区域。
- 不用 `Instrument Serif`、大面积粉紫蓝旧色、负 letter-spacing；新增颜色一律用 Nibi token，不写死 hex。

---

## 3. 执行前准备（建立真实对照，禁止看代码猜）

小米开工前必须先跑真实环境，截图对照，不许只读代码：

1. `./dev.sh` 重启前后端（务必用项目根 dev.sh，别手动单起，别绕 CORS）。
2. 准备 4 类**学习笔记**各一篇真实产物（视频/音频/图片/文本各一个已完成 item）。
   - 若现成数据不全，用真实链接/本地文件各跑一条 pipeline 生成。
3. 用 Playwright 或浏览器逐个打开，**确认 URL 落在 `/note`（NoteShell）**，截图当前形态。
4. 浏览器打开设计稿 `nibi-all-pages.html`，切到 pg-note/audio/image/text，截图目标形态。
5. 形成 4 组「当前 vs 设计稿」对照截图，存 `frontend/test-results/`（gitignore）。
6. 若发现某类笔记默认没走 NoteShell（走了 *ResultPage），**停下回报 Claude**，不要擅自改 *ResultPage。

---

## 4. 分阶段执行

> 每个 Stage 的产出 = 1 个能 build 通过的提交。顺序按依赖：先固化 → 视频（最复杂，建立范式）→ 音频/图片/文本复用范式 → 右栏与顶栏统一 → 回归。

### Stage 0 — 固化半成品（本轮起点）

- **目标**：把工作区未提交的 NoteShell + result CSS 半成品固化成干净 commit。
- **步骤**：
  1. `git status --short` 核对未提交清单确属设计迁移（result CSS、NoteShell、note-shell.css 等）。
  2. `pnpm -C frontend build`（应通过）+ `pnpm -C frontend test`（如失败，确认是否与本次视觉无关，记录）。
  3. 提交：`feat(design): Goal 3 起点 — 固化结果页迁移半成品`。
- **不做**：此 Stage 不改任何视觉，只固化。

### Stage 1 — 视频笔记形态 1:1（设计稿 pg-note 2035-2187）

- **涉及文件**：`NoteShell/index.tsx`（`--video` workbench 段 ~948-1005）、`NoteMediaCompanion.tsx`、`NoteShell/note-shell.css`。
- **设计稿对照区块清单**（左 `.note-left` / 右 `.note-right`）：
  - 顶栏 `.note-bar`：返回「任务中心」+ 标题 + `VIDEO · 12:34` meta。
  - 播放器 `.note-player`：大播放按钮 + 字幕浮层 `.note-subtitle` + 章节标签 `.note-chapter-label`。
  - 控制条 `.note-controls/.note-transport`：播放、±10s、字幕、循环、倍速 `.note-speed`、音量 `.note-volume`。
  - 时间轴 `.note-timeline`：时间、截图、画中画、全屏、进度条 + markers + hover、章节点 `.note-chapters`、缩略图轨 `.note-thumb`。
  - 转录 `.note-transcript`：标题 + 计数 + 逐句列表 `.note-line/.note-ts`（时间戳可点跳转）。
  - 右栏 `.note-right`：标题 + 标签 `.note-tags` + meta + 结构化 `.note-section`（h2/h3 + 引用 `.note-quote`）+ 画中画 `.note-pip`。
- **接真实数据**：播放器接 `note.media.video.url`；转录接真实字幕；右栏正文走 MilkdownEditor 真实笔记；标签/章节接真实数据。
- **保留不砍**：现有逐句字幕编辑、时间码点击 seek、截图补图、版本栈、导出、问 AI。
- **占位留待办**：画中画 `.note-pip`、缩略图轨若无真实帧数据 → 占位 + 登记 §7。

#### Stage 1 进度拆分（Codex 审 `e25c9d3` 后细化）

- **Stage 1.1 ✓ done**（commit `e25c9d3`，Codex：通过）：导出菜单灰显占位、转录头「转录 + N 条」、右栏改 `note-copy`/`note-section` 结构。
- **Stage 1.2 — 视频播放器 transport（⚠️ 难点，先拆细给小米；若反复回归无法收敛则升级 Claude）**：
  - 现状：`LNVideoPanel.tsx`（`pages/results/LearningNotesPage/`）用浏览器**原生 `<video controls>`** + 截图按钮 + 键盘 ±5s。设计稿要自定义 transport：播放/暂停、±10s、字幕、循环、倍速 `.note-speed`、音量 `.note-volume`，及 timeline（进度条+markers+hover、章节点、缩略图轨）。
  - **影响三处共享组件**：`NoteShell` 视频形态、`NoteMediaCompanion`、遗产 `LearningNotesPage` 都 import `LNVideoPanel`；改完必须三处都验证不回归（转录联动 `seekTo`/`onTimeUpdate`、截图、键盘快捷键保留）。
  - 按尺度：做**有真实 video API 支撑**的控件（播放/±10s/倍速/音量/循环/字幕开关/自定义进度条 seek），隐藏原生 controls；**无数据源的（章节点、缩略图轨、画中画、字幕浮层文案）→ 占位/暂不渲染 + §7**，不造假数据。±5s 改 ±10s 对齐设计稿。
- **Stage 1.3 — 引用块/正文对齐（小米，小修）**：补 `.note-section blockquote` 样式（Codex 意见③）；复核右栏正文已由 `MilkdownEditor` 渲染 h2/h3/ul/blockquote、无前端硬编码「关键要点」（Codex 意见②，`e25c9d3` 已满足，仅复核）。

> ⚠️ **跨 Stage 新发现**：generic workbench（音频/文本）当前是「左正文 + 右素材卡（MATERIAL）」结构（`index.tsx:948-994`），与设计稿 pg-audio（左波形播放器+转录 / 右总结）、pg-text（左编辑器 / 右要点）**差异较大，Stage 2/4 是结构重构，不是微调**，工作量需预留。

### Stage 2 — 音频笔记形态 1:1（设计稿 pg-audio 2188-2309）

- **涉及文件**：`NoteAudioPanel.tsx`、`NoteMediaCompanion.tsx`（音频分支）、`note-shell.css`（`--audio` 变体）、`index.tsx`（generic workbench 音频段 ~1158）。
- **设计稿对照**：顶栏 `.audio-topbar`（返回+标题+meta+3 动作）；左 `.audio-player`（波形 `.audio-waveform` + 播放 + 进度 + 时间 + 控制 ±10s/倍速）；`.audio-transcript`（转录文本逐句 + 时间戳）；右栏总结/笔记。
- **接真实数据**：波形/播放接真实音频；转录接真实字幕；说话人若有→保留。
- **注意**：音频页**不要恢复章节区**（若产品已移除）；播放按钮尺寸与视频形态对齐。

### Stage 3 — 图片笔记形态 1:1（设计稿 pg-image 2310-2422）

- **涉及文件**：`index.tsx`（`--image` workbench 段 ~1006-1070）、`note-shell.css`（`--image` 变体）。
- **设计稿对照**：顶栏 `.image-topbar`；左 `.image-gallery`（主图 `.image-main` + 计数 `.image-counter` + 缩略图 `.image-thumbs`）+ `.image-meta`（来源/生成参数/创建时间）；右 `.image-right`（标题 + 标签 + 结构化笔记）。
- **接真实数据**：画廊接 `note.media.images`；meta 接真实来源/时间；右栏走真实笔记。
- **占位留待办**：「生成参数」若图文笔记无该字段 → 占位或省略 + 登记 §7（图文 OCR 笔记≠AI 绘图，参数可能不适用）。

### Stage 4 — 文本笔记形态 1:1（设计稿 pg-text 2423-2546）

- **涉及文件**：`MilkdownEditor.tsx`、`index.tsx`（generic workbench 文本段）、`note-shell.css`（`--text` 变体）。
- **设计稿对照**：顶栏 `.text-topbar`；左 `.text-editor`（工具栏 `.text-editor-toolbar` + 富文本内容 `.text-editor-content`，含 h2/h3/代码块 `.text-code-block`）；右 `.text-right`（标题 + 标签 + meta + 核心要点 + 引用）。
- **接真实数据**：编辑器正文走真实笔记 markdown；右栏接真实要点/总结。
- **保留不砍**：Milkdown 所见即所得、源码对照、自动保存、导出。

### Stage 5 — 右栏结构化笔记 + 顶栏动作统一（4 类共用）

- **涉及文件**：`index.tsx`（`.nibi-note-hero` / `.nibi-note-aside` / `.nibi-note-topbar`）、`note-shell.css`、必要时 `NewSummaryModal`。
- **目标**：4 类形态共用的右栏（结构化笔记 section + 标签 + 引用）与顶栏（返回 + 标题 + meta + 新建总结/导出/AI 工具）样式统一到设计稿，且**动作不在正文区重复**。
- **保留**：导出菜单 enabled/disabled 区分；AI 工具 disabled 标「敬请期待」不伪装可用。

### Stage 6 — 回归验证

- `pnpm -C frontend build` ✓
- `pnpm -C frontend test` ✓（或说明失败与本次视觉无关）
- 手测 4 类笔记结果页：打开渲染、播放/波形/画廊/编辑器、转录跳转、新建总结、导出、问 AI、保存状态、暗色模式。
- 确认 4 个 *ResultPage（复刻向）未被波及。
- 产出报告 `docs/test-reports/`：改了哪些文件、为什么、命令结果、手测通过项、未验证项与原因、§7 待办增量。

---

## 5. 给小米的执行提示词（逐 Stage 复制）

> 通用前缀（每个 Stage 都先做）：
> 你在 `/Users/conan/Desktop/nibi`，分支 `feat/exp-redesign-p1`。先 `git status --short --branch && git log --oneline -3`；
> 若分支不符或有非本任务未提交改动，停下回报。读 `docs/plans/exp-redesign-result-pages-1to1-2026-06-27.md` 的 §1/§2/§3 与对应 Stage。
> 设计稿在 `/Users/conan/Library/Application Support/Open Design/.../2bfc4c3c-.../nibi-all-pages.html`，对照行号读对应 pg-* 段。
> 尺度：视觉/布局/文案 1:1，数据接真实，不砍现有功能，设计稿有但无数据支撑的做占位并登记 §7。红线见 §2。
> 改完 `pnpm -C frontend build` 必须通过再提交；一个 Stage = 一个提交；禁止改路由/payload/后端/4 个 *ResultPage 布局。

- **Stage 0**：执行 §4 Stage 0，固化半成品为干净 commit。
- **Stage 1**：执行 §4 Stage 1，把 NoteShell 视频形态对齐设计稿 pg-note（2035-2187）。先按 §3 截当前 vs 设计稿对照图。
- **Stage 2-4**：分别对齐音频 pg-audio / 图片 pg-image / 文本 pg-text，复用 Stage 1 范式。
- **Stage 5**：统一右栏与顶栏。
- **Stage 6**：回归验证 + 出报告。

每个 Stage 完成后回报：改了哪些文件、对照设计稿哪些区块、build/test 结果、手测截图路径、§7 新增待办。需判断或与设计稿冲突处，回报 Claude，不擅自决定。

---

## 6. 给 Codex 的审查提示词（每 Stage 完成后复制）

> 审查 `feat/exp-redesign-p1` 上小米刚提交的 Stage N（结果页 1:1 还原，计划见 `docs/plans/exp-redesign-result-pages-1to1-2026-06-27.md`）。
> 在干净 checkout / worktree 上跑 `pnpm -C frontend build` 与 `pnpm -C frontend test`。
> 判断：①是否守住 §2 红线（未改路由/payload/后端/*ResultPage 布局，未引入 hex/Instrument Serif/负 letterspacing）；
> ②是否符合尺度（视觉 1:1、数据接真实、未砍现有功能、无数据项有占位且登记 §7）；
> ③build/test 是否通过。给出 通过 / 不通过 / 需补验证，并列 file:line 证据。

---

## 7. 后续待办（设计稿有、当前无数据/功能支撑，逐步完善）

> Stage 5+6 验收后最终清单（2026-06-28）。详见 `docs/test-reports/stage5-6-acceptance-2026-06-28.md`。

| # | 来源 | 占位项 | 状态 | 建议 |
|---|---|---|---|---|
| §7-1 | Stage 1 | 视频画中画 `.note-pip` | 未渲染 | 后续做 — 需确认浏览器 PiP API |
| §7-2 | Stage 1 | 缩略图轨真实帧数据 | ✅ 已接真实 videoFrames | 可移除 |
| §7-3 | Stage 1 | 章节标签 `.note-chapter-label` | 未渲染（无数据源） | 后续做 — 需后端章节数据 |
| §7-4 | Stage 1 | 导出 PPTX/PDF/Word/长图/沉浸式 | disabled 灰显占位 | 后续批次逐个接入 |
| §7-5 | Stage 3 | 图片「生成参数」 | 不适用于图文 OCR 笔记 | 建议移除 |
| §7-6 | Stage 3 | 图片「创建时间」meta | ItemNote 无 created_at | 后续做 — 需 API 变更 |
| §7-7 | Stage 4 | 文本笔记工具栏 B/I/H/• | disabled 占位 | 后续做 — Milkdown 命令接入 |
| §7-8 | Stage 5 | AI 工具：思维导图/海报 | disabled 灰显 | 后续做 |
| §7-9 | 后续 | 合集/复刻/资料库/收藏/知识库/搜索/设置/主页/处理页 | 非首批范围 | P2+ 批次 |
