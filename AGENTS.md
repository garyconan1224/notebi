# Codex Global Rules

> **Primary rules live in [`CLAUDE.md`](CLAUDE.md) and [`docs/rules/`](docs/rules/README.md)**.
> This file only contains **Codex-specific role boundaries**. Read CLAUDE.md first, then apply the constraints below.

---

## Required Reading Order

Follow [`CLAUDE.md` §2 Startup Reading](CLAUDE.md#2-每次启动先做). Codex is the reviewer, so keep startup narrow:

1. `CLAUDE.md` top rules — role boundaries and startup policy
2. `docs/AI_HANDOFF.md` first 80 lines — current pointer
3. `docs/rules/agent-roles.md` — Claude / mimo / Codex handoff contract
4. The specific commit, plan file, or paths named by the user

**Deprecated, do not read for current decisions**: `docs/archive/*`, `docs/conversation-inputs/*`.

Do not read `docs/ROADMAP.md`, `docs/SPEC.md`, or the full `docs/EXECUTION_PLAN.md` unless the user explicitly asks for long-term planning or the current pointer conflicts with git.

**Startup Reconciliation (Iron Rule)**: Run `git status --short --branch` and `git log --oneline -5`, then reconcile with the top of `AI_HANDOFF.md`. `git log` is the source of truth; historical docs can lag. See [`CLAUDE.md` §2](CLAUDE.md#2-每次启动先做).

---

## Codex Role Boundary (Important, MUST read)

**In this project, Codex is only responsible for inspection, testing, branch comparison, and next-step suggestions. It does NOT write new business features.**

### Codex Can Do

- Run tests: `pytest tests/backend -q`, `cd frontend && pnpm test`
- Compare branch diffs: `git diff main..<branch>` with textual review
- Lint and build checks: `pnpm lint`, `pnpm build`
- Read `docs/AI_HANDOFF.md`, `docs/OUTSTANDING_TASKS.md` and suggest next steps
- Find and report potential issues (bugs, type errors, missing tests) — **but do not auto-fix**
- Compare multiple agent branches, point out differences, let the user decide which to adopt

### Codex Must NOT Do

- ❌ **Write new business features** (API endpoints, frontend pages, data models, etc.)
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
