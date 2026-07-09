---
title: "R4 任务中心笔记向素材直达 NoteShell"
status: done
created: 2026-06-06
completed_date: 2026-06-06
depends_on: []
---

# R4 任务中心笔记向素材直达 NoteShell

## 背景

任务中心（taskboard）点素材卡片时，笔记向素材仍走旧的 overview/detail 两步路由。
R4 把这条路径缩短：笔记向素材（intent !== 'replica'）点卡片直接进 `/note`（NoteShell），
复刻向保留原路由不动。

## R4 设计

### 路由分流规则

| intent | 行为 |
|---|---|
| `replica` | 保留原逻辑（video→video_detail，audio→audio_detail 等） |
| 非 replica（含 learning/summary/未填） | → `/workspaces/{ws}/items/{itemId}/note` |

### 共享 helper

`frontend/src/lib/resolveItemRoute.ts` — 统一入口，MaterialCard / FavoritesTab / LibraryPage / ResultsOverview 共用。

### 涉及文件

| 文件 | R4.1 | R4.2 | R4.3 |
|---|---|---|---|
| `MaterialCard.tsx` | ✅ 本地→共享 | — |
| `FavoritesTab.tsx` | ✅ 本地→共享 | — |
| `ResultsOverview/index.tsx` | ✅ 本地→共享 | ✅ useEffect 兜底跳转 |
| `LibraryPage/ItemCard.tsx` | — | ✅ 用共享 helper |
| `LibraryPage/index.tsx` | — | ✅ 用共享 helper |
| `backend/app/routes/workspaces.py` | — | ✅ library API 加 preflight | ✅ item note Obsidian export |
| `frontend/src/services/library.ts` | — | ✅ LibraryItem 加 preflight 类型 |
| `frontend/src/services/workspaces.ts` | — | — | ✅ item note export service |
| `frontend/src/pages/result/NoteShell/index.tsx` | — | — | ✅ 问 AI / 导出 / TOC |

### 不动的东西

- 旧路由（`/overview`、`/_detail`、`/ln`）不删、不改，直接访问仍可用
- storyboard（复刻流）不碰
- `_detail/_result` 页本身不改
- `/ln`、`/av-synthesis` 路由和旧页面不删、不改，继续作为遗留入口保留
- ProcessingPage 现有 note→/note 跳转不动

## R4 子任务

### R4.1 卡片 + overview 路由分流 ✅

**目标**：改 MaterialCard、FavoritesTab、ResultsOverview 三处路由 helper，
笔记向素材点卡片直达 `/note`，复刻保留原路。

**改动**：
1. MaterialCard.tsx `resolveItemRoute`：加 `if (item.preflight?.intent !== 'replica') return .../note`
2. FavoritesTab.tsx `resolveItemRoute`：同上
3. ResultsOverview.tsx `resolveDetailRoute`：同上

**验收**：
- 任务中心点笔记素材（text/image/audio/video 各一）直达 NoteShell
- 复刻素材（intent=replica）仍走原路
- 旧链接 /overview、/_detail 直接访问仍可用
- `pnpm -C frontend tsc -b` 绿

### R4.2 overview 收敛 + 剩余落点统一直达

**目标**：
1. 消除 resolveItemRoute 重复定义，提取到 `@/lib/resolveItemRoute`
2. LibraryPage（ItemCard + index）改用共享 helper
3. ResultsOverview 进入时：笔记向 → useEffect navigate(`/note`, {replace:true})
4. 后端 library API 加 preflight 字段

**改动**：
1. `frontend/src/lib/resolveItemRoute.ts` — 新建共享 helper
2. `MaterialCard.tsx` / `FavoritesTab.tsx` — 删除本地定义，import 共享版
3. `ResultsOverview/index.tsx` — 删除本地定义，import 共享版 + useEffect 兜底
4. `LibraryPage/ItemCard.tsx` — import 共享版，navigate 改用 resolveItemRoute
5. `LibraryPage/index.tsx` — import 共享版，navigate 改用 resolveItemRoute
6. `backend/app/routes/workspaces.py` — library API 加 preflight 字段
7. `frontend/src/services/library.ts` — LibraryItem 类型加 preflight

**验收**：
- 任务中心 + Library 点笔记素材都直达 /note
- 直接访问笔记素材的 /overview 自动跳 /note
- 复刻素材 /overview 保留
- 旧链接不 404
- `pnpm -C frontend tsc -b` 绿

### R4.3 NoteShell 补齐通用笔记能力 ✅

**目标**：在统一 NoteShell 内补齐通用笔记能力，让用户不再必须回到旧 `/ln` 或 `/av-synthesis` 才能完成常用笔记操作。

**边界**：
1. 只补当前单素材 NoteShell 能力：问 AI、导出、目录 TOC
2. `/ln`、`/av-synthesis` 路由和旧页面不动，作为遗留入口保留
3. 不碰多素材综合、不碰复刻、不开 PDF/Word 导出

**改动**：
1. `NoteShell/index.tsx` 顶栏加「问 AI」按钮，复用通用 `NoteChatDrawer`，作用域为当前 `note.md` 正文 + 转录上下文
2. `NoteShell/index.tsx` 顶栏加「导出」菜单：Markdown 前端直接下载；Obsidian 走 item 级 zip
3. `NoteShell/index.tsx` 阅读态从 h2/h3 提取侧栏 TOC，点击滚动到正文标题
4. `frontend/src/services/workspaces.ts` 增加 `exportItemNoteObsidian`
5. `backend/app/routes/workspaces.py` 增加 `GET /workspaces/{ws}/items/{item}/note/export?format=obsidian`
6. `tests/backend/test_item_note_write.py` 覆盖 Obsidian zip 与不支持格式

**验收**：
- NoteShell 顶栏可打开问 AI 面板，prompt 只包含当前笔记与转录
- NoteShell 可导出 `.md` 和 Obsidian zip
- 有 h2/h3 的笔记显示 TOC，点击可跳到标题
- `cd frontend && pnpm exec tsc -b` 绿
- `.venv/bin/python -m pytest tests/backend/test_item_note_write.py -q` 绿
