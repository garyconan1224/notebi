---
title: Track K · M7 NoteShell 五期执行计划（R0–R5；R0 已展开，R1–R5 概览）
status: done            # R0 已完成（R0.1+R0.2+R0.3）
owner: 计划=Claude(CC) / 执行=xiaomi mimo v2.5-pro
created: 2026-06-05
completed_date: 2026-06-05
parent: docs/plans/track-K-M7-result-pages-redesign.md
decisions: |
  用户 2026-06-05 拍板：
  ① md 底座走「后端归一化」（治本）
  ② frontmatter schema 用本计划的 v1 草案（CC 细化）
  ③ 先把单素材内容流跑通；/ln + /av-synthesis 能力合并放最后（R4）
scope: 只动「笔记板块」；不碰复刻/提示词/复刻包/AI导演/图片批量；多素材综合后置；不破坏现有结果页 / 任务流 / RAG / 导出
workflow: 一会话一子任务；每期独立分支；CC 出计划 → mimo 执行 → CC 验收 → 再展开下一期
---

# 0. 怎么用这份文档

- 本文 = NoteShell 重构的**执行总纲 + R0 可执行卡**。
- **R0 已展开到 mimo 可直接做**；R1–R5 只给「目标 / 产出 / 验收」概览，**待 R0 完成后由 CC 逐期展开**（项目铁律 §5：pending phase 不自作主张展开操作步骤）。
- 节奏：CC 出 R0 → 你交 mimo 执行 → CC 验收 R0 → CC 展开 R1 → 依次类推。

---

# 1. 全局边界与红线（贯穿 R0–R5）

- ✅ **只动**：text / image / audio / video 单素材的**笔记向产出**，统一到 `source.md + summaries/* + note.md + frontmatter` + 统一 NoteShell。
- ❌ **不动**：复刻流程 / 复刻结果页 / 提示词 / 复刻包 / AI 导演 / 图片批量 —— 独立线，与笔记无关。
- ⏸ **后置**：多素材综合 / 工作区综合。
- **不破坏现有**：现有结果页、任务流、summary 生成、RAG 问答、导出在每一期都必须保持可用（每期验收含回归）。
- **执行纪律**：一会话一子任务；每子任务一小 commit；`pnpm tsc` + `pytest` + 关键路径手测；**不主动 push**；不确定停下问（CLAUDE.md §4）。

---

# 2. 五期总纲

| 期 | 名称 | 一句话 | 主产出 | 依赖 |
|---|---|---|---|---|
| **R0** | md 内容底座归一化（后端·生产侧） | 把每个单素材的 results/tags/summaries **序列化**成规范 `source.md + note.md + frontmatter`，落盘 + 只读 API | `note_assembler` 服务、per-item 目录约定、frontmatter schema v1、`GET …/note` API | — |
| **R1** | NoteShell 壳 + 总结风格面板（前端骨架） | 抽 `<NoteShell>` 统一壳，读 R0 产物渲染 note.md；SummariesTab 收成「总结风格/版本」面板，支持「应用到主笔记」 | NoteShell 组件族、总结风格面板、应用到 note.md；先接 **text** 一种类型跑通 | R0 |
| **R2** | 富文本 / Markdown / 对照 三视图 | note.md 的三种视图，保存只写 md（WYSIWYG 需装库，§4 红线，开工前确认选型） | NoteBodySwitcher / WysiwygEditor / MarkdownSourceView / SplitCompareView | R1 |
| **R3** | 媒体伴随 + 四类型全接入 | 图片 inline 嵌正文；音视频 companion 伴随区（播放器+转录轴+时间戳联动，复用 /ln 组件）；image/audio/video 接入 | 媒体 inline/companion 组件、四类型全接入 NoteShell | R1（建议 R2 后） |
| **R4** | 删中转 + 路由收敛 + 能力合并 | 列表直达 NoteShell；/overview 下沉成概览条；**/ln 与 /av-synthesis 能力并入统一路由**，旧路由重定向 | 路由收敛、列表直达、旧页重定向 | R3 |
| **R5** | 增强（按需） | `note.html + assets` 离线导出（从 md 单向渲染）、时间戳跳转完善；脑图/关系图远期不做 | html 导出、导出菜单按目标软件给格式 | R4 |

