import { create } from 'zustand'
import type { EditorView } from '@codemirror/view'

interface LnEditorState {
  cmView: EditorView | null
  // WYSIWYG 模式（Milkdown）注册的插入函数；优先级高于 cmView
  insertFn: ((text: string) => boolean) | null
  wrapSelectionFn: ((before: string, after: string) => boolean) | null
  setCmView: (v: EditorView | null) => void
  setInsertFn: (fn: ((text: string) => boolean) | null) => void
  setWrapSelectionFn: (fn: ((before: string, after: string) => boolean) | null) => void
  insertAtCursor: (text: string) => boolean
  wrapSelection: (before: string, after: string) => boolean
}

export const useLnEditorStore = create<LnEditorState>((set, get) => ({
  cmView: null,
  insertFn: null,
  wrapSelectionFn: null,

  setCmView: (v) => set({ cmView: v }),
  setInsertFn: (fn) => set({ insertFn: fn }),
  setWrapSelectionFn: (fn) => set({ wrapSelectionFn: fn }),

  insertAtCursor: (text) => {
    // 优先用 WYSIWYG（Milkdown）注册的插入函数
    const { insertFn, cmView } = get()
    if (insertFn) return insertFn(text)
    // 降级到 CodeMirror（MD 编辑模式）
    if (!cmView) return false
    const { from, to } = cmView.state.selection.main
    cmView.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    })
    cmView.focus()
    return true
  },

  wrapSelection: (before, after) => {
    const { wrapSelectionFn, cmView } = get()
    if (wrapSelectionFn) return wrapSelectionFn(before, after)
    if (!cmView) return false
    const { from, to, empty } = cmView.state.selection.main
    const selected = cmView.state.sliceDoc(from, to)
    const insert = `${before}${selected}${after}`
    const cursor = from + before.length + (empty ? 0 : selected.length)
    cmView.dispatch({
      changes: { from, to, insert },
      selection: { anchor: cursor },
    })
    cmView.focus()
    return true
  },
}))
