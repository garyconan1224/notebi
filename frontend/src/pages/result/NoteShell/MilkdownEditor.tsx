/**
 * MilkdownEditor — WYSIWYG 可编辑 Milkdown 编辑器
 *
 * 封装 TestEditorPage 验证通过的配置（commonmark+gfm+prism+listener+nord）。
 * Props: { markdown, onMarkdownChange }
 *
 * re-seed 策略：由外部 key={noteId+seedVersion} 控制重挂，
 * 内部不自动重设 defaultValue（防光标跳动 + 保存死循环）。
 * 首挂保存边界：mounted 时用编辑器自己的序列化器捕获初始 canonical 内容作为
 * 基线（createNoteSeedGuard），规范化不触发保存，真实编辑才保存。
 */
import { useEffect, useRef } from 'react'
import { Editor, rootCtx, defaultValueCtx, prosePluginsCtx, editorViewCtx, serializerCtx, marksCtx, remarkPluginsCtx, parserCtx } from '@milkdown/core'
import { Plugin, TextSelection } from '@milkdown/prose/state'
import { history, undo, redo } from '@milkdown/prose/history'
import { keymap } from '@milkdown/prose/keymap'
import { Slice } from '@milkdown/prose/model'
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { prism } from '@milkdown/plugin-prism'
import { nord } from '@milkdown/theme-nord'
import '@milkdown/theme-nord/style.css'
import { timestampPlugin, unescapeNoteTimestamps } from './milkdownTimestamp'
import { createNoteSeedGuard, type NoteSeedGuard } from './milkdownSeedGuard'
import { stripUnresolvedFramePlaceholders } from './frameMarkdown'
import { underlineHtmlRemarkPlugin, underlineMarkSchema } from './underlineMark'
import { highlightHtmlRemarkPlugin, highlightMarkSchema } from './highlightMark'
import { useLnEditorStore } from '@/store/lnEditorStore'
import {
  getEditorFormattingState,
  runEditorFormat,
} from './editorFormatting'

interface MilkdownEditorProps {
  markdown: string
  onMarkdownChange: (md: string) => void
  onSeek?: (sec: number) => void
  registerCommands?: boolean
}

