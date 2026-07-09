# 修复计划：批量分析冗余 / 资料库头部 UX / 首页最近任务回归 / 合集详情精简+融合重做

> 日期：2026-07-02　分支：`feat/exp-redesign-p1`
> 作者：Claude（终端，已实测定位）　执行：小米　审查：Codex
> 用户已拍板：
> - 合集详情：**只留 AI对话**（只聊本合集内容），**知识库从合集移除**（去侧栏「知识库」板块问）。
> - 融合：**默认全选 + 可取消**（像 BiliNote）+ 风格选择 + 结果持久展示。

本批做 **任务 1-4**（相互独立），建议顺序：**任务3（首页回归 bug，优先）→ 任务1 → 任务2 → 任务4**。
**任务 5-7 是 Claude 调查时发现的技术债/清理，优先级低于 1-4，非本批阻塞项**，1-4 过审后再排。

---

## 任务 3：首页「最近任务」空了（回归 bug，优先修）

### 现象
首页 `/` 下方本应显示最近 8-9 个任务，现在空了（「暂无任务」）。

### 根因（Claude 已实测）
小米 task1（commit `94ec003`）给 `list_tasks` 加了过滤：**只保留 `project_id` 属于当前非 trashed 工作空间的任务**。
- 文件 `backend/app/routes/pipeline.py` `list_tasks`：
  ```python
  valid_ids = {ws.workspace_id for ws in _ws_store.list_all(include_trashed=False)}
  all_recs = [r for r in all_recs if r.project_id in valid_ids]
  ```
- 实测：`GET /pipeline/tasks?limit=50` 返回 **0 条**。存储里 374 个任务中，**235 个 project_id 是 `default_project`**，还有 `test_project` / `xinjiang_test` 等——**这些 project_id 根本不是 workspace_id**，全被这条过滤干掉 → 首页空。

> 本项目里 task 的 `project_id` **不等于** workspace_id（很多走 `default_project` 等 pipeline 级项目名）。task1 当初假设「project_id == workspace_id」是错的。

### 修复
把过滤从「只保留有效工作空间」反转为「**只排除已 trashed 工作空间**」，其余全保留：
```python
# 只排除「明确被删（trashed）的工作空间」的任务；default_project 等非工作空间任务照常保留
trashed_ids = {
    ws.workspace_id for ws in _ws_store.list_all(include_trashed=True) if getattr(ws, "trashed", False)
}
all_recs = [r for r in all_recs if r.project_id not in trashed_ids]
```
- 这样：首页恢复显示最近任务；同时 task1 要解决的「删除的笔记合集不再残留」仍成立（被删合集 = trashed，其任务被排除）。
- 保留 `list_all().sort(created_at desc)[:limit]` 逻辑不变，首页取前 8-9 条。

### 验收
1. 重启后端（**确认新进程**）。
2. `curl -s 'http://localhost:8000/pipeline/tasks?limit=50' | python3 -c "import sys,json;print(len(json.load(sys.stdin)))"` → 应 > 0。
3. 首页显示最近任务卡片（≥1 条）。
4. 回归 task1：在 `/notes` 删一个合集/笔记 → 首页不再残留它、也不整页清空。

---

## 任务 1：删除「批量分析」按钮（资料库多选工具栏）

### 现象
笔记页 `/notes`、复刻页 `/replicas` 多选素材后出现「批量分析」按钮，只对图片有用、与知识库定位冲突，冗余。

### 修复
文件 `frontend/src/pages/LibraryPage/index.tsx`：
- 删除「批量分析」按钮（约 625–633 行，`<Sparkles>` + `handleBatchAnalyze` 那个 `<button>`）。
- 连带清理：`handleBatchAnalyze`（约 432 行起）、相关 state（`analyzing` 等）、未再使用的 `Sparkles` import（若别处没用到）。
- 保留多选里的「全选/取消/删除/加入合集」。

### 验收
- `/notes`、`/replicas` 进入多选后，工具栏无「批量分析」；`cd frontend && npm run build` 通过。

---

## 任务 2：资料库头部按钮 UX 优化（导入内容 / 新建合集 / 查看合集）

### 现象
头部三个按钮（[LibraryPage:589-608](frontend/src/pages/LibraryPage/index.tsx)）都用一样的 `+` 图标和相近样式，主次不分、不符直觉。

### 分析 + 方案
- **「查看合集」其实是冗余**：它只是 `setSelectedFilters(['collection'])`，而筛选行里已经有「合集」这个 filter chip（全部/视频/音频/图文/文本/**合集**/生成中）。功能重复。
- 方案（符合直觉的主次）：
  1. **删除「查看合集」按钮**——用筛选行的「合集」chip 即可（若担心用户找不到，可给「合集」chip 加个数字角标显示合集数）。
  2. **「导入内容」= 唯一主操作**（黑色主按钮，`+` 图标，跳 `/` 导入）。
  3. **「新建合集」= 次按钮**（描边/次要样式，换成文件夹类图标如 `FolderPlus`，不要也用 `+` 图标，跟主按钮区分）。
