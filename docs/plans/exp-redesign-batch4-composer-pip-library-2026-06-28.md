# Batch4 · 画中画/AI菜单/源md/状态栏/合集/添加素材/库页/复刻 8 项修复 — Codex 执行计划

status: ready
日期：2026-06-28
分支：`feat/exp-redesign-p1`
执行：**Codex 直接执行 + 自验证**（无独立审查者，红线需自查）

> 接 batch3 后用户真机又提的 8 项。**红线沿用 batch2 §1 / batch3 §4**（不改契约/路由/payload/状态机；不写死 hex；复用 Nibi token 与 note-card 范式；不删现有功能；API key 遮罩；一项一提交 build+test 通过）。
> 设计稿（只读）：`/Users/conan/Library/Application Support/Open Design/namespaces/release-stable/data/projects/2bfc4c3c-b63e-49f2-ad5c-a0e210cfdb3e/nibi-all-pages.html`。

## 0. 接手前对账
```bash
git status --short --branch && git log --oneline -8
pnpm -C frontend build   # 先确认基线可构建
```

## 1. 用户决策（已拍板）
- **问题2**：**新建总结改独立按钮**（放顶栏，不藏进版本下拉）；**AI 工具下拉只管「问 AI」**（把 FloatingAskAi 入口并进 AI 工具菜单，浮窗可保留或从这里唤起）。
- **问题3**：**只留右侧「源 md」卡片**、去掉顶栏 `</>` 图标；卡片**改名「原文」/「转写原文」**（"源 md"对新手不友好）。
- **问题4a**：取消顶部后端/CPU/MEM 整行，**移到左侧导航栏底部**（贴底，靠近「设置」），内容区变高。
- **问题4b**：首页 composer **去掉内联「归入合集」行**；合集选择**移进「添加素材」弹框**（问题5 那个 modal）里做第二步。
- 问题1/5/6/7/8 见 §2 各项。

## 2. 逐项

### 2.1【问题1】画中画精简成 B 站风（只多一个截帧键）
- 现象：当前内嵌 PiP 迷你窗控制条太full（播放/快进/字幕/循环/倍速/音量/进度/截图/全屏…）。
- 诉求：参考 B 站画中画——**极简**：视频 + 播放/暂停 + 进度 + **截帧** + 关闭（+ 可拖拽/尺寸）。去掉字幕/循环/倍速/音量/全屏等。
- 修复：精简 PiP 悬浮窗（NoteShell 的 `.note-pip` 渲染 + LNVideoPanel transport 在 pip 态的精简版）；保留截帧按钮（复用 `captureScreenshot`）。
- 文件：`NoteShell/index.tsx`、`LNVideoPanel.tsx`、`note-shell.css`。
- 验收：PiP 窗只剩视频+播放+进度+截帧+关闭，可拖拽；其余控制移除。

### 2.2【问题2】新建总结独立按钮 + AI 工具只管问 AI
- 现象：新建总结藏在「风格/版本」下拉且仅在有总结时显（`index.tsx:932`），用户找不到；「问 AI」浮窗（`FloatingAskAi.tsx`）未并入顶栏。
- 修复：
  - 顶栏加**独立「+ 新建总结」按钮**（`nibi-note-bar-btn--label`），直接 `setShowNewSummaryModal(true)`，常驻可见；版本下拉里那个可去掉或保留为次要。
  - **AI 工具下拉**（`index.tsx:1065`）内容改为「问 AI」（唤起 `FloatingAskAi`/NoteChatDrawer）+ 其余真 AI 占位；去掉与新建总结的纠缠。
- 文件：`NoteShell/index.tsx`、`FloatingAskAi.tsx`。
- 验收：顶栏直接可见「新建总结」；AI 工具下拉点「问 AI」唤起对话；无重复入口。

### 2.3【问题3】源 md 只留右侧卡片 + 改名
- 现状：顶栏 `</>` 图标（`index.tsx:1040`）+ 右侧 `.nibi-note-source-card`（`index.tsx:1598`）两处。
- 修复：**删顶栏 `</>` 按钮**；右侧卡片保留，标题/kicker **改名「原文」或「转写原文」**（去掉"源 md"措辞，含 FileCode 注释处）。
- 文件：`NoteShell/index.tsx`、`note-shell.css`。
- 验收：只剩右侧「原文」卡片，顶栏无 `</>`。

### 2.4【问题4a】顶部状态栏移到左侧导航底部
- 根因：`AppShell.tsx` 顶栏（行 270-305）后端/CPU/MEM chip 占一整行。
- 修复：**移除顶部那一行**（或仅留 ThemeSwitcher）；把后端 online 点 + CPU/MEM 移到**左侧导航栏底部**（`flex-1` spacer 之后、贴底），紧凑小字，复用现有 `useSystemStats`/`online`。
- 文件：`frontend/src/layouts/AppShell.tsx`（必要时少量 css）。
- 验收：顶部整行消失、内容区变高；左侧栏底部显示后端/CPU/MEM；online 颜色点保留。

