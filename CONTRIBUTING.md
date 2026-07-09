# Contributing

Thanks for taking the time to improve Nibi.

## Before You Start

- Keep changes focused. Avoid mixing refactors, feature work, and formatting in one PR.
- Do not commit API keys, cookies, downloaded media, local databases, model caches, or generated runtime output.
- For platform integrations, support public/anonymous access only unless the maintainer explicitly accepts a different design.
- If a change touches model calls, downloads, file paths, or user data, explain the failure mode and fallback behavior in the PR.

## Local Setup

```bash
./start.sh
```

For development:

```bash
./dev.sh
```

Frontend:

```bash
cd frontend
pnpm install
pnpm build
```

Backend smoke check:

```bash
python3 -m py_compile backend/app/main.py
```

## Pull Requests

Please include:

- What changed and why.
- How you verified it.
- Any model/API/platform assumptions.
- Screenshots for UI changes.

Large product changes should start with an issue or discussion first.