- 结果：头部只剩「导入内容（主）」+「新建合集（次）」，层级清晰。

> 若用户后续想保留「查看合集」独立入口，可改为跳到合集筛选视图并高亮，但**默认按上面精简**。

### 验收
- 头部只剩两个按钮、主次分明；点「合集」chip 能筛出合集；`npm run build` 通过。

---

## 任务 4：合集详情页（TaskboardPage）精简 + 融合重做

涉及目录 `frontend/src/pages/WorkspacePage/TaskboardPage/`。
**拆成 3 个 commit 分别提交，便于 Codex 分段审：**(1) 4a+4c+4d（精简+高亮，纯前端）；(2) 4b 后端（merge 加 style）；(3) 4b 前端（融合弹框+置顶展示）。

### 4a. 修复素材多选高亮看不清（白色）
- 现象：融合/多选时选中的卡片高亮是白的，看不出选了哪个。
- 位置：`MaterialCard.tsx` 用 `data-selected` / `data-checked` 属性（约 117、121 行），高亮样式在 `taskboard.css`。
- 修复：在 `taskboard.css` 给 `.mat-card[data-selected="true"]` 加明显选中态（如 `outline: 2px solid var(--accent)` + 轻微背景色 `var(--accent-weak)` + 勾选框 `.mat-select-chk[data-checked]` 用 accent 底色白勾）。确保浅色背景下对比明显。

### 4b. 融合（Merge）重做——对齐 BiliNote
后端**已支持并持久化**融合笔记：`POST /workspaces/{id}/merge`、`GET /workspaces/{id}/merged-notes`（见 `frontend/src/services/workspaces.ts:771,780`）。当前前端问题：融合结果只塞进一个临时弹框（`index.tsx` 的 `mergeResult` state，约 57、337 行），关掉就没了，且从不读取/展示 `merged-notes` → 用户感觉「融合后内容不见了」。

用户拍板：**默认全选 + 可取消，加风格选择，结果持久展示。**

**前端 `TaskboardPage/index.tsx` + 新弹框组件：**
1. 点「融合」→ 打开融合弹框（新建 `MergeModal.tsx`），**默认勾选合集内全部素材**，可逐个取消（复用 4a 的选中态）。
2. 弹框内加**风格选择**（对齐 BiliNote）：`综合大纲(默认) / 知识图谱 / 精华摘要`。
3. 提交后调 `mergeNotes(workspaceId, itemIds, style)`（见下方后端改动），loading 态保留。
4. **结果持久展示**：融合成功后不再用「关掉即失」的临时弹框，而是：
   - 页面加载时调 `listMergedNotes(workspaceId)`，把融合笔记**置顶展示在合集内**（参考 BiliNote：合集顶部一块「融合笔记」区，可点开看 `content_md`、可复制/导出）。
   - 新融合完成后刷新该列表，新笔记出现在顶部。

**后端 `backend/app/routes/workspaces.py` 的 merge 端点（已核实现状）：**
- 现状：`MergeRequest` 只有 `item_ids: List[str]`（第 4961 行），**无 style**；`merge_notes` 要求 `len(item_ids) >= 2`，否则返回 400「融合至少需要 2 个素材」。
- 改动：给 `MergeRequest` 增加可选 `style` 字段（默认「综合大纲」）；`merge_notes` 按 style 选择不同总结 prompt（可复用 `summary_templates.py` 模板，与结果页笔记风格一致）。
- `MergedNote` 已持久化（有 `merged_id`/`created_at`），无需改存储；只需让融合内容按 style 生成。
- **前端配合 ≥2 限制**：默认全选后，若用户取消到只剩 ≤1 个，融合按钮要禁用并提示「至少选 2 个」；合集内只有 1 条笔记时融合入口也应禁用。
- **红线**：改 merge 端点时不要动 analyze/note 主 pipeline；只在 merge 内部按 style 换 prompt。

### 4c. 精简工具栏 / 标签页：移除 对比 / 队列 / 版本 / 标签库
文件 `TaskboardPage/TaskboardHead.tsx` + `TabsNav.tsx` + `index.tsx`：
- `TaskboardHead.tsx`：
  - 顶部操作行移除「对比」按钮（约 194 行 `onCompare`）、「队列」按钮（约 186 行 `onMenuAction('queue')`）。
  - 「更多」菜单（`DEFAULT_MORE_ITEMS`，约 87-95 行）移除 `queue`(队列)、`history`(版本)、`tags`(标签库)。
- `TabsNav.tsx`：移除 `compare`、`tags` 标签项（以及若有 queue/versions 标签）。
- `index.tsx`：移除对应的渲染分支与 import（`CompareTab`、`QueueTab`、`VersionsTab`、`TagsTab` 不再挂载）。**Tab 组件文件可暂时保留**（不删文件，减少牵连），只摘掉入口和 import。
- 保留：加入素材、导出、融合、分享(md/html)、合集设置、收藏夹。

