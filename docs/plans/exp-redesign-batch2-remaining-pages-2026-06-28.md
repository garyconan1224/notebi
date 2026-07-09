# 剩余页面 1:1 还原设计稿 — Codex 执行计划

status: ready
日期：2026-06-28
分支：`feat/exp-redesign-p1`
执行：**Codex 直接执行 + 自验证**（无独立审查者，红线需自查）

---

## 0. 背景

用户在 Open Design 重做 Nibi 全套 UI。设计稿（只读源，对照用）：

```
/Users/conan/Library/Application Support/Open Design/namespaces/release-stable/data/projects/2bfc4c3c-b63e-49f2-ad5c-a0e210cfdb3e/nibi-all-pages.html
```

**已完成（git，勿重做）**：四类笔记结果页 `pg-note/audio/image/text`（NoteShell）、搜索 `pg-search`、设置 `pg-settings`、主页 `pg-home`。

**本计划范围**：剩余页面，Codex 逐页对齐设计稿；**外加视频笔记详情页 `pg-note` 的 4 项播放器交互修复（§3.9，功能/交互 bug，非纯视觉）**。

**⚠️ 并发事故（接手前必读）**：本计划起草期间，曾有另一会话与本任务在**同一工作树 `/Users/conan/Desktop/nibi`、同分支 `feat/exp-redesign-p1`** 并发提交，导致 §3.9 的播放器改动被裹进提交 `d71a6c9`「收藏+分镜页 pg-favorites/pg-storyboard」（未单独成 commit）。接手第一步：`git status --short --branch && git log --oneline -8` 对账，确认**只有本任务一个会话**在动这个工作树；§3.9 改动是否已在 HEAD 见 §3.9 自带对账命令，缺则补、全则只验证，**勿重复实现**。若 HEAD 因他人遗留无法 build（如 `FavoritesPage.tsx` 的 `ArrowRight` 未使用 import），先确认非本任务所致再随手修掉使 HEAD 可构建。

---

## 1. 尺度与红线（必读，与首批一致）

**尺度**：

1. 视觉/布局/文案 1:1 对齐设计稿。
2. 数据接真实后端数据，不用设计稿示例文案。
3. 设计稿没画、但当前/后端已有的真实功能 → **保留不砍**。
4. 设计稿有、但当前无数据/功能支撑 → **占位 + 在本文件 §6 登记**，不造假数据/假功能。

字体：得意黑（Smiley Sans）只进品牌/页面标题/章节标题；Inter 正文；JetBrains Mono 元信息（时间/ID/状态/版本）。

**红线（违反即回滚）**：

- 不改业务契约：路由、`generateNote / savePreflight / startItemPipeline` payload、结果页 `intent`、数据 contract、`note.media`、pipeline 状态机。
- 不改后端/数据库/鉴权；**API key 等密钥必须遮罩，绝不明文**。
- 复用已建立的 Nibi 范式（`note-card` / 表单组件 / 顶栏 / token），不另起一套。
- 不写死 hex / 不用 `Instrument Serif` / 不用负 letter-spacing；新增色一律 Nibi token。
- **不发明新功能、不新建大功能页**；设计稿有但当前无对应页面/数据的 → 停下标注，跳过，不擅自新建。
- 每页改完 `pnpm -C frontend build` + `pnpm -C frontend test` 必须通过；**一页一提交**。

完整红线见首批计划 `docs/plans/exp-redesign-result-pages-1to1-2026-06-27.md` §2。

---

## 2. 页面清单 + 映射（设计稿 ↔ 当前文件）

