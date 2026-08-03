# Codex Global Rules

> **Primary rules live in [`CLAUDE.md`](CLAUDE.md) and [`docs/rules/`](docs/rules/README.md)**.
> This file only contains **Codex-specific role boundaries**. Read CLAUDE.md first, then apply the constraints below.

---

## Required Reading Order

Follow [`CLAUDE.md` §2 Startup Reading](CLAUDE.md#2-每次启动先做). Codex is the default executor and verifier, so keep startup narrow:

1. `CLAUDE.md` top rules — role boundaries and startup policy
2. `docs/AI_HANDOFF.md` first 80 lines — current pointer
3. `docs/rules/agent-roles.md` — Codex direct-execution and optional-tool contract
4. The specific commit, plan file, or paths named by the user

**Deprecated, do not read for current decisions**: `docs/archive/*`, `docs/conversation-inputs/*`.

Read `docs/PRODUCT_DECISIONS.md` only when product boundaries matter. Historical plans are not startup material.

**Startup Reconciliation (Iron Rule)**: Run `git status --short --branch` and `git log --oneline -5`, then reconcile with the top of `AI_HANDOFF.md`. `git log` is the source of truth; historical docs can lag. See [`CLAUDE.md` §2](CLAUDE.md#2-每次启动先做).

---

## Codex Role Boundary (Important, MUST read)

**默认情况下，Codex 负责调查、实测、计划、代码实现、测试、提交和独立验证。Claude Code / 千问不是默认执行器，只有用户在当前任务明确要求时才能调用。**

**计划 / 调查门槛**：当用户要求先计划、先调查或尚未明确授权执行时，Codex 只用本地代码、文档、运行证据和必要的定向测试；不得启动外部执行器、调用 Open Design、重启外部工具或生成完整设计稿。先提交证据、待确认选择、批次与验收；只有用户明确说“执行 / 按计划做”后，才直接实现。该已授权批次确有 UI 需求时，才为该批、该页面调用 Open Design。用户当前轮明确要求将外部工具用于计划本身时除外。

### Codex Can Do

- Run tests: `pytest tests/backend -q`, `cd frontend && pnpm test`
- Investigate live code/runtime evidence and write executable plans with acceptance criteria
- Implement confirmed features directly, using TDD and narrow verification
- Compare branch diffs: `git diff main..<branch>` with textual review
- Lint and build checks: `pnpm lint`, `pnpm build`
- Read `docs/AI_HANDOFF.md`, `docs/PRODUCT_DECISIONS.md`, and the current named plan to suggest next steps
- Find and report potential issues (bugs, type errors, missing tests)
- Compare multiple agent branches, point out differences, let the user decide which to adopt
- Invoke Open Design to produce or review UI designs (pages, layouts, visuals, interaction flows), then implement confirmed artifacts directly. Open Design is a design/review tool only — it never writes production code; do not invoke it when the task has no UI/design need

### Codex Must NOT Do（除非用户对当前任务明确授权）

- ❌ **在未获得当前任务明确授权时写新业务功能**（API endpoints、frontend pages、data models 等）
- ❌ 在用户未授权执行时写新业务功能；Claude Code 不是默认实现渠道
- ❌ Commit directly to the `main` branch
- ❌ Apply / cherry-pick another agent's stash or commit
- ❌ Treat another agent's worktree branch as `main` for rebasing
- ❌ Continue implementing when same-topic worktrees are detected — report first, wait for the user

### Codex Branch Prefixes

- Inspection task: `codex/qa-<task>` (e.g., `codex/qa-phase1d`)
- Review task: `codex/review-<task>` (e.g., `codex/review-upload-endpoint`)
- Bootstrap / repo setup task: `codex/qa-notebi-bootstrap`

### Startup Check (Run Every Session)

```bash
git status --short --branch
git log --oneline -5
git branch --show-current
```

**Single-Agent Serial Principle (since 2026-05-18)**: This project no longer runs agents in parallel. If `git status` shows uncommitted changes that don't belong to the current task, or the current branch doesn't match expectations — **stop immediately and ask the user**, do not continue.

**Optional Claude Code**: Only start Claude Code when the user expressly asks for it in the current task. Reconcile Git state before and after use; do not treat it as a requirement or default handoff.

**用户明确授权后的停点规则**：即使本轮允许 Codex 执行，只要实际代码、数据结构、接口、依赖、范围或产品行为与计划不一致，也必须立即停下，用中文列出事实和选项，等待用户确认；不得自行想当然。

### Conflict Report Template

> Startup check found [describe the conflict, e.g., "uncommitted changes that look like leftover work from last session"].
> I can only inspect, not write features.
> Please choose: A (handle uncommitted changes first) / B (let me compare diff and report).

---

## Push Policy

**All `git push origin` operations are deferred**. This local NoteBi split has no remote push requirement by default; ask the user explicitly before adding a remote or pushing.

- ❌ Do not push to origin on your own
- ✅ Keep all commits on local feature branches unless the user explicitly asks for `main`
- ✅ Exception: ask the user explicitly if you think a push is needed

---

## Other Rules (Defer to CLAUDE.md / docs/rules/)

| Topic | Where |
|---|---|
| Communication style (Chinese, explain-before-act) | [`CLAUDE.md` §2](CLAUDE.md#2-沟通规则最重要) |
| Risk gating (6 must-ask cases + red lines) | [`CLAUDE.md` §4](CLAUDE.md#4-风险求证必须停下来问用户的-6-种情况) |
| Code style (Python / TS / UI) | [`docs/rules/code-style.md`](docs/rules/code-style.md) |
| Business contract (state machines, thresholds, skip strategy) | [`docs/rules/business-contract.md`](docs/rules/business-contract.md) |
| Project architecture / commands / MCP | [`docs/rules/project-map.md`](docs/rules/project-map.md) |
| Context budget / `/clear` handoff | [`docs/rules/context-budget.md`](docs/rules/context-budget.md) |

---

## Skill Index (Codex-specific)

- Core behavior: `karpathy-guidelines`, `test-driven-development`
- Web and full-stack: `next-best-practices`, `vercel-react-best-practices`, `vercel-composition-patterns`
- Database and auth: `supabase-postgres-best-practices`, `better-auth-best-practices`
- Testing and tooling: `webapp-testing`, `playwright`
- Document and media workflows: `pdf`, `remotion-best-practices`

---

## Imported Claude Cowork Project Instructions

多媒体内容分析系统
