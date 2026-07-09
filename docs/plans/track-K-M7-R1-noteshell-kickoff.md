---
title: Track K · M7 · R1 详细执行卡 —— NoteShell 壳 + 总结风格面板（先接 text）
status: done
owner: 计划=Claude(CC) / 执行=xiaomi mimo v2.5-pro
created: 2026-06-05
parent: docs/plans/track-K-M7-noteshell-execution-plan.md
depends: R0（已 done：note_assembler + GET …/note + getItemNote）
scope: 只动笔记板块；先接 text 一种类型跑通；NoteShell 新页与旧结果页并存（灰度，不删旧路由）；不碰复刻/不装新库
workflow: 一会话一子任务；分支 feat/k-r1-<n>-xxx；CC 验收后再下一子任务
---

# 0. R1 是什么（一句话）

> 抽一个统一笔记壳 `<NoteShell>`，读 R0 的 `GET …/note` 渲染 note.md + 标签概览，把 SummariesTab 收成「总结风格/版本」面板并支持「应用到主笔记」（写 note.md）。**先只接 text 跑通**，作为**新页面与旧 TextResultPage 并存**（灰度），不删旧路由。

# 1. 边界与关键约束

- ✅ **做**：NoteShell 壳（顶栏/概览条/正文区/伴随区）+ 一个后端写接口（note.md 可写）+ 总结风格面板「应用到主笔记」。
- ⛔ **R1 不做**：富文本 WYSIWYG、对照视图（→ R2，要装库）；媒体 inline/companion（→ R3）；image/audio/video 接入（→ R3）；路由收敛 / 删旧页（→ R4）。
- 🚫 **不装新库**：正文渲染复用 `ReactMarkdown`（ln `HtmlView`），源码编辑复用 `CodeMirror`（ln `MdView`）。R1 一旦想引入富文本库 → 停，那是 R2。
- 🟢 **新页并存**：NoteShell 挂新路由 `…/items/:itemId/note`，与 `…/text_detail` 并存；旧 TextResultPage **原样不动**。并存期两者数据源不同（旧页编辑写 `results.content`，NoteShell 编辑写 `note.md`）——这是预期，R4 收敛时旧页退役。

# 2. 已核实的代码事实（省去重新调查）

| 主题 | 事实（file:line） |
|---|---|
| R0 写盘 | `note_assembler.py`：`note_dir(ws,item)`:30、`build_frontmatter`:36、`build_note_md`:170、`assemble_item_note(...,overwrite=True)`:194 |
| **防覆盖（关键）** | `_assemble_note_for_task`（workspaces.py:281，注册在 analyze/text/audio/image SUCCESS 回调）与 `get_item_note`:2857 **都是 `if note.md 存在则 continue/跳过`** → note.md 一旦存在永不被自动覆盖。**R1.1 无需改 assemble 逻辑** |
| 只读 API | `GET /{ws}/items/{item}/note`:2857 → `{frontmatter, source_md, note_md, summaries:[{template,version,path,content}], note_dir}`；解析 frontmatter 靠 `note_md.split("---\n",2)` |
| note.md 格式 | `---\n<yaml>\n---\n<body>`；frontmatter 含 `schema_version/type/title/source_url/created_at/tags/media/layers/version`（version 现为常量） |
| 前端 service/类型 | `getItemNote(ws,item):Promise<ItemNote>`（workspaces.ts:824）；`ItemNote{frontmatter,source_md,note_md,summaries,note_dir}`、`ItemNoteSummary{template,version,path,content}`（types/workspace.ts:120） |
| 路由 | `frontend/src/router.tsx`，lazy import；结果页模式 `workspaces/:workspaceId/items/:itemId/<kind>_detail`（text/audio/video/image）；overview = `…/overview` |
| 结果页 | `pages/result/{Text,Audio,Video,Image}ResultPage.tsx`；`/ln`=`pages/results/LearningNotesPage/`（`HtmlView`=ReactMarkdown 渲染、`MdView`=CodeMirror 编辑、`LNNotesPanel`）；`/av-synthesis`=`pages/results/AVSynthesisResultPage.tsx` |
| 总结 | `SummariesTab.tsx` props=`{workspaceId,itemId}`；service `summaries.ts`：`listSummaries/createSummary/getSummary/deleteSummary`（**无 apply，R1 要加应用到主笔记的前端动作**） |

# 3. 关键设计决策（CC 替你定，有异议告诉 CC）

1. **写接口收口在「正文 body」**：新增 `PUT /{ws}/items/{item}/note`，body = `{ body: <正文 markdown，不含 frontmatter> }`。后端：读现有 note.md → **保留旧 frontmatter 的全部机器字段（tags/media/layers）**，只把 `version+1`、写 `updated_at`、`user_edited: true`，正文换成新 body → 拼回 `---\nyaml---\nbody` 写盘 → 返回完整 note（同 GET 结构）。note.md 不存在则先惰性组装拿 frontmatter 再写。
   - 好处：前端**永不碰 YAML**——编辑器只显示/提交正文 body；frontmatter 全由后端维护。
2. **前端剥离 frontmatter 展示**：getItemNote 拿到整篇 note_md → 前端用字符串 `split('---\n')` 取出 body 给用户看/编辑（不引 YAML 库）。
3. **应用到主笔记 = PUT body**：点某 summary 的「应用到主笔记」→ `getSummary` 取 content → `PUT note {body: content}`。统一走同一个写接口。
4. **R1 正文两态**：`阅读`（ReactMarkdown 渲染）/ `Markdown`（CodeMirror 编辑，1.5s debounce 自动保存）。视图记忆 `localStorage('note-view-mode')`。富文本/对照留 R2。
5. **入口**：TextResultPage 顶部加一个「统一笔记 (beta)」按钮跳 `…/note`，灰度并存；不动其它结果页。