> 严格串行 R0→R1→…→R5。每期完成、CC 验收通过后，CC 才展开下一期的可执行步骤。

---

# 3. R0 详细执行计划（mimo 可直接执行）

## 3.1 R0 是什么（一句话）

> **R0 = 序列化快照层。** 把已经存在于 `WorkspaceItem`（`results` / `tags` / `summaries`）里的数据，按统一 schema **组装成 md 文件落盘**，并提供只读 API。**不重新分析、不调 LLM、不改任何现有消费方。**

**为什么安全**：
- 只**新增**一个服务 + 一个只读 API + 落盘文件；不修改 summary 生成 / RAG / 导出 / 现有结果页的读取路径（它们继续吃 `item.results`）。
- 组装失败 best-effort（try/except + 日志），**绝不阻断 item 分析主流程**。
- `note.md` 在 R0 阶段是 `results` 的「md 投影」，可随时重新组装；编辑仍走现状（T2 写 `results.content`），**不存在覆盖用户编辑的冲突**。真正的「直接编辑 note.md」推迟到 R2。

## 3.2 已核实的代码事实（省去重新调查）

| 主题 | 事实（file:line） |
|---|---|
| 数据模型 | `backend/app/models/workspace.py`：`ItemType`(video/audio/image/text):33；`ItemSummary`(summary_id/template/version/content_md):110；`WorkspaceItem`(item_id/type/source/source_value/name/status/**results**/**tags**/**summaries**/**inline_frames**/created_at):162；`InlineFrame`(frame_path 相对 ws 根):137 |
| 存储 | `WorkspaceStore` `workspace_store.py:64`；`update_item():176`；`add_item_summary():264`。`get_workspace_root(ws_id)` `shared/config.py:54`；`WORKSPACE_DIR = DATA_DIR/"workspaces"` |
| handler | `pipeline_tasks.py`：`handle_note_task:1527`（**视频笔记走这里**，1546 处理 `video_url`）；`handle_text_task:2274`；`handle_image_task:2571`；`handle_audio_task:2924` |
| 现有 md 落盘 | text 产物 `data/workspaces/<pid>/text/<task_id>.md+.json`（docstring）；note `runtime_dir/{task_id}.md`(1151)；`av_synthesis.md`、`ln.md` 都在 `workspace_root/`（**workspace 级**，R0 改 **item 级**） |
| 各类型 results 关键字段 | text:`content`+`summary`；video:`frames[]`+`transcript[]`+`summary`；audio:`transcript`+`transcript_segments`+`summary`；image:`description`+`ocr_text` |
| 总结 | `summary_templates.py`(14 模板)；`summary_generator.py`(吃 `results.transcript→content→summary`)；`SummariesTab.tsx`；summaries 存在 `item.summaries`（List[ItemSummary]，随 record JSON 持久化） |
| 消费侧（R0 **不动**） | `chat_context._format_results`（按 type 临时拼）、`rag_qa_service.py`、`routes/export.py`（导出时已临时写过 `source.md`） |

## 3.3 关键设计决策（CC 替你定，按授权②；如有异议告诉 CC）

