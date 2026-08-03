# CLAUDE.md

> 项目级入口规则。与全局 `~/.claude/CLAUDE.md` 一起生效。
> 本文件只放稳定协作规则；当前进度、下一步和历史事实以 [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md) 顶部为准，不写在这里。

---

## 1. 项目基线

- 后端：Python 3.11 + FastAPI + SQLAlchemy + SQLite
- 前端：React 19 + TypeScript + Vite 6 + Tailwind 4
- 产品：NoteBi，本地优先的内容笔记工具，从 `/Users/conan/Desktop/nibi` 拆分出来，默认运行 `VITE_PRODUCT_MODE=notebi`
- 用户：编程新手；回复要用中文，并把关键操作解释清楚

---

## 2. 每次启动先做

```bash
cd /Users/conan/Desktop/notebi
git status --short --branch
git log --oneline -5
git branch --show-current
```

默认只读这些小片段：

1. 本文件顶部规则。
2. `docs/AI_HANDOFF.md` 前 80 行。
3. `docs/rules/agent-roles.md`，用于确认 Codex 直接执行与可选外部工具边界。
4. 用户明确点名的计划文件或代码文件。

`git log` 是事实来源。若 `AI_HANDOFF.md` 顶部与最近 commit 冲突，先报告漂移并请求确认，不要按旧文档继续。

不要默认读取历史计划或 `docs/design/`。产品边界按需读取 `docs/PRODUCT_DECISIONS.md`，当前状态只看 `docs/AI_HANDOFF.md` 顶部和 Git。

---

## 3. Codex 直接执行铁律

默认协作链：

1. **Codex**：负责调查、实测、根因分析、产品/技术计划、具体实现、测试、提交和最终验证。
2. **用户**：负责产品取舍、风险停点与是否采用外部工具的决定。

执行类计划落地为 `docs/plans/*.md`（背景 / 根因 / 修复方案 / 涉及文件 / 验收 / 执行红线）；完成并合入后删除计划文件，历史从 Git 提交读取。

**计划 / 调查与执行隔离**：当用户要求“先做计划”“先调查”或尚未明确同意执行时，Codex 只能用本地代码、文档、运行证据和必要的定向测试完成工作；不得调用外部执行器、Open Design 或为规划生成完整设计稿。交付应包含：问题归类、事实证据、待确认产品决策、分批执行顺序和验收标准。用户明确说“执行 / 按计划做”后，Codex 才在已确认范围内直接实现。

**Claude Code 是可选工具，不是必经步骤**：只有用户在当前任务明确要求使用 Claude Code / 千问时，Codex 才可启动并监控它；否则不得把实现、测试或 commit 默认转交出去。外部执行结果也必须由 Codex 复验。

**UI/设计分支**：仅在用户已经授权执行、且当前批次涉及用户可见 UI 页面、布局、视觉稿、交互流程或视觉审查时，Codex 才可用 Open Design 产出或审查该批设计方案。Open Design 只做设计/评审，不写生产代码；Codex 根据确认的产物直接实现并验证。详见 [`docs/rules/agent-roles.md`](docs/rules/agent-roles.md)。

产品决策（功能取舍 / 交互方案）仍由用户拍板；Codex 只给事实、选项与建议。

需要完整执行与工具边界时再读 [`docs/rules/agent-roles.md`](docs/rules/agent-roles.md)。

---

## 4. 沟通规则

1. 始终用中文回复。
2. 改代码或文档前，先说明要改哪些文件、为什么改。
3. 改完后用 1-2 句总结效果。
4. 遇到术语，第一次出现时用白话解释一句。
5. 用户问“这是干什么的”时直接说明，不要假设用户已理解背景。
6. 涉及产品需求或 UI 改动，先与用户确认“是你的想法”再写死详细方案，不凭猜决定。

---

## 5. 风险求证

出现以下情况必须停下来问用户：

