---
title: Track K · Milkdown 所见即所得编辑器集成（三阶段）
status: ready
owner: Claude 桌面定方案 → 小米 v2.5pro 终端执行 → Codex 审查
depends_on: spike/milkdown-editor 选型验证（commit 3277e25 · /test-editor 校验通过）
created: 2026-06-12
scope: 仅视频结果页 NoteShell 编辑器；不动音频/图片/文本结果页
---

# Track K · Milkdown 集成三阶段计划

> 📌 本计划只负责一件事：在**视频结果页 NoteShell** 把编辑体验从「只读富文本 + CodeMirror 源码」升级为 **Milkdown 所见即所得**，分三步渐进，每一步都可独立验收、独立 commit。
> 全程**不碰** md 源码编辑、源 md 对照、导出能力，更不碰非视频结果页 / 复刻 / RAG / 数据库 / 鉴权。

---

## 0. 一句话目标

视频笔记编辑器从「富文本只读渲染（ReactMarkdown）+ md 源码（CodeMirror）」升级到 **Milkdown 所见即所得直接编辑**：
**阶段一**先把 Milkdown 作为新增模式接通自动保存（旧富文本不删）；**阶段二**在 Milkdown 内实现 `[mm:ss]` 点击跳转视频；**阶段三**时间码验证通过后，移除旧的富文本只读模式。

---

## 1. 背景与产品目标

### 背景
- 视频结果页 NoteShell 现在中列提供三个标签：**富文本**（`read`，ReactMarkdown 只读渲染，含时间码点击跳转）、**md格式**（`edit`，CodeMirror 编辑源码）、**源md对照**（`compare`，左 CodeMirror + 右预览/源 md）。
- 「富文本」只能看不能改，用户要改内容必须切到「md格式」面对裸 markdown 语法——对编程新手用户不友好。
- 已在 `spike/milkdown-editor` 分支完成 Milkdown 选型验证（`/test-editor` 页，commit `3277e25`）：渲染、GFM（表格/任务列表/删除线）、内联图片、代码高亮、中文输入、~3000 字大文档性能、时间码链接均通过。

### 产品目标
1. 用户在视频笔记里能像写 Notion 一样**直接所见即所得编辑**，不用面对 markdown 符号。
2. 时间码 `[mm:ss]` 在所见即所得模式下仍可**点击跳转视频**（与现在富文本一致）。
3. 升级**不丢失**任何现有能力：md 源码编辑、源 md 对照、导出 md / Obsidian 包、自动保存。
4. 渐进切换、可回退：每阶段独立 commit，时间码没验证通过前**绝不**删旧富文本。

---

## 2. 现状锚点（已查证，小米不必再查）

| 项 | 事实 | 位置 |
|---|---|---|
| Milkdown 依赖 | `@milkdown/{core,ctx,react,preset-commonmark,preset-gfm,plugin-listener,plugin-prism,theme-nord,prose,transformer}` 全部 **7.21.2 已安装** | `frontend/package.json:20-29` |
| CodeMirror 依赖 | `@codemirror/*` + `codemirror` 已安装 | `frontend/package.json:14-37` |
| 选型验证页 | Milkdown 可用配置范本（commonmark+gfm+prism+listener+nord） | `frontend/src/pages/TestEditorPage.tsx`，路由 `/test-editor`（`router.tsx:91-92`，dev 用，注明「验证通过后删除」） |
| 主组件 | NoteShell 视频笔记壳，1142 行 | `frontend/src/pages/result/NoteShell/index.tsx` |
| 三种模式 | `type ViewMode = 'read' \| 'edit' \| 'compare'`；标签 `read=富文本 / edit=md格式 / compare=源md对照` | `index.tsx:95`、`:255-259` |
| 现有 CodeMirror 编辑器 | `NoteEditor`（轻量 CodeMirror，外部 md 变化时在 `useEffect` 里 re-seed） | `index.tsx:269` 起、re-seed 见 `:307` |
| 对照视图 | `CompareView` 左编辑右预览，右栏可切 source；**右预览是纯 ReactMarkdown，无时间码 chip** | `index.tsx:329`、`:359-366` |
| 自动保存 | `handleEditorChange(md)` → `setEditingBody` + debounce **1500ms** → `doSave` → `putItemNote(workspaceId,itemId,body)`；状态 `idle/saving/saved/failed` | `index.tsx:590-618`，状态条 `:989-991` |
| 时间码跳转 | **仅 `read` 模式**：`renderNoteTimestampChildren(children,onSeek)` 遍历 ReactMarkdown 渲染结果，命中正则 → 渲染 `.ln-ts-chip` 按钮 → `onSeek(sec)` | `index.tsx:175-237`，挂载点 `:954 onSeek={handleSeek}` |
| 时间码正则 | `TS_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)(?:~(\d{1,2}:\d{2}(?::\d{2})?))?\]/g`，配 `parseTs` | 定义在 `frontend/src/pages/results/LearningNotesPage/HtmlView.tsx:11`，NoteShell `import` 复用 |
| seek 接线 | `handleSeek(sec)` → `videoRef.current?.seekTo(sec)` + `mediaCompanionRef.current?.seekTo(sec)` | `index.tsx:545-546`、`:666-667` |
| 导出 | `exportItemNoteObsidian` + `downloadMarkdownFile`（导出 md 文件） | `import` 自 `@/services/workspaces`（`index.tsx:27`） |
| 测试范式 | vitest + @testing-library/react，已有 `renderNoteTimestampChildren` 单测 | `frontend/src/__tests__/NoteShellTimestamp.test.tsx`（33 行），命令 `cd frontend && npm test`（= `vitest run`） |

