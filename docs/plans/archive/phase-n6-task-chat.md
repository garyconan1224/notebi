---
phase: N6
title: 任务级 LLM 对话上下文素材多选 chip + RAG 兜底
status: done
priority: P1
estimate_hours: 6-8
actual_hours: ~2
model: Opus 4.7
branch: feat/phase-n6-task-chat
worktree: 是（/Users/conan/Desktop/nibi-n6）
depends_on: [N5]
commits: [ae7ed8b, 435e8cb, 935d933]
completed_date: 2026-05-19
spec_ref: docs/SPEC.md §1.5
---

## 范围概述

把现有 `ChatSidebar` 升级为 SPEC §1.5 描述的「任务级 AI 对话」：
- 对话面板顶部加「上下文素材」多选 chip 条
- 用户必须选 ≥ 1 个素材，提供「全任务上下文」一键全选
- 后端把选中 item 的分析结果拼成 system prompt 注入对话
- 上下文超 token 阈值时 → 自动截断/精简，前端顶部展示「上下文已自动精简」标识

**保留**：已有 SSE 流式 + chat_store 历史 + 工作区 chat 路由结构。
**不做**：跨任务 RAG（已由 Phase 3B 资料库覆盖）/ AI 导演 / 收藏功能。

---

## 现状 vs 目标差距

| 项 | 现状 | 目标 |
|---|---|---|
| 上下文注入 | 只有 user/assistant 历史，无 item 数据 | 选中 items 的 name + tags + results 拼成 system prompt |
| 素材选择 UI | 无 | 顶部 chip 条多选 + 「全选」按钮 |
| Token 兜底 | 无 | char 阈值（~12000，约 3000 token）超时降级 |
| 降级方式 | — | v1：按 item 优先级截断 + 提示；RAG embedding 检索留接口（后续 N9/N10 真接） |
| 已选状态 UI | — | 顶部 chip：未选灰、已选紫；底部输入框 disabled 若未选 |

---

## 子任务拆分

- [ ] **N6.1** 后端：context 构建工具
  - 新增 `backend/app/services/chat_context.py::build_item_context(workspace, item_ids, max_chars=12000)`
  - 输出 `{system_prompt: str, used_item_ids: [...], truncated: bool}`
  - 拼接顺序：item.name → tags → preflight.background → results 关键字段（summary / ocr_text / frame_prompts 前若干个）
  - 超阈值时按 item 顺序截断，第一个被截的标 `truncated=true`

- [ ] **N6.2** 后端：扩展 chat 路由 + runner
  - `ChatCreateRequest` 加 `item_ids: list[str]` 字段（可空）
  - `ChatRunner.start_turn` 接 `item_ids`，调 `build_item_context`，把 system_prompt 插到 history 第 0 位
  - 返回值加 `context_truncated: bool` 让前端显示提示
  - 入参 `item_ids` 不存在/为空时**保留旧行为**（向后兼容旧浮动 ChatSidebar 浮动按钮入口）

- [ ] **N6.3** 后端：单元测试
  - 至少 2 个：(a) 选 1 个 item 拼上下文成功 (b) 选超长 items 触发 truncated

- [ ] **N6.4** 前端：services/chat.ts 扩展
  - `createChatTurn` 入参加 `item_ids?: string[]`
  - 返回值类型加 `context_truncated?: boolean`

- [ ] **N6.5** 前端：ChatPanel 重构（独立于 ChatSidebar 浮动按钮）
  - 新建 `components/workspace/TaskChatPanel.tsx`：用于 WorkspaceDetail 的「AI 对话」Tab 内嵌
  - 顶部 chip 多选条：从 workspace.items 渲染，每个 chip 显示素材类型 icon + 截断的 name + 已选高亮
  - 「全任务上下文」按钮：一键勾选所有 items
  - 输入框上方提示：未选 item 时禁用发送，已截断时展示「上下文已自动精简」徽章
  - 复用现有 SSE 订阅逻辑（subscribeChatTurn）
  - 旧 `ChatSidebar`（浮动按钮）保留不动，作为「无上下文」的快速入口

- [ ] **N6.6** WorkspaceDetail：AI 对话 tab 切到新组件
  - 找到 N2 已加的「AI 对话」tab，把 ChatSidebar 替换/补充为 TaskChatPanel
  - ChatSidebar 浮动按钮不动

- [ ] **N6.7** 收尾：pytest + tsc + 文档
  - `pytest tests/backend -q`：所有通过 + 新增 2 个 chat_context 测试
  - `pnpm tsc -b --noEmit`：除 4 baseline 不新增
  - 更新 EXECUTION_PLAN / AI_HANDOFF / COMPLETED_WORK / plan frontmatter

---

## 数据形状

**请求体**（POST `/workspaces/{ws_id}/chat`）：
```json
{
  "prompt": "...",
  "chat_id": "...",
  "model": "...",
  "item_ids": ["item_abc", "item_def"]
}
```

**返回值**：
```json
{
  "turn_id": "...",
  "chat_id": "...",
  "workspace_id": "...",
  "status": "pending",
  "context_truncated": false,
  "used_item_ids": ["item_abc", "item_def"]
}
```

**system prompt 模板**：
```
你正在协助分析以下任务素材。回答时请引用具体素材内容。

任务背景：{workspace.background.topic}

素材 1：{name}（类型：video）
  - 标签：style=电影感, ...
  - 摘要：...
  - 提示词样例：...

素材 2：{name}（类型：image）
  - OCR：...
  - 提示词：...
```

---

## 不要做的事

- ❌ 不要重写 `ChatSidebar` 浮动按钮组件（保留作为"无上下文"快捷入口）
- ❌ 不要为 N6 引入新的 embedding 索引（沿用 char-based 截断；真 embedding RAG 等 N9/N10 跨素材对比时再做）
- ❌ 不要修改 `chat_store.jsonl` 存储格式
- ❌ 不要装新 Python 依赖

## 风险点

1. **workspace.items 的 results 结构跨素材类型差异大**——context builder 要按 `item.type` 分支处理，不能假设字段
2. **system prompt 注入位置**——`chat_store.list` 历史里只有 user/assistant，system prompt 是请求时动态插入，不持久化，避免污染历史
3. **char 阈值不等于 token**——v1 用 char 估算（中文 1 char ≈ 1 token，英文 4 char ≈ 1 token），偏保守阈值 12000 chars