### 4d. AI对话 vs 知识库：合集内只留 AI对话
用户拍板：**合集里只保留「AI对话」（只回答本合集内容）；「知识库」从合集移除**，去侧栏专门的「知识库」板块问。
- `TaskboardHead.tsx` 的「更多」菜单移除 `knowledgeQA`(知识库)（约 94 行），保留 `chat`(AI对话)。
- `TabsNav.tsx` / `index.tsx` 移除 `knowledgeQA` 标签与渲染、import（`KnowledgeQATab` 文件保留不删）。
- `chat`(AI对话/`ChatTab`) **已核实是按合集划分的**（`ChatTab` 接收 `workspace` prop，服务层 POST `/workspaces/{id}/chat`），已满足「只聊本合集内容」，无需再改范围。
- 「AI对话」UI 微调：确保入口在合集内清晰可见（可从「更多」菜单提升为顶部一个按钮，视觉与融合/导出同级）。

### 验收（任务4）
1. 多选素材时选中态**明显可见**（4a）。
2. 点融合 → 弹框默认全选、可取消、有 3 种风格选择；融合后结果**持久显示在合集顶部**，刷新页面仍在（4b）；`curl 'http://localhost:8000/workspaces/{id}/merged-notes'` 能查到。
3. 工具栏与标签页不再有 对比/队列/版本/标签库/知识库（4c、4d）；保留 AI对话且只聊本合集内容。
4. `cd frontend && npm run build` 通过；后端 merge 端点 `style` 参数生效（各风格产出不同）。

---

## 任务 5-7：技术债 / 清理（Claude 调查时发现，后续排期，非本批 1-4 的阻塞项）

> **详细执行计划见独立文档：[task-store-refactor-and-cleanup-2026-07-02.md](task-store-refactor-and-cleanup-2026-07-02.md)**（含迁移方案、dry-run 脚本、验收）。
> 这三项不影响本批 1-4 的验收，优先级低于 1-4。1-4 过审后再排；执行顺序 6 → 5 → 7。下面是摘要。

### 任务 5：任务存储技术债（中优先，建议单独重构）
- 现状：`.local/backend_tasks.json` 已达 **40MB / 374 个任务**，大头是 analyze 任务的 `result` 大数据（frames/transcript）全塞在**单个 JSON**里，`task_store._save` 每次改动全量序列化 + fsync 重写整份文件。
- 本次已用「写盘节流 + 日志裁剪」（commit `32858bf`）缓解下载卡顿，但**未治本**：任务越多，每次写盘越慢，会再次拖慢下载/处理。
- 治本方向（择一，需先出方案给 Claude/用户审）：
  1. **一任务一文件**：改成 `data/tasks/<task_id>.json`（对齐 `workspace_store` 的按 workspace 一文件），更新单任务只写单文件。
  2. **大 result 外置**：task 记录只存轻量字段，`result` 大数据落单独文件，列表/首页不加载。
- **红线**：改存储格式属高风险，必须先写迁移方案（含旧 40MB 文件的一次性迁移）+ 兼容读旧格式，经审后再动；不可直接改格式导致历史任务读不出。

### 任务 6：清理开发期测试数据（低优先，一次性）
- 现状：存储 374 个任务里，**235 个 `default_project`、20 个 `test_project`、16 个 `xinjiang_test`、14 个 `20260417T...`** 等是开发/测试残留，污染首页「最近任务」与任务列表。
- 做法：写一次性清理脚本（**不写进运行时代码**），删除 project_id 属于测试集（`default_project`/`test_project`/`xinjiang_test`/`proj` 等明显非真实工作空间）的**终结态**任务；保留真实工作空间（UUID）关联的任务。
- **红线**：删前先备份 `.local/backend_tasks.json`；只删终结态测试任务；先 dry-run 打印将删列表给用户确认，再实删。

### 任务 7：首页最近任务卡片体验（低优先，依赖任务 3+6）
- 任务 3 修好后首页会显示最近任务，但（在任务 6 清理前）会混入历史测试任务。任务 6 清理后自然变干净。
- 可选增强：首页最近任务卡片过滤掉明显的测试/占位任务（如无标题、来源为空的），只展示有效内容。此项看任务 3+6 后的实际观感再决定，**本批可不做**。

---

## 给小米的红线
- 后端改动验证前先确认**新进程**（`ps aux | grep uvicorn` 看启动时间 + `.venv`/`--reload`）。
- 前端一律 `cd frontend && npm run build` 核对（不要只信 `tsc`）。
- 任务3 只改 `list_tasks` 那一段过滤，别动 task1 的其它部分（remove_item 清任务、前端 removeByProject 都保留）。
- 任务4c/4d **只摘入口和 import，不删 Tab 组件文件**（`CompareTab/QueueTab/VersionsTab/TagsTab/KnowledgeQATab.tsx` 保留），减少牵连、便于回退。
- 任务4b 改 merge 后端时**不碰 analyze/note 主 pipeline**，只在 merge 内按 style 换 prompt。
- 产品交互若发现与本计划不符或有歧义，停下来回报，不自行发挥。
- 每个任务各自 commit（写清任务号），方便 Codex 分别审查；自己跑数据/`build` 验证后再提交。
