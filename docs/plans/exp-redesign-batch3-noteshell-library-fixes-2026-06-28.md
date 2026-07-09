# Batch3 · 笔记页/播放器/库页 9 项修复 — Codex 执行计划

status: ready
日期：2026-06-28
分支：`feat/exp-redesign-p1`
执行：**Codex 直接执行 + 自验证**（无独立审查者，红线需自查）

> 接 batch2（`docs/plans/exp-redesign-batch2-remaining-pages-2026-06-28.md`，已完成至 `74051db`）之后，用户真机使用又提的 9 项问题。
> 设计稿（只读对照源）：`/Users/conan/Library/Application Support/Open Design/namespaces/release-stable/data/projects/2bfc4c3c-b63e-49f2-ad5c-a0e210cfdb3e/nibi-all-pages.html`。
> **红线沿用 batch2 §1**（不改契约/路由/payload/状态机；不写死 hex；复用 Nibi token 与 note-card 范式；不删现有功能；API key 遮罩；一项一提交 build+test 通过）。

---

## 0. 接手前对账

```bash
git status --short --branch && git log --oneline -8
```
确认只有本会话动这个工作树（batch2 期间发生过并发裹挟事故）。工作区应干净；`pnpm -C frontend build` 先确认基线可构建。

---

## 1. 用户决策（已拍板，照此做）

- **问题 6**：两个「新建总结」合并 → **只留风格/版本下拉里**，AI 工具下拉去掉重复项。
- **问题 4**：**完整编辑器设置面板**（字体/字号/行高/颜色/加粗）。
- **问题 8**：笔记页**按设计稿 `pg-notes`**——单一网格 + 筛选 chip（含「合集」），**取消「合集区/笔记区」两段式**。
- **问题 3**：顶部状态栏**变矮 + chip 紧凑**。
- **问题 5**：播放器全屏 = **仅视频全屏播放**（推翻 batch2 §3.9② 的"整工作台全屏"）。
- **问题 2**：画中画 = **设计稿内嵌悬浮窗范式**（推翻 batch2 §3.9③ 的浏览器原生 PiP）。

---

## 2. 逐项：现象 → 根因 → 设计稿依据 → 修复 → 涉及文件

### 2.1【问题1】中间分栏让视频可缩到更小

- 现象：拖分隔条，视频最小只能到当前这么大，想更小。
- 根因：`NoteShell/index.tsx` `VIDEO_SPLIT_MIN = 42`（行 69），左栏占比下限 42%。
- 修复：把 `VIDEO_SPLIT_MIN` 降到 **20**（或加「折叠/最小化播放器」态）。"无限小"有下限：控制条/转录需最小可用空间，20% 较稳；如需更激进可到 15。同步 `VIDEO_SPLIT_DEFAULT` 保持 60、`localStorage` clamp 用新下限。
- 文件：`frontend/src/pages/result/NoteShell/index.tsx`。
- 验收：拖分隔条左栏可缩到 ~20%，播放器随之变小不破版。

### 2.2【问题5】全屏 = 仅视频全屏播放（推翻 batch2）

- 现象：点播放器全屏，全屏的是"视频 + 右侧总结"整工作台，用户要的是纯视频全屏。
- 修复：
  - `LNVideoPanel.tsx` `getFullscreenTarget()` 改回**只针对播放器容器**：`v?.closest('.nibi-note-player-wrap') ?? v?.closest('.ln-video-wrapper') ?? videoRef.current`（不再 `.nibi-note-page`）。
  - `note-shell.css`：删 batch2 加的 `.nibi-note-page:fullscreen` 规则，改为 `.nibi-note-player-wrap:fullscreen{ width:100vw; height:100vh; aspect-ratio:auto; background:#000; }`，内部 `<video> object-fit:contain` 自然铺满黑底；字幕浮层（在 player-wrap 内）仍可见，自绘控制条可隐藏。
- 文件：`LNVideoPanel.tsx`、`note-shell.css`。
- 验收：点全屏只剩纯视频铺满屏幕、无右侧总结/转录；ESC 退出按钮态同步。

### 2.3【问题2】画中画 = 设计稿内嵌悬浮窗（推翻 batch2 原生 PiP）

- 现象/诉求：进画中画后，**背景应是总结正文占满**（左侧视频列/字幕隐藏），右上角弹出可拖拽迷你播放器，**迷你窗上方再加截屏按钮**。
- 设计稿依据：markup `#notePip`（行 2169-2186）、CSS `.note-pip*`（809-824）、JS `toggleNotePip/exitNotePip`（5500-5536）；`.note-page.is-pip .note-left{display:none}` + `.is-pip .note-right{flex:1}`（735-738）。
- 修复（替换 batch2 的原生 PiP 实现）：
  - 去掉 `LNVideoPanel` 里 `requestPictureInPicture()` 那套；画中画按钮改为切换 NoteShell 的 `isPip` 态。
  - `is-pip` 时：`.nibi-note-page` 加 `is-pip` class → CSS 隐藏 `.nibi-note-left`、`.nibi-note-right` 占满。
  - 渲染 `.note-pip` 悬浮窗（固定右下、可拖拽、尺寸档位）：内含视频 + 字幕 + 控制条（播放/进度/**截图**/尺寸/关闭）。视频源复用同一 `<video>`（注意单 video 元素跨容器移动或共享 currentTime 同步）。
  - 截图按钮复用现有 `handleScreenshot`。
