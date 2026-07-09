---
title: Track K · M2.5 开工卡 — learning 视频进 ln 学习笔记页 + 治 ln 数据债
status: ready
created: 2026-06-03
parent: docs/plans/track-K-notes-knowledge-base-design-draft.md
exec_env: 终端（小米模型执行）
branch: feat/k-m2.5-ln-landing
prereq: M2（默认 intent→learning）已合并；本卡比 M1/M2 重，碰后端路径+存量数据+路由
---

# 目标（可验证）

让 **learning 视频做完笔记后，能进到 ln 学习笔记页并看到非空内容**。两件事：
1. **治 ln 数据债**：ln 页当前大概率读不到 note 的真实产物（记忆 RP1-B：读的路径 ≠ note 写的 `<name>_图文分镜.md`），导致 `/ln` 空/404。
2. **落地/入口**：learning 视频完成后顺畅进 `/ln`（默认跳转或显著入口），并让 VideoResultPage 的"学习笔记/复刻"按钮高亮正确。

> ⚠️ 这一步比 M1/M2 重：涉及后端文件路径、**存量 workspace 历史产物**、路由跳转。**Step 1 必须先把现状定位清楚再改；遇到要动存量数据/迁移，停下来问用户**（见红线）。

---

# 关键背景（锚点；精确文件名以 Step 1 代码确认为准）

| 环节 | 现状锚点 | 位置 |
|---|---|---|
| ln 页前端 | `getLnMarkdown` / `getItemResult` / `patchLnMarkdown`(编辑) / `exportLnObsidian`(导出)；有 B-1 空态(`/ln` 404 友好提示) | `pages/results/LearningNotesPage/index.tsx`、`services/workspaces.ts` |
| ln 后端读取 | GET/PATCH ln markdown 接口；导出走 `routes/export.py`（优先读"用户编辑层"再回落产物） | `routes/workspaces.py`、`routes/export.py` |
| note 真实产物 | 视频分析写 `output_dir/<safe_name>_图文分镜.md`(+`.html`)；note 任务 return `markdown` + 路径 | `shared/video_analyzer.py`、`pipeline_tasks.py:1193 handle_note_task` |
| 路由 | `/workspaces/:workspaceId/ln` → LearningNotesPage；VideoResultPage 顶部"学习笔记"按钮 `navigate(.../ln)` | `router.tsx`、`VideoResultPage.tsx:644` |

---

# 执行步骤

## Step 0 · 启动 + 对账
- `git status` + `git log --oneline -8`，确认 M2 已并入；从 main 新建 `feat/k-m2.5-ln-landing`；`./dev.sh`。

## Step 1 · 定位数据债（必须先做，别急着改）
1. **实跑确认**：粘贴一个 learning B站短视频，做完 → 进 `/workspaces/<ws>/ln`，确认是否真的空/404。
2. **代码对账（用 Read 看精确路径，别只用 grep——中文文件名会被高亮打码）**：
   - ln markdown 接口（`getLnMarkdown` 对应的后端路由）实际读哪个文件/路径；
   - note 任务/`video_analyzer` 实际把笔记 md 写到哪个文件/路径（`<safe_name>_图文分镜.md`？workspace 根还是 project_json_dir？）；
   - 找出**读 vs 写不匹配的具体点**（路径目录？文件名？item 维度 vs workspace 维度？）。
3. 把"读路径 / 写路径 / 不匹配点 / 建议的最小治本方向"**发回来确认，再动手 Step 2**。

## Step 2 · 治本 + 落地（Step 1 对齐后，逐项小 commit）
- **P1 数据债**：让 ln 接口读到 note 真实产物（二选一最小改动：① ln 接口按真实产物名/路径读；② note 写到 ln 接口期望的路径）。
  - **存量兼容**：78+ 历史 workspace 已有老产物，改路径前确认老数据还能读到；**若需迁移/重命名存量文件 → 先停下问用户**。
- **P2 落地/入口**：learning 视频完成后默认进 `/ln`（或在 ResultsOverview/VideoResultPage 给显著入口）；保留复刻入口可手动切。
- **P3 toggle 正确高亮**：VideoResultPage 顶部"学习笔记/复刻"按钮按当前所在页/intent 正确 active（接上 M2 收口的那个硬编码点）。

## Step 3 · 验证 + 收尾
- 粘贴 learning B站视频 → 完成 → 顺畅进 ln 页 → **看到非空笔记**；ln 在线编辑（patch）+ 导出 Obsidian 正常。
- `pnpm tsc --noEmit` 绿；`pytest`（`.venv` python + `KMP_DUPLICATE_LIB_OK=TRUE`）绿。
- 逐项 commit（`feat(k-m2.5): ...` / `fix(k-m2.5): ...`）；不 push。

---

# 不在 M2.5 范围
- 跨素材总结 / 知识库问答 / 联网 → M4
- 更多平台 → M6
- ln 页的新功能（M2.5 只治"接对数据 + 进得去"，不加新特性）

---

# 红线 / 纪律（本卡尤其注意）
- **存量数据**：任何涉及重命名/迁移历史 workspace 产物的动作，**必须先停下问用户**（§4 数据迁移红线）。
- Step 1 没把"读 vs 写"对账清楚前，不要改代码。
- 不破坏复刻（replica）流程与现有 video_detail 页。
- 改前先一句话说明；自己跑 pytest/tsc 报结果；逐项 commit；不 push；拿不准先问。