### ⚠️ 阶段二的核心差异（必须记住）
- **真实笔记正文里时间码是裸文本** `[mm:ss]` / `[mm:ss~mm:ss]`（被 `TS_RE` 匹配）。
- **选型页 `/test-editor` 用的是 markdown 链接** `[00:30](timestamp://30)`——那只是 spike 里方便验证的写法，**不是**线上笔记格式。
- ⇒ 阶段二**不能**把笔记内容改成 `timestamp://` 链接形式（会改变保存的 md、破坏 md格式/源md对照/导出）。必须在保持 md 字节不变（仍是裸 `[mm:ss]`）的前提下，让 Milkdown 把它显示成可点击 chip。

---

## 3. 全程必须保留（红线级，三阶段都不许动）

1. **md格式（CodeMirror 源码编辑）** —— `edit` 模式，保留。
2. **源md对照（CompareView）** —— `compare` 模式，保留。
3. **导出 md / 导出 Obsidian 包** —— `downloadMarkdownFile` / `exportItemNoteObsidian`，保留。
4. **自动保存管线** —— debounce 1500ms → `putItemNote`，**复用**，不许新建第二套保存逻辑。
5. **保存的 markdown 字节兼容** —— 时间码始终以裸 `[mm:ss]` 存盘；不得因为编辑器换了就改变落盘格式。

---

## 4. 三阶段范围

### 阶段一：新增 Milkdown 所见即所得模式（富文本不删，接通自动保存）

**目标**：在 NoteShell 中列新增第 4 个标签「所见即所得」（Milkdown 可编辑），与现有富文本/md格式/源md对照并存；Milkdown 内容变化复用现有 debounce 自动保存。本阶段**不做**时间码点击跳转（裸 `[mm:ss]` 在 Milkdown 里先按普通文本显示即可）。

**涉及文件（≤4 个，不触发 §4 跨 5 文件红线）**
- 新增 `frontend/src/pages/result/NoteShell/MilkdownEditor.tsx`：封装 spike 的可用配置（commonmark+gfm+prism+listener+nord），props 形如 `{ markdown, onMarkdownChange }`，把 `listenerCtx.markdownUpdated` 接到 `onMarkdownChange`。
- 改 `frontend/src/pages/result/NoteShell/index.tsx`：
  - `ViewMode` 增加 `'wysiwyg'`；`videoViewModeLabels` 增加 `wysiwyg: '所见即所得'`。
  - 标签切换 UI 增一个按钮；渲染分支：`viewMode === 'wysiwyg'` 时渲染 `<MilkdownEditor markdown={editingBody} onMarkdownChange={handleEditorChange} />`（**复用** `handleEditorChange` → 复用自动保存）。
  - **不改** read/edit/compare 三个分支，`read` 仍是默认。
- （可选）新增一个 Milkdown 主题覆盖 css 文件，或沿用 spike 的内联 `<style>`；优先内联，少加文件。

**验收标准**
1. 切到「所见即所得」标签，正文以渲染态显示，可直接打字编辑（含中文 IME 不串字）。
2. 编辑后状态条出现「保存中…→已保存 HH:mm」；**刷新页面内容仍在**（落盘成功）。
3. 在「所见即所得」改完切到「md格式」/「源md对照」，看到的是同一份最新内容（editingBody 一致，无丢字）。
4. 富文本/md格式/源md对照/导出 md/导出 Obsidian **全部照旧可用**，行为无回归。
5. `cd frontend && npm test` 全绿；`npm run build` 通过（Milkdown 体积不报错）。

