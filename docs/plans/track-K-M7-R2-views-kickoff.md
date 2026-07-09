---
title: Track K · M7 · R2 详细执行卡 —— 笔记正文三视图（阅读 / Markdown / 对照，不装库）
status: done
owner: 计划=Claude(CC) / 执行=xiaomi mimo v2.5-pro
created: 2026-06-05
parent: docs/plans/track-K-M7-noteshell-execution-plan.md
depends: R1（已 done：NoteShell 壳 + 两态 read|edit + putItemNote 自动保存 + 总结风格面板）
decision: 用户 2026-06-05 拍板「先做对照视图，不装库」——R2 不引入 WYSIWYG 富文本库；真·所见即所得编辑器记为 backlog，后续单独评估。
scope: 纯前端；零新依赖；就地在 NoteShell/index.tsx 扩 read|edit → read|edit|compare；不打散 R1 已验证的保存逻辑；不碰复刻/后端/其它结果页
workflow: 一会话一子任务；分支 feat/k-r2-<n>-xxx；CC 验收后再下一子任务
---

# 0. R2 是什么（一句话）

> 把 NoteShell 正文区从「阅读 | Markdown」两态扩成「阅读 | Markdown | **对照**」三态。**对照** = 桌面宽屏左右分栏：左 CodeMirror 改 md、右 ReactMarkdown 实时看带图渲染。**不装任何库**（复用 R1 现有 `react-markdown` + `@codemirror/*`）。窄屏自动降级回两态。

**范围调整说明**：redesign 原把 R2 定义为「富文本 WYSIWYG / Markdown / 对照」三视图。用户 2026-06-05 选「先做对照、不装库」→ **R2 去掉 WYSIWYG**，只做对照视图。真·所见即所得（Tiptap/Milkdown 那种）= **backlog，后续单独评估**（届时仍要走装库红线确认）。

# 1. 边界与关键约束

- ✅ **做**：正文三态切换（read|edit|compare）+ 对照分栏（左编辑右预览，共享同一份 body）+ 窄屏降级。
- 🚫 **不装库**：复用 `react-markdown`（预览）+ `@codemirror/*`（编辑）。**R2 一旦想装 tiptap/lexical/milkdown/prosemirror → 停，回来找用户**（那是 backlog，不是 R2）。
- ⛔ **不动**：R1 的保存逻辑（`doSave`/debounce/applying flag）、后端、复刻、其它结果页、总结风格面板、概览条、伴随区。
- 🟢 **surgical**：就地在 `NoteShell/index.tsx` 扩展，不为此重构/打散 R1 已验证代码（真正组件化留 R3 媒体期再做）。

# 2. 已核实的代码事实（R2 直接改动对象）

`frontend/src/pages/result/NoteShell/index.tsx`（460 行，单文件）：

| 锚点 | 位置 | 现状 |
|---|---|---|
| 视图类型 | :57 | `type ViewMode = 'read' \| 'edit'`（read=阅读 / edit=Markdown 编辑） |
| 视图记忆 | :55 | `VIEW_MODE_KEY = 'nibi-note-view-mode'` |
| CodeMirror 封装 | :73 | `NoteEditor({ markdown, onMarkdownChange })`——R2 对照态左侧直接复用它 |
| 预览 | :17 | `import ReactMarkdown`；正文区 `<ReactMarkdown remarkPlugins={remarkPlugins}>` :438——对照态右侧直接复用 |
| 主组件 | :231 | `NoteShell()` |
| 视图 state | :244 | `useState<ViewMode>`，从 localStorage 读（`saved === 'edit' ? 'edit' : 'read'`） |
| 编辑数据源 | :251 | `editingBody`——对照态左右共享的**单一数据源** |
| 自动保存（不动） | :276/:296 | `doSave`(putItemNote) + `handleEditorChange`(1.5s debounce) + applying flag :307 |
| 切换函数 | :328 | `switchView(mode)`：setViewMode + localStorage |
| 切换按钮 UI | :380 | `(['read','edit'] as ViewMode[]).map(...)`，标签 `m==='read'?'阅读':'Markdown'` |
| 正文区 | :434-443 | `viewMode==='read' ? <ReactMarkdown> : <NoteEditor>` |
| 依赖 | package.json | 已装 `react-markdown`/`@codemirror/*`/`remark-gfm`/`rehype-*`；**未装** tiptap/lexical/milkdown（R2 保持不装） |

> ⚠️ **测试基线**：R1.4 收口记录 vitest 有 **14 个既有 fail**（基线）。R2 验收标准 = **不新增 fail**（前后都是 14），不要求修既有 14。

# 3. 关键设计决策（CC 替你定）

