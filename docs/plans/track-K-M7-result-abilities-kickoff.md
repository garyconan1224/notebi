---
title: Track K · M7 结果页补「笔记三能力」（编辑 / AI 问答 / 导出，复用 ln，不动底层分析）
status: ready
owner: xiaomi mimo v2.5-pro
created: 2026-06-04
parent: docs/plans/track-K-M7-kickoff.md
branch: 每子任务独立分支 feat/k-m7-ability-<n>
supersedes: track-K-M7-2-kickoff.md（入口收敛已搁置，原因见下）
ui_source: LearningNotesPage(ln) 现成三能力 + docs/design/components/{text,image,audio,video}_detail.jsx + docs/DESIGN_TOKENS.md
---

> ⚠️ **2026-06-05 部分执行 + 已被新报告覆盖**：本卡 **T1/T2（纯文页 AI 问答 / 在线编辑）已合 main**；**T3–T6 勿继续直推**。结果页方向已升级为「单素材 NoteShell」，先看 [`track-K-M7-result-pages-redesign.md`](track-K-M7-result-pages-redesign.md) 确认后再做（三能力会并入 NoteShell，不再逐页单独补）。

# 0. 方向（重定，必读）

原 M7「统一笔记入口 / 把 text/image/audio 收敛到 note pipeline」**已搁置**，因为 Opus 核实发现：

1. **video+learning 没坏**：视频下载成功后系统自动发起 analyze（`workspaces.py:208`，download→自动 analyze），一直能出学习向分析。mimo 勘验漏看了这一步、误判"只下载不出笔记"。git 也证明这块 M7 没碰。
2. **收敛会降级**：text/image/audio 的专门 handler 有 N10 改写翻译/联想、N9 图片联想/EXIF/复刻词、N8 说话人/音乐分析；`handle_note_task` 没有。把入口收敛到 note 会丢这些功能 + 破结果页。

**新方向（用户决议 2026-06-04）**：**不动底层各类型专门分析，只给现有结果页补上统一的「编辑 / AI 问答 / 导出」三能力**，复用 ln 现成件。

> M7-3 已合并的成果保留有用：`bilibili_opus` 移动端适配器、小红书图文 OCR/VLM、`analyze_image_file` 等仍是有效资产，只是不再强推"主路径收敛到 note"。

---

# 1. 目标（可验证）

四类结果页（文/图/音/视频）+ ln 都支持：① **在线编辑**笔记正文 ② 针对**本篇** AI 问答 ③ **导出**（md/Obsidian/PDF）。全部**复用 ln 现成件**，不重造、不碰底层 handler/分析逻辑。

---

# 2. 现状（三能力盘点，M7-1 勘验过）

| 结果页 | 编辑 | AI 问答 | 导出 |
|---|---|---|---|
| 纯文 `TextResultPage` | ✗ | ✗ | md/Obsidian ✓；PDF ✗ |
| 纯图 `ImageResultPage` | ✗ | ✗ | 隐藏(N11) |
| 纯音频 `AudioResultPage` | ✗ | ✗ | 仅字幕 |
| 纯视频 `VideoResultPage` | ✗ | ✗ | 字幕 + 复刻包 |
| **ln 学习笔记页** | ✓ | ✓ `ChatDrawer` | 多格式 ✓ | ← **复用源** |

---

# 3. 子任务（一个会话一个；先纯文定基准，再三类对齐）

| # | 子任务 | 复用 | 风险 |
|---|---|---|---|
| **T1** 纯文页 AI 问答 | ln 的 `ChatDrawer`（按 systemPrompt 作用域） | 低（最清晰，先做）|
| **T2** 纯文页 在线编辑 | ln 的 `patchLnMarkdown` 模式 | 中（需确认 text 的内容更新接口）|
| **T3** 纯文页 导出补 PDF | `av_synthesis/pdf_builder` 思路写轻量 `build_simple_pdf(md,title)` | 中（确认 pdf 库；python-docx 已装）|
| **T4-T6** 图 / 音 / 视频页对齐三能力 | 同上 | 按纯文基准复制 |

---

# 4. 第一个子任务详展 · T1 纯文页 AI 问答

## 目标
`TextResultPage` 右侧加一个「问答」入口（tab 或抽屉），针对**本篇笔记**做 AI 问答。

## 做法（复用，不重造）
- 接入 ln 的 `ChatDrawer`（`frontend/src/pages/results/LearningNotesPage/ChatDrawer.tsx`），它的接口是 `{ workspaceId, systemPrompt }`、按 `systemPrompt` 锁定上下文。
- `systemPrompt` 用**本篇笔记内容**构造（`result.content` + `result.summary`），作用域=本篇。
- `TextResultPage` 已有 `workspaceId`/`itemId`（`useParams`）+ `getTextItemResult` 产出 → 直接构造 systemPrompt。
- 若 `ChatDrawer` 与 ln 耦合太深不好抽，则抽一个轻量 `<NoteChatDrawer workspaceId systemPrompt />` 共用组件（ln 和结果页都用），**不重写问答逻辑**。

## 验证
- `./dev.sh` 真跑：纯文页打开问答 → 针对本篇内容流式回答。
- 回归：ln 页的 ChatDrawer 仍正常。
- `pnpm tsc` 绿。

---

# 5. 红线 / 纪律
- **只在结果页 UI 加三能力**——不碰底层 `handle_text/image/audio/note_task`、不改任何分析逻辑（保护 N8/N9/N10 专门功能）。
- 复用 ln 现成件优先；改 UI 先读 `DESIGN_TOKENS.md` + 对应 `*_detail.jsx`。
- 一个子任务一个小 commit；`pnpm tsc` + `./dev.sh` 真验；**不主动 push**。
- 不确定（如 ChatDrawer 复用、text 编辑持久化接口）→ 停下问（CLAUDE.md §4）。

---

# 6. 开工话术（复制即用）

```
执行 Track K M7 结果页三能力 · T1（纯文页 AI 问答），先读 docs/plans/track-K-M7-result-abilities-kickoff.md。

启动：git status && git log --oneline -8 对账；从 main 新建 feat/k-m7-ability-1-text-chat；./dev.sh。

任务：给 TextResultPage 右侧加「问答」入口（tab 或抽屉），针对本篇笔记 AI 问答。
- 复用 ln 的 ChatDrawer（frontend/src/pages/results/LearningNotesPage/ChatDrawer.tsx，接口 {workspaceId, systemPrompt}）。
- systemPrompt 用本篇内容构造（result.content + result.summary）；TextResultPage 已有 workspaceId/itemId（useParams）。
- 若 ChatDrawer 与 ln 耦合太深，抽一个轻量共用组件 NoteChatDrawer，别重写问答逻辑。

验证：./dev.sh 真跑，纯文页问答针对本篇流式回答；ln 的 ChatDrawer 仍正常；pnpm tsc 绿。

红线：只动结果页 UI，绝不碰底层 handle_*_task / 分析逻辑；复用优先不重造；改 UI 读 DESIGN_TOKENS + text_detail.jsx；一子任务一 commit；不 push；不确定停下问。
```
