# 详细计划：任务存储重构 + 测试数据清理 + 首页卡片体验（任务 5-7）

> 日期：2026-07-02　分支：待定（建议从 main 或当前分支切 `feat/task-store-refactor`）
> 作者：Claude（终端，已实测定位）　执行：小米　审查：Codex
> 关系：本文是
> [library-header-recenttasks-collection-detail-2026-07-02.md](library-header-recenttasks-collection-detail-2026-07-02.md)
> 里「任务 5-7」的详细展开。**优先级低于任务 1-4，1-4 过审后再做。**
> 顺序：**任务 6（清理，低风险，先做）→ 任务 5（重构，高风险）→ 任务 7（体验，依赖 5/6）**。
> （把 6 放 5 前面：先把 40MB 里的测试垃圾清掉，重构迁移的数据量更小、更快。）

---

## 背景（Claude 实测数据）

- `.local/backend_tasks.json` 已 **40MB / 374 个任务 / 40243 行日志**。
- `task_store._save()` 每次任何改动都把**全部任务**序列化成 40MB JSON + fsync 重写整份文件。
- commit `32858bf` 已用「写盘节流 + 日志裁剪」缓解下载卡顿（下载从 ETA 数小时→2.4-4.5s），但**未治本**：任务越多，每次全量写盘越慢，会再次拖慢下载/处理/任何写任务的操作。
- 大头不是日志（~4MB），而是 analyze 任务的 `result` 大数据（frames/transcript/视觉 JSON）全塞进单文件。
- project_id 分布：`default_project` 235、`test_project` 20、`xinjiang_test` 16、`20260417T...` 14、其余为真实工作空间 UUID——**大量是开发期测试残留**。

---

## 任务 6：清理开发期测试数据（低风险，先做，一次性脚本）

### 目标
删除存储里明显的开发/测试残留任务，缩小文件、净化首页「最近任务」与任务列表。

### 现状核实
- 测试类 project_id（非真实工作空间）：`default_project`(235)、`test_project`(20)、`xinjiang_test`(16)、`20260417T025752Z_123`(14)、`proj`(2) 等。
- 真实工作空间 project_id 是 UUID（如 `eb793d57-...`），当前非 trashed 工作空间只有 14 个。

### 做法（一次性脚本，不写进运行时代码）
1. 新建脚本 `scripts/cleanup_test_tasks.py`（放 `scripts/`，不进 backend 运行时）。
2. 脚本逻辑：
   - 读 `.local/backend_tasks.json`。
   - **先备份**：复制成 `.local/backend_tasks.json.bak.<时间戳>`。
   - 判定「测试任务」：project_id 属于测试集合，或 project_id **不是**任何真实工作空间 UUID 且不是有效业务项目。安全起见用**白名单反选**：
     - 保留：project_id 属于 `workspace_store.list_all(include_trashed=True)` 的任一 workspace_id（真实工作空间，含垃圾桶）。
     - 其余（default_project / test_project / xinjiang_test / proj / 时间戳串等）视为测试，且**仅删终结态**（SUCCESS/FAILED/CANCELLED）的。
   - **dry-run 模式（默认）**：只打印「将删除 N 条、按 project_id 分组统计、示例 task_id」，不写盘。
   - 加 `--apply` 参数才真正写回。
3. 用户看 dry-run 输出确认后，再 `--apply`。

### 风险与红线
- **必须先备份**再删。
- 默认 dry-run，`--apply` 才实删；实删前把 dry-run 结果给用户确认。
- 只删终结态测试任务；**不删**任何真实工作空间（UUID，含 trashed）关联的任务。
- 若某测试 project_id 下仍有非终结态任务（僵尸），交给 task_store 启动清理去标 FAILED，本脚本不碰非终结态。
- 脚本执行时后端应**停止**（避免与运行中的 store 写盘竞争）。

### 验收
1. dry-run 输出将删列表，数量合理（预计删掉两三百条测试任务）。
2. `--apply` 后 `.local/backend_tasks.json` 明显变小；`.bak` 备份存在。
3. 重启后端，首页最近任务只剩真实内容；`curl '.../pipeline/tasks?limit=50'` 返回的都是真实工作空间任务。
4. 真实工作空间的任务、结果页、合集均不受影响（抽查 2-3 个真实工作空间打开正常）。

---

## 任务 5：任务存储重构——一任务一文件（高风险，先出方案审）

### 目标
根治「每次写任务都全量重写整份 JSON」的性能问题，让写单个任务只写单个小文件。

### 方案选择：一任务一文件（对齐已验证的 `workspace_store`）
- 采用 `workspace_store.py` 的成熟模式：每个任务一个 JSON 文件，内存 dict 缓存，写单任务只写单文件。
- 不采用「大 result 外置」方案（需拆记录、改 to_dict/from_dict、消费方要拼装，牵连更大）。

### 关键前提（已核实，决定这次重构是安全的）
`TaskStore` 的**公开 API 被所有消费方依赖，但内部存储格式没人依赖**：
- 消费方（`pipeline.py` 的 `_store`、`workspaces.py` 用的 `_runner.store`、`task_runner.py`）只调
  `create / get / update / append_log / list_all / delete`。
- **只要保持这 6 个方法签名和行为不变，改 `_load`/`_save` 内部实现，调用方零改动。** 这是本次重构风险可控的核心。