- 文件：`NoteShell/index.tsx`、`LNVideoPanel.tsx`、`note-shell.css`。
- ⚠️ 实现注意：单个 `<video>` 不能同时在两处 DOM 渲染；方案二选一并在报告说明——(a) 把同一 video 节点移动到 pip 容器（退出再移回）；(b) pip 用第二个 video 共享 src + 同步 currentTime/playing。推荐 (a)。
- 验收：点画中画 → 左侧视频列消失、右侧总结占满；右下悬浮迷你播放器可拖拽、可播放/截图/关闭；退出还原。

### 2.4【问题3】顶部状态栏变矮 + chip 紧凑

- 根因：`AppShell.tsx` 顶栏 `py-2.5`（行 271）+ 两个 chip `px-2.5 py-1 text-xs`（277-304）占一整行。
- 修复：顶栏 `py-2.5 → py-1`（或 `py-1.5`）；chip 改更小 `px-2 py-0.5 text-[10px]`、间距收紧；可只在非 print 显示。保留后端状态/CPU/MEM 信息与 `online` 颜色点。
- 文件：`frontend/src/layouts/AppShell.tsx`。
- 验收：顶栏明显变矮，下方内容区可视高度增加；chip 信息仍清晰。

### 2.5【问题4】编辑器设置面板（字体/字号/行高/颜色/加粗）

- 诉求：右侧笔记正文字体太大；要可调字体族/字号/行高/颜色/加粗等。
- 设计落点：在右栏顶部（或顶栏）加「Aa 设置」按钮，点开弹出面板。**区分两类**：
  - **显示设置（作用于整篇正文渲染）**：字体族、字号、行高、正文颜色 → 写成 CSS 变量挂在 `.nibi-note-right`/note-copy 上，存 `localStorage`（如 `nibi.note.editorPrefs`）。**默认字号下调**（解决"太大"）。
  - **文本命令（作用于选中/光标）**：加粗等 → 复用现有 `useLnEditorStore.insertAtCursor` 包 `**...**`（codex 先确认 LnEditor 命令能力，受限则只做显示设置 + 加粗，其余标注）。
- 红线：不写死 hex（颜色用 token 或受控变量）；不改 Markdown 数据契约（显示设置只改渲染 CSS，不改存盘内容）。
- 文件：右栏编辑器组件（codex 定位 `LnEditor`/note-copy 渲染处）、`note-shell.css`、可能新增 `EditorPrefsPanel` 组件 + store。
- 验收：面板可调并实时生效、刷新保留；默认字号变小；加粗作用于选中文本且写入 Markdown。
- ⚠️ 遇停：若 LnEditor 不支持选区命令而要大改编辑器内核 → 停下标注，先交付显示设置部分。

### 2.6【问题6】合并两个「新建总结」+ 创建状态反馈

- 根因：`NoteShell/index.tsx` 风格/版本下拉「+ 新建总结…」（行 752）与 AI 工具下拉「新建总结」（行 790）都调 `setShowNewSummaryModal(true)`，重复。
- 修复：
  - **删 AI 工具下拉里的「新建总结」**（行 790），只留风格/版本下拉里那个；AI 工具下拉只留真实 AI 功能（暂仅「敬请期待」占位）。
  - **创建状态反馈**：`creatingSummary` 期间右上角弹 toast/进度（复用现有 toast）+ 按钮 loading 态；完成/失败 toast 提示。检查 `handleCreateSummary` 流程补上状态。
- 文件：`NoteShell/index.tsx`。
- 验收：只有一个新建总结入口；点击后有"生成中"状态、完成有提示；AI 工具下拉无重复项。

### 2.7【问题8】笔记页按 `pg-notes`：单网格 + 筛选 chip，去重

- 现象：笔记页顶部「合集」分区 + 下方「笔记」分区两段，重复；「查看合集」CTA 跳首页。
- 设计稿依据：`pg-notes`（行 1707）——**一个 `#notesGrid` 网格**容纳 collection-card 与 note-card；筛选 chip：全部/视频/音频/图文/文本/**合集**/生成中（行 1728-1734）；hero「查看合集」= 打开合集文件夹（行 1718-1721），非首页。
- 修复（`LibraryPage/index.tsx`）：
  - 取消「Workspace 区 + Item 区」两段式（行 405-431 / 433-477）→ **合集卡与笔记卡并入同一 `note-grid`**；用筛选 chip「合集」过滤合集类（FilterChips 增加 collection 维度）。
  - 去重：已归入合集的条目不在网格里重复出现（或按设计语义：合集是一种卡片，独立条目正常列；codex 按 pg-notes 数据语义对齐，避免同一条既在合集卡又单列重复）。
  - 修「查看合集」CTA：`navigate('/')`（行 325-327）→ 改为打开合集/资料库视图（如 `/library` 或合集筛选态），**不跳首页**。
  - 合集卡 onClick 已是 `/workspaces/:id`（WorkspaceCard 行 71，正确，保留）。
