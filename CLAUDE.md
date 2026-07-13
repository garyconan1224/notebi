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
3. `docs/rules/agent-roles.md`，用于确认 Claude / 小米 / Codex 接力边界。
4. 用户明确点名的计划文件或代码文件。

`git log` 是事实来源。若 `AI_HANDOFF.md` 顶部与最近 commit 冲突，先报告漂移并请求确认，不要按旧文档继续。

不要默认读取 `docs/ROADMAP.md`、`docs/SPEC.md`、完整 `docs/EXECUTION_PLAN.md` 或 `docs/design/`。只有用户明确问长期规划、规格仲裁、设计落地，或当前指针与 git 冲突时，才先 `rg -n "^##|关键词"` 定位，再 `sed -n` 读相关段落。

---

## 3. 三角色边界

默认协作链：

1. Claude 桌面版 Code：计划、调查、拆任务、写给小米的执行提示词。
2. Claude Code 终端 + 小米 v2.5pro：实际改代码、跑测试、commit。
3. Codex：默认验收审查，判断通过 / 不通过 / 需要补充验证。

本轮用户已明确授权 Codex 直接执行“音频统一笔记页 / 区分说话人总结”任务。该授权只覆盖本计划明确列出的文件、接口、测试和用户决策，不改变 Codex 的默认职责，也不扩展到其它产品功能。

执行类任务的详细计划落地为 `docs/plans/*.md`（背景 / 根因 / 修复方案 / 涉及文件 / 验收 / 给小米的执行须知与红线）；小米读该 md 执行，Codex 审查。NoteBi 当前拆分主计划是 `docs/plans/NoteBi_Phase1.md`。

调研与计划按难度分层：**复杂 / 大方向 / 需多处判断**的根因分析与方案设计归 Claude（必要时 Codex 审）——Claude 自己跑代码、看数据定位，不把实测甩给用户；**简单 / 单点 / 根因已明确**的可交小米出计划 + 执行。小米做调研或计划时**必须附上自己跑出的数据证据，不许只看代码猜**；遇到需判断、与现状不符处回报 Claude。**产品决策（功能取舍 / 交互方案）一律由用户拍板**，Claude 与小米只列选项。

Claude 桌面版默认不做执行者工作：

- 不直接 `Edit` 业务代码。
- 不 `git add` / `git commit`。
- 不跑长 Playwright 或全量测试。
- 不用长会话连续接多个任务；context 超过 50% 时，输出短 handoff 后开新会话。
- 只读少量关键文件；需要读超过 5 个文件时，先说明原因和范围。

终端配置不要和桌面窗口混淆：`CLAUDE_CODE_EFFORT_LEVEL=max` 主要是 Claude Code CLI / 小米执行环境的配置；Claude 桌面当前使用什么模型和 effort，以桌面 UI 底部显示为准。桌面版只有疑难规划或复杂审查才用 Opus，普通计划优先用更轻模型。

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

不要把 `docs/EXECUTION_PLAN.md` 当作每次启动必读。只有用户明确要求推进 phase、维护计划、更新完成记录时，才读取对应片段，并按已有计划执行。

规格仲裁优先级：

1. `docs/AI_HANDOFF.md` 顶部当前指针，用于当前状态和下一步。
2. `docs/SPEC.md` + `docs/spec/`，用于产品规格冲突。
3. `docs/EXECUTION_PLAN.md`，用于工程 phase 推进。
4. `docs/design/` + `docs/DESIGN_TOKENS.md`，用于 UI 设计落地。
5. 当前代码和 git log；当文档与代码冲突时，先报告冲突。

---

## 8. 规则索引

按需片段读取，不预读整文件：

| 主题 | 文件 |
|---|---|
| 上下文预算 / 读文件 / `/clear` 接力 | [`docs/rules/context-budget.md`](docs/rules/context-budget.md) |
| Git 行为 / commit / push | [`docs/rules/git-workflow.md`](docs/rules/git-workflow.md) |
| Python / TypeScript / UI / 测试风格 | [`docs/rules/code-style.md`](docs/rules/code-style.md) |
| pipeline / 状态机 / 阈值 / 清理策略 | [`docs/rules/business-contract.md`](docs/rules/business-contract.md) |
| 模型选择：Opus / Sonnet / 小米 / Haiku | [`docs/rules/model-strategy.md`](docs/rules/model-strategy.md) |
| 项目结构 / router / 端口 / 常用命令 | [`docs/rules/project-map.md`](docs/rules/project-map.md) |
| 小米终端执行加速协议 | [`docs/rules/mimo-onboarding.md`](docs/rules/mimo-onboarding.md) |
| Claude 桌面 / 小米 / Codex 接力 | [`docs/rules/agent-roles.md`](docs/rules/agent-roles.md) |

产物目录约定：

- `docs/plans/`：当前可执行的详细计划（给小米执行）。
- `docs/test-reports/`：手测 / E2E 报告；截图在 `frontend/test-results/`（gitignore，不进 git）。

---

## 9. 回复前自检

- 是否用中文，并解释了关键操作？
- 是否只读了必要片段，而不是整文件扫全项目？
- 是否遵守了 Claude 桌面 / 小米终端 / Codex 的角色边界？
- 是否触发风险求证项？若触发，是否已经停下来问用户？
- 是否避免了无关重构、危险命令、主动 push 和脏树 commit 审查？
