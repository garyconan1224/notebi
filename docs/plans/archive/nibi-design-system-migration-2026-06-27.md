# Nibi 设计系统整体审查与执行计划

日期：2026-06-27

用途：给下一位执行模型使用。本文只做调查、问题归纳和可执行计划，不修改 `/Users/conan/Desktop/nibi` 业务代码。

## 0. 一句话结论

Nibi 的 Open Design 主原型已经接近目标视觉方向：暖中性底色、琥珀强调色、得意黑标题、Inter 正文、JetBrains Mono 状态信息。但真实 React 项目还保留 VidMirror / 旧结果页 token、Instrument Serif 显示字体、大量 inline style 和局部硬编码色值。下一步不应继续堆 HTML 原型，而应把 Nibi 设计系统收敛成 React 项目的唯一 token 与组件规范，再按路由迁移。

## 1. 本次检查范围

### Open Design 项目文件

- `nibi-all-pages.html`：当前主原型，429 KB。
- `nibi-planning-review.html`：上一轮生成的规划审查页。
- `note-split-screen.html`、`audio-note.html`、`modal-5layouts.html`、`settings-layouts.html`：关键视觉参考。
- `critique.json`：上一轮五维自评。

### 只读源码仓库

- 路径：`/Users/conan/Desktop/nibi`
- 当前分支：`feat/exp-redesign-p1`
- 最近提交：
  - `a02b568 feat(merge): 融合功能 — 多素材笔记 LLM 合成综合笔记`
  - `a9590a7 feat(share): 导出自包含 HTML（后端 + 前端）`
  - `51ccbbe feat(share): 分享菜单 + 复制 Markdown 到剪贴板`
  - `f658c1e feat(taskboard): 布局重组 — BiliNote式头部+素材网格默认主体+Modal弹层`
  - `d38faf4 fix(tests): 同步测试代码到最新接口变更`
- 准备前工作树状态：曾存在未跟踪 `docs/plans/*.md` 和 `test-results/`。交给执行模型前应以实时 `git status --short --branch` 为准；若仍看到同主题未提交改动，必须先停下确认，不能直接覆盖。

## 2. 已确认的事实证据

### 2.1 主原型已经接入得意黑，但 token 不是最终规范

证据：

- `nibi-all-pages.html:7` 已加载 `Smiley Sans`。
- `nibi-all-pages.html:11-13` 定义了 display/body/mono 字体栈。
- `nibi-all-pages.html:18` 当前琥珀强调色是 `oklch(62% 0.20 55)`，而 Nibi 设计系统规范是 `oklch(62% 0.16 55)`。
- `nibi-all-pages.html:26-31` 同时保留新 token 别名 `--fd/--fb/--fm` 和旧长命名 `--font-display/--color-*`。

判断：

主原型的视觉方向对，但 token 还不是设计系统的唯一事实源。执行时要先统一 token，再迁移组件。

### 2.2 主原型结构完整，但仍是单文件演示形态

证据：

- 页面入口存在：`pg-home`、`pg-notes`、`pg-collection`、`pg-note`、`pg-audio`、`pg-image`、`pg-text`、`pg-replica`、`pg-replicas`、`pg-resources`、`pg-storyboard`、`pg-favorites`、`pg-knowledge`、`pg-search`、`pg-settings`。
- 页面映射在 `nibi-all-pages.html:3325-3340`。
- sidebar 收缩后网格从 3 列到 4 列的行为已在 `nibi-all-pages.html:94-97` 写入。
- 静态统计：无重复 ID；但有 `526` 个 inline style、`284` 个 inline onclick、`90` 个 hex 颜色命中。

判断：

主原型适合作为视觉蓝图，不适合直接当成 React 实现方式。执行端应该抽组件、抽 CSS，而不是复制 inline 样式。

### 2.3 React 路由已经分层，不能按单 HTML 思路实现

证据：

- `frontend/src/router.tsx:59-65`：`/`、`/library`、`/notes`、`/replicas` 已是独立路由，其中 notes/replicas 共用 `LibraryPage` 并传 `kind`。
- `frontend/src/router.tsx:72-89`：视频、图片、音频、文本、统一笔记 `NoteShell` 是独立结果页。
- `frontend/src/router.tsx:114-134`：设置页已拆为嵌套路由。

判断：