# 4. 子任务分解（一会话一子任务，分支 feat/k-r1-<n>-xxx）

### R1.1 — 后端 note.md 写接口（+ 前端 service）
- 新增 `PUT /{ws}/items/{item}/note`（workspaces.py），按 §3.1 实现：保留旧 frontmatter 机器字段、version+1、updated_at、user_edited=true、换 body、写盘、返回完整 note。note.md 缺失则先 assemble。
- 前端 `workspaces.ts` 加 `putItemNote(ws, item, body): Promise<ItemNote>`。
- 测试 `tests/backend/test_item_note_write.py`：PUT body → GET 读回 body 一致；frontmatter 的 tags/media 保留；version 递增；user_edited=true；note.md 不存在时能创建。
- **验收**：`pytest` 绿；现有 `GET …/note` 不受影响（回归）。纯新增端点，零回归。

### R1.2 — NoteShell 壳骨架 + 路由 + 读渲染 + 概览条
- 新建 `frontend/src/pages/result/NoteShell/`：`index.tsx`（容器，getItemNote 拉数据）+ 顶栏（返回/标题=frontmatter.title/类型徽章=frontmatter.type）+ 概览条（frontmatter.tags 的 6 维+free → chips，可折叠）+ 正文区（`阅读`态：ReactMarkdown 渲染 body，复用 ln HtmlView 模式）+ 伴随区（source.md 只读，可折叠）。
- 路由：router.tsx 加 `workspaces/:workspaceId/items/:itemId/note` → lazy `NoteShell`，与现有并存。
- 入口：TextResultPage 顶部加「统一笔记 (beta)」按钮 → 跳 `…/note`。
- **验收**：`./dev.sh` 真跑，text 素材进 NoteShell 看到 标题/标签 chips/note 正文渲染/source 折叠；`pnpm tsc` 绿；TextResultPage 原样可用（回归）。

### R1.3 — Markdown 编辑保存 + 总结风格面板 + 应用到主笔记
- 正文区加 `Markdown` 态：CodeMirror 编辑 body（复用 ln MdView）+ 1.5s debounce 自动保存 → `putItemNote`（状态：保存中/已保存 HH:mm/失败）；`阅读|Markdown` 切换记忆 `localStorage('note-view-mode')`。
- 伴随区接总结风格面板：复用 `SummariesTab`，加可选 prop `onApplyToNote?(summary)`（旧页不传则按钮不显示，**保证 SummariesTab 在旧结果页回归正常**）；NoteShell 传入实现 = `getSummary→putItemNote(content)`，应用后刷新正文。
- **验收**：`./dev.sh`，text：编辑 note→自动保存→刷新仍在；生成总结→应用到主笔记→note 正文更新；**旧页 SummariesTab 回归正常**；`pnpm tsc` + `pytest` 绿。

### R1.4 — 收口（可并入 R1.3）
- text 端到端验收清单跑一遍（进入/标签/阅读/编辑保存/生成总结/应用/source 对照）。
- 更新 `docs/EXECUTION_PLAN.md` 勾 R1、本文件 frontmatter 标 done、`docs/COMPLETED_WORK.md` 追加。

# 5. R1 总验收（CC 据此验收，通过才展开 R2）
- text 素材能在 NoteShell 完成闭环：进入 → 看标签/正文/source → 阅读/Markdown 切换 → 编辑自动保存 → 生成总结 → 应用到主笔记。
- 写接口保留 frontmatter 机器字段、version 递增；note.md 不被自动分析覆盖。
- **零回归**：TextResultPage、SummariesTab（旧页）、GET note、summary 生成、导出、RAG 全部正常。
- 未装任何新依赖（package.json 无新增）。

# 6. mimo 开工话术（R1.1，复制即用）
```
执行 Track K NoteShell · R1.1（后端 note.md 写接口 + 前端 service）。开工前读 docs/plans/track-K-M7-R1-noteshell-kickoff.md §2/§3/§4。

启动：git status（确认在 main、干净）&& git log --oneline -8 对账；从 main 新建 feat/k-r1-1-note-write。

任务：在 backend/app/routes/workspaces.py 新增 PUT /{workspace_id}/items/{item_id}/note，body={body: 正文markdown(不含frontmatter)}。逻辑：读现有 notes/<item>/note.md→解析旧 frontmatter（保留 tags/media/layers 等全部机器字段）→ version+1、写 updated_at、user_edited=true → 正文换成新 body → 拼回 ---\nyaml---\nbody 写盘 → 返回完整 note（同 GET …/note 结构）。note.md 不存在时先 assemble_item_note 拿 frontmatter 再写。前端 frontend/src/services/workspaces.ts 加 putItemNote(ws,item,body):Promise<ItemNote>。

配测 tests/backend/test_item_note_write.py：PUT→GET body 一致 / frontmatter tags 保留 / version 递增 / user_edited=true / note.md 不存在可创建。

红线：不改 assemble 覆盖逻辑（防覆盖已天然满足，见 §2）；不装新库；不动复刻/其它结果页；KMP_DUPLICATE_LIB_OK=TRUE .venv/bin/python -m pytest tests/backend/test_item_note_write.py -v 自验绿；不 push；收口点/字段不确定停下问。完成贴 pytest 结果 + git diff --stat。
```
