# Codex Global Rules

> **Primary rules live in [`CLAUDE.md`](CLAUDE.md) and [`docs/rules/`](docs/rules/README.md)**.
> This file only contains **Codex-specific role boundaries**. Read CLAUDE.md first, then apply the constraints below.

---

## Required Reading Order

Follow [`CLAUDE.md` §2 Startup Reading](CLAUDE.md#2-每次启动先做). Codex is the reviewer, so keep startup narrow:

1. `CLAUDE.md` top rules — role boundaries and startup policy
2. `docs/AI_HANDOFF.md` first 80 lines — current pointer
3. `docs/rules/agent-roles.md` — Codex / Claude Code + Qwen handoff contract
4. The specific commit, plan file, or paths named by the user

**Deprecated, do not read for current decisions**: `docs/archive/*`, `docs/conversation-inputs/*`.

Read `docs/PRODUCT_DECISIONS.md` only when product boundaries matter. Historical plans are not startup material.

**Startup Reconciliation (Iron Rule)**: Run `git status --short --branch` and `git log --oneline -5`, then reconcile with the top of `AI_HANDOFF.md`. `git log` is the source of truth; historical docs can lag. See [`CLAUDE.md` §2](CLAUDE.md#2-每次启动先做).

---

## Codex Role Boundary (Important, MUST read)

**默认情况下，Codex 负责调查、实测、计划和完成后的独立审查；具体代码执行优先交给 Claude Code 中的千问。若同一问题交给千问连续两次仍未解决，视为用户已授权 Codex 在原任务范围内直接接管修复，并继续遵守停点求证规则。**

### Codex Can Do

- Run tests: `pytest tests/backend -q`, `cd frontend && pnpm test`
- Investigate live code/runtime evidence and write executable plans with acceptance criteria
- Start Claude Code + Qwen in a user-visible terminal, monitor progress, and independently review its commit
- Compare branch diffs: `git diff main..<branch>` with textual review
- Lint and build checks: `pnpm lint`, `pnpm build`
- Read `docs/AI_HANDOFF.md`, `docs/PRODUCT_DECISIONS.md`, and the current named plan to suggest next steps
- Find and report potential issues (bugs, type errors, missing tests)
- Directly fix the same unresolved issue after two failed Qwen attempts, with narrow tests and no scope expansion
- Compare multiple agent branches, point out differences, let the user decide which to adopt
- Invoke Open Design to produce or review UI designs (pages, layouts, visuals, interaction flows), then hand the confirmed artifacts, constraints, and acceptance points to Qwen for implementation. Open Design is a design/review tool only — it never writes production code; do not invoke it when the task has no UI/design need

### Codex Must NOT Do（除非用户对当前任务明确授权）

- ❌ **在未获得当前任务明确授权时写新业务功能**（API endpoints、frontend pages、data models 等）
- ❌ 在千问尚未对同一问题完成两次失败尝试前，跳过默认接力直接实现具体业务功能（用户当前轮明确要求 Codex 直接执行除外）
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

**Visible Terminal + Fresh Session**: Prefer the Codex right-side/integrated terminal for Claude Code so the user can watch progress. If unavailable, open a foreground Terminal window. Before every new unrelated Claude Code task, run `/clear` or start a fresh Claude session; confirm the previous process has stopped. Preserve context only for retries of the same issue.

**Two-Attempt Takeover**: After each Qwen commit, Codex independently reviews it. Return the first failed review to Qwen with concrete evidence. If the same root cause or acceptance item is still unresolved after the second Qwen attempt, Codex fixes it directly; do not send a third retry.

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
