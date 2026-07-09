# Track K · md格式源码视图时间戳跳转（mimo 执行卡）

> 给 mimo 的开工卡。Claude 桌面已调查完并写好确切改法，读完直接动手。
> 状态：ready ｜ 范围：纯前端单文件 ｜ 预计 <1h

---

## 目标

「md格式」tab（CodeMirror 源码视图）里的 `[mm:ss]` 现在是纯文本、点不动。
给它加可点击跳转，跳转复用已有的 `handleSeek`（和「所见即所得」表现一致）。

## 范围

- **只改一个文件**：`frontend/src/pages/result/NoteShell/index.tsx`
- 纯前端，不动后端、不动 Milkdown、不改正则。

## 背景（现成机制，照用即可）

- 「所见即所得」已有跳转：`frontend/src/pages/result/NoteShell/milkdownTimestamp.ts`
  —— 识别裸 `[mm:ss]` → 加 `note-ts-chip` class → 点击读 `data-sec` → 调 `onSeek(sec)`。
- 跳转函数 `handleSeek` 已存在（`index.tsx` 约 526 行，内部调 `seekTo`），已传给 MilkdownEditor（709 行）。
- 正则 `TS_RE` + 解析函数 `parseTs` 从 `@/pages/results/LearningNotesPage/HtmlView` 导出（milkdownTimestamp 已在用）。
- CodeMirror 编辑器是 `NoteEditor` 组件（约 245 行），用在两处：**711 行**（md格式 tab）、**312 行**（CompareView 左栏）。
- CSS class `note-ts-chip` 已有样式，直接复用。

## 红线

- 只改 `index.tsx` 一个文件。
- 仓库有其它未提交改动，commit 时只 `git add` 这个文件，**禁止 `git add -A` / `git add .`**。
- 不动 Milkdown、不动后端、不改正则（复用 `TS_RE`）。
- 交互说明：源码态点击时间戳会触发**跳转**（而非定位光标），与「所见即所得」一致，这是预期行为。

---

## 改动步骤

### 1. 补 import（约 21–24 行）

`@codemirror/view` 的 import 补上 `Decoration, ViewPlugin, MatchDecorator` 和 type `ViewUpdate`；
并新增一行从 HtmlView 导入正则与解析函数：

```tsx
import { EditorView, keymap, lineNumbers, Decoration, ViewPlugin, MatchDecorator, type ViewUpdate } from '@codemirror/view'
// …其余 import 不变…
import { TS_RE, parseTs } from '@/pages/results/LearningNotesPage/HtmlView'
```

### 2. 新增 CodeMirror 时间戳扩展（放在 `NoteEditor` 定义前，约 237 行那行注释上方）

```tsx
/** CodeMirror 时间戳跳转扩展：给裸 [mm:ss] 加 note-ts-chip，点击调 onSeek。 */
function makeTimestampExtension(getOnSeek: () => ((sec: number) => void) | undefined) {
  const matcher = new MatchDecorator({
    regexp: new RegExp(TS_RE.source, 'g'),
    decoration: (m) =>
      Decoration.mark({ class: 'note-ts-chip', attributes: { 'data-sec': String(parseTs(m[1])) } }),
  })
  return ViewPlugin.fromClass(
    class {
      decorations
      constructor(view: EditorView) { this.decorations = matcher.createDeco(view) }
      update(u: ViewUpdate) { this.decorations = matcher.updateDeco(u, this.decorations) }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(e) {
          const t = e.target as HTMLElement
          if (t?.classList?.contains('note-ts-chip')) {
            const sec = Number(t.getAttribute('data-sec'))
            if (!Number.isNaN(sec)) { getOnSeek()?.(sec); e.preventDefault(); return true }
          }
          return false
        },
      },
    },
  )
}
```

### 3. `NoteEditor` 加 onSeek（约 239–267 行）

props 接口加 `onSeek?`：

```tsx
interface NoteEditorProps {
  markdown: string
  onMarkdownChange: (md: string) => void
  onSeek?: (sec: number) => void
}
```

函数签名解构出 `onSeek`，并照搬现有 `cbRef` 模式加一个 `seekRef`：

```tsx
function NoteEditor({ markdown: md, onMarkdownChange, onSeek }: NoteEditorProps) {
  // …hostRef / viewRef 不变…
  const cbRef = useRef(onMarkdownChange)
  cbRef.current = onMarkdownChange
  const seekRef = useRef(onSeek)     // 新增
  seekRef.current = onSeek           // 新增
```

`extensions` 数组里加一行（放 `EditorView.lineWrapping` 之后）：

```tsx
        makeTimestampExtension(() => seekRef.current),
```

### 4. 两处使用 + CompareView 透传

- **711 行**：
  ```tsx
  <NoteEditor markdown={editingBody} onMarkdownChange={handleEditorChange} onSeek={handleSeek} />
  ```
- `CompareViewProps`（约 298 行）加 `onSeek?: (sec: number) => void`；`CompareView` 解构出 `onSeek`，传给左栏 **312 行**：
  ```tsx
  <NoteEditor markdown={markdown} onMarkdownChange={onMarkdownChange} onSeek={onSeek} />
  ```
- **707 行**：
  ```tsx
  <CompareView markdown={editingBody} onMarkdownChange={handleEditorChange} sourceMd={note.source_md} onSeek={handleSeek} />
  ```

---

## 验证（自己跑完贴结果再 commit）

```bash
cd /Users/conan/Desktop/nibi/frontend
npm run build     # tsc + vite 编译需无类型错误
```

编译通过后 commit（只加这个文件）：

```bash
git add frontend/src/pages/result/NoteShell/index.tsx
git commit -m "feat(k-milkdown): md格式源码视图 [mm:ss] 可点击跳转（CodeMirror decoration）"
```

## 完成后回报

1. `npm run build` 结果（成功 / 报错）；
2. `git show --stat HEAD` 文件清单（确认只动了 `index.tsx`）；
3. 「md格式」tab 的时间戳是否被识别成 `note-ts-chip`（浏览器 DevTools 看 span 有没有这个 class）。