1. 安装新依赖或全局软件。
2. 修改当前计划没有覆盖的子任务。
3. 实际代码与计划文件描述不符。
4. 修改数据库 schema 或迁移。
5. 涉及加密、API key、鉴权、权限或用户数据安全。
6. 预计跨 5 个以上文件。
7. 同主题存在其他 worktree / agent 会话 / 未提交改动，可能互相覆盖。
8. 实际实现遇到计划没有描述的行为、接口或数据结构。

求证格式：

> 我在做 X 时发现实际情况是 A，但计划里写的是 B。
> 我看到两个方案：1. ... 2. ...
> 你想按哪个方向处理？

### 本轮强制停点

- 只要出现上述任一情况，立即停止当前执行，不用默认方案继续推进。
- 先用中文说明已完成的检查、发现的事实、阻塞点和可选方案，等待用户选择。
- 不为了让测试通过而偷偷改变产品语义、删除旧功能、扩大文件范围或修改数据库结构。

---

## 6. 红线

- 不主动重构无关代码。
- 不改 `.env` 或 `.env.example`，除非用户明确要求或新增字段且已说明。
- 不执行危险命令：`rm -rf`、`git reset --hard`、`git push --force`、`git clean -fd`。
- 不把 API key、密码或 token 写进代码或 commit。
- 不在未确认时修改 git 历史，例如 rebase、amend 主线 commit。
- 不主动 `git push origin`；push 需要用户明确确认。
- 不在 `docs/archive/`、`docs/conversation-inputs/` 目录搜索或读取。
- 不在脏工作树上验证“单个 commit 能否过审”；需要 commit 级审查时，用干净 worktree 或先隔离未提交改动。

---

## 7. 计划和规格只按需读

当前事实和产品仲裁优先级：

1. 当前代码、运行结果和 `git log`。
2. `docs/AI_HANDOFF.md` 顶部当前指针。
3. `docs/PRODUCT_DECISIONS.md` 中已确认的产品边界。
4. 当前任务明确点名的 `docs/plans/*.md`。
5. `docs/design/` + `docs/DESIGN_TOKENS.md`，仅用于 UI 设计落地。

文档与代码冲突时先报告，不按历史文档继续。

---

## 8. 规则索引

按需片段读取，不预读整文件：

| 主题 | 文件 |
|---|---|
| 上下文预算 / 读文件 / `/clear` 接力 | [`docs/rules/context-budget.md`](docs/rules/context-budget.md) |
| Git 行为 / commit / push | [`docs/rules/git-workflow.md`](docs/rules/git-workflow.md) |
| Python / TypeScript / UI / 测试风格 | [`docs/rules/code-style.md`](docs/rules/code-style.md) |
| pipeline / 状态机 / 阈值 / 清理策略 | [`docs/rules/business-contract.md`](docs/rules/business-contract.md) |
| 执行工具选择：Codex 直接执行 / 可选 Claude Code | [`docs/rules/model-strategy.md`](docs/rules/model-strategy.md) |
| 项目结构 / router / 端口 / 常用命令 | [`docs/rules/project-map.md`](docs/rules/project-map.md) |
| 外部执行器历史说明（沿用旧文件名） | [`docs/rules/mimo-onboarding.md`](docs/rules/mimo-onboarding.md) |
| Codex 直接执行与 Open Design 协作 | [`docs/rules/agent-roles.md`](docs/rules/agent-roles.md) |

产物目录约定：

- `docs/plans/`：仅存放尚未完成的可执行计划；完成后从当前树删除。
- `docs/test-reports/`：手测 / E2E 报告；截图在 `frontend/test-results/`（gitignore，不进 git）。

---

## 9. 回复前自检

- 是否用中文，并解释了关键操作？
- 是否只读了必要片段，而不是整文件扫全项目？
- 是否遵守了 Codex 调查、直接实现、独立验证，以及外部工具必须由用户明确指定的边界？
- 是否触发风险求证项？若触发，是否已经停下来问用户？
- 是否避免了无关重构、危险命令、主动 push 和脏树 commit 审查？
