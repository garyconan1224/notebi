---
phase: RP1-B · B-3 技术分析
title: 学习笔记页 HTML/MD 视图双向同步策略
status: ready
owner: Opus 4.7 出方案，mimo 2.5pro 实现
parent_plan: docs/plans/result-pages-redesign-v1.md § RP1-B · B-3
companion: docs/plans/rp1-execution-handoff.md § 3.3 提示词 B-3
---

## 0. 核心结论（mimo 看这一段就够开工）

1. **架构**：单一 source of truth = `markdown: string`。两个视图都是它的"投影"。
2. **MD 视图** = **CodeMirror 6** + `@codemirror/lang-markdown`。`pnpm add codemirror @codemirror/lang-markdown @codemirror/state @codemirror/view`。
3. **HTML 视图** = **react-markdown 渲染** + **contentEditable 包装** + **DOMPurify 净化粘贴**。`pnpm add dompurify @types/dompurify`。
4. **HTML → MD 转换** = **turndown**。`pnpm add turndown @types/turndown`。
5. **同步规则（务必按此实现，否则会循环渲染）**：
   - HTML 视图编辑 → **blur 触发一次** turndown → 更新 `markdown` state
   - MD 视图编辑 → **每次 dispatch** 直接更新 `markdown` state（CodeMirror 是受控的）
   - **切换视图时强制 flush** 当前视图的编辑（HTML 视图先 blur 再切）
6. **5 个边界 case 处理方案在 §4**，mimo 写完逐项手测。

---

## 1. 三种选型对比与决策

| 候选 | HTML 视图 | MD 视图 | 双向 | 工作量 | 决策 |
|---|---|---|---|---|---|
| **TipTap** | ✅ ProseMirror | ⚠️ 弱（要插件） | ✅ | 大（引入 ProseMirror 全套，~250 KB） | ❌ 过重 |
| **@uiw/react-md-editor** | ✅ 内置 | ✅ 内置 | ⚠️ 单向（HTML 只读） | 小 | ❌ 不满足用户决议 |
| **CodeMirror 6 + contentEditable + turndown** | contentEditable | CodeMirror 6 | ✅ | 中 | ✅ **选这个** |

**理由**：
- 项目栈已有 react-markdown 10 + remark-gfm + rehype-raw，HTML 视图渲染基础已具备
- CodeMirror 6 模块化、TS 类型完善、与 React 配合标准（不要用 `@uiw/react-codemirror` wrapper，直接用核心 API 反而更可控）
- 总新增依赖 ~120 KB gzip，可接受

---

## 2. 同步架构（精确数据流）

```
            ┌────────────────────────────────┐
            │  state: markdown: string       │
            │  (LearningNotesPage 单一源)    │
            └──────────┬─────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
  ┌──────────────┐            ┌─────────────────┐
  │  MD 视图     │            │  HTML 视图       │
  │  CodeMirror  │            │  react-markdown  │
  │  6           │            │  渲染            │
  │              │            │     ↓            │
  │  ↓ dispatch  │            │  contentEditable │
  │  (即时)       │            │  div 包装        │
  └──────┬───────┘            │     ↓            │
         │                    │  blur 时:        │
         │                    │  innerHTML →     │
         │                    │  turndown →      │
         │                    └────┬────────────┘
         │                         │
         ▼                         ▼
       setMarkdown(...)        setMarkdown(...)
                       │
                       ▼
            debounce 1500ms → PATCH /workspaces/{ws}/ln
```

**两条铁律**：
- ✅ HTML 视图**只在 blur 时** turndown 一次，**不要在 onInput 里实时转**（会卡 + 光标乱跳）
- ✅ 视图切换时**先 flush 当前视图**：HTML→MD 时 `document.activeElement?.blur()`；MD→HTML 时 CodeMirror state 已经是最新的，直接读

---

## 3. 代码骨架

### 3.1 LearningNotesPage 容器（B-1 已存在，B-3 扩展）

```tsx
// frontend/src/pages/results/LearningNotesPage/index.tsx
import { useState, useEffect, useRef } from 'react'
import { LNNotesPanel } from './LNNotesPanel'
import { LNVideoPanel } from './LNVideoPanel'

type ViewMode = 'html' | 'md'

export default function LearningNotesPage() {
  const [markdown, setMarkdown] = useState('')
  const [view, setView] = useState<ViewMode>(() =>
    (localStorage.getItem('ln-view') as ViewMode) || 'html'
  )

  function switchView(next: ViewMode) {
    // 切换前 flush HTML 视图（如果当前在编辑）
    if (view === 'html') (document.activeElement as HTMLElement)?.blur()
    setView(next)
    localStorage.setItem('ln-view', next)
  }

  return (
    <div className="ln-page">
      <LNVideoPanel /* B-1 已实现 */ />
      <LNNotesPanel
        markdown={markdown}
        onMarkdownChange={setMarkdown}
        view={view}
        onSwitchView={switchView}
      />
    </div>
  )
}
```

