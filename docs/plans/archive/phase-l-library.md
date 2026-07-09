---
name: phase-l-library
status: done
phase: L (Library aggregation page)
track: F (Flow) / 落地汇总视图
prerequisite: F3 已完成
model: L1 ⭐ deepseek v4-pro / L2 Sonnet 4.6 或 deepseek v4-pro / L3-L4 ⭐ deepseek v4-pro
branch: 可直接打 main（每个子任务 <5 文件）
created: 2026-05-22
---

# Phase L — 资料库聚合页落地

## 背景与目标

侧边栏「资料库」按钮（`frontend/src/layouts/AppShell.tsx:34`）**当前临时指向 `/search`**，是占位。
F1~F4 跑完后已经有一堆真实分析结果散落在各个 workspace 里，需要一个统一的汇总视图：
- 一眼看到所有已分析内容
- 按类型 / 工作空间快速筛选
- 多维度排序，方便复盘测试结果
- 点卡片下钻到现有 Results 子页（不重复造详情页）

视觉真相源（**优先级从高到低**）：
1. **`/Users/conan/Downloads/vidmirror (Remix)/components/storyboard.jsx::Library`**（行 91~131）—— jsx 组件源码，最精确
2. **`/Users/conan/Downloads/vidmirror (Remix)/styles.css`** 行 459~486 —— `.ex-grid` / `.ex-card` / `.ex-thumb` / `.ex-meta` CSS
3. `docs/design/VidMirror.html` 渲染版（备用对照）

> ⚠️ **设计稿覆盖范围有限**：只画了基础视觉（grid/list 切换 + 「导入」按钮 + 卡片网格），**没画 chip 筛选、没画排序下拉、没画 workspace 卡片视图**。L3/L4 是基于用户决议对设计稿的**功能扩展**，视觉风格必须**沿用设计稿同一套 design tokens**（var(--ink) / var(--bg-elev) / var(--line) / var(--accent) / var(--accent-green) / var(--mono) 字体 / var(--radius) / var(--shadow-md)）。

---

## 用户决议（不要再问）

| 决议项 | 用户拍板结果 |
|---|---|
| 工作空间呈现 | **方案三（workspace 也是卡片，和 item 平级）**：选「工作空间」chip 时显示 workspace 卡片网格；选其它 chip（视频/音频/图片/文字）时按方案一显示平铺的 item 卡片 |
| 类型筛选 UI | **顶部多选 chip**：[全部] [视频] [音频] [图片] [文字] [工作空间]，多选可叠加，「全部」与其它互斥 |
| 排序维度 | **全做，先做创建时间**（默认）：创建时间 / 完成时间 / 时长 / 状态 |
| 数据源 | **复用 workspaces API，新增聚合端点**（不建新表，0 迁移） |

---

## 数据模型现状（已查清，不需要改 schema）

`backend/app/models/workspace.py::WorkspaceItem`：

```
item_id / type (video|audio|image|text) / source / source_value
name / status / results / related_task_ids
created_at / updated_at / preflight / tags
```

✅ 100% 覆盖 Library 页所需字段。`WorkspaceRecord.items` 是 `List[WorkspaceItem]`，只需新增一个聚合端点摊平 + 反向带 workspace 信息。

---

## 路由现状（已查清）

`frontend/src/router.tsx` 没有 `/library`。需要新增：

```
{ path: 'library', element: withSuspense(<LibraryPage />) }
```

同时改 `AppShell.tsx:34` 把 `path: '/search'` 改为 `path: '/library'`。

---

## 子任务拆分（4 个，每个一 commit）

### L1 — 后端：聚合端点 `GET /workspaces/library`

**模型**：⭐ deepseek v4-pro
**预计**：1~2 小时

**改动文件**（≤3）：
- `backend/app/routes/workspaces.py`：新增 `@router.get("/library")` 端点
- `tests/backend/test_workspaces_api.py`：追加 2 个测试
- 必要时改 `backend/app/models/workspace.py`（仅在需要新增 to_dict 字段时）

**端点契约**：

```http
GET /workspaces/library?include_trashed=false
```

