---
title: Track K · M1 开工卡 — 网页文章 → 笔记知识库（端到端竖切）
status: ready
created: 2026-06-03
parent: docs/plans/track-K-notes-knowledge-base-design-draft.md
exec_env: 终端（小米模型执行）
branch: feat/k-m1-webpage-notes
---

# 目标（可验证）

把「粘贴网页文章链接 → 详细稿(md) → 默认总结 → 进知识库(workspace)」端到端跑通，并轻量包装成「笔记」形态。
**核心心态：先验证现状，再做最小包装改动，不开发新大功能。** M1 完成 = 粘贴一个文章链接，能顺滑得到一份带正文+总结的笔记，存在某个工作空间（知识库）里。

---

# 关键背景：链路已大体实现（带锚点，别重新摸索）

| 环节 | 现状 | 位置 |
|---|---|---|
| 抓取 | `load_auto/load_url`，readability-lxml + 微信 #js_content，**无需新依赖** | `shared/text_loader.py:233,333` |
| text 任务 | 状态机 FETCH→PARSE→EXTRACT→SUM→STORE，**产物 `data/workspaces/<pid>/text/<task_id>.md + .json`** | `backend/app/services/pipeline_tasks.py:1873 handle_text_task` |
| 摘要 | `_summarize_text` 自动出 abstract/key_points/golden_quotes（pipeline:1926 调用） | 同上文件，搜 `def _summarize_text` |
| 总结 UI | 按模板生成/多版本/对比/缓存 | `frontend/src/components/SummariesTab.tsx` |
| 模板 | summary_templates（含 text category），`/templates` CRUD | `backend/app/services/summary_templates.py`、`routes/templates.py` |
| 结果页 | 正文 tab + 总结 tab(SummariesTab) | `frontend/src/pages/result/TextResultPage.tsx` |
| 入口 | 粘贴 URL → sniff，`primary_type=='text'` 走预览确认 | `frontend/src/pages/WorkbenchPage/Composer.tsx:126` |
| 知识库/问答 | rag_qa_service + knowledge_base（**M1 不碰，留 M4**） | `backend/app/services/rag_qa_service.py` |

---

# 执行步骤

## Step 0 · 启动 + 对账
- 跑启动必读：`git status --short --branch` + `git log --oneline -20`，确认在干净分支，新建 `feat/k-m1-webpage-notes`。
- 启动 app：项目根 `./dev.sh`（**必须用 dev.sh 重启前后端，别手动单起/绕 CORS**）。

## Step 1 · 验证现状（先实跑一遍，定义「通过」基线）
1. 前端首页粘贴一个网页文章链接：先试普通博客/新闻，再试一个微信公众号文章。
2. 走完流程，逐项确认：
   - text task 状态机走到 SUCCESS（浮动任务面板/日志）；
   - `data/workspaces/<pid>/text/<task_id>.md` 已生成，标题/正文正确；
   - `TextResultPage` 正文 tab 显示正文，**总结 tab 能看到或点按生成总结**。
3. 后端直验（任选其一）：
   - 看任务：`curl 'http://localhost:<后端端口>/pipeline/tasks/<task_id>'`（端口/前缀按 `dev.sh`/`routes/pipeline.py` 实际为准）；
   - 跑测试：`cd backend && python -m pytest tests/ -k "text or note" -q`。
4. **把缺口记下来**（这是 Step 2 的输入）：哪步不通、哪里体验别扭（例：到结果页要点太多步 / 措辞不是「笔记」/ text 详细稿不能导出 / SummariesTab 对 text 是否可用）。

## Step 2 · 最小包装改动（按 Step 1 结果**逐项小 commit**，别一次全做）
候选清单（先确认再动手，每条单独评估）：
- [ ] **默认更顺**：粘贴文章链接后，减少「预览确认 → 添加素材」步数，让「生成笔记」更接近一键。
- [ ] **措辞对齐**：workspace → 在 UI 上呈现为「知识库」；text 结果页呈现为「笔记」。
- [ ] **总结可用**：确认 `SummariesTab` 新建总结调用的后端接口，确保 text 类型走得通（不通就修最小一处）。
- [ ] **导出确认**：确认 text 详细稿能否走现有 obsidian/pdf/docx 导出；**若未接入，记为 M5，不在 M1 强求**。

> 原则：能复用就不新增；改一处验一处；拿不准就停下问用户（见红线）。

## Step 3 · 验证 + 收尾
- `cd frontend && pnpm build`（或 `pnpm tsc --noEmit`）确保不破坏构建；
- 相关 `pytest` 绿；
- **一个子任务一个 commit**，commit 信息 `feat(k-m1): ...`；**不要 push**（开源前暂缓）。

---

# 不在 M1 范围（别顺手做）
- 知识库问答 / 联网增强 → M4
- B站视频字幕笔记 → M2
- 交互式风格库扩展（口播/步骤/Anki…）→ M3
- 更多平台（YouTube/抖音/小红书）→ M6
- 跨素材总结、增量索引、错误体验深化 → 后续

---

# 红线 / 纪律（来自 CLAUDE.md）
- 改代码前先用 1-2 句说明「改什么、为什么」；改完 1-2 句总结。
- **不装新依赖**（M1 不需要）；真要装，先停下问用户。
- 不主动重构无关代码；不改 `.env`；不执行危险命令；不 `git push`。
- 代码级验证（pytest/build）**自己跑完报结果再 commit**。
- 一个会话只做一个子任务；拿不准的命名/路径/字段**先问用户，不瞎猜**。
