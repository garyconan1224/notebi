---
phase: H2
title: 任务中心 Taskboard 1:1 复刻（重做 /workspaces/:id）
status: ready
branch: feat/homepage-h2-taskboard
worktree: 无（直接分支）
created: 2026-05-20
priority: P2
estimate_hours: 15-20
depends_on: H1 已合并（design-tokens + DESIGN_SYSTEM.md 已落盘）
---

# H2 任务中心 Taskboard 1:1 复刻

> 用户决议 2026-05-20：直接替代当前 `/workspaces/:id`（方案 A），Style / Compare 后做（方案 3 的 H2.5+）
> 设计稿源：`docs/design/components/taskboard.jsx`（849 行）+ `docs/design/components/materials.jsx`（如存在）
> **CSS 在 `docs/design/VidMirror.html`，不在 styles.css**——所有 H2 子阶段都从 VidMirror.html 抽 .tb- / .mat- / .ctx- / .fav- / .exp- 等类

## 设计原则约束

1. **Taskboard = WorkspaceDetail**：设计稿大标题是工作空间名，所以这是单 workspace 详情页，不是全局路由
2. 复用 H1 已落盘的 `design-tokens.css`，**禁止再 hardcode 颜色**
3. 颜色语义沿用：粉=输入/输出 / 紫=分析 / 蓝=结构化 / 琥珀=分镜 / 绿=完成
4. **保留** `/workspaces` 列表页（H1 已确认保留），只重做 `/workspaces/:id`

## 9 个 Tab 现状对照

| Tab | 中文 | 后端能力 | 现有前端代码 | H2 子阶段 |
|---|---|---|---|---|
| materials  | 素材    | ✅ workspace items API | WorkspaceDetail.tsx 部分 | H2.2 |
| queue      | 队列    | ✅ task store          | 散落各处          | H2.3 |
| favs       | 收藏夹  | ✅ /favorites          | FavoritesPage 现成 | H2.3 |
| history    | 版本    | ⚠️ PromptVersionStack 有 | 散落               | H2.3 |
| tags       | 标签库  | ⚠️ N3 加过部分          | useTagFilter.ts    | H2.4 |
| chat       | AI 对话 | ✅ N6 已做              | 现成               | H2.4 |
| export     | 导出    | ✅ N11 藏了入口         | 隐藏中             | H2.4 |
| style      | 风格报告 | ❌ **无**               | —                  | **H2.5+ 押后** |
| compare    | A/B 对比 | ❌ **无**               | —                  | **H2.5+ 押后** |

---

## 子任务清单

### H2.1 Taskboard 骨架 + 头部 + 9 Tab nav

**模型**：**Sonnet 4.6**（新建多文件 React 组件，需要熟悉 zustand store）
**预计**：4-5h
**抓取源**：
- `docs/design/components/taskboard.jsx` 第 1-80 行（头部 + tab 定义）
- `docs/design/VidMirror.html` 中 `.tb-`, `.ctx-` 开头的 CSS 类
- 现有 `frontend/src/pages/WorkspacePage/WorkspaceDetail.tsx`（要读懂再替换）
- 现有 `frontend/src/store/workspaceStore.ts`（取 5 维度上下文：contentType/people/background/terms/purpose）

**Skill**：
- `design:design-handoff`（jsx → TSX 翻译）
- `anthropic-skills:vercel-composition-patterns`（拆 tab 组件）

**产出文件**：
1. `frontend/src/pages/WorkspacePage/TaskboardPage/index.tsx` — 新入口（lazy）
2. `frontend/src/pages/WorkspacePage/TaskboardPage/TaskboardHead.tsx` — 任务名 + 5 维度上下文 + 编辑背景/添加素材按钮
3. `frontend/src/pages/WorkspacePage/TaskboardPage/TabsNav.tsx` — 9 个标签栏（含数量徽章）
4. `frontend/src/pages/WorkspacePage/TaskboardPage/taskboard.css` — 从 VidMirror.html 抽 .tb-/.ctx- 类
5. `frontend/src/pages/WorkspacePage/TaskboardPage/types.ts` — Tab id 类型 / MaterialState 类型