执行计划必须按真实路由拆任务：AppShell/Workbench、Library、NoteShell、VideoResultPage、Audio/Image/Text、Settings，而不是只改一个大文件。

### 2.4 React 源码仍保留旧视觉系统

证据：

- `frontend/src/index.css:5-15` 仍是 `VidMirror design tokens`，包含 `--vm-accent`、`--vm-display: Instrument Serif`。
- `frontend/src/index.css:58-70` 仍有硬编码蓝色主色、ring 和 shadcn 风格 token。
- `frontend/src/pages/result/tokens.css:6-29` 在视频结果页作用域内继续定义 `#FF4D7E`、`#B84CFF`、`#3C77FB`、`#f6f5f0`、`Instrument Serif`。
- 抽样统计这些关键源码文件中有 `226` 个 style object、`32` 个 hex 命中、`139` 个旧 token 引用。

判断：

真实项目尚未切到 Nibi 设计系统。下一步第一优先级是 foundation migration。

### 2.5 LibraryPage 已有正确产品逻辑，但视觉仍需要重做

证据：

- `frontend/src/pages/LibraryPage/index.tsx:68` 接收 `kind?: 'note' | 'replica'`。
- `frontend/src/pages/LibraryPage/index.tsx:140-164` 已按 workspace kind、item type、intent 过滤。
- `frontend/src/pages/LibraryPage/index.tsx:284-290` 已通过 `resolveItemRoute` 打开完成项，未完成项提示用户。
- `frontend/src/pages/LibraryPage/index.tsx:293-503` 大量布局仍是 inline style，并使用 `var(--ink-3)`、`var(--accent-pink)`、`var(--accent-3)`、`var(--line)` 等旧 token。
- `frontend/src/pages/LibraryPage/index.tsx:312` 有 `letterSpacing: '-0.02em'`，不符合当前 Web 设计约束，应移除。

判断：

LibraryPage 逻辑可保留，重点改 CSS 和卡片视觉。笔记库和复刻库应继续共用数据逻辑，但要视觉区分。

### 2.6 AddMaterialModal 是输入流事实源，原型不能越过它发明逻辑

证据：

- `frontend/src/components/workspace/AddMaterialModal.tsx` 已定义 `StagedConfig`、`NoteMediaKind`、`ActionType`。
- 该组件已支持 `note` / `replica` 动作、`auto/video/image_text/audio` 笔记类型、`replicaKind`、配图、视觉模型、截帧间隔、说话人区分、summary template、用户补充说明。
- 链接提交仍走 `generateNote`，本地文件走 `savePreflight + startItemPipeline`，并导航到 `/processing/:taskId`。

判断：

执行端只应该重做 AddMaterialModal 的视觉层和交互表达，不要改 payload、路由或任务创建逻辑，除非另起功能计划。

### 2.7 NoteShell 顶栏动作已经基本对齐用户要求

证据：

- `frontend/src/pages/result/NoteShell/index.tsx` 已复用 `NewSummaryModal`。
- 顶栏包含新建总结、导出、AI 工具。
- 导出项包含 Markdown、Obsidian 包、视频原文对照，PDF/Word/长图/PPT/沉浸式笔记为 disabled 占位。

判断：

不要再把导出、AI 工具、复制等动作重复放到内容区。执行时要保留“顶部统一动作区”的信息架构。

### 2.8 VideoResultPage 同时承载学习与复刻，复刻不应另起孤立页面

证据：

- `frontend/src/pages/result/VideoResultPage.tsx` 根据 `result.intent === 'learning'` 区分学习/复刻。
- 复刻模式已有主帧、缩略图轨、提示词格式、批量复制、导出复刻包、提示词版本、收藏帧。
- 学习模式仍有统一笔记入口和截图补图逻辑。

判断：

复刻结果页的 UI 优化应基于现有 `VideoResultPage` 的 intent 分支，而不是新建一条与数据契约脱节的页面。

## 3. 问题清单

### P0-1. 设计系统事实源分裂

问题：

Open Design 主原型使用 Nibi 风格；React 项目 `index.css` 和结果页 token 仍使用 VidMirror / shadcn / Instrument Serif 风格。

风险：

如果直接按原型改页面，会出现每个页面各有一套 token，后续深色模式、主题切换、组件复用都会失控。

解决方向：

