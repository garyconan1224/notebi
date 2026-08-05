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
import { Editor, rootCtx, defaultValueCtx, prosePluginsCtx, editorViewCtx, serializerCtx, marksCtx, remarkPluginsCtx } from '@milkdown/core'
import { Plugin, TextSelection } from '@milkdown/prose/state'
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

  useEditor(
    (root) => {
      const editor = Editor.make()
        .config((ctx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, safeMarkdown)
          ctx.update(remarkPluginsCtx, (plugins: any) => [...plugins, { plugin: underlineHtmlRemarkPlugin, options: {} }])
          ctx.update(marksCtx, (marks: any) => [...marks, ['underline', underlineMarkSchema]])
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
              timestampPlugin(() => onSeekRef.current ?? (() => {})),
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
