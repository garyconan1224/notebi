import { create } from 'zustand'
import type { EditorView } from '@codemirror/view'
import {
  EMPTY_EDITOR_FORMATTING_STATE,
  type EditorFormat,
  type EditorFormattingState,
} from '@/pages/result/NoteShell/editorFormatting'

interface LnEditorState {
  cmView: EditorView | null
  // WYSIWYG 模式（Milkdown）注册的插入函数；优先级高于 cmView
  insertFn: ((text: string) => boolean) | null
  wrapSelectionFn: ((before: string, after: string) => boolean) | null
  getSelectionFn: (() => string) | null
  replaceSelectionFn: ((text: string) => boolean) | null
  formatFn: ((format: EditorFormat, value?: string) => boolean) | null
  formattingState: EditorFormattingState
  setCmView: (v: EditorView | null) => void
  setInsertFn: (fn: ((text: string) => boolean) | null) => void
  setWrapSelectionFn: (fn: ((before: string, after: string) => boolean) | null) => void
  setGetSelectionFn: (fn: (() => string) | null) => void
  setReplaceSelectionFn: (fn: ((text: string) => boolean) | null) => void
  setFormatFn: (fn: ((format: EditorFormat, value?: string) => boolean) | null) => void
  setFormattingState: (state: EditorFormattingState) => void
  resetFormatting: () => void
  insertAtCursor: (text: string) => boolean
  wrapSelection: (before: string, after: string) => boolean
  getSelectedText: () => string
  replaceSelection: (text: string) => boolean
  applyFormat: (format: EditorFormat, value?: string) => boolean
}

export const useLnEditorStore = create<LnEditorState>((set, get) => ({
  cmView: null,
  insertFn: null,
  wrapSelectionFn: null,
  getSelectionFn: null,
  replaceSelectionFn: null,
  formatFn: null,
  formattingState: EMPTY_EDITOR_FORMATTING_STATE,

  setCmView: (v) => set({ cmView: v }),
  setInsertFn: (fn) => set({ insertFn: fn }),
  setWrapSelectionFn: (fn) => set({ wrapSelectionFn: fn }),
  setGetSelectionFn: (fn) => set({ getSelectionFn: fn }),
  setReplaceSelectionFn: (fn) => set({ replaceSelectionFn: fn }),
  setFormatFn: (fn) => set({ formatFn: fn }),
  setFormattingState: (formattingState) => set({ formattingState }),
  resetFormatting: () => set({
    formatFn: null,
    formattingState: EMPTY_EDITOR_FORMATTING_STATE,
  }),

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

  getSelectedText: () => {
    const { getSelectionFn, cmView } = get()
    if (getSelectionFn) return getSelectionFn()
    if (!cmView) return ''
    const { from, to } = cmView.state.selection.main
    return cmView.state.sliceDoc(from, to)
  },

  replaceSelection: (text) => {
    const { replaceSelectionFn, cmView } = get()
    if (replaceSelectionFn) return replaceSelectionFn(text)
    if (!cmView) return false
    const { from, to } = cmView.state.selection.main
    cmView.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    })
    cmView.focus()
    return true
  },

  applyFormat: (format, value) => {
    const { formatFn } = get()
    if (!formatFn) return false
    return value === undefined ? formatFn(format) : formatFn(format, value)
  },
}))