先建立唯一 Nibi token 文件，并让全局、结果页、Library、Modal 都引用同一套 token。

### P0-2. 得意黑职责未在真实项目收敛

问题：

得意黑已在 HTML 原型加载，但 React 项目显示字体仍可能落到 `Instrument Serif` 或局部 `.display` 旧定义。

风险：

标题、品牌、页面英雄区风格不统一，中文界面会显得混用多个品牌系统。

解决方向：

得意黑只用于品牌、页面标题、章节标题；Inter 用于正文和 UI；JetBrains Mono 用于时间、任务 ID、状态、版本。

### P0-3. Inline style 太多，无法组件化

问题：

主原型有 `526` 个 inline style，关键 React 抽样文件也有 `226` 个 style object。

风险：

视觉改动无法批量管理，也不利于 CJX/React 实现、暗色模式、响应式、hover/focus 状态。

解决方向：

按组件分层抽 CSS：Button、Tag、Input、Card、Modal、Topbar、PageHeader、LibraryGrid、ResultToolbar。

### P0-4. 旧 token 名称仍大量出现在业务页面

问题：

`var(--ink-*)`、`var(--accent-pink)`、`var(--line)`、`var(--bg-sunken)` 与 Nibi token 并存。

风险：

同一页面里会出现冷灰、粉色、蓝色、暖中性混用，破坏 Nibi 的品牌一致性。

解决方向：

先做 token alias 兼容层，再逐步替换到 Nibi 原生 token：`--fg/--fg2/--mut/--bdr/--acc/--accl`。

### P0-5. 复刻/笔记/资料库视觉区分还没有落到 React

问题：

React 中 `/notes` 和 `/replicas` 共用 `LibraryPage` 逻辑是对的，但视觉层仍较通用。

风险：

用户会继续觉得笔记库、复刻库、资料库“太像”，不容易判断当前所在功能域。

解决方向：

保留共享数据逻辑，使用 `kind` 派生页面标题、hero、卡片封面语言、空状态和 CTA。笔记偏阅读/总结，复刻偏帧格/提示词，资料库偏聚合/管理。

### P0-6. 主原型与 React 路由边界不同

问题：

Open Design 主原型把所有页面合在 `nibi-all-pages.html`，但 React 是独立路由和懒加载。

风险：

执行模型如果照搬单文件结构，会破坏现有路由、代码分割和结果页数据边界。

解决方向：

执行计划必须以 `router.tsx` 路由为任务拆分单位。

### P1-1. AddMaterialModal 视觉需要升级，但不能改任务契约

问题：

HTML 原型中的 modal 已接近视觉目标，但 React `AddMaterialModal.tsx` 有大量 style object，且需要和 Nibi token 收敛。

风险：

盲改会影响 `generateNote` / `savePreflight` / `startItemPipeline` payload。

解决方向：

只改样式和布局，保留状态、提交函数、字段值、路由导航。

### P1-2. 结果页 token 与 Nibi 系统不一致

问题：

`result/tokens.css` 仍使用旧粉紫蓝高对比系统。

风险：

结果页会看起来像另一个产品，尤其视频复刻页与 NoteShell 会割裂。

解决方向：

结果页可以保留媒体工作台的高对比局部气质，但底层 token 要映射回 Nibi，不再使用 `Instrument Serif` 和硬编码 hex。

### P1-3. 设置页、音频/图片/文本页仍有独立参考稿债务

问题：

这些页面已有原型和源代码，但样式来源分散，容易局部看起来完成、整体不统一。

解决方向：

先迁 token，再逐页做视觉对齐。不要一次跨 5 个以上业务文件。

### P2-1. 动效和可访问性需要统一口径

问题：

主原型已有 hover lift、ripple、toast、卡片入场，但 React 页面未统一。

解决方向：

建立 motion 规则：默认 `.15s-.2s`，卡片 hover `translateY(-2px)`，支持 `prefers-reduced-motion`，焦点统一 `box-shadow: var(--shf)`。

## 4. 执行总原则