**Response**：
```json
{
  "items": [
    {
      "item_id": "...",
      "workspace_id": "...",
      "workspace_name": "...",
      "type": "video",
      "source": "url",
      "source_value": "https://www.bilibili.com/video/BV...",
      "name": "三代封神！那四代呢？大疆Pocket 4首发体验",
      "status": "done",
      "created_at": "2026-05-22T10:00:00",
      "updated_at": "2026-05-22T10:01:30",
      "duration_seconds": 92,
      "thumbnail": null,
      "results_summary": {
        "has_summary": true,
        "has_transcript": true
      },
      "primary_task_status": "done"
    }
  ],
  "workspaces": [
    {
      "workspace_id": "...",
      "name": "...",
      "items_count": 3,
      "items_count_by_type": {"video": 2, "audio": 1, "image": 0, "text": 0},
      "cover_thumbnail": null,
      "updated_at": "2026-05-22T10:01:30",
      "status": "active"
    }
  ]
}
```

**实现要点**：
1. 复用现有 `_enrich_workspace()` 里的 `_items_count_by_type()` / `_cover_thumbnail()` / `_sync_item_with_tasks()`
2. `duration_seconds` 优先从 `item.results` 里取（不同 type 字段名可能不一样：video → `duration`，audio → `duration`，image 没有，text 没有；找不到给 `null`）
3. `primary_task_status`：拿 `item.related_task_ids` 里最新一个 task 的 status，方便前端显示 running/queued/done/error 徽标
4. 默认 `include_trashed=false`，过滤掉 `WorkspaceRecord.trashed=True` 的工作空间
5. **不要做分页**——本地工具数量级（< 1000 items）不需要

**测试**（2 个 happy path + 1 错误，写在 `test_workspaces_api.py`）：
- 空库：返回 `{"items": [], "workspaces": []}`，200
- 有 2 workspace × 各 3 items：返回 6 items + 2 workspaces，字段齐全
- `include_trashed=true` vs 默认：trashed 工作空间是否过滤正确

**commit**：`feat(L1): 新增 /workspaces/library 聚合端点 + 测试`

---

### L2 — 前端：LibraryPage 骨架 + 路由 + ItemCard 组件

**模型**：Sonnet 4.6 或 ⭐ deepseek v4-pro（看复杂度，能不升档就不升）
**预计**：半天

**改动文件**（≤6）：
- 新增 `frontend/src/pages/LibraryPage/index.tsx`
- 新增 `frontend/src/pages/LibraryPage/ItemCard.tsx`
- 新增 `frontend/src/pages/LibraryPage/WorkspaceCard.tsx`
- 新增 `frontend/src/pages/LibraryPage/library.css`（或用 Tailwind 写在 tsx，看现有风格）
- 改 `frontend/src/router.tsx`：注册 `/library`
- 改 `frontend/src/layouts/AppShell.tsx:34`：`path: '/search'` → `path: '/library'`
- 新增 `frontend/src/services/library.ts`：调 `GET /workspaces/library`

**视觉对照（必读）**：`/Users/conan/Downloads/vidmirror (Remix)/components/storyboard.jsx` 行 91~131 的 `Library` 组件。**直接照抄它的 JSX 结构与 className**，仅把数据源从 `VM_DATA.TASKS` 换成 `library.items`。

**CSS 复用策略**：
- 设计稿用的 `.ex-grid` / `.ex-card` / `.ex-thumb` / `.ex-meta` / `.ex-title` / `.ex-sub` / `.eyebrow` / `.btn-primary` —— **检查 `frontend/src/index.css` 或 `frontend/src/styles/` 里是否已有同名 class**，没有就从 `/Users/conan/Downloads/vidmirror (Remix)/styles.css:459-486` 复制 + 复制对应的 `:root` 变量（var(--bg-elev) / var(--ink-3) / var(--mono) / var(--radius) / var(--shadow-md) / var(--accent-green) / var(--ink-4)）。优先级：用 Tailwind 写不出来的就抄过去，写得出来的用 Tailwind。

**重点元素（对照设计稿 JSX）**：
- 顶部：`<div className="eyebrow">LIBRARY · {N} ITEMS</div>` + `<h1 style={{fontFamily:'var(--display)', fontSize:48, letterSpacing:'-0.02em'}}>资料库</h1>`
- 右上：grid/list segmented control（设计稿是 inline style `tw-segm`，3px padding, radius 10, 选中态 box-shadow）+ `<button className="btn btn-primary">导入</button>`
- 卡片状态徽标：左上角圆点 + 状态文字（设计稿是 `position:absolute, top:8, left:8, bg:rgba(0,0,0,0.6), font-mono, 10px white`）
- 卡片缩略图：`aspect-ratio: 16/9, bg:#111`，没有 thumbnail 时显示一个居中占位（设计稿用 frame_*.svg，我们后端无 thumbnail 时给 type 图标）
- 卡片 meta：title 13px medium + sub 是 `{src} · {type}`，mono font，10.5px，letter-spacing 0.08em，颜色 `var(--ink-3)`