1. **R0 只做生产侧**：消费侧（summary / RAG / export / 现有页）**这一期完全不切换**到 md，仍走 `results`。切换放到 R1+。→ 保证 R0 零回归。
2. **per-item 目录**：`get_workspace_root(ws)/ "notes" / {item_id}/`，用 **item_id**（用户视角稳定），不用 task_id。
3. **触发**：item 状态进 DONE 后自动组装一次（best-effort）；另提供幂等函数 `assemble_item_note(ws, item_id)` 可重复调用；API 读取时若目录不存在则**惰性组装**一次（覆盖历史 item，免写迁移脚本）。
4. **note.md 初始正文** = 当前主体全文（text=content；audio/video=transcript 拼可读 md；image=OCR/description）。summaries 是另一层，**不自动并入 note.md**（用户在 R1 才「应用到主笔记」）。
5. **source.md** = 原始依据（同上来源，偏只读）。R0 阶段 text 的 source.md 与 note.md 内容可能相同——这是预期（note 是可编辑副本，source 供追溯）。

## 3.4 目录约定 + frontmatter schema v1

**落盘结构（per-item）**：
```
<workspace_root>/notes/<item_id>/
├── note.md                 # frontmatter(YAML) + 主笔记正文（当前主体全文）
├── source.md               # 原始依据（OCR / transcript / 原文），偏只读
├── summaries/
│   └── <template>/v<n>.md   # 由 item.summaries 序列化（template+version）
└── assets/                 # R0 先建空目录占位；媒体引用统一相对路径，R3 落地
```

**frontmatter schema v1**（写进 `note.md` 顶部；mimo 落地时以此为准，字段拿不到就省略或留空）：
```yaml
---
schema_version: 1
id: <item_id>
workspace_id: <ws_id>
type: video | audio | image | text
title: <item.name>
source_url: <item.source_value，当 source==url>
created_at: <item.created_at>
tags:                         # 直接序列化 item.tags（已是 6维+free 结构）
  content_type: ...
  domain: ...
  difficulty: ...
  duration_tier: ...
  density: ...
  tone: ...
  free: [...]
media:                        # 按 type 从 results / inline_frames 尽力提取；拿不到留空
  images: [assets/...]
  audio: assets/...
  video: { path: assets/..., duration: <sec> }
  frames: [{ sec: <int>, path: assets/frame_xxx.png }, ...]
layers:
  source: source.md
  note: note.md
  summaries: [summaries/<template>/v<n>.md, ...]
exports:
  html: note.html            # R5 才真正生成；R0 仅占位字段
version: 1                    # note.md 编辑版本号（R0 固定 1，R2 起递增）
---
```

## 3.5 子任务分解（一会话一子任务，分支 `feat/k-r0-<n>-xxx`）

### R0.1 — schema + note_assembler 核心（纯函数 + 单测，不接任何现有流程）
- 新建 `backend/app/services/note_assembler.py`：
  - `note_dir(ws_id, item_id) -> Path`
  - `build_frontmatter(item, ws_id) -> dict`（schema v1）
  - `build_source_md(item) -> str` / `build_note_md(item, frontmatter) -> str`（按 `item.type` 取来源，见 §3.3.4/5）
  - `serialize_summaries(item) -> list[Path]`（把 `item.summaries` 写成 `summaries/<template>/v<n>.md`）
  - `assemble_item_note(ws_id, item_id, *, overwrite=True) -> dict`（组装 + 落盘，返回各路径）
- 新建 `tests/backend/test_note_assembler.py`：构造 4 类型假 `WorkspaceItem`（含 tags/summaries）→ 断言：目录与文件生成、frontmatter 关键字段正确、note/source 正文非空、summaries 按 template/version 落盘、重复调用幂等。
- **验收**：`pytest tests/backend/test_note_assembler.py` 绿。纯新增模块，**零回归**（不被任何现有代码引用）。

