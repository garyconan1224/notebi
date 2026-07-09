---
phase: H1
title: 首页 · 工作台 1:1 复刻
status: done
branch: feat/homepage-h1-workbench
worktree: 无（直接分支）
created: 2026-05-19
completed_date: 2026-05-20
priority: P2
estimate_hours: 12-18
depends_on: N11 已合并；与 N7b/N8b 并行不冲突
commits: 8f68740 (H1.1) / fb297b3 (H1.2) / 12176ab (H1.3) / 0d3f726 (H1.4) / 27fae68 (H1.5)
---

# H1 工作台（Workbench）1:1 复刻

> 来源：用户决议 2026-05-19；设计稿 `docs/design/components/workbench.jsx` + `system_design_v1.1.md`
> 目标：把 `/` 路由从 `<Navigate to="/workspaces" />` 改为新工作台页，1:1 复刻设计稿
> `/workspaces` 列表保留为「工作空间管理」页（不动）
> 后续：H2 复刻 Taskboard / H3 复刻 Processing / H4 复刻 Results / H5 复刻 Storyboard / …（一步一步做）

## 设计规范的核心约束

颜色语义（来自 `system_design_v1.1.md` 第 118 行）：

- 粉（coral / `--accent-pink`）= 输入 / 输出层
- 紫（`--accent-purple`）= AI 分析层
- 蓝（`--accent-blue`）= 结构化层
- 琥珀（`--accent-amber`）= 分镜层
- 绿（`--accent-green`）= 完成态
- 红（`--accent`）= 入口按钮、最终输出（强调）

H1.1 之后所有子阶段都必须用 token，不允许 hardcode 颜色值。

---

## 子任务清单

### H1.1 设计 tokens + 规范文档

**模型**：⭐ 小米 2.5 Pro（终端，免费）
**预计**：2-3h
**抓取源**：
- `docs/design/styles.css`（1799 行，主参）
- `docs/design/styles-preflight.css`
- `docs/design/system_design_v1.1.md` 第 118 行起的颜色语义段

**Skill**：
- `design:design-system`（生成 `DESIGN_SYSTEM.md` 的结构）
- `anthropic-skills:theme-factory`（参考 token 分层方式）

**产出文件**：
1. `frontend/src/styles/design-tokens.css` — 全局 token 文件
   - 颜色：`--ink` / `--ink-3` / `--ink-4` / `--bg` / `--bg-sunken` / `--line` / `--accent` / `--accent-pink` / `--accent-purple` / `--accent-green` / `--accent-blue` / `--accent-amber`
   - 字体：`--mono` / display 字体栈 / 字号阶梯
   - 间距：spacing scale（4/8/12/16/20/24/32）
   - 圆角：radius scale（7/12/16/99）
   - 通用类：`.eyebrow` `.display` `.lede` `.chip` `.kw` `.mono` `.btn` `.btn-ghost` `.btn-primary` `.btn-run`

2. `docs/DESIGN_SYSTEM.md` — 使用手册
   - 颜色语义对照表
   - 字体级别使用场景（display / lede / mono / eyebrow 各什么时候用）
   - 按钮 3 种形态使用场景（primary / ghost / run）
   - 间距密度规则

3. `frontend/src/main.tsx` 加一行 `import './styles/design-tokens.css'`

**操作步骤**：
1. 读 `docs/design/styles.css` 全文，提取所有 `:root` 下的 CSS 变量
2. 把 `.hero` / `.composer` / `.examples` / `.sidebar` 等"页面级"类先**不动**，只提通用层
3. 跑 `cd frontend && pnpm build` 确认引入 token 后还能构建

**验收**：
- ✅ `pnpm build` 通过
- ✅ `DESIGN_SYSTEM.md` 包含 5 个章节（颜色 / 字体 / 间距 / 圆角 / 按钮）
- ✅ `design-tokens.css` 中所有 token 在浏览器 DevTools 能看到（启动 dev 后）

**禁止**：
- ❌ 不要把整份 styles.css 直接抄过来（1799 行里 70% 是页面级样式，H1.2 才需要）
- ❌ 不要改任何业务组件

---

### H1.2 WorkbenchPage 静态骨架（不接后端）

**模型**：Sonnet 4.6（多文件 React 组件级新建）
**预计**：4-6h
**抓取源**：
- `docs/design/components/workbench.jsx` 全文（核心，1:1 翻译为 TSX）
- `docs/design/components/icons.jsx`（图标对照表，全部换成 lucide-react 等价图标）
- `docs/design/components/data.js`（mock 数据结构参考）

**Skill**：
- `design:design-handoff`（设计稿 → 生产级组件规格）
- `anthropic-skills:vercel-composition-patterns`（拆 Composer 内部子组件）

