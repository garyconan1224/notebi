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
3. `docs/rules/agent-roles.md`，用于确认 Codex / Claude Code + 千问接力边界。
4. 用户明确点名的计划文件或代码文件。

`git log` 是事实来源。若 `AI_HANDOFF.md` 顶部与最近 commit 冲突，先报告漂移并请求确认，不要按旧文档继续。

不要默认读取历史计划或 `docs/design/`。产品边界按需读取 `docs/PRODUCT_DECISIONS.md`，当前状态只看 `docs/AI_HANDOFF.md` 顶部和 Git。

---

## 3. Codex / 千问协作铁律

默认协作链：

1. **Codex**：负责调查、实测、根因分析、产品/技术计划和可执行验收标准。
2. **Claude Code 终端 + 千问**：只按 Codex 已确认的任务执行具体修改、测试和 commit；当前由 CC Switch 路由到千问模型，每次新会话先核对实际模型映射。
3. **Codex**：Claude Code 完成后独立审查 diff、测试和运行证据，给出通过 / 不通过 / 需要补充验证。

具体执行默认交给 Claude Code 中的千问，不让千问重新做产品规划。执行类计划落地为 `docs/plans/*.md`（背景 / 根因 / 修复方案 / 涉及文件 / 验收 / 给千问的执行须知与红线）；完成并合入后删除计划文件，历史从 Git 提交读取。

**计划 / 调查与执行隔离**：当用户要求“先做计划”“先调查”或尚未明确同意执行时，Codex 只能用本地代码、文档、运行证据和必要的定向测试完成工作；**不得启动 Claude Code + 千问，不得调用 Open Design，也不得为规划生成完整设计稿或重启外部工具**。此阶段的交付应是：问题归类、事实证据、待确认产品决策、分批执行顺序、验收标准和可直接交给千问的提示词。只有用户明确说“执行 / 按计划做”后，才按对应批次启动千问；该批确有 UI 设计需求时，再为该批、该页面调用 Open Design。除非用户在当前轮明确要求把某个外部工具用于计划本身，否则本条优先；不得因外部工具卡住而拖长计划阶段。

审查不通过时，把 Codex 的具体问题、失败测试和验收差距退回千问修一次；**同一个问题连续两次仍未解决，Codex 直接接管并修复，不再第三次来回转交**。这里的“同一个问题”按同一根因或同一验收项计数；新发现的独立问题重新计数。Codex 接管后仍遵守风险求证、TDD、干净工作区和不主动 push 的规则。

**UI/设计分支**：仅在用户已经授权执行、且当前执行批次涉及用户可见 UI 页面、布局、视觉稿、交互流程或视觉审查时，Codex 才可用 Open Design 产出或审查该批设计方案，再把已确认的设计产物、约束和验收点交给千问实现；计划和调查阶段不调用。没有 UI/设计需求时不强制调用。Open Design 是设计/评审工具，不替代千问写生产代码；千问在缺少设计产物或设计与代码事实矛盾时必须停止回报，不得自行猜 UI。Codex 仍独立审查最终 UI 和运行证据。详见 [`docs/rules/agent-roles.md`](docs/rules/agent-roles.md)。

**会话隔离**：同一问题的返修可以保留上下文；不同问题、互不依赖的子任务，以及每次新建 Claude Code 执行任务前，必须先 `/clear` 或退出后启动全新会话。新会话启动前确认旧 Claude Code 进程已停止、工作区状态已对账，禁止两个执行器并行修改同一工作区。

**可见终端优先**：Codex 调用 Claude Code 时，优先使用用户可见的右侧/集成终端；当前界面无法直接写入时，打开前台可见 Terminal 窗口。除非用户明确同意或可见终端不可用，不要把长执行静默放在后台。每批至少在开始、红灯、绿灯、commit 四个节点汇报进度。

产品决策（功能取舍 / 交互方案）仍由用户拍板；Codex 和千问只给事实、选项与建议。

需要完整模板时再读 [`docs/rules/agent-roles.md`](docs/rules/agent-roles.md)。

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
| 模型选择：Codex 规划 / Claude Code + 千问执行 | [`docs/rules/model-strategy.md`](docs/rules/model-strategy.md) |
| 项目结构 / router / 端口 / 常用命令 | [`docs/rules/project-map.md`](docs/rules/project-map.md) |
| 千问终端执行加速协议（沿用旧文件名） | [`docs/rules/mimo-onboarding.md`](docs/rules/mimo-onboarding.md) |
| Codex / Claude Code + 千问接力 | [`docs/rules/agent-roles.md`](docs/rules/agent-roles.md) |

产物目录约定：

- `docs/plans/`：仅存放尚未完成的可执行计划；完成后从当前树删除。
- `docs/test-reports/`：手测 / E2E 报告；截图在 `frontend/test-results/`（gitignore，不进 git）。

---

## 9. 回复前自检

- 是否用中文，并解释了关键操作？
- 是否只读了必要片段，而不是整文件扫全项目？
- 是否遵守了 Codex 调查计划 / 千问执行 / Codex 审查与两次失败接管边界？
- 是否触发风险求证项？若触发，是否已经停下来问用户？
- 是否避免了无关重构、危险命令、主动 push 和脏树 commit 审查？