1. 先查仓库状态。若分支不是用户指定分支、或未跟踪文件与本任务冲突，先停下问用户。
2. 不直接照搬 `nibi-all-pages.html`。它是视觉蓝图，不是 React 架构。
3. 不改业务契约：AddMaterialModal 提交参数、路由、结果页 intent、NoteShell 导出/总结逻辑必须保留。
4. 每一阶段最多集中改一组相关文件，避免同时动 5 个以上业务页面。
5. 每阶段都跑最小验证：类型检查/构建 + 相关页面手测或 Playwright 冒烟。
6. 得意黑只进 display 层，不进正文和表格密集 UI。
7. 不发明假数据、不新增“设计控制面板”、不把平台/viewport 切换器放进产品 UI。

## 5. 分阶段执行计划

### Phase 0. 启动对账

目标：确认执行环境安全，避免覆盖其他模型的工作。

步骤：

1. 进入仓库：`cd /Users/conan/Desktop/nibi`
2. 运行：
   - `git status --short --branch`
   - `git log --oneline -5`
   - `git branch --show-current`
3. 读取：
   - `CLAUDE.md` 顶部规则
   - `docs/AI_HANDOFF.md` 前 80 行
   - 本计划文件
4. 若看到同主题未提交改动或不在预期分支，停止并问用户。

验收：

- 能说清楚当前分支、最近提交、未跟踪文件是否影响本任务。

### Phase 1. 建立 Nibi token 唯一事实源

目标：让 React 项目先有统一的 Nibi 视觉基础。

建议涉及文件：

- `frontend/src/index.css`
- 可新增 `frontend/src/styles/nibi-tokens.css`，再由 `index.css` import
- `frontend/src/pages/result/tokens.css`

步骤：

1. 把 Nibi token 写成一个全局 token 层，包含：
   - `--fd`
   - `--fb`
   - `--fm`
   - `--bg`
   - `--bgalt`
   - `--srf`
   - `--fg`
   - `--fg2`
   - `--mut`
   - `--bdr`
   - `--bdrs`
   - `--acc`
   - `--acch`
   - `--accl`
   - `--accfg`
   - `--ok/--okl`
   - `--wrn/--wrnl`
   - `--err/--errl`
   - `--rs/--r/--rl/--rf`
   - `--sh1/--sh2/--sh3/--shf`
2. 加载得意黑：
   - `@font-face { font-family: 'Smiley Sans'; ... }`
3. 保留必要兼容 alias，但明确标注为过渡层：
   - `--vm-display: var(--fd)`
   - `--vm-sans: var(--fb)`
   - `--vm-mono: var(--fm)`
   - `--vm-accent: var(--acc)`
4. 将 `result/tokens.css` 的 `Instrument Serif` 替换为 `var(--fd)`。
5. 将 `#FF4D7E`、`#B84CFF`、`#3C77FB` 等硬编码先映射到 Nibi token 或语义 token，避免页面失色。

验收：

- `rg -n "Instrument Serif|--vm-display: 'Instrument|#FF4D7E|#B84CFF|#3C77FB" frontend/src` 不再命中核心运行样式。
- 页面标题、品牌、结果页标题能使用得意黑。
- 正文和按钮仍是 Inter，不误用得意黑。

### Phase 2. 定义基础组件样式层

目标：先统一组件，再逐页迁移，避免每页手写样式。

建议涉及文件：

- `frontend/src/index.css`
- `frontend/src/components/ui/button.tsx`
- `frontend/src/components/ui/badge.tsx`
- `frontend/src/components/ui/input.tsx`
- `frontend/src/components/ui/tabs.tsx`
- 可新增 `frontend/src/styles/nibi-components.css`

步骤：

1. 定义通用类：
   - `.display`
   - `.eyebrow`
   - `.mono`
   - `.btn`
   - `.btn-primary`
   - `.btn-secondary`
   - `.btn-ghost`
   - `.tag`
   - `.input`
   - `.page-header`
   - `.nibi-card`
   - `.nibi-toolbar`
2. 删除或替换负 letter-spacing，尤其是大标题上的 `-0.02em`。
3. 统一 focus：
   - `box-shadow: var(--shf)`
   - 不使用默认 outline。
4. 统一按钮高度：
   - 紧凑按钮 28-32px
   - 标准按钮 36-40px
   - 触摸/移动端不少于 44px。
5. 统一 icon：
   - Lucide
   - 1.5 stroke
   - `currentColor`

验收：

- `LibraryPage`、`AddMaterialModal`、`NoteShell` 可开始复用这些类。
- 无新增硬编码 hex。

### Phase 3. 迁移 AppShell 和导航规则

