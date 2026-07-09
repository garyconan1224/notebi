---
title: Track K · M2 开工卡 — B站视频接入笔记知识库
status: ready
created: 2026-06-03
parent: docs/plans/track-K-notes-knowledge-base-design-draft.md
exec_env: 终端（小米模型执行）
branch: feat/k-m2-bilibili-notes
prereq: M1 已合并 main（c6f7042）
---

# 目标（可验证）

让「粘贴 B站视频链接 → 笔记（详细稿 transcript/analysis + 总结）→ 进知识库」端到端顺，并对齐笔记形态。
**同 M1 心态：先验证现状，再轻包装，不开发新大功能。** M2 完成 = 粘贴一个 B站视频，默认就走"做笔记/学习"，能拿到带转写+总结的视频笔记，并能在总结 tab 选模板基于转写生成总结。

---

# 关键背景：视频笔记链路已大体实现（带锚点）

| 环节 | 现状 | 位置 |
|---|---|---|
| 入口 | 粘贴 URL → sniff `video` → `handleAdd` → 添加素材弹窗 | `WorkbenchPage/Composer.tsx`、`AddMaterialModal.tsx` |
| 分析配置 | scope（visual_only / av_combined）+ intent（learning / **默认 replica**） | `AddMaterialModal.tsx:49,243,254` |
| note 任务 | download→transcribe→analyze→note，产出 `transcript`/`analysis`/`markdown` | `pipeline_tasks.py:1193 handle_note_task` |
| 结果页 | content tab + summary tab(SummariesTab)，「学习笔记」字幕总结模式 | `pages/result/VideoResultPage.tsx:99,623` |
| 模板总结 | **已支持 transcript（M1 P1 改的）** | `summary_generator.py`（已合 main） |
| B站下载 | 无 Cookie + yt-dlp 兜底，有限流/412 兜底 | `downloaders/bilibili_nocookie.py` |

---

# 执行步骤

## Step 0 · 启动 + 对账
- `git status` + `git log --oneline -8`，确认在 **main 且含 M1（c6f7042）**；从 main 新建 `feat/k-m2-bilibili-notes`。
- `./dev.sh` 启动前后端。

## Step 1 · 验证现状（实跑一遍）
1. 粘贴一个 **B站短视频** URL（选短的，避免下载慢/限流），走完 note 流程。
2. 逐项确认：
   - note task 各步骤（download→transcribe→analyze→note）完成到 SUCCESS；
   - 产出 `transcript` / `analysis` / `markdown`（详细稿）；
   - `VideoResultPage` content tab 显示转写/摘要；
   - **总结 tab 选一个模板 → 能基于 transcript 生成总结**（这是 M1 P1 的红利，重点验证它对视频真的通）。
3. 记录缺口：下载是否触发限流（已知风险）、默认是不是"复刻"而非"笔记/学习"、视频结果页措辞是否还叫"text/workspace"等。

## Step 2 · 轻包装（按 Step 1 结果，逐项小 commit）
- **P1【核心·体验】默认走"笔记/学习"**：粘贴视频做笔记时，`videoIntent` 默认从 `replica` → `learning`。
  - ⚠️ 先确认改默认**不破坏复刻（replica）流程**——复刻是另一条产品线（Track R）。若全局改默认风险大，就只在"笔记入口"路径上默认 learning，保留复刻入口可手动切。
  - 文件：`AddMaterialModal.tsx`（`useState('replica')` 那处，约 254 行）。
- **P2【措辞】** 视频结果页对齐"笔记/知识库"（Composer/WorkspaceList 已被 M1 改过，共享受益；只查 `VideoResultPage.tsx` 自己的文案）。
- **P3【验证总结可用】** 若 Step 1 发现视频 SummariesTab 选模板生成不通，修最小一处（多半已通，P1 红利）。

## Step 3 · 验证 + 收尾
- `cd frontend && pnpm tsc --noEmit` 绿；
- `cd backend && python -m pytest tests/ -q` 绿（**注意：本机用项目 `.venv` 的 python，加 `KMP_DUPLICATE_LIB_OK=TRUE` 防 libomp 崩**）；
- 一个子任务一个 commit（`feat(k-m2): ...`）；不 push。

---

# 不在 M2 范围（别顺手做）
- 跨素材总结 / 知识库问答 / 联网 → M4
- 导出 → M5
- 更多平台（YouTube/抖音/小红书）→ M6
- 视频路径3（Gemini 大模型直接分析）→ 已搁置（付费 API）
- dev.sh frontend.pid bug → 已记 OUTSTANDING，独立处理

---

# 红线 / 纪律
- B站下载可能限流/412，属已知；多试一个短视频或换时段，别误判为代码 bug。
- **绝不破坏现有视频分析（replica / VLM / av_combined 各路径）**；改 intent 默认前先想清影响。
- 改代码前先一句话说明；自己跑 pytest/tsc 报结果再 commit；不 push；拿不准先问用户。
