---
title: Track K · M4 开工卡 — 知识库问答（本地，不联网）
status: ready
created: 2026-06-03
parent: docs/plans/track-K-notes-knowledge-base-design-draft.md
exec_env: 终端（小米模型执行）
branch: feat/k-m4-kb-qa
prereq: M5 已合并；本卡先定位再实现
decided: 本期只做本地问答，不联网（用户 2026-06-03 决议）
---

# 目标（可验证）

让用户能对**一个工作空间（=知识库）里的笔记提问**，得到基于笔记内容的本地回答。**不联网**（联网增强已决议后续单独做）。

---

# 现状锚点

| 能力 | 现状 | 位置 |
|---|---|---|
| 任务级 AI 对话 | `create_chat_turn` + `build_item_context`（N6：按 item_ids 多选拼 system_prompt 上下文） | `backend/app/routes/chat.py`、`services/chat_context.py` |
| ln 页问答抽屉 | `ChatDrawer`（B-8，上下文 = 当前 ln.md + transcript，前端构建 system_prompt） | `pages/results/LearningNotesPage/ChatDrawer.tsx`、`services/chat.ts` |
| embedding RAG | `rag_qa_service.ask_with_sources`（Short/Long 自动 + 来源引用），按 `project_json_dir` 文件夹；**前端未接** | `services/rag_qa_service.py`、`routes/rag.py`、`shared/knowledge_base.py` |

---

# 执行步骤

## Step 0 · 启动
- 对账（确认 M5 已并入 2986835），从 main 新建 `feat/k-m4-kb-qa`；`./dev.sh`。

## Step 1 · 定位（先摸清再实现，把结论发我确认）
1. 现有**任务级对话的前端入口**在哪（Taskboard / 结果页 / 工作空间？）、能否对一个 workspace 的**多个笔记**一起问答（item_ids 多选现状）。
2. `rag_qa_service` 的 `project_json_dir` 实际对应什么目录；能否直接喂某 workspace 的目录做知识库检索（路径/产物是否齐）。
3. 给出 M4 最小方案二选一 + 你的推荐：
   - **方案 A（预期更轻）**：复用现有任务级 chat 对话，在工作空间层露出"知识库问答"入口（对该 ws 的笔记多 item 上下文问答），措辞对齐"知识库"。本地、现成、不引依赖。
   - **方案 B（进阶）**：前端接 `rag_qa_service`（embedding Short/Long + 来源引用 [1][2]），做真 RAG。
   把结论发我，我定方案再开 Step 2。

## Step 2 · 实现（按确认的方案，逐项小 commit）
- 倾向 A：露出工作空间级"问答"入口 + 复用 chat 多 item 上下文 + 措辞。
- 若 A 上下文明显不够（笔记多、char 截断丢信息），再评估接 B（embedding）。

## Step 3 · 验证 + 收尾
- 在一个有 2+ 笔记的工作空间提问，得到基于笔记内容的合理回答（A 方案：上下文覆盖；B 方案：带来源标记）。
- `pytest`(.venv + KMP_DUPLICATE_LIB_OK=TRUE) + `pnpm tsc` 绿；逐项 commit；不 push。

---

# 不在 M4 范围
- **联网增强**（web search）→ 已决议本期不做，后续单独加。
- 跨素材高级聚合 / 自动主题归并 → 后续。
- embedding RAG 若 A 够用则标后续（不强接 B）。

---

# 红线 / 纪律
- 本地优先，**不引外部依赖、不出网**。
- 不破坏现有 chat / ChatDrawer / 任务级对话。
- Step 1 定位没对齐前别大改；改前先解释；pytest 用 .venv；逐项 commit；不 push；拿不准先问。
