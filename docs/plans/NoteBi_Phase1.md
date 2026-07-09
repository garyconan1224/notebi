# NoteBi / ReplicaBi 拆分详细计划 v3

**核心决策**

1. 保留单仓三模式：`nibi`、`notebi`、`replicabi`。
2. 默认仍是 `nibi`，避免破坏当前开源版。
3. `notebi` 只保留 `workspace.kind === "note"` 数据和功能。
4. `replicabi` 只保留 `workspace.kind === "replica"` 数据和功能。
5. NoteBi 模式允许清理 replica 数据，但必须有确认流程，不能静默删除。
6. ReplicaBi 第一版不把“知识库”作为主导航，但保留后续做“参考库 / 灵感库”的空间。

## Phase 0：产品配置冻结

新增 `frontend/src/config/product.ts`：

- `mode`: `nibi | notebi | replicabi`
- `name`
- `allowedKinds`
- `defaultKind`
- `storagePrefix`
- `showKnowledge`
- `showReplica`
- `showStoryboard`
- `showDirector`
- `showPromptFormat`
- `allowReplicaCleanup`

默认 `VITE_PRODUCT_MODE` 为空时使用 `nibi`，保证当前行为不变。

## Phase 1.5：后端 kind 过滤底座

> 注意：为了防止前端越权，先做底层改动。前端过滤只作为 UI 辅助，全部过滤都在后端执行。

后端改动：

- `WorkspaceStore.list_all(include_trashed=False, trashed_only=False, kinds=None)`
- `GET /workspaces/library?kinds=note`
- `POST /search` 请求体加 `kinds?: string[]`
- `GET /knowledge/status?kinds=note`
- `POST /knowledge/rebuild` 请求体加 `kinds?: string[]`
- `POST /knowledge/ask` 请求体加 `kinds?: string[]`

服务层改动：

- `global_knowledge._indexable_records(..., allowed_kinds=None)`
- `search_across_workspaces(..., kinds=None)`

## Phase 1：品牌和入口隔离

前端先只改可见入口，不动数据：

- `AppShell`：品牌名、导航项、底部导航按 product config 过滤。
- `WorkbenchPage/Hero`：按产品切文案。
- `Composer`：按产品模式锁定默认 kind。
- `GlobalAddMaterialModal` / `AddMaterialModal`：只显示当前产品允许的动作。
- `RecentTasks`：只显示当前产品允许 kind 的任务。
- localStorage：统一走 `storagePrefix`，兼容读取旧 `nibi-*` key。

## Phase 2：NoteBi 数据清理能力

新增接口：

- `GET /workspaces/kind-summary`：返回 `{ note_count, replica_count, note_items, replica_items }`
- `POST /workspaces/cleanup-by-kind`：第一版只允许 `{ "kind": "replica", "mode": "trash" }`

清理规则：

- 只移入回收站，不永久删除。
- 二次确认：“检测到 X 个复刻项目，不属于 NoteBi。”（保留但隐藏 / 移入回收站）
- **清理后失效全局知识库缓存，包括 `__global__` 和 `__global_sub__:*`**。（遍历清理 `CACHE_DIR` 下的所有子范围缓存）
- UI 提示用户需要刷新知识库，或自动触发 rebuild。

## Phase 3：列表、收藏、搜索、知识库隔离

前端：

- `LibraryPage`：按 `allowedKinds` 请求和展示。
- `/replicas`：NoteBi 下 route guard，跳 `/notes` 或 404。
- `FavoritesPage`：不显示跨产品 tab，不出现 all 混合视图。
- `SearchPage`：workspace 下拉按 kind 过滤；搜索请求带 `kinds`。
- `KnowledgePage`：workspace 选择器按 kind 过滤；status/rebuild/ask 全部传 `kinds`。

后端：

- 搜索和知识库即使前端漏传 workspace ids，也必须按 `kinds` 过滤。

## Phase 4：设置和模板隔离

- `SettingsShell`：按 `showPromptFormat` 等配置过滤设置菜单。
- `VideoTemplatesPage`：NoteBi 隐藏 `style_replica`。
- `PromptFormatPage`：NoteBi 隐藏整个入口。
- `AnalysisDefaultsPage`：隐藏不属于当前产品的默认项。
- 全局排查 localStorage key：至少包括 `nibi-sidebar-collapsed`、`nibi_search_history`。

## Phase 5：结果页和导出隔离

专项扫描：

- `VideoResultPage`：复刻 toggle、复刻导航、`vd-layout--replica`、复刻包导出、prompt 区、复刻按钮全部按 product mode 处理。
- `ResultsOverview`：即使 item intent 是 replica，NoteBi 也不能展示复刻分支。
- `TaskboardPage`：NoteBi 隐藏 `StoryboardLaunchModal` 入口。
- `LibraryPage` / `WorkspaceCard`：替换含“复刻”“分镜”的文案。
- `export.py` 后端先不拆，前端隐藏不适用导出入口；后续再按产品拆导出 API。

## Phase 6：测试和验收

构建：

```bash
VITE_PRODUCT_MODE=nibi pnpm --dir frontend build
VITE_PRODUCT_MODE=notebi pnpm --dir frontend build
VITE_PRODUCT_MODE=replicabi pnpm --dir frontend build
```

新增测试重点：

- `product.ts` 配置。
- `WorkspaceStore.list_all(kinds=...)`。
- `/knowledge/*` kind 过滤。
- `/search` kind 过滤。
- `cleanup-by-kind` trash + 索引失效。
- `AppShell` 导航过滤。
- `AddMaterialModal` 动作过滤。
- `SearchPage` workspace 下拉过滤。
- `FavoritesPage` tab 过滤。

**最终红线**

- 不拆仓。
- 不改 `WorkspaceRecord.kind` 存储格式。
- 不永久删除 replica 数据。
- 不只靠前端隐藏处理知识库和搜索。
- 默认 `nibi` 模式必须保持现有行为。
