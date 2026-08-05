/**
 * Q6：正文编辑工具栏（浮动式）。
 *
 * 在 milkdown 编辑器内选中非空文字时出现在选区上方（Word 风格），不再固定于顶部；
 * 点击空白、Esc 或滚动后隐藏。通过 lnEditorStore 作用于当前挂载的 Milkdown 编辑器。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CSSProperties } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Code2,
  Eraser,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Plus,
  Quote,
  Strikethrough,
  Type,
  Underline,
} from 'lucide-react'

import { useLnEditorStore } from '@/store/lnEditorStore'
import type { EditorFormat } from '@/pages/result/NoteShell/editorFormatting'
import {
  DEFAULT_EDITOR_PREFS,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  FONT_FAMILY_OPTIONS,
  FONT_WEIGHT_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  TONE_OPTIONS,
  type NoteEditorPrefs,
} from './editorPrefs'


export type TextAlign = 'left' | 'center' | 'right'

interface ToolbarButtonProps {
  format?: EditorFormat
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}

function ToolbarButton({
  format,
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: ToolbarButtonProps) {
  const applyFormat = useLnEditorStore((state) => state.applyFormat)
  return (
    <button
      type="button"
      className={`ed-toolbar-btn${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label}（${shortcut}）` : label}
      disabled={disabled}
      onMouseDown={(event) => {
        // 工具栏聚焦会清掉编辑器选区；阻止默认聚焦后再执行命令
        event.preventDefault()
      }}
      onClick={onClick ?? (() => {
        if (format) applyFormat(format)
      })}
    >
      {children}
    </button>
  )
}

interface EditorToolbarProps {
  /** 提供时渲染对齐按钮（文本笔记的历史能力，其他笔记类型不显示） */
  textAlign?: TextAlign
  onTextAlignChange?: (align: TextAlign) => void
  /** 提供时渲染「正文设置」入口（原顶栏 Aa 面板移入浮动工具栏） */
  editorPrefs?: NoteEditorPrefs
  onEditorPrefsChange?: (patch: Partial<NoteEditorPrefs>) => void
}

