/**
 * 正文阅读偏好（字体 / 字号 / 行高 / 颜色 / 字重 / 对齐）。
 *
 * 原为 NoteShell 顶栏 Aa 面板的私有定义；Aa 面板移除后曾由浮动
 * EditorToolbar 编辑，现归设置页「笔记显示」管理，类型与常量抽到
 * 此处供 NoteShell 与设置页共用。偏好经 localStorage 持久化，
 * NoteShell 以 --note-copy-* 变量应用。
 */

export const EDITOR_PREFS_STORAGE_KEY = 'nibi.note.editorPrefs'

export const EDITOR_FONT_SIZE_MIN = 13
export const EDITOR_FONT_SIZE_MAX = 20

export type NoteEditorPrefs = {
  fontFamily: 'sans' | 'serif' | 'mono'
  fontSize: number
  lineHeight: 1.6 | 1.8 | 2
  textTone: 'ink' | 'muted' | 'soft'
  fontWeight: 'regular' | 'medium' | 'bold'
  textAlign: 'left' | 'center' | 'right'
}

export const DEFAULT_EDITOR_PREFS: NoteEditorPrefs = {
  fontFamily: 'sans',
  fontSize: 15,
  lineHeight: 1.8,
  textTone: 'ink',
  fontWeight: 'medium',
  textAlign: 'left',
}

export const FONT_FAMILY_OPTIONS: Array<{ key: NoteEditorPrefs['fontFamily']; label: string }> = [
  { key: 'sans', label: 'Sans' },
  { key: 'serif', label: 'Serif' },
  { key: 'mono', label: 'Mono' },
]

export const LINE_HEIGHT_OPTIONS: NoteEditorPrefs['lineHeight'][] = [1.6, 1.8, 2]

export const FONT_WEIGHT_OPTIONS: Array<{ key: NoteEditorPrefs['fontWeight']; label: string }> = [
  { key: 'regular', label: '常规' },
  { key: 'medium', label: '中' },
  { key: 'bold', label: '粗' },
]

export const FONT_FAMILY_VALUE: Record<NoteEditorPrefs['fontFamily'], string> = {
  sans: 'var(--fb)',
  serif: 'var(--fd)',
  mono: 'var(--fm)',
}

export const TEXT_TONE_VALUE: Record<NoteEditorPrefs['textTone'], string> = {
  ink: 'var(--fg2)',
  muted: 'var(--mut)',
  soft: 'var(--ink-2)',
}

export const TONE_OPTIONS: Array<{ key: NoteEditorPrefs['textTone']; color: string; label: string }> = [
  { key: 'ink', color: 'var(--fg2)', label: '深' },
  { key: 'muted', color: 'var(--mut)', label: '柔' },
  { key: 'soft', color: 'var(--ink-2)', label: '浅' },
]

export const FONT_WEIGHT_VALUE: Record<NoteEditorPrefs['fontWeight'], number> = {
  regular: 400,
  medium: 500,
  bold: 700,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function writeEditorPrefs(prefs: NoteEditorPrefs): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(EDITOR_PREFS_STORAGE_KEY, JSON.stringify(prefs))
}

export function readEditorPrefs(): NoteEditorPrefs {
  if (typeof window === 'undefined') return DEFAULT_EDITOR_PREFS
  try {
    const raw = window.localStorage.getItem(EDITOR_PREFS_STORAGE_KEY)
    if (!raw) return DEFAULT_EDITOR_PREFS
    const parsed = JSON.parse(raw) as Partial<NoteEditorPrefs>
    return {
      fontFamily: parsed.fontFamily === 'serif' || parsed.fontFamily === 'mono' ? parsed.fontFamily : 'sans',
      fontSize: typeof parsed.fontSize === 'number'
        ? clamp(parsed.fontSize, EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX)
        : DEFAULT_EDITOR_PREFS.fontSize,
      lineHeight: parsed.lineHeight === 1.6 || parsed.lineHeight === 2 ? parsed.lineHeight : 1.8,
      textTone: parsed.textTone === 'muted' || parsed.textTone === 'soft' ? parsed.textTone : 'ink',
      fontWeight: parsed.fontWeight === 'regular' || parsed.fontWeight === 'bold' ? parsed.fontWeight : 'medium',
      textAlign: parsed.textAlign === 'center' || parsed.textAlign === 'right' ? parsed.textAlign : 'left',
    }
  } catch {
    return DEFAULT_EDITOR_PREFS
  }
}