**操作步骤**：
1. 先在 `router.tsx` 临时把 `/workspaces/:id` 指向**新** `TaskboardPage`，但**保留**旧 `WorkspaceDetail` 作为 fallback（注释掉但别删，H2.4 末确认无遗漏后删）
2. TabsNav 用 `useState<TabId>` 切换，**先只渲染 materials tab**（其它 8 个 tab 是占位 div "敬请期待"）
3. Style / Compare 两个 tab 显式禁用 + tooltip "Phase [C]"

**验收**：
- ✅ `/workspaces/:id` 打开后是新设计稿骨架
- ✅ 9 个 tab 能切换（除 materials 外都是占位）
- ✅ 头部 5 维度上下文从 store 取
- ✅ `pnpm build` + `pnpm lint` 全绿
- ✅ 旧 WorkspaceDetail 没删（保险）

**禁止**：
- ❌ 不实现 materials 内部（H2.2）
- ❌ 不删旧 WorkspaceDetail 代码（H2.4 末才删）

---

### H2.2 Materials Tab 素材网格

**模型**：**Sonnet 4.6**（最复杂的 tab，要处理状态/进度/标签 chip）
**预计**：4-6h
**抓取源**：
- `docs/design/components/taskboard.jsx` 第 10-40 行（`MaterialCard` 组件）+ 整个 materials 渲染段
- `docs/design/components/materials.jsx`（如存在，扫一遍）
- `docs/design/VidMirror.html` 中 `.mat-` 开头的 CSS 类
- 现有 `frontend/src/services/workspaces.ts`（取 items）
- 现有 `frontend/src/types/workspace.ts`（ItemRecord 字段对照）

**Skill**：
- `anthropic-skills:vercel-react-best-practices`（loading/empty/error 四态）

**产出文件**：
1. `TaskboardPage/MaterialsTab.tsx` — 素材列表 + 筛选
2. `TaskboardPage/MaterialCard.tsx` — 单卡（含状态徽章 / 进度条 / 类型 chip / tag chips）
3. `taskboard.css` 追加 `.mat-` 类

**操作步骤**：
1. 类型映射：现有 ItemRecord.type → 设计 video/audio/image/text + tone
2. 状态映射：现有 ItemRecord.status → 设计 done/running/queued/error
3. running 时显示进度条（从 task store 拿 progress）
4. 点击卡片 → 跳现有 `/workspaces/:wid/items/:iid/result`（按类型路由）

**验收**：
- ✅ 真实 workspace 数据加载后，素材网格 1:1 对照设计稿
- ✅ 状态徽章颜色对（绿/黑/灰/红）
- ✅ 进度条只在 running 时出现
- ✅ 类型 chip 颜色对（粉/紫/蓝/琥珀）
- ✅ 点击卡片跳详情页正常

---

### H2.3 Queue + Favorites + Versions Tab 整合

**模型**：⭐ **小米 2.5 Pro**（3 个 tab 都是把现有页面塞进新外壳，模板化）
**预计**：3-4h
**抓取源**：
- `docs/design/components/taskboard.jsx` 中 queue / favs / history 渲染段
- 现有 `frontend/src/pages/FavoritesPage/FavoritesPage.tsx`（整合进 favs tab）
- 现有 PromptVersionStack 组件（找一下）

**产出文件**：
1. `TaskboardPage/QueueTab.tsx` — 复用 useTaskStore 过滤 running/queued/error
2. `TaskboardPage/FavoritesTab.tsx` — 把 FavoritesPage 内容塞进来
3. `TaskboardPage/VersionsTab.tsx` — 复用 PromptVersionStack
4. `taskboard.css` 追加 `.fav-` `.ver-` 类

**禁止**：
- ❌ 不要**重新实现**这 3 个 tab 的业务逻辑，直接复用现有组件，只改外壳样式

**验收**：
- ✅ queue tab 显示真实任务（按状态分组）
- ✅ favs tab 内容与原 `/favorites` 路由一致
- ✅ versions tab 显示提示词版本历史

---

### H2.4 Tags + Chat + Export Tab + 旧代码清理

**模型**：**Sonnet 4.6**（标签库交互复杂，且要决定是否删旧 WorkspaceDetail）
**预计**：4-5h
**抓取源**：
- `docs/design/components/taskboard.jsx` 中 tags / chat / export 渲染段
- `docs/design/components/item_tags.jsx`（如存在）
- 现有 `frontend/src/pages/WorkspacePage/useTagFilter.ts`
- N11 时藏掉的导出工作包入口（`docs/EXECUTION_PLAN.md` 提及）