### 改动（`backend/app/services/task_store.py`）
1. 存储根目录：`TASK_STORE_DIR = ROOT_DIR / ".local" / "tasks"`（每任务一文件 `<task_id>.json`）。
   保留旧常量 `TASK_STORE_PATH`（指向旧单文件）仅用于迁移。
2. `_file_path(task_id)`：消毒 task_id（禁跨目录，参照 workspace_store 的 `replace('/','_')`）。
3. `_load()`：
   - 若新目录不存在但旧 `backend_tasks.json` 存在 → 先执行**迁移**（见下），再从新目录加载。
   - `glob("*.json")` 逐个读入内存 dict（沿用现有：启动把非终结态标 FAILED、日志裁剪到 `MAX_LOG_ENTRIES`）。
   - 裁剪/清理导致的变更，只 `_save_one` 受影响的任务（不再全量写）。
4. `_save_one(rec)`：原子写单个任务文件（tmp + fsync + os.replace，复用现有原子写逻辑）。
5. 各写方法改为写单文件：
   - `create` → `_save_one(record)`。
   - `update` → 改完 `_save_one(rec)`；**保留** progress/download_speed 的 debounce（现在单文件写很快，debounce 可保留也可放宽，建议保留避免高频 fsync）。
   - `append_log` → `_save_one(rec)`（保留 info 级 debounce、warning/error 立即写）。
   - `delete` → 删内存 + `os.remove(_file_path)`（文件不存在则忽略）。
6. `list_all` / `get`：只读内存 dict，逻辑不变。

### 迁移（一次性，`_load` 内自动触发）
- 条件：新目录 `.local/tasks/` 不存在或为空，且旧 `.local/backend_tasks.json` 存在。
- 步骤：
  1. 读旧单文件 → 对每条 `TaskRecord.from_dict`。
  2. 逐个 `_save_one` 写到新目录。
  3. 迁移成功后，把旧文件重命名为 `backend_tasks.json.migrated`（**不删**，留作回退凭据）。
  4. 迁移过程加 try/except + 日志；任一条坏数据跳过不阻塞整体。
- **兼容读旧格式**：迁移逻辑就是读旧格式，天然兼容；迁移后一律走新目录。
- 建议**先跑任务 6 清理**再迁移，迁移的数据量小很多。

### 风险与红线
- **高风险**：这是持久层改造。**必须先写出完整方案（含迁移伪代码、回退方案）给 Claude 或用户审，通过后再动手。**
- 保持 6 个公开方法签名/行为完全不变，不改任何消费方代码。
- 迁移**不删旧文件**（重命名保留），可回退。
- 改完必须有测试覆盖：
  - 若已有 `test_task_store*.py`，先跑通旧测试；再补：迁移正确性（旧单文件 → N 个新文件，条数/字段一致）、单任务写不影响其它文件、delete 删文件、启动裁剪只写受影响文件。
- 后端验证前确认新进程；用干净 worktree 跑 commit 级审查（存储改动尤其要在干净树上验）。

### 验收
1. 迁移：把（清理后的）旧文件放回，启动后端 → `.local/tasks/` 下生成 N 个 `<task_id>.json`，旧文件变 `.migrated`；任务数、内容与迁移前一致。
2. 性能：下载/处理任务时，`.local/tasks/` 只有对应任务文件在变（`ls -lt` 观察），不再全量重写；连续跑一个真实 B 站任务全程流畅。
3. 回归：首页最近任务、任务详情、合集状态桥（`_sync_item_with_tasks`）、重试/取消/删除全部正常。
4. `pytest`（task store 相关）全绿；`cd frontend && npm run build` 不受影响（前端无改动）。

---

## 任务 7：首页最近任务卡片体验（低优先，依赖 5/6）

### 目标
任务 3 修好后首页会显示最近任务；配合任务 6 清理后自然变干净。此项做**锦上添花**的空态/无效卡过滤。

### 现状
- 首页 `RecentTasks`（`frontend/src/pages/WorkbenchPage/RecentTasks.tsx`）取 `tasks.slice(0, 8)`，`taskToNoteCard` 渲染。
- 无标题/无来源的占位任务也会渲染成空卡。

### 做法（前端，小改）
- 在 `RecentTasks` 渲染前过滤掉明显无效的卡：如 `title` 落到 `getStatusText`（说明既无 video_title 也无 url）、且无封面无摘要的任务。
- 或者：只展示有 `url`/`video_title`/来源的任务，保证卡片有意义。
- 保持「最近 8 个」的数量，过滤后不足 8 个就少显示，不补占位。

### 验收
- 首页最近任务卡都有意义（有标题/来源/封面其一）；`npm run build` 通过。
- **本项非必须**：若任务 6 清理后首页已足够干净，任务 7 可不做。

---

## 总红线（任务 5-7 通用）
- 任务 5 属持久层高风险改造：**先出方案审，再动手**；保持 TaskStore 公开 API 不变；迁移不删旧文件。
- 任务 6 一次性脚本：先备份、默认 dry-run、`--apply` 前给用户确认；只删终结态测试任务。
- 三项都需后端**新进程**验证；存储相关改动在**干净 worktree** 跑 commit 级审查。
- 各任务独立 commit，写清任务号 + 附实测证据（迁移前后条数、文件大小、下载流畅度）。
- 不改 `.env`、不动无关代码、不 `git push`（push 需用户确认）。
