---
phase: N1b
title: 磁盘布局迁移 data/projects/ → data/workspaces/
status: done
model: Opus 4.7
branch: feat/phase-n1b-workspace-layout
worktree: TBD
created: 2026-05-19
priority: P1
estimate_hours: 6-10
depends_on: N1 (已合并)
completed_date: 2026-05-19
commits: a11512a (N1b.3 迁移脚本) / e411b0c (N1b.4 调用方替换)
---

# N1b 磁盘布局迁移

> 来源：`docs/EXECUTION_PLAN.md` 第 57 行（从 N1 拆出）
> 目的：把项目术语从「project」彻底切到「workspace」，磁盘布局对齐 SPEC

## 背景与现状

代码层（router / store / API）早在 N1 已经统一为 `workspace`，**唯一遗留**是磁盘路径：

| 类型 | 当前路径 | 代码常量 |
|---|---|---|
| Workspace 元数据 JSON | `data/workspaces/<workspace_id>.json` | `workspace_store.py` |
| 每个 workspace 的产物目录 | `data/projects/<project_id>/{videos,json_data,text,runtime}/` | `shared/config.py::PROJECT_WORKSPACES_DIR` |
| 旧导演台项目存档 | `projects/`（仓库根，非 data/） | `shared/config.py::PROJECTS_DIR` |

`data/projects/` 当前有 **17 个子目录**（真实用户数据，不能丢）。

## 最终方案（2026-05-19 用户拍板）

- **D1 = 方案 A**：`data/workspaces/<id>.json` 与 `data/workspaces/<id>/` 同层并存
- **D2 = 方案 2**：半自动 `scripts/migrate_n1b_layout.py`，默认 `--dry-run`，需 `--apply` 才真搬，原目录改名为 `data/projects.bak.<timestamp>/` 保留
- **D3 = 改名 + 保留 alias**：新增 `WORKSPACES_DATA_DIR` / `get_workspace_*()`，旧 `PROJECT_WORKSPACES_DIR` / `get_project_*` 保留为 deprecated alias（带 `DeprecationWarning`）

---

## 历史决议备选（已废）

### D1：新布局形态二选一

- **方案 A（推荐）**：目录与 JSON 同层并存
  ```
  data/workspaces/
    ├── <id>.json             ← 元数据（保留现状）
    └── <id>/                 ← 产物（从 data/projects/<id>/ 搬过来）
        ├── videos/
        ├── json_data/
        ├── text/
        └── runtime/
  ```
  优点：rename 即可；缺点：`ls data/workspaces/` 视觉混乱。

- **方案 B**：JSON 收进子目录
  ```
  data/workspaces/
    └── <id>/
        ├── workspace.json    ← 元数据
        ├── videos/
        └── ...
  ```
  优点：每个 workspace 一个完整文件夹；缺点：要改 `workspace_store.py` 所有读写路径。

### D2：旧数据搬家策略

- 自动：后端 `lifespan` 启动钩子检测到 `data/projects/` 非空时执行迁移并打印日志。
- 半自动：写独立脚本 `scripts/migrate_n1b_layout.py`，用户手动跑一次。
- 推荐：**半自动 + dry-run 默认**，避免启动时静默改用户数据。

### D3：常量命名

`shared/config.py` 里 `PROJECT_WORKSPACES_DIR` 改成 `WORKSPACES_DATA_DIR`，函数 `get_project_*` 改成 `get_workspace_*`。代码层 90% 已经叫 workspace，只剩 shared/ 这一层有 `project_` 前缀。

---

## 子任务（待 D1/D2/D3 确认后填具体步骤）

### N1b.1 决议落盘 + 测试基线
- 把 D1/D2/D3 决议写进本文件「最终方案」段
- 跑 `pytest tests/backend -q` 拿当前绿色基线

### N1b.2 改 `shared/config.py` 常量与函数名
- 新增 `WORKSPACES_DATA_DIR`、`get_workspace_*()` 系列
- 保留旧 `PROJECT_WORKSPACES_DIR` / `get_project_*` 作为 deprecated alias（指向新路径），加 `DeprecationWarning`

### N1b.3 迁移脚本 `scripts/migrate_n1b_layout.py`
- 默认 `--dry-run`：扫 `data/projects/` 列出会搬什么
- `--apply`：真搬，逐个 `shutil.move`，失败回滚
- 完成后打印「已迁移 N 个，旧目录已重命名为 `data/projects.bak.<timestamp>/`」
- 不删 `.bak`，让用户自己确认后删

### N1b.4 调用方批量替换
- `backend/app/routes/notes.py`：upload 路径
- `backend/app/routes/workspaces.py`：text 任务读盘路径
- `backend/app/services/pipeline_tasks.py`：text/image/audio/video 产物落盘路径
- `shared/project_store.py`：（如果 D3 决定改名，整文件 rename）
- 注释里的 `data/projects/` 字符串也要刷

### N1b.5 测试
- 新增 `tests/backend/test_workspace_layout.py`：
  - happy path：创建 workspace → 跑 text 任务 → 断言产物落在 `data/workspaces/<id>/text/`
  - 兼容性：旧路径 `data/projects/<id>/text/` 还存在时 fallback 读取（一次性兼容）
- 跑 `pytest tests/backend -q` 全绿

### N1b.6 本机验证
- 用户自己机器上跑 `python scripts/migrate_n1b_layout.py --dry-run`
- 看输出 OK → 跑 `--apply`
- 启 `./start.sh`，开一个老 workspace 看产物能正常加载

### N1b.7 文档收尾
- `docs/EXECUTION_PLAN.md`：N1b 打 `[x]`
- 本文件 frontmatter：`status: done` + 填 `commits` / `completed_date`
- `docs/COMPLETED_WORK.md`：追加记录
- `docs/AI_HANDOFF.md`：更新「下一步是 N8b」

---

## 风险

- **数据丢失**：迁移脚本必须先复制再删原目录，且保留 `.bak` 至少一周
- **运行中迁移**：迁移时后端必须停（脚本开头检查 `BACKEND_PORT` 是否在监听，是就 abort）
- **CI / 旧测试**：grep 全仓库找 hardcoded `data/projects` 字符串，逐个替换

## 验收标准

1. `data/projects/` 在用户机器上已搬空（或重命名为 `.bak`）
2. 启动后端 + 前端，老 workspace 能加载历史产物
3. 新建 workspace → 跑各分支任务 → 产物全部落在 `data/workspaces/<id>/`
4. `pytest tests/backend -q` 全绿
5. `grep -rn "data/projects" backend/ shared/ frontend/src` 无业务代码命中（只剩注释/迁移脚本）