**风险与缓解**
- **re-seed 死循环 / 光标跳动**：Milkdown 是非受控 ProseMirror，每次按键都重设 `defaultValue` 会丢光标或触发保存循环。缓解：只在「进入 wysiwyg 模式」或「note 标识/外部刷新（应用到主笔记）」时 re-seed，平时不重设；参考现有 `NoteEditor` 的 `useEffect` re-seed 套路（`index.tsx:307`）与 `applyingRef` 守卫。建议用 `key={noteId + seedVersion}` 让需要时干净重挂、平时不重挂。
- **初次挂载误触发保存**：`markdownUpdated` 首帧可能携带初值触发一次 `doSave`。缓解：复用现有 `applyingRef` 或加「首帧跳过」标记，避免打开页面就写一次盘。
- **主题 css 外泄**：nord 样式污染外层。缓解：样式限定在 `.milkdown` 作用域内（沿用 spike 写法）。

**本阶段红线**
- ❌ 不删 / 不改 富文本、md格式、源md对照、导出。
- ❌ 不新建第二套保存逻辑（必须复用 `handleEditorChange`/`doSave`）。
- ❌ 不装新依赖（Milkdown 全家桶已在 `package.json`）。
- ❌ 不动音频/图片/文本结果页、不动 router 其它路由。

---

### 阶段二：Milkdown 内实现 `[mm:ss]` 点击跳转

**前置**：阶段一已合并、所见即所得编辑+自动保存验收通过。

**目标**：在「所见即所得」模式下，正文中的裸 `[mm:ss]` / `[mm:ss~mm:ss]` 显示为可点击 chip，点击调用与富文本同一个 `handleSeek(sec)` 跳转视频；**且保存的 markdown 仍是裸 `[mm:ss]`，md格式/源md对照/导出完全不变**。

**推荐方案（务必先确认再写）**
- **方案 A（推荐）：ProseMirror 插件 + 行内 Decoration。** 写一个 Milkdown/ProseMirror 插件，扫描文本节点命中 `TS_RE`，对命中区间挂 **inline decoration**（加 class / widget）使其可点击 → `onSeek(parseTs(ts))`。Decoration **不修改文档模型**，所以序列化回 markdown 天然还是裸 `[mm:ss]`，round-trip 零风险。复用 `TS_RE`/`parseTs`。
- **方案 B（不推荐）：自定义 inline node + inputrule + remark 序列化**。要把 `[mm:ss]` 变成自定义节点再序列化回去，改动大、round-trip 易回归。仅在方案 A 实测不可行时才考虑，且需先报告。
- ❌ **禁止**把笔记内容转成 spike 里的 `[00:30](timestamp://30)` 链接形式（会改变落盘 md）。

**涉及文件（≤4 个）**
- 新增 `frontend/src/pages/result/NoteShell/milkdownTimestamp.ts`：ProseMirror decoration 插件，入参 `onSeek`。
- 改 `MilkdownEditor.tsx`：注册该插件，新增 prop `onSeek` 透传。
- 改 `index.tsx`：`<MilkdownEditor ... onSeek={handleSeek} />`。
- 新增/扩展测试：`frontend/src/__tests__/` 下加 Milkdown 时间码用例（参考 `NoteShellTimestamp.test.tsx` 范式），覆盖「命中 `[mm:ss]` → 点击触发 onSeek(秒数正确)」与「代码块内不命中」。

**验收标准**
1. 所见即所得模式下，`[01:30]` / `[01:30~02:00]` 显示为可点击 chip，点击后视频/媒体跳到对应秒（`handleSeek` 生效）。
2. 在 chip 前后打字、删除不破坏文本，不残留脏字符。
3. 改完保存后切「md格式」「源md对照」，时间码仍是**裸 `[mm:ss]`**（diff 对比落盘前后字节，时间码部分不变）；导出 md 同样是裸文本。
4. 代码块 / 行内代码里的 `[mm:ss]` **不**变 chip（沿用富文本的既有约定）。
5. `cd frontend && npm test` 全绿（含新增用例）；`npm run build` 通过。

**风险与缓解**
- **大文档 decoration 性能**：每次输入重算全文 decoration 可能卡。缓解：基于 ProseMirror `Decoration` 增量/按 transaction 映射，必要时只扫可视/变更区间。
- **点击与选区冲突**：chip 既要可点又不能挡住编辑。缓解：decoration 用 widget/`pointer-events` 与 click handler 配合，参考 `.ln-ts-chip` 现有交互。
- **序列化回归**：务必加「保存前后时间码字节一致」验收，防止悄悄改格式。