### R0.2 — 接 handler 自动触发 + 只读 API + 前端 service
- 在 item 分析完成处调用 `assemble_item_note`（best-effort，try/except 包裹，失败只记日志不抛）。优先选**统一收口点**（如 `update_item(status=DONE)` 处）；若无统一点，则在 4 个 handler 收尾各加一行。mimo 落地前先确认收口点，不确定停下问。
- 新增 `GET /workspaces/{ws}/items/{item}/note` → `{frontmatter, source_md, note_md, summaries:[{template,version,path,content}], note_dir}`；目录不存在则**惰性 assemble 一次**再返回（覆盖历史 item）。
- 前端 `frontend/src/services/workspaces.ts` 加 `getItemNote(ws, item)` + 类型（**仅加 service，不接 UI**，UI 留给 R1）。
- **验收**：`./dev.sh` 真跑，分析 1 个 text + 1 个 video → `<ws>/notes/<item_id>/` 出现规范文件；`curl GET …/note` 读到正确 frontmatter/note/source；**回归**：text/video 结果页、SummariesTab、导出、RAG 问答全部正常；`pnpm tsc` + 相关 `pytest` 绿。

### R0.3 — 文档收口（可并入 R0.2）
- frontmatter schema v1 在本文件定稿（如落地有调整，回写本文件 §3.4）。
- 更新 `docs/EXECUTION_PLAN.md` 勾选 R0、本文件 frontmatter 标 R0 done、`docs/COMPLETED_WORK.md` 追加。
- **验收**：老 workspace 的 item 调 `…/note` 能惰性生成；三处文档更新到位。

## 3.6 R0 总验收（CC 据此验收，通过才展开 R1）
- 四类型素材（text/image/audio/video）都能产出规范 `source.md + note.md + frontmatter(+summaries/*)`，`…/note` API 可读。
- frontmatter 字段与 §3.4 一致；media/tags 尽力填充、缺失不报错。
- **所有现有功能零回归**（结果页 / summary / 导出 / RAG / 任务流）。
- assemble 失败不阻断分析主流程（人为构造异常验证 best-effort）。

## 3.7 mimo 开工话术（R0.1，复制即用）
```
执行 Track K NoteShell · R0.1（note_assembler 核心 + 单测），先读 docs/plans/track-K-M7-noteshell-execution-plan.md §3。

启动：git status && git log --oneline -8 对账；从 main 新建 feat/k-r0-1-note-assembler。

任务：新建 backend/app/services/note_assembler.py，把 WorkspaceItem(results/tags/summaries) 按 §3.4 schema v1 序列化成 source.md + note.md + summaries/* 落盘到 <ws_root>/notes/<item_id>/，纯函数，不接任何现有流程。配套 tests/backend/test_note_assembler.py 覆盖四类型 + 幂等。

红线：不调 LLM、不改分析/ summary/RAG/导出/现有结果页；纯新增模块；KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest 自验绿；不 push；不确定（如收口点/字段来源）停下问。
```

---

# 4. R1–R5 概览（待 R0 验收后由 CC 逐期展开）

- **R1 NoteShell 壳**：抽 `<NoteShell>`（顶栏/概览条/正文区/伴随区骨架）读 `…/note` 渲染 note.md；SummariesTab → 「总结风格/版本」面板 + 「应用到主笔记」（写 note.md，此时编辑/消费开始切向 note.md）。**先只接 text** 跑通，新页面与旧结果页并存（灰度，不删旧路由）。
- **R2 三视图**：富文本(WYSIWYG)/Markdown/对照，保存只写 md。⚠️ 进 R2 前单独确认 WYSIWYG 选型（Tiptap/Lexical/Milkdown/Toast UI，§4 装包红线）。移动端降级二态。
- **R3 媒体 + 全接入**：图片 inline、音视频 companion（复用 ln 的 LNVideoPanel/LNTranscriptPanel + 时间戳联动）；image/audio/video 接入；只接笔记向字段，复刻向不进壳。
- **R4 路由收敛 + 能力合并**：列表直达 NoteShell、/overview 下沉、**/ln 与 /av-synthesis 能力并入统一路由 + 旧路由重定向**（用户指定放最后）。
- **R5 增强**：`note.html+assets` 从 md 单向渲染的离线导出、导出菜单按目标软件给格式、时间戳跳转完善；脑图/关系图远期不做。