1. **三态就地扩**：`ViewMode` 加 `'compare'`；切换按钮数组 `['read','edit','compare']`，标签 `阅读 | Markdown | 对照`。
2. **对照视图就地实现**：在 index.tsx 内新增一个小组件 `CompareView`（与 `NoteEditor` 并列，不新建跨文件依赖）：左 = `<NoteEditor markdown={editingBody} onMarkdownChange={handleEditorChange} />`，右 = `<ReactMarkdown remarkPlugins={remarkPlugins}>{editingBody}</ReactMarkdown>`，CSS 左右各 50%。
   - 关键：左右共享 `editingBody` + `handleEditorChange` → **保存逻辑完全复用 R1，不新增任何 save 代码**。左边改 = 右边实时变 = 1.5s 后自动存。
3. **窄屏降级**（§4.5.2「对照只在宽屏」）：用 `matchMedia('(min-width: 1024px)')` 判断。窄屏：① 切换条不渲染「对照」按钮；② 若 localStorage 存的是 `compare` 但当前窄屏 → 进页时 fallback 到 `read`（避免窄屏卡在对照态）。
4. **视图记忆兼容三值**：读取时 `['read','edit','compare'].includes(saved) ? saved : 'read'`（且叠加 §3.3 的窄屏 fallback）。
5. **对照对象**：R2.1 只做「md 源码 ↔ 渲染预览」（同一份 note body）。「note ↔ source 看原文」作为 R2.2 可选增强。

# 4. 子任务分解（一会话一子任务，分支 feat/k-r2-<n>-xxx）

### R2.1 — 对照视图 + 三态切换 + 窄屏降级（核心，一个子任务可完成）
- `NoteShell/index.tsx`：`ViewMode` 加 `'compare'`；切换按钮加「对照」；正文区加 `viewMode==='compare'` 分支 → `<CompareView>`；新增 `CompareView` 小组件（§3.2）；`matchMedia` 窄屏降级（§3.3）；localStorage 读取兼容三值（§3.4）。
- 不动 `doSave`/`handleEditorChange`/applying/后端/总结面板。
- **验收**：`./dev.sh` 真跑——三态可切；对照态左改→右实时预览；对照态编辑 1.5s 自动保存（「已保存」状态出现）、刷新仍在；窄屏（<1024px）无「对照」按钮、不卡死；`pnpm tsc` 绿；vitest **不新增 fail**（仍 14）；回归 R1：阅读/Markdown/应用到主笔记/概览条/source 折叠全部正常。

### R2.2 — 收口（+ 可选增强，可并入 R2.1）
- 可选增强：对照右栏加一个「预览 ↔ source 原文」小切换（看原文调格式，§4.5.1），数据来自 R1 已有的 `source_md`，只读。**做不做都行，不影响 R2 验收主线**。
- 文档收口：更新 `docs/EXECUTION_PLAN.md` 勾 R2、本文件 frontmatter 标 done、`docs/COMPLETED_WORK.md` 追加；execution-plan §2 R2 行注明「WYSIWYG 改 backlog」。

# 5. R2 总验收（CC 据此验收，通过才展开 R3）
- 三态（阅读/Markdown/对照）切换正常并记忆；对照左改右实时预览、自动保存、刷新保持。
- 窄屏自动降级两态、不卡死。
- **零回归**：R1 全部闭环（编辑保存/应用到主笔记/总结面板/概览条/source）、其它结果页、后端均正常。
- **零新依赖**（package.json 无新增）；vitest 不新增 fail。

# 6. mimo 开工话术（R2.1，复制即用）
```
执行 Track K NoteShell · R2.1（对照视图 + 三态切换 + 窄屏降级，不装库）。开工前读 docs/plans/track-K-M7-R2-views-kickoff.md §2/§3/§4。

启动：git status && git log --oneline -8 对账；从 main 新建 feat/k-r2-1-compare-view。

任务：只改 frontend/src/pages/result/NoteShell/index.tsx。① type ViewMode 加 'compare'；② 切换按钮数组改 ['read','edit','compare']，标签 阅读|Markdown|对照；③ 正文区加 viewMode==='compare' 分支，渲染新增的 CompareView 小组件（就地定义，与 NoteEditor 并列）：左=<NoteEditor markdown={editingBody} onMarkdownChange={handleEditorChange}/>，右=<ReactMarkdown remarkPlugins={remarkPlugins}>{editingBody}</ReactMarkdown>，左右各占 50%；④ matchMedia('(min-width:1024px)') 窄屏降级：窄屏不渲染「对照」按钮、且 localStorage 存了 compare 时进页 fallback 到 read；⑤ localStorage 读取兼容三值。

红线：不装任何库（只用现有 react-markdown + @codemirror）；不动 doSave/handleEditorChange/applying/后端/总结面板/其它结果页；对照左右共享 editingBody+handleEditorChange，不新增 save 逻辑。

自验：./dev.sh 跑起，手测三态切换+对照左改右变+对照态自动保存+刷新保持+窄屏无对照不卡；pnpm -C frontend tsc -b 绿；vitest 不新增 fail（既有 14 基线）。不 push；不确定停下问。完成贴 tsc 结果 + git diff --stat + 一句手测结论。
```