| 页面 | 设计稿(行号) | 当前文件 | 备注 |
|---|---|---|---|
| 资料库 | `pg-resources` 2722 | `LibraryPage` (`/library` 无 kind) | ↓ 三态**共用 LibraryPage** |
| 笔记库 | `pg-notes` 1707 | `LibraryPage` kind=note (`/notes`) | |
| 复刻库 | `pg-replicas` 2642 | `LibraryPage` kind=replica (`/replicas`) | |
| 合集详情 | `pg-collection` 1874 | `WorkspacePage/TaskboardPage` (`/workspaces/:id`) | |
| 复刻详情 | `pg-replica` 2547 | `*ResultPage` 复刻向 (intent=replica) | 基于 `VideoResultPage` intent 分支，**不新建孤岛页** |
| 分镜 | `pg-storyboard` 2884 / `pg-storyboard-detail` 2803 | `StoryboardPage` (`/storyboard`) | 详情若是内部视图按现有结构 |
| 收藏 | `pg-favorites` 2960 | `FavoritesPage/FavoritesPage.tsx` (`/favorites`) | |
| 处理页 | `pg-processing` 3517 | `result/ProcessingPage/index.tsx` (`/processing/:taskId`) | |
| 知识库 | `pg-knowledge` 3043 | **无对应路由** | ⚠️ 当前无页面，**跳过 + 标注待用户确认，勿擅自新建** |
| (复查)笔记结果页 | `pg-note/audio/image/text` | `NoteShell` | 首批已完成，**仅复查一致性，非重做** |
| 视频笔记播放器修复 | `pg-note` 2035 + JS 5463/5500/5555 | `LNVideoPanel` + `NoteShell` | **功能 bug 修复，见 §3.9**（缩放/全屏/字幕/画中画/顶栏收敛） |

---

## 3. 逐页要点

> 每页：① 先 `./dev.sh` 起真实环境打开该页 + 读设计稿对应行号对照；② 改视觉（复用 Nibi 范式）；③ build+test；④ 一页一提交 + 自查红线 + 截对照图存 `frontend/test-results/`。

### 3.1 资料库 / 笔记库 / 复刻库（LibraryPage，一个组件三态）

- 三态共用 `LibraryPage`，按 `kind`（note / replica / 无=资料库）派生标题、卡片语言、空状态、CTA，**视觉区分但逻辑共用，勿拆分逻辑**。
- 对照 `pg-resources/notes/replicas`：网格/列表 + 卡片（封面/标题/类型/meta/状态）+ 筛选/排序/搜索 + 空态。
- 复用 Nibi `note-card` 样式（与结果页/主页一致）。接真实 workspace/item 列表；保留网格↔列表切换、批量选择、删除、打开等现有功能。

### 3.2 合集详情（TaskboardPage）

- 对照 `pg-collection`：合集头部 + 素材网格 + 操作区。接真实 workspace/items；保留添加素材、素材卡操作、Modal 弹层等现有功能，**不改添加素材提交逻辑**。

### 3.3 复刻详情（*ResultPage 复刻向）

- 对照 `pg-replica`：主帧大图 + 缩略图轨 + 提示词格式 tabs + 批量复制 + 导出复刻包 + 提示词版本栈。
- 基于 `VideoResultPage` 的 `intent==='replica'` 分支（及其他 `*ResultPage` 复刻向），**不新建脱离数据契约的孤岛页**。保留复制/批量复制/导出复刻包/版本栈功能。媒体工作台可保留高对比暗色帧区，但外层 shell/按钮/标签 Nibi 化，替换 emoji fallback。

### 3.4 分镜（StoryboardPage）

- 对照 `pg-storyboard`（库）+ `pg-storyboard-detail`（详情）。接真实分镜数据；保留现有功能。详情若为 StoryboardPage 内部视图，按现有结构对齐，不强行拆路由。

### 3.5 收藏（FavoritesPage）

- 对照 `pg-favorites`：收藏列表/卡片。复用 `note-card` 样式；接真实收藏数据；保留取消收藏、打开等。

### 3.6 处理页（ProcessingPage）

- 对照 `pg-processing`：处理步骤/进度/日志/任务状态。接真实 pipeline 状态（SSE/轮询）；保留步骤进度、实时日志、错误展示等；**不改状态机/轮询/SSE 逻辑**，只改视觉。

### 3.7 知识库（pg-knowledge）⚠️

- 当前**无对应路由**。**不擅自新建知识库页**（红线：不发明功能）。在报告标注「`pg-knowledge` 无对应页面，需用户确认是否新建」，**跳过**。

### 3.8 笔记结果页四类（复查，非重做）