目标：把全局骨架和 Nibi 规范对齐。

建议涉及文件：

- `frontend/src/pages/Index.tsx`
- AppShell 相关文件
- 全局 sidebar CSS

步骤：

1. 品牌名使用得意黑，纯展示。
2. 首页入口是左侧 sidebar 第一个 nav item。
3. sidebar 收缩必须由独立按钮控制，不与品牌或首页混用。
4. 收缩后卡片网格从 3 列变 4 列的行为要落在真实 CSS 中。
5. 顶栏只放状态、任务队列、上下文动作，不放页面重复入口。

验收：

- 展开/收缩状态刷新后保持。
- 收缩后 Library/Workbench/Storyboard 的主网格能重排，不横向溢出。
- 品牌名点击不承担导航或收缩。

### Phase 4. 重做 Library / Notes / Replicas 视觉层

目标：保留现有 `LibraryPage` 数据逻辑，做出三类页面的视觉区分。

建议涉及文件：

- `frontend/src/pages/LibraryPage/index.tsx`
- `frontend/src/pages/LibraryPage/library.css`
- `frontend/src/pages/LibraryPage/ItemCard.tsx`
- `frontend/src/pages/LibraryPage/WorkspaceCard.tsx`
- `frontend/src/pages/LibraryPage/ListView.tsx`
- `frontend/src/pages/LibraryPage/ViewToggle.tsx`
- `frontend/src/pages/LibraryPage/FilterChips.tsx`

步骤：

1. 移除 `LibraryPage/index.tsx` 内大段 inline style，迁到 `library.css`。
2. 页面头部按 `kind` 分三套文案和视觉：
   - `kind="note"`：笔记、阅读、总结、继续学习。
   - `kind="replica"`：复刻、帧格、提示词、批量导出。
   - 无 kind：资料库、聚合、管理、筛选。
3. 卡片封面必须能显示真实 thumbnail；无图时用类型化占位：
   - 视频笔记：深色封面 + 播放符号 + 字幕预览。
   - 图文笔记：图片栅格 / OCR 片段。
   - 音频笔记：波形 / 说话人。
   - 复刻：帧格 / prompt chip。
4. 保留网格/列表切换。
5. 保留批量选择、删除、图片批量分析逻辑，但视觉改为 Nibi token。
6. 空状态和错误态使用真实业务文案，不用泛泛“暂无数据”。

验收：

- `/library`、`/notes`、`/replicas` 视觉一眼可区分。
- `rg -n "var\\(--ink|var\\(--accent-pink|style=\\{\\{" frontend/src/pages/LibraryPage` 明显下降。
- grid/list 切换、筛选、排序、删除、打开结果页均正常。

### Phase 5. 重做 AddMaterialModal 视觉层

目标：把添加素材变成 Nibi 标准模态，但不改任务创建契约。

建议涉及文件：

- `frontend/src/components/workspace/AddMaterialModal.tsx`
- 相关 modal CSS 文件，或新增 `add-material-modal.css`
- `frontend/src/pages/WorkbenchPage/Composer.tsx` 只在必要时检查入口，不随意改逻辑。

步骤：

1. 保留 state 和 submit 函数，不改 `generateNote` 参数顺序。
2. 把 UI 分为三段：
   - 素材源：链接/本地文件/识别卡。
   - 目标动作：学习笔记/逐帧复刻，锁定态清晰。
   - 参数设置：笔记类型、风格、配图、说话人、截帧、补充说明。
3. 得意黑只用于 modal 标题，不用于字段 label。
4. 选中态使用 `--accl + --acc`，不要用粉紫旧色。
5. 复刻二级类型保留 disabled 状态，不把“拉片分析/竞品对标”做成可点击功能。
6. 错误、sniff 失败、无视觉模型时要有明确状态。

验收：

- 学习笔记和逐帧复刻提交后仍能进入 `/processing/:taskId`。
- 本地文件路径仍走 `savePreflight + startItemPipeline`。
- 链接仍走 `generateNote`。
- 视觉上没有旧 token、硬编码色块、随机 emoji。

### Phase 6. 迁移 NoteShell 顶栏和结果页共用规则

目标：结果页动作统一、字体统一、导出入口不重复。

建议涉及文件：