- 文件：`LibraryPage/index.tsx`、`FilterChips.tsx`、`WorkspaceCard.tsx`、`library.css`。
- ⚠️ 遇停：若"去重"涉及后端返回的 items/workspaces 数据语义（合集内条目是否单列）需改数据契约 → 停下标注，仅做前端展示层去重。
- 验收：笔记页单一网格、筛选 chip 含「合集」、无两段重复；「查看合集」不跳首页；合集卡点击进合集详情。

### 2.8【问题7】合集详情卡片接封面缩略图

- 现象：打开合集（`TaskboardPage`）内卡片没图片封面，与 `pg-collection` 差距大。
- 设计稿依据：`pg-collection`（行 1874）头部 `coll-header`（返回/标题/描述/篇数+更新）+ 工具栏（筛选/搜索/视图）+ `coll-grid` 卡片（`.note-cover` 缩略图，按类型 cover 渐变）。
- 修复：`TaskboardPage` 卡片（`MaterialCard`，`.mat-thumb` 行 89）接真实 `thumbnail`/按类型 cover 渐变，复用库页 `note-cover`/`cover-video|audio|image|text` 范式；头部对齐 `coll-header`。
- 文件：`WorkspacePage/TaskboardPage/MaterialCard.tsx`、`index.tsx`、相关 css。
- 验收：合集详情卡片有封面（有缩略图显图、无则按类型渐变 + 图标），头部与 pg-collection 一致。

### 2.9【问题9】列表视图补封面（对齐设计 `.note-grid.is-list`）

- 现象：横向列表态无封面，与设计差距大。
- 根因：`LibraryPage/ListView.tsx` 是 `<table>` 无封面列；设计稿用 `.note-grid.is-list`——卡片重排为列表行但**保留 `.note-cover`**（CSS 行 452/472 `.note-grid.is-list .note-cover{height:100%}`）。
- 修复（二选一，推荐 a）：
  - (a) **对齐设计**：列表态复用 `ItemCard`/note-card，用 `.note-grid.is-list` 重排（带封面），弃用 table。
  - (b) 最小改：给 table `ListView` 加一列封面缩略图（复用 ItemCard 的 cover 逻辑）。
- 文件：`LibraryPage/ListView.tsx`、`ItemCard.tsx`、`library.css`。
- 验收：列表态每行有封面（缩略图或类型渐变），视觉贴近 pg-notes 列表态。

---

## 3. 执行顺序（建议）

1. 问题3 顶栏变矮（小、独立，先拿下空间）
2. 问题1 分栏下限
3. 问题5 仅视频全屏（推翻 batch2，先做好再做 PiP）
4. 问题6 合并新建总结 + 状态
5. 问题9 列表封面
6. 问题8 笔记页单网格（IA 改动较大）
7. 问题7 合集详情封面
8. 问题4 编辑器设置面板（新功能，较大）
9. 问题2 内嵌画中画（最复杂，单 video 跨容器）

每项：`./dev.sh` 起真实页对照设计稿 → 改（复用 Nibi 范式/token）→ `pnpm -C frontend build` + `pnpm -C frontend test` → **一项一提交** `fix(design): X 修复（pg-X）`。

---

## 4. 自验证（无独立审查，必须自查）

每项改完自查红线：
- [ ] 无写死 hex（新增色用 token / 受控 CSS 变量）
- [ ] 无契约改动（路由 / payload / `note.media` / intent / 状态机 / 后端返回结构）
- [ ] 现有功能未砍（导出/AI/版本/截图/倍速/音量/循环/进度/选择/删除/打开）
- [ ] API key 等密钥遮罩
- [ ] 复用 note-card / token / 既有范式
- 截「当前 vs 设计稿」对照图存 `frontend/test-results/`

---

## 5. 遇到即停（不擅自做）

- 问题2：单 `<video>` 跨容器若需大改播放器架构 → 标注所选方案与风险。
- 问题4：LnEditor 不支持选区命令而需改编辑器内核 → 先交付显示设置，其余标注。
- 问题8：去重涉及后端数据语义 / 需改契约 → 停下，仅做前端展示层。
- 任何需改后端/DB/契约才能完成的 → 停下标注。

---

## 6. 交付

- 全部完成 `pnpm -C frontend build` + `test` 全绿。
- 报告 `docs/test-reports/exp-redesign-batch3-2026-06-28.md`：每项现象/根因/改动文件、对照图、真机结果、红线自查、遇停/标注项。
