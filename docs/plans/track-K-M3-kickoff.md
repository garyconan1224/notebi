---
title: Track K · M3 开工卡 — 总结风格库扩充
status: ready
created: 2026-06-03
parent: docs/plans/track-K-notes-knowledge-base-design-draft.md
exec_env: 终端（小米模型执行）
branch: feat/k-m3-summary-styles
prereq: M2.5 已合并 main
---

# 目标（可验证）

把"总结"tab 的风格库补全：在现有 9 种基础上，加上**口播稿 / 步骤教程 / 大纲 / 问答卡(Anki) / 行动清单**。用户在总结 tab 能选这些新风格并生成正确结果。**纯配置扩展、零新依赖。**

---

# 现状锚点

| 环节 | 现状 | 位置 |
|---|---|---|
| 内置模板 | 9 种：concise/detailed/quotes/meeting/xhs/longform/lecture/interview/shownotes | `backend/app/services/summary_templates.py:19 TEMPLATES` |
| 模板结构 | `SummaryTemplate(id, label, system_prompt, user_prompt, output_format)`，user_prompt 用 `{transcript}` 占位 | 同上 |
| 前端模板列表 | **硬编码**：`TEMPLATE_OPTIONS`(全量) / `QUICK_TEMPLATES`(常用4) / `QUICK_TEMPLATE_CARDS`(空态2×2) | `frontend/src/components/SummariesTab.tsx:32,45,53` |
| 生成链路 | `createSummary(template)` → 后端 `generate_summary`（已支持 transcript→content→summary，M1 P1） | `services/summaries.ts`、`summary_generator.py` |

---

# 执行步骤

## Step 0 · 启动
- 对账（git status + log，确认 M2.5 已并入），从 main 新建 `feat/k-m3-summary-styles`；`./dev.sh`。

## Step 1 · 后端加风格（summary_templates.py 的 TEMPLATES dict）
按现有模板的写法，新增 5 种（id / label / system_prompt / user_prompt 用 `{transcript}` 占位）：
- `oral`　　口播稿/脚本 — 改写成可直接念的口播文案，口语化、有节奏。
- `steps`　 步骤/教程 — 把操作类内容拆成可照做的有序步骤清单。
- `outline` 大纲/思维导图 — 多级层次提纲，一眼看结构。
- `qa`　　　问答卡(Anki) — 输出 Q/A 卡片，便于记忆复习。
- `actions` 行动清单 — 提取可执行的待办/行动项。

> 复用现有 system/user_prompt 风格，保持 `{transcript}` 占位不变（generate_summary 会把正文/转写填进去）。

## Step 2 · 前端同步（SummariesTab.tsx）
- `TEMPLATE_OPTIONS` 加这 5 个 `{value,label}`（value 与后端 id 一致）。
- 可选：更新 `QUICK_TEMPLATES`（常用4，建议 concise/lecture/oral/steps）和空态 `QUICK_TEMPLATE_CARDS`。
- 确认 `templateLabel()` 能显示新 label（靠 TEMPLATE_OPTIONS 映射，加了就行）。

## Step 3 · 验证 + 收尾
- 浏览器：进任一笔记的总结 tab → 能看到并选新风格 → 生成正确（文章用正文、视频用转写）。
- `cd backend && KMP_DUPLICATE_LIB_OK=TRUE .venv/python -m pytest tests/ -k "summary or template" -q`；`pnpm tsc --noEmit`。
- 逐项 commit（`feat(k-m3): ...`）；不 push。

---

# 不在 M3 范围
- 总结**带图**（把关键帧/图集嵌进总结）→ 单列后续（M3.5 或并入 M5）。
- 自定义模板 CRUD 的前端 UI（后端 `/templates` 已有，M3 只加内置风格）。
- 跨素材总结 → M4。

---

# 红线 / 纪律
- 零新依赖；新模板别破坏现有 9 种（只往 dict 里加 key）。
- generate_summary 共享给 video/audio/text，别改它的取数逻辑（M1 P1 已调好）。
- 改前先一句话说明；自己跑 pytest/tsc；逐项 commit；不 push；拿不准先问。