- `frontend/src/pages/result/NoteShell/index.tsx`
- `frontend/src/pages/result/NoteShell/*`
- `frontend/src/components/NewSummaryModal.tsx`
- `frontend/src/components/new-summary-modal.css`

步骤：

1. 保留顶栏动作顺序：
   - 新建总结
   - 导出
   - AI 工具
   - 根据实际需要放复制，但不要在正文区重复。
2. 导出菜单保留现有 enabled/disabled 区分。
3. AI 工具 disabled 项要清楚是“敬请期待”，不伪装成可用功能。
4. 视频笔记三列布局保留：左媒体/字幕，中正文，右操作/版本。
5. 字体：
   - 顶部标题可以得意黑。
   - 正文编辑器和 Markdown 内容不要强行得意黑。
6. 修掉明显 JSX 风险点：检查 `aiToolsOpen` 下拉附近是否存在重复 `<div` 或结构不完整。

验收：

- 新建总结成功后 SummariesTab 刷新。
- 导出 Markdown/Obsidian/原文对照路径可用。
- AI 工具菜单打开/关闭无崩溃。
- 视频笔记、图文笔记、音频/文本通用布局不互相污染。

### Phase 7. 迁移 VideoResultPage 的学习/复刻双模式

目标：让视频结果页符合 Nibi，而不是继续停在 VidMirror 粉紫蓝系统。

建议涉及文件：

- `frontend/src/pages/result/VideoResultPage.tsx`
- `frontend/src/pages/result/result.css`
- `frontend/src/pages/result/tokens.css`
- `frontend/src/components/result/PromptVersionStack.tsx`
- `frontend/src/components/FramePickerModal.tsx`

步骤：

1. 保留 `result.intent === 'learning'` 判断。
2. 学习模式：
   - 统一笔记入口保留。
   - 字幕总结、内容/总结 tab、补图入口保留。
3. 复刻模式：
   - 主帧大图 + 缩略图轨道保留。
   - 右侧 prompt 格式 tabs 保留。
   - 批量复制、导出复刻包、版本栈保留。
4. 将 `result/tokens.css` 的旧粉紫蓝 token 映射为 Nibi token。
5. 媒体工作台可以保留高对比暗色帧区，但外层 shell、按钮、标签、文本要 Nibi 化。
6. 替换 emoji fallback 为 Lucide 图标或中性占位。

验收：

- 视频学习模式、字幕路径模式、visual_only 模式、复刻模式都能渲染。
- 复制提示词、批量复制、导出复刻包按钮仍可用。
- 旧 `Instrument Serif` 不再出现。
- 右侧提示词编辑保存为新版本不回归。

### Phase 8. 补齐音频 / 图片 / 文本结果页一致性

目标：这些页面不必重做功能，先统一视觉系统和动作位置。

建议涉及文件：

- `frontend/src/pages/result/AudioResultPage.tsx`
- `frontend/src/pages/result/ImageResultPage.tsx`
- `frontend/src/pages/result/TextResultPage.tsx`
- 对应 CSS 文件

步骤：

1. 用 Nibi token 替换旧局部色。
2. 顶部状态栏、右侧总结区、全屏按钮、导出/复制按钮位置统一。
3. 音频页不要恢复章节区，如果当前产品方向已经移除章节。
4. 播放按钮大小与视频结果页风格对齐。
5. 分屏拖拽、全屏总结、复制、导出保持可用。

验收：

- 音频、图片、文本结果页不再像三个不同产品。
- 现有播放/分屏/全屏/复制/导出功能不回归。

### Phase 9. 设置页与通用表单规范

目标：把设置页变成 Nibi 的密集工具界面，不做营销页。

建议涉及文件：

- `frontend/src/pages/SettingPage/*`
- `frontend/src/components/settings/*`
- 表单 UI 组件

步骤：

1. 使用左侧设置导航 + 右侧详情，避免过大 hero。
2. Provider/Model 管理使用紧凑表格、状态 tag、测试连接按钮。
3. 输入、select、switch、textarea 统一组件样式。
4. 对 API key、模型配置等敏感项保持遮罩，不在 UI 中明文暴露。

验收：

- `/settings/providers-models`、`/settings/analysis-defaults`、`/settings/download` 至少无视觉割裂。
- 所有表单 focus ring 统一。

### Phase 10. 验证和回归

目标：证明没有破坏真实功能。