### 2.5【问题4b】合集选择移进「添加素材」弹框
- 现状：首页 `Composer.tsx` 内联「归入合集」行常驻（行 229-250）。
- 修复：**去掉 Composer 内联归入合集行**；把合集选择放进 `AddMaterialModal`（`workspaceIds`/`workspaceKind` 已是其 prop，行 366-368）作为弹框内一步。首页输入区精简成"粘贴/上传 + 添加素材"。
- 文件：`Composer.tsx`、`components/workspace/AddMaterialModal.tsx`。
- ⚠️遇停：若合集选择移入弹框需改提交 payload/接口 → 停下标注，仅做展示位置迁移。
- 验收：首页不再常驻归入合集行；点「添加素材」后弹框内可选/新建合集。

### 2.6【问题5】添加素材弹框对齐设计稿 `.am-modal`
- 现状：当前 `AddMaterialModal` 与设计差距大（图4）。
- 设计依据：`.am-*` CSS（行 909-928 起）、`openAddMaterialModal()` JS 结构（行 5812）、composer `cp-submit`（行 1617）。
- 修复：`AddMaterialModal` 视觉/结构对齐 `.am-modal`（URL composer + 平台识别 + 步骤），复用 Nibi token；**接真实 sniff/识别/提交逻辑，不改契约**。合集选择步骤并入此处（配合 2.5）。
- 文件：`components/workspace/AddMaterialModal.tsx` + css。
- 验收：弹框视觉贴近 `.am-modal`；识别/提交/合集选择功能正常。

### 2.7【问题6】笔记/复刻页加「新建合集」按钮
- 修复：`LibraryPage`（kind=note / replica）hero 操作区加「+ 新建合集」按钮，调 `createWorkspace`（`services/workspaces.ts:43`）建空合集后刷新/进入。注意 `kind` 传对（note/replica）。
- 文件：`LibraryPage/index.tsx`、`services` 复用。
- ⚠️遇停：若 `createWorkspace` 不支持建空合集（必须带 item）→ 停下标注，改为"打开添加素材并预选新建合集"。
- 验收：笔记/复刻页可新建合集，列表出现新合集。

### 2.8【问题7】库页重复筛选行去重
- 根因：`LibraryPage/index.tsx` hero 内 `.lib-mini-stats`（全部/视频/音频… 行 384-387）与下方 `<FilterChips>`（行 429）两行重复（图5红框）。
- 修复：**删 `.lib-mini-stats`**（hero 那行），保留功能更全的 `FilterChips`（含合集/生成中）。
- 文件：`LibraryPage/index.tsx`、`library.css`。
- 验收：只剩一行筛选 chip。

### 2.9【问题8】复刻结果页对齐 `pg-replica`
- 现状：复刻结果页（`VideoResultPage` 的 `intent==='replica'` 分支）未从 OpenDesign 迁移；batch2 `2f19b4a` 声称做了 pg-replica，需核实是改了"复刻详情"还是"复刻结果页"。
- 设计依据：`pg-replica`（行 2547）——主帧大图 + 缩略图轨 + 提示词格式 tabs + 批量复制 + 导出复刻包 + 版本栈。
- 修复：先核对 `VideoResultPage` 复刻向当前状态，对齐 `pg-replica`，复用 Nibi 范式，保留复制/批量/导出/版本栈功能；不新建孤岛页、不改 intent 数据契约。
- 文件：`result/VideoResultPage.tsx`（复刻分支）+ css。
- ⚠️遇停：若复刻结果页与"复刻详情"是两个东西、或需改 intent 路由/契约 → 停下标注。
- 验收：复刻结果页视觉对齐 pg-replica，功能不回归。

## 3. 执行顺序（小→大、先撤纠缠）
1. 问题7 库页去重（最小）
2. 问题3 源md 收敛改名
3. 问题4a 状态栏移左下
4. 问题2 新建总结独立按钮 + AI 菜单
5. 问题1 PiP 精简
6. 问题6 新建合集按钮
7. 问题4b composer 去归入合集行
8. 问题5 添加素材弹框对齐（含合集步骤，配合7）
9. 问题8 复刻结果页 pg-replica（最复杂、先核实）

每项：`./dev.sh` 起真实页对照设计稿 → 改（复用 token/note-card）→ `pnpm -C frontend build` + `test` → **一项一提交** `fix(design): X 修复`。

## 4. 自验证（必须自查）
- [ ] 无写死 hex / 无契约改动（路由/payload/sniff/createWorkspace/note.media/intent/状态机）
- [ ] 现有功能未砍（导出/AI/新建总结/截图/合集提交/识别/复制/版本）
- [ ] API key 遮罩；复用 token 与 note-card 范式
- 截「当前 vs 设计稿」对照图存 `frontend/test-results/`

## 5. 遇到即停
- 2.5/2.6 合集入弹框若需改提交 payload；2.7 createWorkspace 不支持空合集；2.9 复刻结果页≠复刻详情或需改 intent 契约 → 一律停下，在报告标注，不擅自改契约/后端。

## 6. 交付
- 全部 `pnpm -C frontend build` + `test` 全绿。
- 报告 `docs/test-reports/exp-redesign-batch4-2026-06-28.md`：每项现象/根因/改动文件、对照图、真机结果、红线自查、遇停项。