- `pg-note/audio/image/text` 首批已完成。仅复查：四类与设计稿是否仍一致、有无被本批公共 CSS 改动波及。发现回归才修。

### 3.9 视频笔记播放器 4 项交互修复（功能 bug，非纯视觉）

> 页面用 **NoteShell** 视频态：`.nibi-note-page`（整工作台）/ `.nibi-note-left` / `.nibi-note-player-wrap`；播放器组件 `LNVideoPanel`；控制条经 `renderTransportInline={false}` + `transportNode` getter 渲染在 player-wrap 外。
> 涉及文件 3 个：`frontend/src/pages/results/LearningNotesPage/LNVideoPanel.tsx`、`frontend/src/pages/result/NoteShell/index.tsx`、`frontend/src/pages/result/NoteShell/note-shell.css`。**零后端/契约改动**。

**对账（先做）**——确认改动是否已在 HEAD（并发事故，见 §0）：

```bash
git show HEAD:frontend/src/pages/results/LearningNotesPage/LNVideoPanel.tsx | grep -nE "togglePip|toggleSubtitles|subtitlesOn|nibi-note-page"
git show HEAD:frontend/src/pages/result/NoteShell/note-shell.css        | grep -nE "aspect-ratio: 16 / 9|nibi-note-page:fullscreen|nibi-note-bar-btn--label|nibi-note-bar-btn--accent"
git show HEAD:frontend/src/pages/result/NoteShell/index.tsx             | grep -nE "nibi-note-bar-btn--label|nibi-note-bar-btn--accent"
```
缺项按下文补，全在则只做 §5 真机验证。**勿重复实现**。

**① 视频跟随分栏缩放、消黑边**
- 根因：`note-shell.css` `.nibi-note-player-wrap` 用 `height: clamp(240px, 56.25cqw, 52vh)`，`52vh` 上限卡死高度，配 `<video> object-fit:contain` → 16:9 视频在矮胖盒子里左右黑边。
- 设计稿依据：`.note-player{aspect-ratio:16/9}`（行 745）。
- 改：`.nibi-note-player-wrap` 改 `width:100%; aspect-ratio:16/9;`，删 clamp 高度。盒子宽度随 `.nibi-note-left`（分隔条）变 → 连续缩放、无黑边。

**② 全屏 = 整个工作台**
- 根因：`LNVideoPanel.tsx` `getFullscreenTarget()` 只全屏 `.nibi-note-left`，且旧 `.nibi-note-left:fullscreen` CSS 把视频 letterbox、转录压 200px。
- 设计稿依据：`toggleNoteFullscreen()` 全屏 `videoNoteWorkbench`（整 `.note-page`，行 5555-5572）。
- 改：`getFullscreenTarget()` → `v.closest('.nibi-note-page') ?? v.closest('.nibi-note-left') ?? panelRef.current`；`note-shell.css` 把 `.nibi-note-left:fullscreen` 整块换成 `.nibi-note-page:fullscreen{ width:100vw; height:100vh; max-height:none; background:var(--bg); }`，整页正常 flex 铺满、16:9 播放器自然变大。

**③ 字幕开关 + 原生画中画**
- 根因：`LNVideoPanel.tsx` 两按钮硬编码 `disabled`、无 onClick。
- 设计稿依据：`toggleNoteSubtitles()`（行 5463）、`toggleNotePip()`（行 5500，自绘悬浮窗 mock）。
- 改：
  - 字幕：新增 `subtitlesOn` state(默认 true)；CC 键 `onClick` 切换 + `is-on` 高亮 + `disabled={!subtitle}`；浮层 `{subtitlesOn && subtitle && ...}`。
  - 画中画：真实 `<video>` 用**浏览器原生** `requestPictureInPicture()/exitPictureInPicture()`（比 mock 自绘窗更实在）；新增 `isPip` state，监听 video `enterpictureinpicture`/`leavepictureinpicture` 同步高亮；`disabled={!src}`。
  - `isPip`、`subtitlesOn` 加入 `onTransportChange` 依赖数组（控制条经父 getter 渲染，需通知父刷新）。