function MilkdownEditorInner({
  markdown,
  onMarkdownChange,
  onSeek,
  registerCommands = true,
}: MilkdownEditorProps) {
  const safeMarkdown = stripUnresolvedFramePlaceholders(markdown)
  // 「初始 canonical 内容」守卫：首挂规范化不保存，内容偏离基线才保存。
  // 懒初始化，保证每次挂载（key 变化重挂）都拿到以当次 seed 建立的新守卫。
  const guardRef = useRef<NoteSeedGuard | null>(null)
  if (guardRef.current === null) {
    guardRef.current = createNoteSeedGuard(safeMarkdown)
  }
  // 避免 timestampPlugin 闭包捕获旧 onSeek
  const onSeekRef = useRef(onSeek)
  onSeekRef.current = onSeek

  // 任务清单（- [ ] / - [x]）勾选切换：mousedown 落在 li 左侧复选框区域时翻转 checked 属性，
  // 经 listener → markdownUpdated → onMarkdownChange 持久化；点击文本区域不拦截（可正常编辑）。
  const taskTogglePlugin = new Plugin({
    view: (view) => {
      const onMouseDown = (event: MouseEvent) => {
        const target = event.target as HTMLElement
        const li = target.closest('li[data-item-type="task"]') as HTMLElement | null
        if (!li) return
        const rect = li.getBoundingClientRect()
        if (event.clientX - rect.left > 20) return
        event.preventDefault()
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (!coords) return
        const $pos = view.state.doc.resolve(coords.pos)
        for (let depth = $pos.depth; depth >= 0; depth -= 1) {
          const node = $pos.node(depth)
          // gfm 在基础 list_item 上扩展 checked 属性（- [ ] / - [x]）
          if (node.type.name !== 'list_item' || node.attrs.checked == null) continue
          const checked = node.attrs.checked === true
          view.dispatch(
            view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
              ...node.attrs,
              checked: !checked,
            }),
          )
          break
        }
      }
      view.dom.addEventListener('mousedown', onMouseDown)
      return {
        destroy: () => view.dom.removeEventListener('mousedown', onMouseDown),
      }
    },
  })

  useEditor(
    (root) => {
      const editor = Editor.make()
        .config((ctx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, safeMarkdown)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx.update(remarkPluginsCtx, (plugins: any) => [...plugins, { plugin: underlineHtmlRemarkPlugin, options: {} }, { plugin: highlightHtmlRemarkPlugin, options: {} }])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx.update(marksCtx, (marks: any) => [...marks, ['underline', underlineMarkSchema], ['highlight', highlightMarkSchema]])
          ctx.get(listenerCtx)
            .markdownUpdated((_ctx: any, md: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
              // 先反转义时间码方括号（Milkdown commonmark 序列化器会把 [ 转义成 \[），
              // 保证基线比较和落盘都用裸文本。
              const normalized = unescapeNoteTimestamps(md)
              if (!guardRef.current?.shouldSave(normalized)) return
              onMarkdownChange(normalized)
            })
            .mounted((mctx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
              // 挂载完成：用编辑器自己的序列化器捕获初始 doc 的 canonical 形式。
              // 之后 markdownUpdated 的内容若等于该基线，即为首挂规范化/无变化，不保存。
              try {
                const view = mctx.get(editorViewCtx)
                const serializer = mctx.get(serializerCtx)
                guardRef.current?.captureBaseline(
                  unescapeNoteTimestamps(serializer(view.state.doc)),
                )
              } catch {
                // 捕获失败时退回「与原始 seed 比较」的兜底路径
              }
            })
          // 注册时间码 decoration 插件
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx.update(prosePluginsCtx, (ps: any) => {
            const formattingPlugin = new Plugin({
              view: (view) => {
                useLnEditorStore.getState().setFormattingState(
                  getEditorFormattingState(view.state),
                )
                return {
                  update: (nextView) => {
                    useLnEditorStore.getState().setFormattingState(
                      getEditorFormattingState(nextView.state),
                    )
                  },
                }
              },
            })
            return [
              ...ps,
              history(),
              keymap({
                'Mod-z': undo,
                'Mod-y': redo,
                'Shift-Mod-z': redo,
              }),
              timestampPlugin(() => onSeekRef.current ?? (() => {})),
              taskTogglePlugin,
              ...(registerCommands ? [formattingPlugin] : []),
            ]
          })
        })
      // @ts-expect-error Milkdown 7.x TS overload 不精确，TestEditorPage 同款写法，运行时正常
      return editor.use(nord).use(commonmark).use(gfm).use(prism).use(listener)
    },
    [],
  )

  // 向 lnEditorStore 注册 Milkdown 插入函数，供截图按钮调用
  const [, getEditor] = useInstance()
  useEffect(() => {
    if (!registerCommands) return
    useLnEditorStore.getState().setInsertFn((text) => {
      const editor = getEditor()
      if (!editor) return false
      editor.action((ctx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const view = ctx.get(editorViewCtx)
        const { state } = view
        const trimmed = text.trim()
        // 检测 markdown 图片语法 ![alt](url)，插入真正的 ProseMirror image 节点
        const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
        if (imgMatch && state.schema.nodes['image']) {
          try {
            const imageNode = state.schema.nodes['image'].create({
              src: imgMatch[2],
              alt: imgMatch[1] || '',
              title: '',
            })
            view.dispatch(state.tr.replaceSelectionWith(imageNode))
            view.focus()
            return
          } catch {
            // 创建节点失败时降级到文本插入
          }
        }
        // 普通文本内容
        view.dispatch(state.tr.insertText(text, state.selection.from, state.selection.to))
        view.focus()
      })
      return true
    })
    // 「解析 Markdown 再插入」：把 markdown 转成真正的标题/列表等节点插入，
    // 供思维导图「插入为大纲」等需要保留格式的场景使用。
    useLnEditorStore.getState().setInsertMarkdownFn((markdown) => {
      const editor = getEditor()
      if (!editor) return false
      let inserted = false
      editor.action((ctx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const view = ctx.get(editorViewCtx)
        try {
          const parser = ctx.get(parserCtx)
          const parsed = parser(markdown)
          const { state } = view
          const { $from } = state.selection
          // 光标在列表项内时，块级片段会被吞进列表（标题嵌套进 li）。
          // 此时提升到最外层列表之后插入，保证大纲作为独立块落地。
          let listDepth = -1
          for (let d = 1; d <= $from.depth; d += 1) {
            const name = $from.node(d).type.name
            if (name === 'bullet_list' || name === 'ordered_list') { listDepth = d; break }
          }
          if (listDepth > 0) {
            const pos = $from.after(listDepth)
            const tr = state.tr.insert(pos, parsed.content)
            tr.setSelection(TextSelection.create(tr.doc, pos + parsed.content.size))
            view.dispatch(tr)
          } else {
            // openStart/openEnd 取 0：作为完整块级片段插入，不与相邻段落合并
            view.dispatch(state.tr.replaceSelection(new Slice(parsed.content, 0, 0)))
          }
          view.focus()
          inserted = true
        } catch {
          // 解析失败时降级为纯文本插入
        }
      })
      if (!inserted) {
        return useLnEditorStore.getState().insertAtCursor(markdown)
      }
      return true
    })
    useLnEditorStore.getState().setWrapSelectionFn((before, after) => {
      const editor = getEditor()
      if (!editor) return false
      editor.action((ctx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const view = ctx.get(editorViewCtx)
        const { state } = view
        const { from, to, empty } = state.selection.main
        const selected = state.doc.textBetween(from, to, '\n')
        const insert = `${before}${selected}${after}`
        const cursor = from + before.length + (empty ? 0 : selected.length)
        const tr = state.tr.insertText(insert, from, to)
        tr.setSelection(TextSelection.create(tr.doc, cursor))
        view.dispatch(tr)
        view.focus()
      })
      return true
    })
    useLnEditorStore.getState().setGetSelectionFn(() => {
      const editor = getEditor()
      if (!editor) return ''
      let selected = ''
      editor.action((ctx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const view = ctx.get(editorViewCtx)
        const { from, to } = view.state.selection
        selected = view.state.doc.textBetween(from, to, '\n')
      })
      return selected
    })
    useLnEditorStore.getState().setReplaceSelectionFn((text) => {
      const editor = getEditor()
      if (!editor) return false
      editor.action((ctx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const view = ctx.get(editorViewCtx)
        const { from, to } = view.state.selection
        view.dispatch(view.state.tr.insertText(text, from, to))
        view.focus()
      })
      return true
    })
    const formatFn = (
      format: Parameters<typeof runEditorFormat>[1],
      value?: string,
    ) => {
      const editor = getEditor()
      if (!editor) return false
      let applied = false
      editor.action((ctx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        applied = runEditorFormat(ctx.get(editorViewCtx), format, value)
      })
      return applied
    }
    useLnEditorStore.getState().setFormatFn(formatFn)
    return () => {
      useLnEditorStore.getState().setInsertFn(null)
      useLnEditorStore.getState().setInsertMarkdownFn(null)
      useLnEditorStore.getState().setWrapSelectionFn(null)
      useLnEditorStore.getState().setGetSelectionFn(null)
      useLnEditorStore.getState().setReplaceSelectionFn(null)
      if (useLnEditorStore.getState().formatFn === formatFn) {
        useLnEditorStore.getState().resetFormatting()
      }
    }
  }, [getEditor, registerCommands])

  return <Milkdown />
}

