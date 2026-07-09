---
title: Track K · M5 开工卡 — 笔记导出（md/Obsidian/PDF/Word）统一覆盖
status: ready
created: 2026-06-03
parent: docs/plans/track-K-notes-knowledge-base-design-draft.md
exec_env: 终端（小米模型执行）
branch: feat/k-m5-notes-export
prereq: M3 已合并；M5 先定位再接线
---

# 目标（可验证）

让"笔记"（text 文章笔记 / ln 视频学习笔记）能导出 **Markdown/Obsidian**，并尽量复用现有 builder 接上 **PDF/Word**，覆盖详细稿+总结。重点补齐 **text 文章笔记的笔记式导出**（现在它只有"复刻工作包"zip，偏复刻不偏笔记）。

> 心态同前：先定位现状，复用现成 builder，不重写导出。

---

# 现状锚点

| 导出 | 现状 | 位置 |
|---|---|---|
| 单 item「复刻工作包」zip | video/image/audio/text 都支持，但内容是 reference_frames + prompts（复刻导向，非笔记 md） | `export.py:304 export_workspace_item` |
| ln 视频学习笔记 → Obsidian | 仅 obsidian（zip：`{标题}.md` + attachments + frontmatter + `![[...]]`） | `export.py:796 export_ln_obsidian` |
| PDF / Word / Obsidian builder | R20 已实现（音视频合成笔记用） | `backend/app/services/av_synthesis/{pdf,docx,obsidian}_builder.py` |
| 字幕 / 批量 | srt/vtt/ass、batch-export | `export.py:569,428` |

---

# 执行步骤

## Step 0 · 启动
- 对账（确认 M3 已并入），从 main 新建 `feat/k-m5-notes-export`；`./dev.sh`。

## Step 1 · 定位（先摸清再接线，把结论发我确认）
1. **各笔记的导出现状**：text 文章笔记现在能导出什么？ln 视频笔记？两者结果页有没有"导出"入口、走哪个接口？
2. **builder 可复用性**：`av_synthesis` 的 `pdf_builder`/`docx_builder`/`obsidian_builder` 输入是什么（markdown 文本？结构化？）——能否直接喂 text/ln 笔记的 markdown（详细稿 md / 总结）生成 pdf/docx？
3. 把"现状表 + 最小补齐方案（哪些类型缺哪些格式、builder 能不能直接复用）"发回来确认，再动 Step 2。

## Step 2 · 接线（按 Step 1 结论，逐项小 commit）
- **P1**：补齐 **text 文章笔记的笔记式导出（md/Obsidian）**——复用 `export_ln_obsidian` 的逻辑或 obsidian_builder，把详细稿 md（含总结）打包。
- **P2**：若 builder 能直接吃 markdown，给 ln/text 笔记加 **PDF/Word** 导出（复用 av_synthesis 的 pdf/docx builder）。**若复用成本高（输入结构不匹配），P2 标记为后续，别硬接。**
- **P3**：前端结果页"导出"入口覆盖这些格式（下拉选 md/obsidian/pdf/docx）。

## Step 3 · 验证 + 收尾
- text 笔记、视频 ln 笔记都能导出 md/obsidian（+pdf/docx 若做了），下载的文件能正常打开、内容含详细稿+总结。
- `pytest`(.venv + KMP_DUPLICATE_LIB_OK=TRUE) + `pnpm tsc` 绿；逐项 commit（`feat(k-m5): ...`）；不 push。

---

# 不在 M5 范围
- **同步到本地 Obsidian vault 文件夹**（文件系统写入）→ 单列后续，今天不做。
- 复刻工作包 zip 不动。
- 跨素材/问答 → M4。

---

# 红线 / 纪律
- 复用现有 builder，**不重写导出逻辑**；不破坏复刻工作包 / 字幕 / 批量导出。
- builder 复用不顺就停在 P1（md/obsidian），别为 pdf/docx 硬改 builder。
- 改前先解释；自己跑 pytest/tsc；逐项 commit；不 push；拿不准先问。