### 3.2 LNNotesPanel（B-3 核心）

```tsx
// frontend/src/pages/results/LearningNotesPage/LNNotesPanel.tsx
import { HtmlView } from './HtmlView'
import { MdView } from './MdView'

interface Props {
  markdown: string
  onMarkdownChange: (md: string) => void
  view: 'html' | 'md'
  onSwitchView: (v: 'html' | 'md') => void
}

export function LNNotesPanel({ markdown, onMarkdownChange, view, onSwitchView }: Props) {
  return (
    <div className="ln-notes-panel">
      <div className="ln-toolbar">
        <button
          data-active={view === 'html'}
          onClick={() => onSwitchView('html')}
        >HTML</button>
        <button
          data-active={view === 'md'}
          onClick={() => onSwitchView('md')}
        >MD 源码</button>
      </div>
      {view === 'html'
        ? <HtmlView markdown={markdown} onMarkdownChange={onMarkdownChange} />
        : <MdView markdown={markdown} onMarkdownChange={onMarkdownChange} />}
    </div>
  )
}
```

### 3.3 HtmlView（contentEditable + 净化 + turndown）

```tsx
// frontend/src/pages/results/LearningNotesPage/HtmlView.tsx
import { useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import DOMPurify from 'dompurify'
import TurndownService from 'turndown'
import { gfm as turndownGfm } from 'turndown-plugin-gfm'  // 如果不想加这个插件，turndown 内置基本够

const turndown = new TurndownService({
  headingStyle: 'atx',          // # 标题
  codeBlockStyle: 'fenced',     // ``` 代码块
  bulletListMarker: '-',
  emDelimiter: '_',
})
// 可选：保留 GFM 表格 / checkbox / 删除线
// turndown.use(turndownGfm)

const SAFE_TAGS = [
  'h1','h2','h3','h4','h5','h6',
  'p','br','strong','em','del','code','pre','blockquote',
  'ul','ol','li',
  'table','thead','tbody','tr','th','td',
  'a','img',
  'input',  // 给 checkbox 用
]
const SAFE_ATTRS = ['href','src','alt','title','type','checked','disabled']

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: SAFE_TAGS,
    ALLOWED_ATTR: SAFE_ATTRS,
    KEEP_CONTENT: true,
  })
}

interface Props {
  markdown: string
  onMarkdownChange: (md: string) => void
}