export default function MilkdownEditor({
  markdown,
  onMarkdownChange,
  onSeek,
  registerCommands = true,
}: MilkdownEditorProps) {
  return (
    <div className="note-milkdown">
      <style>{`
        /* Task list checkbox — scope inside .note-milkdown */
        .note-milkdown .milkdown-theme-nord li[data-item-type="task"] {
          list-style: none;
        }
        .note-milkdown .milkdown-theme-nord li[data-item-type="task"]::before {
          content: "";
          display: inline-block;
          width: 1em;
          height: 1em;
          margin-right: 0.4em;
          border: 1.5px solid currentColor;
          border-radius: 3px;
          vertical-align: -2px;
        }
        .note-milkdown .milkdown-theme-nord li[data-item-type="task"][data-checked="true"]::before {
          content: "✓";
          text-align: center;
          line-height: 1em;
          font-size: 0.85em;
        }
        /* Code block syntax highlighting — scope inside .note-milkdown */
        .note-milkdown .milkdown pre .token.keyword    { color: #ff7b72; }
        .note-milkdown .milkdown pre .token.string,
        .note-milkdown .milkdown pre .token.template-string.string { color: #a5d6ff; }
        .note-milkdown .milkdown pre .token.function   { color: #d2a8ff; }
        .note-milkdown .milkdown pre .token.number,
        .note-milkdown .milkdown pre .token.boolean    { color: #79c0ff; }
        .note-milkdown .milkdown pre .token.operator   { color: #ff7b72; }
        .note-milkdown .milkdown pre .token.punctuation { color: #8b949e; }
        .note-milkdown .milkdown pre .token.comment    { color: #6a737d; font-style: italic; }
        .note-milkdown .milkdown pre .token.builtin,
        .note-milkdown .milkdown pre .token.class-name { color: #ffa657; }
        .note-milkdown .milkdown pre .token.template-punctuation { color: #a5d6ff; }
        .note-milkdown .milkdown pre .token.interpolation { color: #c9d1d9; }
        /* Timestamp chip — inline decoration */
        .note-milkdown .note-ts-chip {
          display: inline;
          padding: 1px 5px;
          border-radius: 4px;
          background: rgba(99, 179, 237, 0.15);
          color: #63b3ed;
          font-size: 0.9em;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          cursor: pointer;
          user-select: none;
        }
        .note-milkdown .note-ts-chip:hover {
          background: rgba(99, 179, 237, 0.3);
        }
        /* Image nodes — block display, responsive width */
        .note-milkdown .milkdown img {
          max-width: 100%;
          display: block;
          margin: 16px auto;
          border-radius: 6px;
        }
      `}</style>
      <MilkdownProvider>
        <MilkdownEditorInner
          markdown={markdown}
          onMarkdownChange={onMarkdownChange}
          onSeek={onSeek}
          registerCommands={registerCommands}
        />
      </MilkdownProvider>
    </div>
  )
}
