---
name: phase-l5-library-remix-polish
status: done
completed_date: 2026-05-26
phase: L5 (Library Remix Polish)
track: F (Flow) / Library UI polish
owner: deepseek v4-pro via ccswitch
branch: feat/phase-l5-library-remix-polish
baseline_commit: 2d1e8c6
created_date: 2026-05-26
---

# Phase L5 — Library Remix Polish

## Why This Phase Exists

Phase L1-L4 already shipped the real Library feature:

- `GET /workspaces/library`
- `/library` route
- item/workspace cards
- type/workspace chips
- sort menu
- grid/list view
- single and batch delete

This phase is not a rewrite. It is a polish pass to make the current `/library` page match the latest Remix design source while preserving all real functionality.

Important naming note: do not call this work "L2". `docs/plans/phase-l-library.md` already has an L2, and that L2 is complete. This new phase is **L5**.

## Source Of Truth

Read these before editing UI:

1. `docs/DESIGN_TOKENS.md`
2. `docs/design/components/library.jsx`
3. `docs/design/components/workspace_card.jsx`
4. `docs/design/check/05_library.png`
5. `docs/design/check/library_final.png`

The local Downloads copy was checked on 2026-05-26 and matched the repo copy for `library.jsx` and `workspace_card.jsx`. Use `docs/design/` as the auditable source.

## Current Code Anchors

Frontend:

- `frontend/src/pages/LibraryPage/index.tsx`
- `frontend/src/pages/LibraryPage/ItemCard.tsx`
- `frontend/src/pages/LibraryPage/WorkspaceCard.tsx`
- `frontend/src/pages/LibraryPage/FilterChips.tsx`
- `frontend/src/pages/LibraryPage/SortMenu.tsx`
- `frontend/src/pages/LibraryPage/library.css`
- `frontend/src/store/libraryStore.ts`
- `frontend/src/services/library.ts`

Backend:

- `backend/app/routes/workspaces.py::get_library`
- `backend/app/routes/workspaces.py::batch_delete_items`
- `tests/backend/test_workspaces_api.py`

## Hard Boundaries

- Do not change the `/workspaces/library` response contract unless a current frontend bug proves it is impossible to avoid.
- Do not change schema or workspace JSON model fields.
- Do not add dependencies.
- Do not push.
- Do not rewrite Search, Favorites, Taskboard, or backend pipeline code.
- Do not replace real data with design mock data.
- Do not hide existing features: filters, sorting, grid/list, item drilldown, workspace drilldown, single delete, batch delete, persisted view state.
- Keep each subtask to about 3-5 files. If a subtask truly needs more, stop and report before editing.

## Startup Check For DS

Run this first:

```bash
cd /Users/conan/Desktop/nibi
git fetch --all --prune
git status --short --branch
git log --oneline -20
git branch --show-current
git worktree list
```
If the working tree is dirty, or another active worktree appears to be editing Library/Workspace frontend files, stop and report. Do not use `git fetch origin`; this checkout may not have an `origin` remote configured.

Create or switch to:

```bash
git switch -c feat/phase-l5-library-remix-polish
```

If the branch already exists, inspect it before continuing.

## L5.1 — Header, Controls, Counts, Status Mapping

Goal: make the Library page header and top controls match the Remix source while keeping current behavior.

Files expected:

- `frontend/src/pages/LibraryPage/index.tsx`
- `frontend/src/pages/LibraryPage/FilterChips.tsx`
- `frontend/src/pages/LibraryPage/SortMenu.tsx`
- Optional: new `frontend/src/pages/LibraryPage/ViewToggle.tsx`

Work:

- Match the Remix header structure from `library.jsx`: eyebrow, large display title, short description, right-side controls.
- Eyebrow should include `LOCAL` and the filtered count, for example `LIBRARY · 12 ITEMS · LOCAL`.
- Add per-chip counts: all, video, audio, image, text, workspace.
- Keep filter semantics unchanged: `all` is mutually exclusive; other filters can combine.
- Extract the grid/list segmented control into a small component if it keeps `index.tsx` smaller.
- Fix the current status label mapping bug. `primaryStatusToState()` returns `done`, `running`, `queued`, `error`, so labels must be keyed by those values.
- Keep the import button visible but route it to the existing workbench (`/`) or leave it disabled with clear title text. Do not build a new import flow in this phase.

Acceptance:

- Header visually follows `docs/design/components/library.jsx`.
- Chip counts update with current filter state.
- Running/queued/error/done labels render correctly.
- No `alert()` introduced.

Suggested commit:

```bash
git add frontend/src/pages/LibraryPage frontend/src/store/libraryStore.ts
git commit -m "feat(phase-l5): polish library header controls and status labels"
```

## L5.2 — ItemCard And ListView Polish

Goal: make item cards and list view match the Remix card/list behavior while preserving real navigation and delete.

Files expected:

- `frontend/src/pages/LibraryPage/ItemCard.tsx`
- `frontend/src/pages/LibraryPage/index.tsx`
- Optional: new `frontend/src/pages/LibraryPage/ListView.tsx`
- Optional: new `frontend/src/pages/LibraryPage/libraryHelpers.ts`
- `frontend/src/pages/LibraryPage/library.css`

Work:

- Move shared helpers out of `index.tsx`/`ItemCard.tsx` if duplication is increasing.
- Match Remix item card behavior:
  - thumbnail aspect ratio 16/9
  - top-left status badge with dot
  - top-right duration when not selecting
  - selection indicator when selecting
  - hover delete button only when not selecting
  - selected border state
  - running progress bar if the item status is running
- Preserve item click behavior:
  - normal mode opens `/workspaces/{workspace_id}/items/{item_id}/overview`
  - selection mode toggles selection
- Move list view out of `index.tsx` if practical.
- List view should include: selection, name, type, status, duration, workspace, created time, delete.

Acceptance:

- Grid card and list row both open the same result route.
- Delete button does not trigger navigation.
- Selection mode never shows accidental delete controls.
- Long titles/source labels truncate cleanly.

Suggested commit:

```bash
git add frontend/src/pages/LibraryPage
git commit -m "feat(phase-l5): polish library item cards and list view"
```

## L5.3 — Rich WorkspaceCard

Goal: replace the plain workspace card with the richer Remix workspace card pattern.

Files expected:

- `frontend/src/pages/LibraryPage/WorkspaceCard.tsx`
- `frontend/src/pages/LibraryPage/index.tsx`
- Optional: `frontend/src/pages/LibraryPage/libraryHelpers.ts`
- `frontend/src/pages/LibraryPage/library.css`

Work:

- Follow `docs/design/components/workspace_card.jsx`.
- Use real Library data, not mock `VM_DATA`.
- Derive each workspace card from `LibraryWorkspace` plus matching `LibraryItem[]`.
- Show:
  - semantic top stripe based on dominant item type
  - title
  - created/updated meta if available
  - up to 4 thumbnails from items/workspace cover
  - `+N` tile when more items exist
  - footer composition counts for video/audio/image/text
  - status pill
- Keep click behavior: workspace card opens `/workspaces/{workspace_id}`.

Acceptance:

- Workspace-only chip shows rich workspace cards.
- Workspace + type filters show workspace section and item section without breaking layout.
- Empty workspace still renders a stable card.

Suggested commit:

```bash
git add frontend/src/pages/LibraryPage
git commit -m "feat(phase-l5): add rich library workspace cards"
```

## L5.4 — Empty, Error, Import, Delete UX

Goal: finish user-visible states and remove rough browser dialogs where project style already has toast.

Files expected:

- `frontend/src/pages/LibraryPage/index.tsx`
- Optional: new `frontend/src/pages/LibraryPage/EmptyState.tsx`
- `frontend/src/pages/LibraryPage/library.css`

Work:

- Add Remix-style empty state for:
  - empty library
  - no matching materials
  - no matching workspaces
- Replace delete failure `alert()` with `toast.error()` from `sonner`.
- Add success toast after single delete and batch delete.
- Keep `window.confirm()` for destructive confirmation unless replacing it stays within scope and file budget.
- Import/new workspace action should navigate to existing workbench route `/`; do not create new import backend behavior.
- Loading and error states should not collapse the page header.

Acceptance:

- Empty/filter/error/loading states are visually stable.
- Single delete and batch delete report success/failure with toast.
- No new backend endpoint.

Suggested commit:

```bash
git add frontend/src/pages/LibraryPage
git commit -m "feat(phase-l5): polish library empty states and delete feedback"
```

## Verification

After each frontend subtask:

```bash
pnpm --dir frontend build
```

At phase close:

```bash
.venv/bin/python -m pytest tests/backend/test_workspaces_api.py -q
pnpm --dir frontend build
pnpm --dir frontend test --run
```

Then run browser smoke against the actual local frontend port. Prefer `VITE_PORT=5175` if `.env` uses it:

```bash
./start.sh
.venv/bin/python scripts/browser_smoke.py --url http://localhost:${VITE_PORT:-5175}/library --library --screenshot /tmp/nibi-library-l5.png
```

Manual QA checklist:

- `/library` loads with real data.
- `all`, `video`, `audio`, `image`, `text`, `workspace` chips work.
- Workspace-only view works.
- Workspace + type combined view works.
- Sort menu changes order.
- Grid/list toggle persists after refresh.
- Item card opens result overview.
- Workspace card opens taskboard.
- Single delete works and refreshes data.
- Batch delete works and refreshes data.
- Browser console has no new errors.

## DS Prompt

Use this prompt when handing the phase to DS:

```text
执行 Nibi Phase L5 — Library Remix Polish。

先按 CLAUDE.md 做启动检查：git fetch --all --prune、git status --short --branch、git log --oneline -20、git branch --show-current、git worktree list。不要使用 git fetch origin。若工作区不干净，或发现其他 active worktree 正在改 Library/Workspace 相关文件，停止汇报。

读取 docs/plans/phase-l5-library-remix-polish.md、docs/DESIGN_TOKENS.md、docs/design/components/library.jsx、docs/design/components/workspace_card.jsx、docs/design/check/05_library.png、docs/design/check/library_final.png。

注意：这不是 L2，旧 L2 已完成；本次是 L5。保留当前 /library 真实功能，不改 /workspaces/library API，不改 schema，不新增依赖，不 push。

按 L5.1 -> L5.4 顺序执行。每个子任务控制在 3-5 文件内，完成一个子任务就 build、commit、停下汇报。如果我明确让你继续，再做下一个子任务。最终跑 backend library tests、frontend build、frontend vitest、browser_smoke /library，并报告 commit hash、改动文件、测试结果、剩余问题。
```