**产出文件**：
1. `frontend/src/pages/WorkbenchPage/index.tsx` — 页面入口（lazy 加载）
2. `frontend/src/pages/WorkbenchPage/Hero.tsx` — v0.3 BETA pill + display 标题 + lede 段落
3. `frontend/src/pages/WorkbenchPage/Composer.tsx` — URL 输入 + 工作空间选择 + 画质 + 抽帧 + 4 LLM 列 + 7 步管线 + 开始按钮
4. `frontend/src/pages/WorkbenchPage/RecentTasks.tsx` — 8 张任务卡（先用 mock 数据）
5. `frontend/src/pages/WorkbenchPage/workbench.css` — 从 design/styles.css 抽取 `.hero` `.composer` `.examples` `.step-pill` `.btn-run` `.pp-popover` 等页面级类
6. `frontend/src/pages/WorkbenchPage/types.ts` — Platform / Pipeline step / QualityOption 类型

**操作步骤**：
1. lucide-react 图标对照表先建：`IcDownload→Download` / `IcFilm→Film` / `IcMic→Mic` / `IcEye→Eye` / `IcCpu→Cpu` / `IcWand→Wand2` / `IcLayers→Layers` / `IcLink→Link2` / `IcUpload→Upload` / `IcSearch→Search` / `IcX→X` / `IcCheck→Check` / `IcPlus→Plus` / `IcArrowRight→ArrowRight`
2. 把 workbench.jsx 的 React.useState 翻译成 TS `useState<Type>`
3. PLATFORMS 常量 → 单独导出（H1.4 会用）
4. 静态版**只用 mock**：projects 用 `[]`，最近任务用 4-8 条假数据
5. 别在 H1.2 接入 Preflight（H1.4 做）；混合内容弹窗（H1.4 做）

**验收**：
- ✅ 启动 `./start.sh` 后访问 `/workbench-preview`（先临时挂个路由，避免顶掉 `/workspaces`）能看到完整页面
- ✅ 视觉对照设计稿截图，**Hero 文字渐变 / Composer 卡片圆角 / 7 步管线 pill 配色**逐项过
- ✅ `pnpm lint` + `pnpm build` 全绿
- ✅ 跑 `anthropic-skills:webapp-testing` 截一张图给用户对照

**禁止**：
- ❌ 不接后端（哪怕你看到 axios import 也别加）
- ❌ 不用 `any` 类型

---

### H1.3 Composer 接后端

**模型**：Sonnet 4.6
**预计**：3-4h
**抓取源**：
- `frontend/src/store/workspaceStore.ts`（工作空间列表来源）
- `frontend/src/store/taskStore.ts`（任务创建后入此）
- `frontend/src/store/providerStore.ts`（ASR / 视觉 / 文本 LLM 选项）
- `frontend/src/services/client.ts`（axios 实例）
- `backend/app/routes/pipeline.py`（任务创建 payload 契约）
- `backend/app/routes/workspaces.py`（工作空间 CRUD）

**Skill**：
- `anthropic-skills:vercel-react-best-practices`（loading/empty/error/success 四态）

**改动文件**：
1. `WorkbenchPage/Composer.tsx` — 工作空间下拉接 `useWorkspaceStore()`；新建工作空间调 `POST /workspaces`
2. `WorkbenchPage/Composer.tsx` — ASR / 视觉 / 文本 LLM 选项接 `useProviderStore()`，不再 hardcode
3. `WorkbenchPage/Composer.tsx` — 「开始解析」按钮调用任务创建 API；成功后 toast + 跳到 `/workspaces/<id>` 或留在工作台显示新任务卡
4. `WorkbenchPage/RecentTasks.tsx` — 改用 `useTaskStore()` 取真实任务（最近 8 条）

**操作步骤**：
1. 先确认后端 `POST /pipeline/...` 的 payload schema（读 router 文件 + tests）
2. URL 输入 → 解析平台（platform 用 H1.2 已建的 PLATFORMS 常量）
3. 工作空间「新建」按钮调 `POST /workspaces` 拿到 id 再写回 store
4. 「开始解析」分支：
   - 非混合内容 → 打开 Preflight 抽屉（H1.4 接）
   - 混合内容 → 打开混合内容弹窗（H1.4 接）
   - **H1.3 暂时简化为**：toast 提示 "下一步会接 Preflight"
5. 四态：loading（spinner）/ empty（最近任务为 0 时显示引导文案）/ error（toast）/ success（任务卡刷新）

**验收**：
- ✅ 启动后端 + 前端，工作空间下拉显示真实数据
- ✅ 新建工作空间后下拉刷新出现新项
- ✅ 最近任务区显示真实任务
- ✅ 后端测试 `pytest tests/backend -q` 全绿（不应受影响，但跑一次保险）

---

### H1.4 平台检测 + 混合内容弹窗 + Preflight 抽屉接入

**模型**：Sonnet 4.6
**预计**：2-3h
**抓取源**：
- `docs/design/components/workbench.jsx` 第 3-18 行（PLATFORMS + detectPlatform）
- `docs/design/components/workbench.jsx` 第 317-348 行（混合内容弹窗）
- `docs/design/components/preflight.jsx`（看抽屉打开 props 协议）
- `frontend/src/components/workspace/PreflightConfigPanel.tsx`（现有 Preflight 实现）

