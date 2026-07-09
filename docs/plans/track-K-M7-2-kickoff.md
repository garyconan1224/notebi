---
title: Track K · M7-2 统一笔记入口 — 让「添加素材」接上 note pipeline（M7-3 端到端生效）
status: superseded
superseded_by: docs/plans/track-K-M7-result-abilities-kickoff.md
superseded_reason: 入口收敛到 note 会降级专门分析(N8/N9/N10)；且 video+learning 实为没坏（download→自动 analyze @workspaces.py:208，mimo 误判）。改走「结果页补三能力」方向，不动底层分析。
owner: xiaomi mimo v2.5-pro
created: 2026-06-04
parent: docs/plans/track-K-M7-kickoff.md
branch: feat/k-m7-2-note-entry
prereq: M7-3 已合 main（handle_note_task: PROBE 下载调度 + 各类型分析 + opus + 图文 OCR/VLM）
test_fixtures: docs/plans/m7-test-fixtures.md（9 条素材）
---

> ⚠️ **2026-06-05**：本卡已 superseded；连同 `track-K-M7-result-abilities-kickoff.md`，最新方向看 [`track-K-M7-result-pages-redesign.md`](track-K-M7-result-pages-redesign.md)（单素材 NoteShell）。

# 0. 背景（为什么做这个）

M7-3 把 `handle_note_task`（下载后内容驱动分析）做通了，但 **Opus 勘验发现主路径没接上**：

- `_bridge_to_pipeline_payload`（`backend/app/routes/workspaces.py:1358`）把 workspace item 翻译成 pipeline task，**只返回 `"text"/"image"/"video"/"audio"`（:1392/:1425…），没有 `"note"`**。
- 即「从工作区添加素材」的主流程走的是**旧的按类型 task**（handle_text/handle_image/…），**没调 `handle_note_task`**。
- M7-3 的统一分析逻辑因此只在某条小众入口生效（小红书/opus 验收走的那条），**主路径白做**。

**M7-2 = 把主路径接上 note pipeline**，让"选笔记 → 下载后内容驱动分析"真正端到端。

---

# 1. 目标（可验证）

从工作区/Composer 添加一个素材（笔记意图）→ 走 **note task** → `handle_note_task` → PROBE 识别 → 各类型走对分析路径 → 出笔记。9 条素材（含 opus/小红书/网页/本地）走主路径都通。

---

# 2. Step 1 · 勘验（先查清，别急着改；rg 中文乱码就用 Read）

**这一步只读，产出现状 + 改法清单，发用户确认再进 Step 2。**

1. **note task 现有触发路径**：搜 `createNoteTask` / `task_type == "note"` / `pipeline.py` 的 note 入口——M7-1/M7-3 验收时小红书/opus 是怎么触发 `handle_note_task` 的？哪个入口/intent？
2. **`_bridge_to_pipeline_payload` 全貌**（`workspaces.py:1358-1440`）：各类型 task 的决策逻辑、intent/preflight 怎么影响 task_type。
3. **task 分派表**：`task_runner` 怎么把 task_type 映射到 handler（`handle_note_task` 注册在哪）。
4. **入口边界**：哪些素材该收敛到「笔记」(走 note)，哪些要保留按类型（**视频复刻 / AI 导演 / 图片批量等非笔记用途不能破坏**）。
5. **前端**：`AddMaterialModal`/`Composer`/`featuresToSteps.ts` 现在怎么定 item.type 和 steps；"笔记/学习模式"入口现状。

→ 产出《M7-2 现状 + 改法清单》，**发用户确认**。

---

# 3. Step 2 · 改法框架（勘验确认后细化）

- **后端 bridge**：`_bridge_to_pipeline_payload` 对「笔记意图」item 返回 `("note", payload)`（payload 带 steps，由 PROBE 后裁剪）；非笔记（复刻等）保持原 task_type。
- **前端入口**：选「笔记」建 note item（**不前期判类型**，type/intent=note），措辞对齐"做笔记"。
- **不破坏非笔记流程**：视频复刻 / AI 导演 / 图片批量分析等保留现有按类型路径。

---

# 4. Step 3 · 验收（`./dev.sh` 真跑，看正文真假）

- 从工作区添加 9 条素材（`m7-test-fixtures.md`）→ 确认走 **note task**（日志/task_type）→ `handle_note_task` PROBE 识别正确 → 各类型出对的笔记。
- 重点回归：opus 真正文、小红书图文(6图+正文+VLM描述)不崩、公众号/网页真正文、本地文件。
- **不破坏**：视频复刻页 / 图片批量 等非笔记流程仍正常。
- 全量 `pytest`（.venv+KMP）绿；改前端则 `pnpm tsc`。

---

# 5. 红线 / 纪律
- **Surgical**：只接通 note 主路径，**别动 / 别破坏**复刻、AI 导演、图片批量等非笔记流程（先勘验清边界）。
- 不前期判类型（类型判断在 PROBE/下载后）；不 import 坏模块 `bilibili_nocookie`。
- **Step 1 勘验产出发用户确认后再改**（跨前后端 + 影响主流程，风险高）。
- 一个子任务一个小 commit；真端到端验收；**不主动 push**；不确定就停下问（CLAUDE.md §4）。

---

# 6. 开工话术（复制即用）

```
执行 Track K M7-2（统一笔记入口），先读 docs/plans/track-K-M7-2-kickoff.md。

启动：git status && git log --oneline -8 对账；从 main 新建 feat/k-m7-2-note-entry；./dev.sh。

先做 Step 1 勘验（只读，别急着改，rg 中文乱码就用 Read）：
1. note task 现有怎么触发（createNoteTask / pipeline.py note 入口 / task_type=="note" / 笔记模式）——M7-1/M7-3 验收时小红书/opus 走哪条？
2. _bridge_to_pipeline_payload（backend/app/routes/workspaces.py:1358）各类型 task 决策全貌。
3. task_runner 的 task_type→handler 分派表（handle_note_task 注册在哪）。
4. 入口边界：哪些该走「笔记」(note)，哪些保留按类型（视频复刻/AI导演/图片批量不能破坏）。
5. 前端 AddMaterialModal/Composer/featuresToSteps 怎么定 item.type 和 steps。

产出《现状 + 改法清单》发我确认，再进 Step 2 改（_bridge 笔记意图→"note" task + 前端选笔记建 note item + 不破坏非笔记流程）。

红线：surgical 别破坏复刻/AI导演/图片批量；不前期判类型；勘验后确认再改；不push；不确定停下问。
```
