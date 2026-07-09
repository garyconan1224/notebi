---
phase: RP1-B · B-8 学习笔记页内 AI 问答抽屉
status: done
completed_date: 2026-05-31
owner: xiaomi-mimo-2.5pro
parent: docs/plans/result-pages-redesign-v1.md § RP1-B · B-8
companion: docs/plans/rp1-execution-handoff.md § 3.3 提示词 B-8
prerequisite:
  - ln 页存在（B-1+）；建议作为 RP1-B 收尾（最重，5-7h）
estimated_hours: 5-7
deps_redline: false   # 后端 chat.py/rag.py SSE 现成；前端 SSE 用原生 EventSource/fetch，无新依赖
decisions:
  - 已决议（result-pages-redesign-v1.md §333-3）：本期做，但**作用域限定**「仅在学习笔记页内问当前笔记 + 视频字幕」，不做全局问答。
---

## 0. 前置说明（mimo 必读）

> **⚠️ 2026-05-31 现状更新（开工必看，文档其余部分写于更早）**：
> - 学习笔记页已重排为 **笔记左 62% / 视频+字幕右 38%**（index.tsx 里 `<LNNotesPanel>` 在 DOM 最前），顶栏已新增**导出菜单**（PDF/MD/Obsidian）。
> - 「问 AI」浮动按钮放**笔记面板（左侧）右下角**，与顶栏导出菜单不冲突。
> - `backend/app/services/ln_service.py` **已不存在**；上下文统一走 `rag_qa_service.ask_with_sources`（`backend/app/routes/rag.py` 调用）。任务 0 以 rag.py + rag_qa_service.py 为准。

B-8 在学习笔记页加一个「问 AI」浮动按钮 → 右侧抽屉，用户问"这段视频讲了什么""3:42 那个画面什么意思"，AI 基于**当前 ln.md + transcript** 回答（流式）。

### 后端基本现成（B-8 启动时务必先 rg 核对契约）

- `backend/app/routes/chat.py` 已有完整对话 SSE：POST 创建一轮、GET `/events?turn_id=` SSE 推 delta/done/error（30s 心跳）、GET `/messages` 历史、GET `/list`。
- `backend/app/routes/rag.py` 用 `ask_with_sources`（`backend/app/services/ln_service.py` / `rag_qa_service.py`）。
- **关键未知**：上下文 scope 怎么注入——chat.py 是否已按 workspace 自动带 ln+transcript，还是要前端传？**任务 0 必须先确认**，决定前端只发问题还是要带上下文。

### 是否已有前端 chat 组件可复用

先 `rg -rln "EventSource|chat|SSE|LiveLog" frontend/src` —— 若已有 SSE 处理（如 LiveLog.tsx）或 chat 前端，复用其流式逻辑，别重写。

---

## 1. mimo 启动提示词（直接复制到 ccswitch CC 终端）

```
RP1-B · B-8 学习笔记页内 AI 问答抽屉（作用域限当前笔记 + 字幕）。
实测 URL: http://localhost:5177/workspaces/{有 ln.md 的 ws}/ln

详细规格: docs/plans/result-pages-redesign-v1.md § RP1-B · B-8
本任务计划: docs/plans/rp1-b8-mimo-prompt.md
已决议: 仅问当前笔记 + 当前视频字幕，不做全局问答。

【任务 0: 先摸清后端契约（决定前端怎么发）】
  rg -n "router\.(post|get)|turn_id|delta|done|events|context|ln|transcript" backend/app/routes/chat.py
  rg -n "ask_with_sources|context|sources" backend/app/routes/rag.py backend/app/services/ln_service.py
  确认：用 chat.py 还是 rag.py；上下文是后端按 ws 自动注入，还是前端要传 ln+transcript；SSE 事件名。
  → 若后端不支持"限定 ln+transcript scope"，做最小后端改动支持一个 scope=ln 参数（属本任务范围）。

【任务 1: 浮动按钮 + 右抽屉 UI】
  - 笔记面板右下角浮动「问 AI」按钮 → 点击滑出右抽屉（宽 ~360px，可关闭）。
  - 抽屉内：消息列表（user/assistant 气泡）+ 底部输入框 + 发送。
  - 样式用 nibi token，light/dark 可读。

【任务 2: 接 SSE 流式】
  - 发送 → 调后端创建一轮 → 订阅 /events SSE → 逐 delta 追加到 assistant 气泡 → done 收尾。
  - 复用现有 SSE 处理（先 rg EventSource/LiveLog）；错误/断连显示重试。

【任务 3: 上下文限定】
  - 按任务 0 结论，把"当前 ln.md 全文 + transcript 段"作为问答上下文（后端注入或前端传）。
  - 抽屉顶部标一句"仅基于本视频笔记与字幕回答"，让作用域对用户透明。

【范围限制】
- 不做全局/跨 workspace 问答、不做多会话管理 UI（一个抽屉一条对话即可）。
- 不碰编辑/保存/截图/导出。前端 SSE 用原生，不装新依赖。
- 后端只在"支持 scope 限定"必要时做最小改动，不重构 chat/rag。不留 debug 脚本。

【验证】
- 若动了后端：pytest 相关用例自己跑过。
- pnpm build + tsc EXIT=0
- 手测一次完整问答往返（问"这个视频讲了什么" → 流式出答案 → 答案确实基于本笔记）
- playwright 归档 2 张: docs/e2e-test/screenshots/rp1b-b8-{drawer-open,answer}.png
- git commit: feat(rp1-b): B-8 学习笔记页内 AI 问答抽屉
  Co-Authored-By: xiaomi-mimo-2.5pro <noreply@xiaomi.com>
- 更新 COMPLETED_WORK + EXECUTION_PLAN（加 B-8 条 → 此条完成后 RP1-B 主行可打勾）
- 不要 push
```

## 2. 风险预案

| 风险 | 应对 |
|---|---|
| chat.py 默认全局上下文，不限 ln | 任务 0 确认；必要时加 scope=ln 参数，后端只取该 ws 的 ln+transcript 作上下文 |
| ln.md 过长超 token 上限 | 截断/摘要 transcript，或只取 ln.md 正文；记策略到注释 |
| SSE 在 dev 代理下断连 | 用现成 SSE 处理（含心跳/重连）；./dev.sh 起的前后端同源，避免 CORS |
| 重复造 chat 前端 | 先 rg 现有 chat/SSE 组件，能复用就复用 |

## 3. 验收清单

> **2026-05-31 晚 · 布局回归修复（opus）**：B-8 功能链路 mimo 已实现且可用，但 AI 面板原为 `absolute` 常驻、挤占布局，笔记宽度回归（只占 62% 容器留空白）。已修：`.ln-chat-fab`/`.ln-chat-drawer` 改 `position:fixed` 右下悬浮面板（380×min(70vh,620px)，参考 `FloatingTaskQueue`）；`index.tsx` 去掉笔记外层 wrapper，笔记面板恢复占满左栏 62%（两栏满布局）；暗色边框统一。tsc=0 + build OK。

- [x] 任务 0 摸清 chat/rag 契约 + 上下文注入方式
- [x] 浮动按钮 + 悬浮面板 UI（fixed 右下，light/dark 边框统一）
- [x] SSE 流式问答（复用现有 SSE 处理）
- [x] 上下文限当前 ln + transcript
- [x] 一次问答往返手测通过（用户实测）
- [x] pnpm build + tsc EXIT=0
- [x] 无新前端依赖、无 debug 脚本
- [ ] 截图 + COMPLETED_WORK + EXECUTION_PLAN 登记（待 commit 时补）、没 push
```
