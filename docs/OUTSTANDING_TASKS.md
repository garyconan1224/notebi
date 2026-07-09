# Outstanding Tasks

> 本文件是「下一步该做什么」的快照。写入前必须先 `git log --oneline -20` 对账，避免把已完成阶段当作待办。

> ⚠️ **2026-06-05 当前有效待办（覆盖下方旧池）**：先**确认 M7 单素材笔记页（NoteShell）信息架构**，依据 [`docs/plans/track-K-M7-result-pages-redesign.md`](plans/track-K-M7-result-pages-redesign.md)；**本轮不开始搭建 / 不动代码**。下方 2026-05-29 任务池为历史快照，勿直接捡起执行。

Last updated: 2026-05-29（**当前阶段 = R21.P3.S3 followup 待 merge → 音视频端到端打通**）

---

## 🔴 当前阶段（一切让路）

**R14~R21 全系列已合入 main（以 git log 为准）；分支 `fix/r21-p3-s3-followup`（R21.P3.S3 followup，preflight intent 链路修复 + av_combined 补图入口）已 `status: done`，下一步用户授权后本地 merge 到 `main`。不 push origin。**

下一步方向（用户 2026-05-29 决议）：**音频 + 视频两条线从输入链接 → 任务 → 落地页完整端到端打通**，确保音视频闭环到位，再做文字 / 图片深化。

短期任务池（按依赖排序）：
1. **🔴 S0 E2E bugfix（必修）** — 见 [`docs/plans/phase-e2e-bugfix-2026-05-29.md`](plans/phase-e2e-bugfix-2026-05-29.md)
   - S0.1 `/subtitles` 端口删 demo 兜底（P1，1-2h）
   - S0.2 audio_result has_real 认 transcript_segments（P1，0.5h）
   - S0.3 visual_only 前端禁 SRT 按钮（P1+，0.5h）
   - S0.4 ResultsOverview React key（P2，0.5h）
   - S0.5~S0.8 P3（可选，2-3h）
2. S1-S3 清理（plans 归档 / Streamlit 冻结 / 未用 assets）
3. S4 N7b 路径3 Gemini 后端骨架（无 API，已定方向）
4. S5 N8b 音频 librosa 6 维度后端
5. S6 R20 笔记 PDF/Word/Obsidian 导出

---

## P0 — 当前 main 基线

- 最新基线：N1~N11 主线 + H 系列 + IP 系列全部完成，详见 `docs/EXECUTION_PLAN.md`。
- **IP.9 Flow Gaps 已完成**（2026-05-21）：Results 总览页 + N7b/N8b UI + payload 对齐，5 个 commit 合入 main。
- **N7b 路径 1 已完成**（2026-05-21）：视频字幕直接总结后端 + 结果契约修复（transcript 数组化）+ UI 收口，4 个 commit 合入 main。
  - PreflightDrawer 已加摘要路径选择（tasks.summary.path = "subtitle"）
  - VideoResultPage 已支持路径 1 字幕总结模式（summary + transcript 展示）
  - 端到端验证通过：本地视频 → Whisper 转写 → LLM 总结 → 结构化返回
- **N7b/N8b UI 已就绪**，后端 handler 待实现：
  - N7b 路径 3（视频模型直接）— 依赖 Gemini / GPT-4o / Qwen-VL API 集成决策
  - N8b 音频 librosa 分析（6 维度切分）
- **推荐下一步：followup merge + 音视频端到端回归** — merge `fix/r21-p3-s3-followup` 到 local main 后，跑音视频端到端冒烟记录断点；不 push origin。
- Push 策略不变：所有 `git push origin` 暂缓到 `[D]` 开源准备阶段。

## P0 — 已知收口事项

- `.git` 当前约 `278M`，原因是早期历史包含 `.venv/` 和 `backend/app/services/test_note_output/`。清理方案是 `git filter-repo`，但必须等用户明确说「做」。
- 视频结果 frames 数据契约待查：ResultsOverview timeline frames 为空对象 `[{}]`，`f.idx` / `f.ts` / `f.shot_type` 全 undefined（S0.4 仅兜底了 key，未修数据源）。
- `docs/EXECUTION_PLAN.md` 是当前最准确的执行状态来源。
- `docs/WORKFLOW.md`、`CLAUDE.md`、`AGENTS.md`、`docs/AI_HANDOFF.md` 应保持与 N11 后状态一致。

## P1 — 可选下一步

- **推荐 1：开源前仓库收口**：验证 `pnpm build` / 后端测试，修剩余存量 lint 基线，整理 handoff 文档。
- **推荐 2：.git 历史瘦身**：先备份 `.git`，再用 `git filter-repo` 移除历史大文件路径，完成后不 push。
- **推荐 3：[D] 开源准备**：README、license、安全检查、CI、发布前清单。

## 长期遗留技术债

- Streamlit 旧入口冻结，除非用户明确要求维护。
- `N1b` 磁盘布局：`data/projects/` → `data/workspaces/` 仍是高影响待做项。
- `N7b` 路径 3 后端 handler（UI 已就绪，依赖 Gemini / GPT-4o / Qwen-VL API 集成决策）。路径 1 已完成。
- `N8b` 音频 librosa 分析后端（UI 已就绪，6 维度切分）。
- [backlog] 复刻页失败帧「重试」接后端 — 前置：需先建 frame status（成功/失败态）机制。来源：RP1-C C-5 scope exception。
- [backlog] `dev.sh` frontend.pid 路径/cwd bug（约 53-54 行）— 启动时 cwd 错乱，影响 `./dev.sh` 体验。来源：Track K M1 验证（2026-06-03）发现，未阻塞 M1。
- [backlog] 笔记 PDF/Word 导出 — `av_synthesis` 的 pdf/docx builder 绑死 `ParsedNotes`（关键帧画廊/章节）不能复用，需写轻量 `build_simple_pdf/docx(markdown, title)`（方案 A）。来源：Track K M5（2026-06-03）；md/Obsidian 已覆盖主需求故本期跳过。
- [backlog] 快手视频下载 — yt-dlp 无快手提取器，需自写 `kuaishou_share` 模块（仿抖音 `douyin_mobile_share` 的分享页解析）。来源：Track K M6（2026-06-03）；YouTube/抖音/小红书已通，快手单列。
- [backlog] item.name / project_id 与 task.result 同步债 — pipeline 完成后 `item.name` 仍为 URL 尾部（应取 `result.title`）；产物 `project_id` 仍硬编码 `default_project`（应为 `workspace_id`，N1b 归属债）。属 item↔task 同步问题；封面已用「绝对路径 + 从 task store 回填」绕过，不阻塞。来源：Track K M6 小红书重构（2026-06-04）。