export function HtmlView({ markdown, onMarkdownChange }: Props) {
  const editableRef = useRef<HTMLDivElement>(null)

  // 关键：粘贴拦截，净化富文本
  function onPaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    const insert = html ? sanitize(html) : text.replace(/</g, '&lt;')
    document.execCommand('insertHTML', false, insert)
  }

  function onBlur() {
    if (!editableRef.current) return
    const html = sanitize(editableRef.current.innerHTML)
    const md = turndown.turndown(html)
    onMarkdownChange(md)
  }

  return (
    <div
      ref={editableRef}
      contentEditable
      suppressContentEditableWarning
      onPaste={onPaste}
      onBlur={onBlur}
      className="ln-html-view"
    >
      {/* 关键：用 ReactMarkdown 渲染初始内容
          但 contentEditable 模式下 React 不能频繁重渲染
          → 用 key={view-token} 强制只在切换/外部 md 大变化时重建 */}
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
```

**重要技术细节**：
- contentEditable 包裹 ReactMarkdown 看起来奇怪，但 React 不会"反复重渲染破坏光标" —— 因为我们**只在 view 切换或外部 markdown 大变化时**才重建。日常编辑 React 不会重渲染（contentEditable 直接改 DOM）。
- 一定要 `suppressContentEditableWarning`，不然 React DevTools 会报。
- `document.execCommand('insertHTML', ...)` 已 deprecated 但**所有浏览器仍然支持**，且是 paste 拦截的最简方案。如果未来不支持，回退用 `Selection.getRangeAt(0).insertNode(...)`。

### 3.4 MdView（CodeMirror 6）

```tsx
// frontend/src/pages/results/LearningNotesPage/MdView.tsx
import { useRef, useEffect } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'

interface Props {
  markdown: string
  onMarkdownChange: (md: string) => void
}

export function MdView({ markdown: md, onMarkdownChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: md,
      extensions: [
        lineNumbers(),
        history(),
        markdown(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const next = u.state.doc.toString()
            onMarkdownChange(next)
          }
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // 只挂载一次

  // 外部 md 变化时同步到 CodeMirror（如视图切换从 HTML 转来的新内容）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() !== md) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: md }
      })
    }
  }, [md])

  return <div ref={hostRef} className="ln-md-view" />
}
```

**重要技术细节**：
- `EditorView.updateListener.of(...)` 是 CodeMirror 6 的标准回调
- 用 `viewRef.current.state.doc.toString() !== md` 判断避免循环（外部传入和当前一致就不 dispatch）

---

## 4. 5 个边界 case 处理 + 验证方法

| # | 边界 | 处理 | 验证步骤 |
|---|---|---|---|
| 1 | 从 Word/Notion 粘贴富文本 | onPaste 拦截 → DOMPurify 净化 → execCommand insertHTML | 复制 Word 一段带颜色/字号的文本，粘贴到 HTML 视图，blur 后查 MD 视图：颜色/字号丢失但结构（加粗/标题）保留 |
| 2 | 粘贴外站图片（base64 或 url） | 净化保留 `<img src>`，turndown 转 `![](url)` | 复制网页图片，粘贴 → MD 视图应该出现 `![](data:image/...)` 或外链 url |
| 3 | GFM 表格 | turndown 默认不转表格 → 需 `turndown.use(turndownGfm)` **或** SAFE_TAGS 已含 table 标签，让 contentEditable 保留 HTML 表格不转 MD（妥协） | HTML 视图编辑表格 cell → blur → MD 视图应该有 `\| col1 \| col2 \|` 或保留 `<table>` HTML（任选一种，写到注释里） |
| 4 | 任务列表 checkbox（`- [ ]`） | rehype-raw 让 MD `- [ ]` 渲染成 `<input type=checkbox>`，turndown 默认转回 `- [ ]` ✅ | MD 输入 `- [ ] 任务1` → 切 HTML 视图能看到 checkbox → 勾选 → blur → MD 视图变 `- [x] 任务1` |
| 5 | 内联代码块 `` ` `` 和 `~~~` 代码块 | turndown 默认正确处理 `code` 和 `pre>code` | MD 输入 `` `code` `` 和三引号块 → 切 HTML 看到 `<code>` → 编辑后切回 MD 应保留 |

**已知妥协（向用户说明）**：
- HTML 视图编辑表格的体验比 Notion 差很多（contentEditable 表格选择 cell、加行加列都没有 UI），如果用户主要写表格建议用 MD 视图。
- 粘贴图片如果是 base64 会让 markdown 体积暴涨，提示：「图片粘贴建议先用 B-5 截图功能上传」。

---

## 5. 性能 / 渲染优化

- HTML 视图 contentEditable + ReactMarkdown 同时存在：因为 contentEditable 是受 DOM 控制，React 几乎不会重渲染（除非 markdown prop 变了）
- 长笔记（>10000 字）：MD 视图开启虚拟滚动（CodeMirror 6 内置）；HTML 视图建议**首屏只渲染 80% viewport，剩余懒加载**（可选优化，本期不做）
- 自动保存 debounce 1500ms（在 LearningNotesPage 容器上做，不在 LNNotesPanel）

---

## 6. 验证清单（mimo 写完后必跑）

- [ ] `pnpm add codemirror @codemirror/lang-markdown @codemirror/state @codemirror/view @codemirror/commands dompurify @types/dompurify turndown @types/turndown` 安装成功
- [ ] HTML 视图打开能编辑，blur 后 MD 状态更新
- [ ] MD 视图输入能即时反映到 markdown state
- [ ] 切换视图保留内容（HTML 写 → 切 MD 看到对应源码 → 切回 HTML 看到一致渲染）
- [ ] §4 五个边界 case 全过
- [ ] 长笔记（粘贴 5000 字）不卡顿
- [ ] localStorage 记住视图偏好
- [ ] `pnpm build` EXIT=0

---

## 7. 不在 B-3 范围（mimo 不要顺手做）

- ❌ 不要在 B-3 做自动保存（B-4 的事）
- ❌ 不要在 B-3 做截图插入（B-5 的事）
- ❌ 不要做协作编辑 / OT / CRDT（远超本期）
- ❌ 不要做 markdown 工具栏按钮（加粗/标题/列表按钮）—— 用户在 MD 视图用快捷键就行；如果需要可加 [C] 阶段
