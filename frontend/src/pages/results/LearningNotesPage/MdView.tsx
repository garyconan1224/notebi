import { useRef, useEffect } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { useLnEditorStore } from '@/store/lnEditorStore'

interface Props {
  markdown: string
  onMarkdownChange: (md: string) => void
}

export default function MdView({ markdown: md, onMarkdownChange }: Props) {
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
        EditorView.lineWrapping,
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
    useLnEditorStore.getState().setCmView(view)
    return () => { useLnEditorStore.getState().setCmView(null); view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 只挂载一次

  // 外部 md 变化时同步到 CodeMirror（如视图切换从 HTML 转来的新内容）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() !== md) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: md },
      })
    }
  }, [md])

  return <div ref={hostRef} className="ln-md-view" />
}
