---
name: phase-r9-floating-task-queue
status: ready
branch: feat/phase-r9-floating-task-queue
baseline_commit: e79a384  # 当前 main
owner: ds (claude code + ccswitch deepseek-v4-pro)
created_date: 2026-05-25
---

# Phase R9 — 全局浮动任务队列

## 目标

跨页面右下角浮动胶囊 + 点击向上弹 popover，让用户离开 ProcessingPage 后仍能看到活跃任务进度并快速切换回去。形态参考用户截图（胶囊：`批量队列 · 5 项进行` + 副行 `● 3 处理中 · 1 等待 · × 1 失败`）。

## 决议（已和用户确认）

| 项 | 决议 |
|---|---|
| 显示时机 | **有活跃任务（非终结态）时出现，全部终结后自动隐藏** |
| 展开形态 | 点击胶囊向上弹 popover（~320×400px），列 5-8 个最近任务 |
| 数据源 | **新增后端 SSE 全局事件流** `/pipeline/events`（无 task_id 版本） |
| 位置 | AppShell 挂载，所有路由都能见 |
| 点击任务 | 跳 `/processing/{taskId}` |

## 当前状态（DS 开工前必读）

- 后端已有 `/pipeline/tasks/{task_id}/events` 单任务 SSE（[backend/app/routes/pipeline.py:160](backend/app/routes/pipeline.py)）
- 前端已有 `useTaskSse` 单任务 hook 和 `usePipelineTasks` 全量轮询 hook
- `useTaskStore` (zustand) 已有 `tasks` 数组和 update 方法
- AppShell ([frontend/src/layouts/AppShell.tsx](frontend/src/layouts/AppShell.tsx)) 是 192 行的 Sidebar 容器，已通过 React Router Outlet 渲染子页
- ProcessingPage 当前默认跳转：任务完成后 1.5s 自动跳结果页（[index.tsx:96](frontend/src/pages/result/ProcessingPage/index.tsx) 附近）

## 子任务（独立 commit）

### R9.1 — 后端全局 SSE 端点

**文件**：`backend/app/routes/pipeline.py`

新增端点（仿照 L160 单任务 SSE 的结构）：

```python
@router.get("/events")
def stream_global_events() -> StreamingResponse:
    """全局任务事件流：所有任务的快照变更 + 心跳"""
```

实现要点：
- 轮询 `_store.list()`（已有方法）
- 每个任务维护 `(last_status, last_progress)`，变化时 emit `{type:'task', task:{...}}`
- 新任务出现 emit `{type:'task_added', task:{...}}`
- 任务消失（被删）emit `{type:'task_removed', task_id:...}`
- 30s 心跳同单任务端点
- 轮询间隔 0.5s
- ⚠️ payload 不带 `log`（日志走单任务端点）以减带宽

**新增测试**：`tests/backend/test_pipeline_global_events.py`
- happy path：起一个 fake task → 订阅 SSE → 收到 task_added + 进度更新事件
- 终结后端点继续保持连接（不像单任务版那样 break）

**commit**：`feat(phase-r9): R9.1 后端 /pipeline/events 全局 SSE 端点`

---

### R9.2 — 前端全局事件 hook

**新文件**：`frontend/src/hooks/useGlobalTaskEvents.ts`

仿 `useTaskSse.ts` 结构：
- mount 时 `new EventSource('/pipeline/events')`
- 收到 `task` / `task_added` 事件 → 调 `useTaskStore.upsertTask(task)`
- 收到 `task_removed` → `useTaskStore.removeTask(taskId)`
- unmount 时 close
- 网络错误首次 toast 一次（防刷屏）

**确保 useTaskStore 有需要的方法**：`upsertTask` / `removeTask`（若没有就加上，仿 `updateTask` 写法，不要换 store 库）

**commit**：`feat(phase-r9): R9.2 useGlobalTaskEvents hook + store upsert/remove`

---

### R9.3 — FloatingTaskQueue 组件

**新文件**：`frontend/src/components/FloatingTaskQueue.tsx` + 同目录 `FloatingTaskQueue.css`（或挂在 `index.css`）