**改动文件**：
1. `WorkbenchPage/MixedContentModal.tsx` — 新建，复刻设计稿的混合内容选择弹窗
2. `WorkbenchPage/Composer.tsx` — 集成 PreflightConfigPanel 抽屉触发
3. `WorkbenchPage/platforms.ts` — PLATFORMS 常量 + detectPlatform 函数（H1.2 已建则只是补强）

**操作步骤**：
1. 复用现有 `PreflightConfigPanel`，不要重新做一个
2. 混合内容场景：小红书 / 微信公众号 → 弹"选择下载范围"（video / audio / article）
3. 非混合：直接开 Preflight 抽屉，把 URL + 平台名 + 工作空间选择传过去

**验收**：
- ✅ 粘贴 B 站链接 → 平台徽章变蓝 + "video" 标签 + 直接开 Preflight
- ✅ 粘贴小红书链接 → 平台徽章变红 + 3 类型标签 + 「开始解析」按钮变成「选择内容类型」+ 弹混合内容窗
- ✅ Preflight 抽屉关闭后状态归位

---

### H1.5 路由切换 + 侧边栏图标系统

**模型**：⭐ 小米 2.5 Pro（终端，免费）
**预计**：1-2h
**抓取源**：
- `docs/design/components/shell.jsx` 第 3-20 行（8 个侧边栏项）
- `docs/design/components/icons.jsx`（70 行 svg → 全部换 lucide-react）
- `frontend/src/layouts/AppShell.tsx`（现有侧边栏）

**改动文件**：
1. `frontend/src/router.tsx` — `/` 从 `<Navigate to="/workspaces" />` 改为 `withSuspense(<WorkbenchPage />)`；保留 `/workspaces` 路由不动；新增 `/workbench-preview` 删除（H1.2 用的临时路由）
2. `frontend/src/layouts/AppShell.tsx` — 侧边栏 8 项对齐设计稿：
   - 工作台（Home，跳 `/`）
   - 任务中心（Layers，跳 `/taskboard`，**H2 才做**，先留死链或禁用态）
   - 处理中（Sparkles，跳 `/processing`，**待实现**，禁用态）
   - 结果（Clapperboard，跳 `/results`，禁用态）
   - 分镜（Film，跳 `/storyboard`，禁用态）
   - 资料库（Library，跳 `/library`，禁用态）
   - AI 导演（Wand2，跳 `/director`，禁用态 + tooltip "Phase [C]"）
   - 12 屏概览（Grid，跳 `/overview`，禁用态）
   - 分隔线
   - 搜索（Search，跳 `/search`，已有）
3. `frontend/src/layouts/AppShell.tsx` 顶栏接近设计稿：后端状态 + GPU 占用（后两个**先 mock**，真实数据 H 系列收尾时做）

**验收**：
- ✅ 浏览器打开 http://127.0.0.1:5173/ 看到工作台
- ✅ 点 `/workspaces` 仍能进入旧列表页
- ✅ 侧边栏 8 个图标排列与设计稿一致，禁用项 hover 显示 tooltip
- ✅ `pnpm build` 全绿

---

## H1 完工标准

1. `/` 路由是新工作台，1:1 视觉对照设计稿
2. URL 输入 → 平台自动识别 → 开 Preflight → 任务真的进了任务库
3. 最近任务区显示真实任务
4. 侧边栏 8 图标到位（已实现的能点，未实现的禁用）
5. `pytest tests/backend -q` + `pnpm lint` + `pnpm build` 全绿
6. 设计 tokens + DESIGN_SYSTEM.md 落盘，H2~H5 可以直接复用

---

## 风险与备忘

- **风险 1**：设计稿用 `React.useState` 不带类型，翻译成 TS 时要补类型，留心 union 类型（如 `frameMode: 'A' | 'B'`）
- **风险 2**：lucide-react 个别图标名可能对不上设计稿（比如 `IcClap` 对应 lucide 的什么？），冷僻图标需要核对一遍
- **风险 3**：`PreflightConfigPanel` 是现成的，但它的 props 协议未必和设计稿 `preflight.jsx` 一致，H1.4 时如发现接不上要先停下来对协议
- **风险 4**：`/workspaces` 路由保留 = 旧入口的"工作空间管理"页保留；侧边栏没有它的入口（设计稿没画），用户只能从工作台跳转，**需要决定是否再加一个侧边栏入口**

---

## 与其它 Phase 的关系

- 与 `N7b` / `N8b` 并行不冲突（前者改前端 UI，后者改后端能力）
- **不要顺手做 Taskboard / Processing / Results**——那是 H2~H5
- `[C] AI 导演` 仍延后；侧边栏「AI 导演」按钮做禁用态即可
- `[D] 开源准备` 仍延后

---

## 验收用 Skill 速查（每个子阶段做完都跑一遍）

- `anthropic-skills:webapp-testing` + `anthropic-skills:playwright` — 视觉验收（截图对比）
- `design:accessibility-review` — H1.2 完工后跑一次（对比度 / 键盘 / 触控）
- `anthropic-skills:karpathy-guidelines` — commit 前过一遍，防过度抽象