**本阶段红线**
- ❌ 保存的 markdown 时间码必须字节级保持裸 `[mm:ss]`。
- ❌ 不破坏富文本/源md对照里既有的时间码渲染。
- ❌ 不动数据库 / 接口签名 / 非视频页。

---

### 阶段三：移除旧富文本只读模式（gated）

**前置（硬门槛）**：阶段二已合并且**用户确认时间码在 Milkdown 验收通过**。未确认前**不得开工本阶段**。

**目标**：让「所见即所得」成为默认编辑/查看视图，移除 `read`（富文本 ReactMarkdown 只读）模式；保留 md格式、源md对照、导出。

**涉及文件（删除偏多，注意跨文件计数）**
- 改 `index.tsx`：
  - 移除 `read` 渲染分支与「富文本」标签；`ViewMode` 去掉 `'read'`。
  - 默认模式 `VIEW_MODE_KEY` 初值、窄屏降级目标（现 `:517`、`:522` 降级到 `'read'`）改为 `'wysiwyg'`。
  - 处理因 read 模式移除而变 dead 的 `renderNoteTimestampChildren`：**先用 `rg` 确认无其它引用**（现仅 `:954` read 分支用），可二选一：(a) 删函数 + 删/迁移对应单测；(b) 保留导出 + 单测（成本低、无害）。**推荐 (b) 保留**，改动更小。开工前在 commit 说明里写清选了哪条。
- （可选清理，spike 已注明「验证通过后删除」）：`router.tsx` 移除 `/test-editor` 路由、删 `frontend/src/pages/TestEditorPage.tsx`、删未跟踪的 `frontend/milkdown-{diag,perf,ss}.mjs` 与 `test-results/`。**这部分可单独一个 commit**，不和主改动混。

**验收标准**
1. 中列标签不再有「富文本」；默认打开即「所见即所得」。
2. md格式、源md对照、导出 md/Obsidian、时间码点击跳转（阶段二）全部可用。
3. 窄屏（<1024px）降级到「所见即所得」而非旧 read。
4. `cd frontend && npm test` 全绿（若动了 read 相关测试，相应更新）；`npm run build` 通过。
5. 手动刷新内容持久；无 console 报错。

**风险与缓解**
- **误删仍被引用的 helper**：删 `renderNoteTimestampChildren` 前必须 `rg -n "renderNoteTimestampChildren"` 全仓确认。推荐保留以减小风险。
- **默认/降级遗漏**：搜 `'read'` 字面量，确保 `VIEW_MODE_KEY` 读取、窄屏降级、localStorage 历史值兼容（旧用户存了 `'read'` 要回退到 `'wysiwyg'`）。

**本阶段红线**
- ❌ 未经用户确认阶段二验收，不得移除富文本。
- ❌ 不删 md格式 / 源md对照 / 导出。
- ❌ 清理 spike 文件与主改动分开 commit，不混提交。

---

## 5. 全局禁止扩大范围（红线，三阶段通用）

- ❌ 只动**视频结果页 NoteShell**，**不碰**音频 / 图片 / 文本结果页。
- ❌ 不做 [C] 复刻·AI 导演、不做 RAG / 知识库问答相关改动。
- ❌ 不改数据库 schema、不做迁移。
- ❌ 不碰鉴权 / API key / 加密。
- ❌ 不做全项目重构、不顺手改无关代码、不默认开 subagent / 全项目体检。
- ❌ 不装新依赖（Milkdown/CodeMirror 已就位）；若确需新包，停下问用户。
- ❌ 不 `git push origin`（开源前暂缓 push）。

---

## 6. 验证与提交规范（每阶段通用）

- 启动只跑 `git status --short --branch` + `git log --oneline -5` 对账，不通读全项目。
- 只读本计划 §2 列出的相关文件；超 300 行先 `rg -n` 定位再 `sed`/offset 片段读。
- 完成后：`cd frontend && npm test` + `npm run build`，自己跑完看结果再提交。
- **每阶段一个 commit**（阶段三的 spike 清理可额外单独一个），commit message 形如 `feat(k-milkdown.阶段一): 新增 Milkdown 所见即所得模式 + 接通自动保存`。
- commit 后输出可直接复制给 Codex 的审查提示词（结论第一行：通过/不通过/需要补充验证）。
- 分支：沿用 `spike/milkdown-editor` 或按用户指示新建 `feat/k-milkdown`；阶段顺序完成、阶段二未过不开阶段三。