**产出文件**：
1. `TaskboardPage/TagsTab.tsx` — 标签库 + 筛选 + 编辑标签
2. `TaskboardPage/ChatTab.tsx` — 复用 N6 的 task chat 组件
3. `TaskboardPage/ExportTab.tsx` — 重新启用 N11 注释的导出工作包入口
4. **删除** 旧 `WorkspaceDetail.tsx`（**前提**：QA 一遍上面 8 个 tab 都正常 + 用户点头）

**操作步骤**：
1. Export tab 实现前先看 N11 注释的代码，确认能直接复活
2. 删 WorkspaceDetail 前先 `grep -rn "WorkspaceDetail"` 找所有引用
3. router.tsx 清理 import

**验收**：
- ✅ Tags tab 能筛选/编辑标签
- ✅ Chat tab 加载 RAG 对话
- ✅ Export tab 能产出工作包
- ✅ 旧 WorkspaceDetail 删后无残留 import
- ✅ `pytest tests/backend -q` + `pnpm build` 全绿

---

### H2.5+ Style 风格报告 + A/B 对比（押后，等 [C] 一起）

**状态**：**不在 H2 范围**。

理由：
- 后端无对应能力（无风格 DNA 计算、无对比 API）
- 涉及生成模型 API 接入 = `[C] AI 导演` 模块范畴
- 现在做容易做出空壳被废

后续会在 `[C]` 启动时统一规划。**Taskboard 的 9 个 tab 中**这两个先做禁用态 + tooltip "Phase [C]"，UI 不留空。

---

## H2 完工标准

1. `/workspaces/:id` 路由是新 Taskboard，**视觉 1:1 对照设计稿**
2. 9 个 tab：7 个可用（materials/queue/favs/history/tags/chat/export），2 个禁用 + tooltip
3. 头部 5 维度上下文从 workspaceStore 取
4. 老 WorkspaceDetail 干净删除（H2.4 末）
5. `pytest tests/backend -q` + `pnpm lint` + `pnpm build` 全绿
6. 4 个子任务每个独立 commit，不堆积

---

## 模型决策速查（每个子任务开工前确认）

| 子任务 | 模型 | 理由 |
|---|---|---|
| H2.1 骨架 + 9 Tab nav | **Sonnet 4.6** | 新建多文件 React 组件 + 接 store + router 切换 |
| H2.2 Materials | **Sonnet 4.6** | 状态机映射 + 多状态 UI + 跳详情路由 |
| H2.3 Queue + Favs + Versions | ⭐ **小米 2.5 Pro** | 整合现有组件，模板化 |
| H2.4 Tags + Chat + Export + 清理 | **Sonnet 4.6** | 删旧代码风险 + 多决策点 |
| H2.5+ Style + Compare | **押后等 `[C]`** | 后端能力缺失 |

---

## 与其它 Phase 的关系

- H2 完成后下一步：H3 Processing 处理中页面（待 plan）/ H4 Results / H5 Storyboard
- `N7b` / `N8b` 仍延后，与 H 系列**并行不冲突**
- `[C] AI 导演` 会顺带做 H2.5+ Style + Compare
- `[D] 开源准备` 最后

---

## 风险与备忘

- **风险 1**：旧 WorkspaceDetail 572 行，含 N3/N4/N5 多次迭代的功能，**必须** grep 找全引用再删，避免回归
- **风险 2**：5 维度上下文（contentType/people/background/terms/purpose）当前 store 字段命名未必对得上设计稿，H2.1 时先 dump 字段确认
- **风险 3**：移动端断点设计稿没明确给，H2 默认只做桌面端 1280+ 视口，移动端等 H 收尾或专门做
- **风险 4**：Tab 切换不走路由（用 `useState`），刷新会回 materials——如果用户希望刷新保留 tab，要改成 query param

---

## 验收用 Skill 速查

- `anthropic-skills:webapp-testing` + `anthropic-skills:playwright` — 视觉验收（每个 tab 截图对比）
- `design:accessibility-review` — H2.1 完工后跑一次
- `anthropic-skills:karpathy-guidelines` — 每次 commit 前过一遍，防过度抽象