export function EditorToolbar({ textAlign, onTextAlignChange, editorPrefs, onEditorPrefsChange }: EditorToolbarProps) {
  const { t } = useTranslation('note')
  const paragraphOptions = [
    { value: '0', label: t('editor.paragraph') },
    { value: '1', label: t('editor.heading1') },
    { value: '2', label: t('editor.heading2') },
    { value: '3', label: t('editor.heading3') },
  ]
  const formatting = useLnEditorStore((state) => state.formattingState)
  const applyFormat = useLnEditorStore((state) => state.applyFormat)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const dismissedRef = useRef(false)
  const lastSelectionKeyRef = useRef('')

  const updatePosition = useCallback(() => {
    const selection = window.getSelection()
    if (
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !selection.anchorNode
    ) {
      setPosition(null)
      return
    }
    const selectionKey = `${selection.anchorNode === selection.focusNode ? selection.anchorNode.nodeType : 'x'}:${selection.anchorOffset}:${selection.focusOffset}`
    if (dismissedRef.current && selectionKey === lastSelectionKeyRef.current) {
      // Esc 后同一选区不重复弹出
      setPosition(null)
      return
    }
    dismissedRef.current = false
    lastSelectionKeyRef.current = selectionKey
    const anchor = selection.anchorNode.nodeType === Node.ELEMENT_NODE
      ? (selection.anchorNode as Element)
      : selection.anchorNode.parentElement
    if (!anchor?.closest('.note-milkdown')) {
      setPosition(null)
      return
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setPosition(null)
      return
    }
    const barWidth = 560
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - barWidth - 8))
    const top = rect.top < 56 ? rect.bottom + 8 : rect.top - 46
    setPosition({ top: Math.max(8, top), left })
  }, [])

  useEffect(() => {
    const onSelectionChange = () => {
      // mousedown 工具条本身会先触发 selectionchange，延后一拍避免误关闭
      window.setTimeout(updatePosition, 0)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissedRef.current = true
        setPosition(null)
      }
    }
    const onScroll = () => setPosition(null)
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [updatePosition])

  // 工具栏隐藏（Esc / 滚动 / 选区收起）时同步收起正文设置弹层
  useEffect(() => {
    if (!position) setPrefsOpen(false)
  }, [position])

  // 点击工具栏外部收起正文设置弹层（工具栏本体 mousedown 已 preventDefault）
  useEffect(() => {
    if (!prefsOpen) return
    const handle = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setPrefsOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [prefsOpen])

  const handleLink = () => {
    const href = window.prompt('链接地址', 'https://')
    if (!href) return
    applyFormat('link', href)
  }

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  const mod = isMac ? '⌘' : 'Ctrl+'

  if (!position) return null

  const showPrefsControls = Boolean(editorPrefs && onEditorPrefsChange)

  return (
    <div
      ref={rootRef}
      className="ed-toolbar ed-toolbar--floating"
      role="toolbar"
      aria-label="正文格式"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="ed-toolbar-row">
        <select
          className="ed-toolbar-paragraph"
          aria-label="段落格式"
          value={String(formatting.headingLevel)}
          onChange={(event) => applyFormat('heading', event.target.value)}
        >
          {paragraphOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="ed-toolbar-divider" aria-hidden="true" />
        <ToolbarButton format="bold" label={t('editor.bold')} shortcut={`${mod}B`} active={formatting.bold} disabled={!formatting.canBold}>
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton format="italic" label={t('editor.italic')} shortcut={`${mod}I`} active={formatting.italic} disabled={!formatting.canItalic}>
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton format="underline" label={t('editor.underline')} active={formatting.underline} disabled={!formatting.canUnderline}>
          <Underline size={14} />
        </ToolbarButton>
        <ToolbarButton format="strike" label={t('editor.strike')} active={formatting.strike} disabled={!formatting.canStrike}>
          <Strikethrough size={14} />
        </ToolbarButton>
        <ToolbarButton format="link" label={t('editor.link')} shortcut={`${mod}K`} active={formatting.link} disabled={!formatting.canLink} onClick={handleLink}>
          <LinkIcon size={14} />
        </ToolbarButton>
        <span className="ed-toolbar-divider" aria-hidden="true" />
        <ToolbarButton format="blockquote" label={t('editor.blockquote')} active={formatting.blockquote} disabled={!formatting.canBlockquote}>
          <Quote size={14} />
        </ToolbarButton>
        <ToolbarButton format="bulletList" label={t('editor.bulletList')} active={formatting.bulletList} disabled={!formatting.canBulletList}>
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton format="orderedList" label={t('editor.orderedList')} active={formatting.orderedList} disabled={!formatting.canOrderedList}>
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton format="taskList" label={t('editor.taskList')} active={formatting.taskList} disabled={!formatting.canTaskList}>
          <ListTodo size={14} />
        </ToolbarButton>
        <span className="ed-toolbar-divider" aria-hidden="true" />
        <ToolbarButton format="inlineCode" label={t('editor.inlineCode')} active={formatting.inlineCode} disabled={!formatting.canInlineCode}>
          <Braces size={14} />
        </ToolbarButton>
        <ToolbarButton format="codeBlock" label={t('editor.codeBlock')} active={formatting.codeBlock} disabled={!formatting.canCodeBlock}>
          <Code2 size={14} />
        </ToolbarButton>
        <ToolbarButton format="clearFormat" label={t('editor.clearFormat')} active={false} disabled={!formatting.canClearFormat}>
          <Eraser size={14} />
        </ToolbarButton>
        {showPrefsControls && (
          <>
            <span className="ed-toolbar-divider" aria-hidden="true" />
            <ToolbarButton
              label={t('editor.textPrefs')}
              active={prefsOpen}
              onClick={() => setPrefsOpen((value) => !value)}
            >
              <Type size={14} />
            </ToolbarButton>
          </>
        )}
        {onTextAlignChange && (
          <>
            <span className="ed-toolbar-divider" aria-hidden="true" />
            <ToolbarButton label={t('editor.alignLeft')} active={textAlign === 'left'} onClick={() => onTextAlignChange('left')}>
              <AlignLeft size={14} />
            </ToolbarButton>
            <ToolbarButton label={t('editor.alignCenter')} active={textAlign === 'center'} onClick={() => onTextAlignChange('center')}>
              <AlignCenter size={14} />
            </ToolbarButton>
            <ToolbarButton label={t('editor.alignRight')} active={textAlign === 'right'} onClick={() => onTextAlignChange('right')}>
              <AlignRight size={14} />
            </ToolbarButton>
          </>
        )}
      </div>
      {prefsOpen && editorPrefs && onEditorPrefsChange && (
        <div className="nibi-note-pref-panel" role="group" aria-label="正文偏好设置">
          <div className="nibi-note-pref-group">
            <span className="nibi-note-pref-label">{t('editor.fontFamily')}</span>
            <div className="nibi-note-pref-segment">
              {FONT_FAMILY_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`nibi-note-pref-chip${editorPrefs.fontFamily === option.key ? ' is-active' : ''}`}
                  aria-pressed={editorPrefs.fontFamily === option.key}
                  onClick={() => onEditorPrefsChange({ fontFamily: option.key })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="nibi-note-pref-group">
            <span className="nibi-note-pref-label">{t('editor.fontSize')}</span>
            <div className="nibi-note-pref-stepper">
              <button
                type="button"
                className="nibi-note-pref-icon-btn"
                title="减小字号"
                aria-label="减小字号"
                disabled={editorPrefs.fontSize <= EDITOR_FONT_SIZE_MIN}
                onClick={() => onEditorPrefsChange({
                  fontSize: Math.max(EDITOR_FONT_SIZE_MIN, editorPrefs.fontSize - 1),
                })}
              >
                <Minus size={13} />
              </button>
              <strong>{editorPrefs.fontSize}px</strong>
              <button
                type="button"
                className="nibi-note-pref-icon-btn"
                title="增大字号"
                aria-label="增大字号"
                disabled={editorPrefs.fontSize >= EDITOR_FONT_SIZE_MAX}
                onClick={() => onEditorPrefsChange({
                  fontSize: Math.min(EDITOR_FONT_SIZE_MAX, editorPrefs.fontSize + 1),
                })}
              >
                <Plus size={13} />
              </button>
            </div>
          </div>
          <div className="nibi-note-pref-group">
            <span className="nibi-note-pref-label">{t('editor.lineHeight')}</span>
            <div className="nibi-note-pref-segment">
              {LINE_HEIGHT_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`nibi-note-pref-chip${editorPrefs.lineHeight === value ? ' is-active' : ''}`}
                  aria-pressed={editorPrefs.lineHeight === value}
                  onClick={() => onEditorPrefsChange({ lineHeight: value })}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="nibi-note-pref-group">
            <span className="nibi-note-pref-label">{t('editor.color')}</span>
            <div className="nibi-note-pref-swatches">
              {TONE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`nibi-note-pref-swatch${editorPrefs.textTone === option.key ? ' is-active' : ''}`}
                  style={{ '--swatch-color': option.color } as CSSProperties}
                  aria-label={t('editor.color')}
                  aria-pressed={editorPrefs.textTone === option.key}
                  onClick={() => onEditorPrefsChange({ textTone: option.key })}
                >
                  <span aria-hidden="true">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="nibi-note-pref-group">
            <span className="nibi-note-pref-label">{t('editor.fontWeight')}</span>
            <div className="nibi-note-pref-segment">
              {FONT_WEIGHT_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`nibi-note-pref-chip${editorPrefs.fontWeight === option.key ? ' is-active' : ''}`}
                  aria-pressed={editorPrefs.fontWeight === option.key}
                  onClick={() => onEditorPrefsChange({ fontWeight: option.key })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="nibi-note-pref-actions">
            <button
              type="button"
              className="nibi-note-pref-ghost"
              onClick={() => onEditorPrefsChange(DEFAULT_EDITOR_PREFS)}
            >
              {t('editor.reset')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default EditorToolbar