最低命令：

```bash
cd /Users/conan/Desktop/nibi
pnpm -C frontend build
pnpm -C frontend test
```

建议手测路径：

1. 首页 → 添加素材 → 学习笔记 → 提交 → processing。
2. 首页 → 添加素材 → 逐帧复刻 → 提交 → processing。
3. `/notes` 网格/列表/筛选/搜索/打开完成项。
4. `/replicas` 网格/列表/筛选/打开复刻项。
5. 视频结果页：学习模式、复刻模式、复制提示词、导出复刻包。
6. NoteShell：新建总结、导出菜单、AI 工具菜单、保存状态。
7. 设置页：provider/model 切换、表单 focus、暗色模式。

验收报告必须包含：

- 改了哪些文件。
- 每个文件为什么改。
- 跑了哪些命令。
- 哪些页面手测通过。
- 哪些未验证，原因是什么。

## 6. 建议拆分顺序

不要一次做完全量。建议拆成 5 个小 PR / 小提交：

1. `design-system-foundation`：全局 Nibi token + 得意黑 + result token alias。
2. `library-nibi-polish`：Library/Notes/Replicas 视觉和卡片。
3. `add-material-modal-nibi`：添加素材 modal 视觉重构。
4. `noteshell-actions-polish`：NoteShell 顶栏、导出、AI 工具、总结弹窗视觉。
5. `video-result-nibi-remix`：VideoResultPage 学习/复刻双模式视觉迁移。

每个小提交都需要构建通过，不要等全做完再修。

## 7. 执行模型红线

1. 不要改数据库 schema。
2. 不要改 API key、鉴权、provider 存储。
3. 不要改 `generateNote`、`savePreflight`、`startItemPipeline` 的业务语义。
4. 不要删除旧路由兼容 redirect。
5. 不要把复制/导出/AI 工具重复放到多个区域。
6. 不要把复刻做成独立孤岛页，先基于 `VideoResultPage` intent 分支。
7. 不要新增“设计系统演示面板”到产品 UI。
8. 不要继续使用 `Instrument Serif`、大面积粉紫蓝、负 letter-spacing。
9. 不要在脏工作树上直接 commit。

## 8. 给下一个模型的执行提示词

可以把下面这段直接给执行模型：

```text
你现在在 /Users/conan/Desktop/nibi 执行 Nibi 设计系统迁移。先运行 git status --short --branch、git log --oneline -5、git branch --show-current；如果分支或未跟踪文件有冲突，先停下汇报。

目标：在不改业务逻辑的前提下，把 React 项目从 VidMirror/旧 token 迁移到 Nibi 设计系统：暖中性底色、琥珀强调色、得意黑标题、Inter 正文、JetBrains Mono 元信息、Scheme B 圆角。得意黑只用于品牌、页面标题、章节标题；正文和密集 UI 不用得意黑。

请先做 Phase 1：建立 Nibi token 唯一事实源。重点文件是 frontend/src/index.css 和 frontend/src/pages/result/tokens.css。保留必要旧 token alias 作为过渡，但把 --vm-display / --display 映射到 Nibi 的 --fd，把 --vm-sans / --mono 映射到 --fb / --fm，并移除 Instrument Serif。不要碰 AddMaterialModal 提交逻辑、路由、后端、数据库。

完成后运行 pnpm -C frontend build 和 pnpm -C frontend test，并汇报：改了哪些文件、为什么改、命令结果、未验证项。
```

## 9. 预期完成标准

设计系统层面：

- 全局 token 与 Nibi 规范一致。
- 得意黑在 React 项目真实生效。
- 旧 VidMirror token 只作为过渡 alias，不再主导视觉。
- 没有新硬编码 hex。

产品层面：

- 首页、资料库、笔记库、复刻库、结果页、设置页在同一 Nibi 视觉系统下。
- 笔记库和复刻库视觉上明显区分，但共用逻辑不重复造轮子。
- AddMaterialModal、NoteShell、VideoResultPage 的关键业务逻辑不回归。

验证层面：

- `pnpm -C frontend build` 通过。
- `pnpm -C frontend test` 通过，或明确说明失败测试与本次视觉变更无关。
- 至少手测 `/notes`、`/replicas`、`/settings/providers-models`、一个视频 NoteShell、一个视频复刻结果页。
