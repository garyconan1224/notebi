---
phase: H3
title: Processing 处理中页面 1:1 复刻
status: ready
branch: feat/homepage-h3-processing
created: 2026-05-20
priority: P2
estimate_hours: 4-6
depends_on: H2 已合并
---

# H3 Processing 处理中页面

> 设计稿源：`docs/design/components/processing.jsx`（152 行）
> 决议 Q2 = 方案 A：新建 `/workspaces/:wid/items/:iid/processing` 路由
> 后端能力：SSE `/pipeline/{id}/events` + WebSocket `…/ws` 已就绪

## 用户路径

```
Workbench / 「开始解析」
  → Preflight 抽屉确认参数
  → POST /pipeline/... 创建任务
  → 跳 /workspaces/:wid/items/:iid/processing  ← H3 新增
  → 任务完成 → 自动跳 /workspaces/:wid/items/:iid/result（H4 改造）
```

## 子任务

### H3.1 ProcessingPage 骨架 + SSE 接线

**模型**：⭐ 小米 2.5 Pro
**预计**：4-6h
**抓取源**：
- `docs/design/components/processing.jsx` 全文（1:1 翻译为 TSX）
- `docs/design/VidMirror.html` 中 `.proc-`, `.live-`, `.step-` 开头的 CSS
- 现有 `frontend/src/services/events.ts`（SSE hook 已实现）
- 现有 `frontend/src/store/taskStore.ts`（任务状态来源）

**产出文件**：
1. `frontend/src/pages/result/ProcessingPage/index.tsx`
2. `frontend/src/pages/result/ProcessingPage/processing.css`
3. `frontend/src/pages/result/ProcessingPage/StepProgress.tsx`（7 步进度条）
4. `frontend/src/pages/result/ProcessingPage/LiveLog.tsx`（实时日志流）

**路由改动**：
- `router.tsx`：新增 `/workspaces/:wid/items/:iid/processing`
- `Composer.tsx` / `Preflight` 提交成功后跳此路由（之前 toast 跳 `/workspaces/:id`）
- 任务 status === SUCCESS 时自动 `navigate` 到 result 路由

**验收**：
- ✅ 粘 URL → 开始解析 → 进 Processing 页面，看到步骤进度
- ✅ 实时日志滚动（SSE 推送的事件）
- ✅ 任务完成自动跳 Results
- ✅ 失败时显示错误 + 重试按钮
- ✅ `pnpm build` + `pnpm lint` 新文件零错误

**禁止**：
- ❌ 不动其它结果页（那是 H4）
- ❌ 不实现"取消任务"按钮以外的副功能