#### 胶囊（收起态）
- 固定 `position: fixed; bottom: 24px; right: 24px; z-index: 60`
- 圆角 99px，深色背景 `var(--ink)` 或 `var(--bg-elev)` 边框 `var(--line-strong)`
- 内容布局：左圆环进度（用 SVG conic-gradient，整体百分比 = 活跃任务平均 progress）+ 主标题 `批量队列 · N 项进行` + 副行 `● N 处理中 · N 等待 · × N 失败`
- 副行的 `处理中` 用 `var(--accent-green)`，`失败` 用 `var(--accent)`，`等待` 用 `var(--ink-3)`
- hover 微抬阴影；点击切 popover

#### Popover（展开态）
- 在胶囊上方 8px、`bottom: 80px right: 24px`，宽 320，最大高 400
- 头部：`最近任务 · N 个活跃` + 关闭 X
- 列表：取 `useTaskStore.tasks` 按 `updated_at desc` 截前 8 个，每条：
  - 状态点（活跃绿/失败红/完成灰/等待透明）
  - 一行标题（截断）+ 副 mono：类型 · stage 名 · `${progress*100|0}%`
  - 点击 `navigate('/processing/' + task_id)` + 关闭 popover
- 底部："查看全部" → `/taskboard`
- ESC / 点击 backdrop / 5s 无 hover 自动收起（5s 那条可选，默认不做以免烦人）

#### 显示逻辑
- `activeTasks = tasks.filter(t => !isTaskTerminal(t.status))`
- `activeTasks.length === 0` → 不渲染整个组件
- 用 framer-motion 或纯 CSS transition fade 100ms（项目里 grep 一下有没有 framer-motion，没有就纯 CSS）

**commit**：`feat(phase-r9): R9.3 FloatingTaskQueue 胶囊 + popover 组件`

---

### R9.4 — AppShell 挂载 + 全局 hook 启动

**文件**：`frontend/src/layouts/AppShell.tsx`

- 在 AppShell 顶层 mount 时 `useGlobalTaskEvents()`
- 渲染 `<FloatingTaskQueue />`，位置：与 `<Outlet/>` 同级，不要嵌进 sidebar 容器

**注意路由白名单**：原本 ProcessingPage 自己显示了当前任务，再叠浮动窗有点冗余。决议是**全部页面都显示**（与"有活跃任务时出现"一致，不做页面级过滤）。

**commit**：`feat(phase-r9): R9.4 AppShell 挂载 FloatingTaskQueue 与全局事件订阅`

---

### R9.5 — 端到端冒烟 + 文档

- 启 backend + frontend
- 跑 `scripts/browser_smoke.py --url http://localhost:5175/` 验证胶囊不出现（无活跃任务）
- 起 1 个真实任务：粘贴 b 站短视频 URL → 一键解析 → 跳 /processing → 切回首页 → 胶囊应该可见
- 点胶囊 → popover 列表显示该任务 → 点条目跳回 /processing
- 任务完成后 ~3s 内胶囊自动隐藏

**收尾**：
- 更新 `docs/EXECUTION_PLAN.md` / `docs/COMPLETED_WORK.md`
- 本文件 frontmatter `status: done`

**commit**：`docs(phase-r9): R9 完工记录与冒烟结果`

---

## 禁止事项

- ❌ 不动 ProcessingPage / AddMaterialModal / PreflightDrawer / Composer / Hero（这些是 R7/R8 边界）
- ❌ 不引入新 state 库（继续用 zustand `useTaskStore`）
- ❌ 不引入 framer-motion 等新依赖
- ❌ 不写 hardcoded hex，用 `var(--*)` token
- ❌ 不 push 远端
- ❌ 5 commit 完成后不要自动 merge，停下等用户授权

---

## 验收

1. `pytest tests/backend/test_pipeline_global_events.py -q` 通过
2. `pnpm lint && pnpm build && pnpm test --run` 通过
3. 手测链路：起任务 → 胶囊出现 → 切页面胶囊跟随 → 点 popover 任务跳转 → 完成后胶囊自动隐藏
4. 多任务场景（连续起 3 个）：副行计数正确
