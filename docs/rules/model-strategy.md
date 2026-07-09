# 模型选择策略（四档决策树）

> 本文件由 `CLAUDE.md` §7 索引指向。**用户决定用哪档模型时查阅，AI 仅在被问到时引用。**
>
> Last updated: 2026-05-29（DS → xiaomi mimo 2.5pro，ccswitch 中转沿用）

---

## 背景

用户同时使用：

- **Claude 桌面版 Code / Claude Desktop**：用于计划、调查、拆任务。用户通常选择 Opus，Effort 用 Medium 或 Low。
- **Claude Code 终端 + ccswitch 接 xiaomi mimo 2.5pro**：用于实际执行代码、测试、commit。终端界面可能显示 Opus / Sonnet / max effort，但底层经 ccswitch 路由到小米模型，不等同于桌面付费 Opus。

**ccswitch 是透明中转代理**：在 Claude Code 终端里选 Sonnet / Opus 角色 → ccswitch 自动路由到 `xiaomi-mimo-2.5pro`。因此不要只根据终端 UI 的 Opus/max 字样判断成本；真正需要控制的是任务范围、读取量、subagent 数量和输出长度。**mimo 当前没有 flash 等小档**——单行 typo / 极简兜底回退到桌面 Haiku 4.5。

**按以下顺序判断，命中即停**：

---

## 档 1 — Claude 桌面版 Opus（付费）：复杂计划 + 升级触发

**任一命中即用**：

- 跨后端 + 前端 + 状态机的复杂阶段
- 跨文件改动 ≥ 5
- schema 迁移 + 老数据兼容
- 加密 / 鉴权 / API key
- SSE / WebSocket / 状态机一致性
- 三轨时间轴 / RAG 检索逻辑设计
- AI 自己说"不太确定哪个方案对"

---

## 档 2 — Sonnet 4.6（桌面，付费）：中等复杂多文件

- 多文件 CRUD（3–5 个文件）
- 组件级前端开发（新建 React 组件 + 接 API）
- 需要严谨业务理解但不烧脑的任务

---

## 档 3 — xiaomi mimo 2.5pro（Claude Code 终端 + ccswitch，便宜优先）：日常执行默认

**这一档是日常执行默认**。在 Claude Code 终端里选 Sonnet 或 Opus 角色，ccswitch 自动路由到 `xiaomi-mimo-2.5pro`。**能用就用，不要因为"mimo 可能不够强"而升到桌面 Sonnet/Opus 浪费 Claude 付费额度**。

**适用场景**：

- git 操作（add / commit / merge / branch / 清理 worktree；**不要 push**，按 CLAUDE.md §4 红线）
- 跑终端命令验证（pytest happy path、pnpm build、curl 测接口、启动 dev server）
- 文档改写（README / docs/*.md / 注释润色 / CLAUDE.md 维护）
- 模板代码（pytest happy path、CRUD 路由骨架、Pydantic schema）
- CSS token 翻译、Tailwind 配置调整
- 重复性改写（i18n key 抽取、批量 import 修改）
- 单文件简单查询 / 解释代码
- 查文档（fastapi / vite / tailwind 用法）

**mimo 的工具能力**：Bash / Read / Write / Edit / Grep / Glob 全套都能用，可独立完成 commit、跑测试、改文件。

**mimo 不擅长 → 升档 1 Opus**：

- 跨 5+ 文件架构
- 复杂状态机推理
- 加密鉴权细节
- RAG / SSE 一致性

---

## 档 4 — 桌面 Haiku 4.5：极简兜底

- 单行修改 / typo
- 短得不值得用 mimo 的任务（< 2 分钟）
- mimo 当前没有 flash 档，所以兜底直接回退到**桌面 Haiku 4.5**

> ⚠️ **不要让 Haiku 当日常默认**：能力弱，多文件 CRUD / 组件级前端会翻车。日常默认必须 mimo 2.5pro。

---

## Phase 启动速查

开工前对照 `docs/EXECUTION_PLAN.md` + 本文件四档决策：

- **当前阶段（2026-05-29）**：R21.P3.S3 followup 已 merge 进 main；下一步**音频 + 视频端到端闭环打通**（用户 5/29 决议）。
- **可选下一步**：N7b 路径3 视频大模型（Gemini，待 API）/ N8b librosa 后端 / R20 笔记多格式导出 / R22 并行 / R23 性能档位 / [C] AI 导演 / [D] 开源。
- **简单阶段**（纯前后端 CRUD / 文档 / 模板代码）：mimo 2.5pro（Claude Code 终端 + ccswitch），**不开 worktree**。
- **复杂阶段**（[C] AI 导演 / 跨状态机 SSE / 加密鉴权 / RAG）：先由 Claude 桌面版 Opus 做计划；若小米执行失败两轮或风险过高，再升级执行者。

### 决策速查表

| 任务特征 | 推荐模型 |
|---|---|
| 复杂 / SSE / 状态机 / 加密 | Opus 4.7 |
| 中等多文件 CRUD | Sonnet 4.6 |
| git / 测试 / 文档 / 模板 | xiaomi mimo 2.5pro（ccswitch）|
| 单行 typo | 桌面 Haiku 4.5 |