**④ 右上角按音频/图文页范式收敛（保留全部功能）**
- 现状：右上角散落 风格/版本下拉、↗ 原链接、源 md、导出、AI 工具，与设计稿不符。
- 设计稿依据：`pg-note` 顶栏右侧仅 `VIDEO · 12:34`（行 2044-2046）；导出/AI 工具视觉范式在音频/图文页 `.audio-topbar-btn`（行 2199-2216 / CSS 1036-1040，AI 工具 `--accent`）。
- 决策（用户拍板）：**保留全部功能，只统一视觉**——导出/AI 工具/风格版本改带文字药丸主按钮，AI 工具 accent；↗/源 md 留小图标次要位。**不删任何功能**（红线）。
- 改：`note-shell.css` 新增 `.nibi-note-bar-btn--label`（auto 宽 + padding + 600，套 `.audio-topbar-btn` 观感）与 `.nibi-note-bar-btn--accent`（accl/acc token，hover 反色）；`index.tsx` 导出加 `--label`+文字「导出」、AI 工具加 `--label --accent`+文字「AI 工具」、风格/版本下拉加 `--label`（防 32px 固定宽裁字）。

**验收（§5 真机逐项核对）**：拖分隔条播放器连续缩放无黑边；点全屏整页铺满、视频变大无黑边、ESC 同步;CC 键切字幕显隐+高亮;画中画弹原生 PiP+退出+高亮;外链视频两键合理灰显;导出/AI 工具为设计系统药丸(AI accent)且下拉功能与原先一致、窄屏不裁切。

---

## 4. 执行协议（Codex）

**顺序建议**（覆盖面/复用度优先 → 复杂度递增）：

1. **LibraryPage 三态**（3.1，覆盖资料库/笔记库/复刻库，面最大、建立列表范式）
2. **收藏**（3.5，复用 note-card）
3. **合集详情**（3.2）
4. **处理页**（3.6）
5. **分镜**（3.4）
6. **复刻详情**（3.3，最复杂）
7. **知识库**（3.7，跳过 + 标注）
8. **复查四类结果页**（3.8）
9. **视频笔记播放器 4 项修复**（3.9，**先对账 HEAD**：已落 `d71a6c9` 则只验证，缺项补；改动单独成 commit `fix(design): 视频笔记播放器交互修复 pg-note`）

**每页流程**：打开真实页 + 读设计稿对照 → 改视觉（复用 Nibi 范式）→ `pnpm -C frontend build` + `test` 通过 → 一页一提交 `feat(design): X 页对齐设计稿 pg-X`。

**自验证（无独立审查，必须自查）**：每页改完自查 → 无写死 hex / 无契约改动 / 现有功能未砍 / API key 遮罩 / 复用 Nibi token；截当前 vs 设计稿对照图存 `frontend/test-results/`。

**遇到即停**：无对应页面 / 需新建功能 / 需改契约 / 与设计稿语义冲突（如设计稿用 AI 绘图示例但实际是 OCR 笔记）→ 停下，在报告标注，不擅自做。

**§3.9 专属遇停**：① 4 项改动既不在 HEAD 也不在工作树 → 疑被并发覆盖，停下报告勿盲目重写；② 用户若后续要「全屏=仅视频元素原生全屏」（不同于当前"整工作台全屏"）→ 产品取舍，等用户拍板。

---

## 5. 验证与交付

- 全部完成：`pnpm -C frontend build` + `pnpm -C frontend test` 全绿。
- 报告 `docs/test-reports/exp-redesign-batch2-2026-06-28.md`：每页改了哪些文件、对照了哪些区块、§6 占位项、手测结果、跳过项（知识库）、待用户确认项。
- 手测各页：打开渲染、核心交互（列表/筛选/打开/添加素材/处理状态/复刻复制导出/取消收藏），四类结果页未回归。

---

## 6. 占位 / 待确认登记（Codex 执行时追加）

- `pg-knowledge` 知识库：当前无对应路由 → 待用户确认是否新建独立页。
- （其余执行中发现的「设计稿有、当前无数据/功能」项追加于此。）