**字段映射**（后端 → 卡片）：
| 卡片字段 | 来源 |
|---|---|
| state 徽标 | `item.primary_task_status` |
| 时长 mm:ss | `item.duration_seconds`（设计稿截图右上角，正式 jsx 里没画——可在 thumb 右上角小标） |
| title | `item.name` |
| sub.src | 从 `item.source_value` 提取域名+路径片段（B 站 → `bilibili.com/BV1abc`） |
| sub.type | `item.type` |
| thumbnail | item.results 里若有缩略图字段则用，否则按 type 显示占位图标 |

**点击下钻**：
- ItemCard 点击 → 跳 `/workspaces/{workspace_id}/items/{item_id}/overview`
- WorkspaceCard 点击 → 跳 `/workspaces/{workspace_id}`

**L2 范围限定**（不做的）：
- ❌ chip 筛选（L3 做）
- ❌ 排序（L4 做）
- ❌ 视图切换（L4 做）
- ❌ 「导入」按钮逻辑

**完工标准**：
- `pnpm build` 通过、`pnpm lint` 通过
- `./start.sh` 起服务，点侧边栏「资料库」→ 看到所有 items 平铺，卡片视觉对齐设计稿
- 点卡片能正确跳到对应详情页

**commit**：`feat(L2): LibraryPage 骨架 + ItemCard/WorkspaceCard 组件 + 路由接线`

---

### L3 — 前端：顶部多选 chip 筛选 + workspace 视图切换

**模型**：⭐ deepseek v4-pro
**预计**：2~3 小时

**改动文件**（≤3）：
- 改 `frontend/src/pages/LibraryPage/index.tsx`：加 chip 状态 + 渲染逻辑
- 新增 `frontend/src/pages/LibraryPage/FilterChips.tsx`
- 必要时新增 `frontend/src/store/libraryStore.ts`（zustand，存 chip 选中状态 + 排序，避免回退页面丢状态）

**Chip 规则**：
- 选项：`[全部] [视频] [音频] [图片] [文字] [工作空间]`
- 「全部」与其它互斥；其它之间可多选
- 默认选中「全部」
- **选中「工作空间」时**：渲染切换为 `WorkspaceCard` 网格（数据用 response.workspaces）
- **选中其它任一组合（不含「工作空间」）**：渲染 `ItemCard` 平铺，按选中类型过滤
- 「工作空间」与其它类型同时选中：上半部分显示 workspace 卡，下半部分显示 item 卡（分两个 section，每个 section 头部小标题）

**顶部统计数字同步更新**：`资料库 · LIBRARY · {当前筛选后数量} ITEMS`

**commit**：`feat(L3): Library 顶部多选 chip 筛选 + workspace/item 视图切换`

---

### L4 — 前端：排序下拉 + 网格/列表视图切换

**模型**：⭐ deepseek v4-pro
**预计**：2~3 小时

**改动文件**（≤3）：
- 改 `frontend/src/pages/LibraryPage/index.tsx`
- 新增 `frontend/src/pages/LibraryPage/SortMenu.tsx`
- 改 `libraryStore.ts`：加 `sortBy` + `viewMode` 字段

**排序选项**（dropdown，默认创建时间）：
- 创建时间（最新在前）/ 创建时间（最早在前）
- 完成时间（最新在前）—— 没 `completed_at` 字段？用 `status==done` 且 `updated_at` 最近代替；若 item 未 done 排到最后
- 时长（长→短）/ 时长（短→长）—— 没时长（image/text）的排到最后
- 状态（error → running → queued → done）—— 让用户能优先看到失败任务

**视图切换**：
- 默认：网格（设计稿样式）
- 列表：表格行（图标 + 标题 + 类型 + 状态 + 时长 + 创建时间），点行同样下钻
- 切换状态存 `libraryStore.viewMode`

**完工标准**：
- 默认进页面：所有 items 按创建时间倒序，网格视图
- 切排序 → 顺序立即变化
- 切列表视图 → 渲染表格
- 刷新页面 → 视图模式 / 排序 / chip 选择保持（用 localStorage 持久化 libraryStore）

**commit**：`feat(L4): Library 排序下拉 + 网格/列表视图切换 + 状态持久化`

---

## 完工标准（Phase L 整体）

- [x] `GET /workspaces/library` 端点 + 测试 OK（`826c311`）
- [x] 侧边栏「资料库」按钮指向 `/library`（不再是 `/search`）（`249e2f0`）
- [x] 进 `/library` 看到设计稿一致的卡片网格（`249e2f0`）
- [x] chip 筛选 / 排序 / 视图切换全部生效（`d5e5a7e` + `cd41720`）
- [x] 点 ItemCard → 跳对应 Results 详情页
- [x] 点 WorkspaceCard → 跳 `/workspaces/{id}` Taskboard
- [x] 卡片缩略图覆盖（下载封面 > 视频首帧 > 类型图标，`shared/video_download_ytdlp.py` writethumbnail）
- [x] 批量删除 + 单项删除 + 选择模式（勾选框仅在进入选择模式后出现，点卡片任意位置切换选中）
- [x] `pnpm build` + `pnpm test` 全通；`pnpm lint` 已跑，失败项为项目存量规则噪音，本次未新增
- [x] 后端 pytest 全通（235 passed, 2 skipped）
- [x] ROADMAP §3 追加 §L 章节 + commit hash
- [x] AI_HANDOFF.md 更新「下一步」

### 超出设计稿范围的扩展

| 功能 | 子任务 |
|---|---|
| 缩略图/封面 | yt-dlp `writethumbnail` → `cover_thumbnail` 优先级链（下载封面 > 分析首帧 > 图标占位） |
| 删除 | 后端 `POST /items/batch-delete` + 前端选择模式 + 单项/批量删除 UI |
| 选择交互 | 独立 `selecting` state → 进入选择模式不自动全选，点卡片任意位置切换选中 |

### L phase commits

```
fa1602d docs(L): 新增 Phase L 资料库聚合页完整落地计划
c10898b docs(L): 补充 Library 设计稿源头 + 字段映射 + L2 复刻指引
826c311 feat(L1): 新增 /workspaces/library 聚合端点 + 测试
249e2f0 feat(L2): LibraryPage 骨架 + ItemCard/WorkspaceCard 组件 + 路由接线
d5e5a7e feat(L3): Library 顶部多选 chip 筛选 + workspace/item 视图切换
cd41720 feat(L4): Library 排序下拉 + 网格/列表视图切换 + 状态持久化
收口扩展 commit 见 git log 最新：缩略图 / 删除 / 选择模式 / 浏览器冒烟脚本 / 文档同步
```

---

## DS 接力 Prompt（每个子任务一次会话，复制粘贴用）

### 开 L1 时

```
你是 deepseek v4-pro，做 Nibi 项目 Phase L 子任务 L1。
读 CLAUDE.md + docs/plans/phase-l-library.md，执行 §L1。
完成后跑 .venv/bin/python -m pytest tests/backend -q，全绿再 commit。
做完停下，等我开 L2 会话。
```

### 开 L2 前必读（设计稿位置）

L2 的 DS 必须在动手前读这两份外部文件：
- `/Users/conan/Downloads/vidmirror (Remix)/components/storyboard.jsx` 行 91~131（Library 组件）
- `/Users/conan/Downloads/vidmirror (Remix)/styles.css` 行 459~486（卡片 CSS）

如果该 Mac 上路径不存在，停下问用户拿设计稿，不要凭"截图记忆"瞎写。

### 开 L2 时

```
你是 deepseek v4-pro（或 Sonnet 4.6 自行判断），做 Nibi 项目 Phase L 子任务 L2。
读 CLAUDE.md + docs/plans/phase-l-library.md，执行 §L2。
L1 已合并（commit 见 git log），后端 /workspaces/library 端点可用。
做完跑 cd frontend && pnpm build && pnpm lint，全绿再 commit。
做完停下，等我开 L3 会话 + 截图复盘视觉。
```

### 开 L3 / L4 时

仿照 L2 prompt，把 §L 编号换掉，提示 DS 上一子任务已合并。

---

## 边界与禁区

- ❌ 不要做分页（local 工具，数据量小）
- ❌ 不要新建 library_items DB 表 / 视图（直接聚合现有 items 已够用）
- ❌ 不要改 `WorkspaceItem` 字段（schema 已够用）
- ❌ 不要顺手重写 `FavoritesPage` 或 `SearchPage`，即使它们结构类似
- ❌ 不要做「导入」按钮的逻辑（L2 留占位即可，未来单开 phase）
- ❌ 不要在 L2 里把 chip / 排序顺手做了——颗粒度按 L1~L4 走，每个独立 commit 便于回滚

---

## 升档触发（DS 转 Opus）

- 任一子任务真实改到 ≥5 个文件
- 发现 WorkspaceItem schema 不够用，需要数据迁移
- 跨 RSC/SSE/状态机
- DS 自己不确定

遇到立刻停，让用户升 Opus。
