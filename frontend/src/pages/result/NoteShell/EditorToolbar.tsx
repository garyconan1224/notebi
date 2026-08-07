/**
 * Q6：正文编辑工具栏（浮动式）。
 *
 * 在 milkdown 编辑器内选中非空文字时出现在选区上方（Word 风格），不再固定于顶部；
 * 点击空白、Esc 或滚动后隐藏。通过 lnEditorStore 作用于当前挂载的 Milkdown 编辑器。
 * 页面级正文显示偏好（字体/字号/行高/颜色/字重）在设置页「笔记显示」管理。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Code2,
  Eraser,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  Undo2,
  Underline,
} from 'lucide-react'

import { useLnEditorStore } from '@/store/lnEditorStore'
import type { EditorFormat } from '@/pages/result/NoteShell/editorFormatting'
import { TABLE_GRID_MAX_COLS, TABLE_GRID_MAX_ROWS } from '@/pages/result/NoteShell/editorFormatting'
import { HIGHLIGHT_COLORS } from '@/pages/result/NoteShell/highlightMark'


export type TextAlign = 'left' | 'center' | 'right'

interface ToolbarButtonProps {
  format?: EditorFormat
  label: string
  shortcut?: string
  /** 段落级操作（引用/列表/代码块等）：效果作用于选区所在的整个段落，悬停提示里注明以免误解 */
  blockLevel?: boolean
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}

function ToolbarButton({
  format,
  label,
  shortcut,
  blockLevel,
  active,
  disabled,
  onClick,
  children,
}: ToolbarButtonProps) {
  const { t } = useTranslation('note')
  const applyFormat = useLnEditorStore((state) => state.applyFormat)
  const title = blockLevel
    ? `${label}（${t('editor.blockScope')}）`
    : shortcut
      ? `${label}（${shortcut}）`
      : label
  return (
    <button
      type="button"
      className={`ed-toolbar-btn${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={title}
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
}

export function EditorToolbar({ textAlign, onTextAlignChange }: EditorToolbarProps) {
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
  // 高亮颜色弹层开关；position 变 null（工具栏隐藏）时同步关闭
  const [highlightOpen, setHighlightOpen] = useState(false)
  // 表格尺寸网格弹层：hover 记录当前划选的行×列
  const [tableOpen, setTableOpen] = useState(false)
  const [tableHover, setTableHover] = useState<{ rows: number; cols: number }>({ rows: 3, cols: 3 })
  useEffect(() => {
    if (!position) {
      setHighlightOpen(false)
      setTableOpen(false)
    }
  }, [position])
  const rootRef = useRef<HTMLDivElement>(null)
  const dismissedRef = useRef(false)
  const lastSelectionKeyRef = useRef('')
  // select 下拉打开会抢焦点、清掉 DOM 选区；记住最后一段非空 range 供命令与定位使用
  const lastRangeRef = useRef<Range | null>(null)

  const updatePosition = useCallback(() => {
    const selection = window.getSelection()
    const live = selection && !selection.isCollapsed && selection.rangeCount > 0 && selection.anchorNode
      ? selection.getRangeAt(0)
      : null
    if (live) {
      const anchor = live.startContainer.nodeType === Node.ELEMENT_NODE
        ? (live.startContainer as Element)
        : live.startContainer.parentElement
      if (anchor?.closest('.note-milkdown')) {
        lastRangeRef.current = live.cloneRange()
      }
    }
    const range = live ?? lastRangeRef.current
    if (!range) {
      setPosition(null)
      return
    }
    const anchorEl = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement
    if (!anchorEl?.isConnected || !anchorEl.closest('.note-milkdown')) {
      lastRangeRef.current = null
      setPosition(null)
      return
    }
    const selectionKey = `${range.startContainer === range.endContainer ? range.startContainer.nodeType : 'x'}:${range.startOffset}:${range.endOffset}`
    if (dismissedRef.current && selectionKey === lastSelectionKeyRef.current) {
      // Esc 后同一选区不重复弹出
      setPosition(null)
      return
    }
    dismissedRef.current = false
    lastSelectionKeyRef.current = selectionKey
    // 焦点被工具栏内的下拉抢走时 DOM 选区会清空：保持工具栏与最后位置，
    // 让用户能继续选选项；其他原因失去选区（点击别处、光标收起）就是
    // 「没有选中文字」，隐藏工具栏
    if (!live) {
      const active = document.activeElement
      if (active instanceof HTMLElement && rootRef.current?.contains(active)) return
      lastRangeRef.current = null
      setPosition(null)
      return
    }
    const rect = live.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setPosition(null)
      return
    }
    // 浮动条 max-width 为 min(92vw, 760px)，超宽时行内水平滚动；定位按 760 钳制
    const barWidth = 780
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
    const onFocusOut = (event: FocusEvent) => {
      // 打开段落下拉后又点别处关闭：选区已空且不会再触发 selectionchange，
      // 等焦点落定后若仍无选区则隐藏
      const target = event.target
      if (!(target instanceof HTMLElement) || !rootRef.current?.contains(target)) return
      window.setTimeout(() => {
        const selection = window.getSelection()
        const hasLive = Boolean(
          selection && !selection.isCollapsed && selection.rangeCount > 0 && selection.anchorNode,
        )
        if (hasLive) return
        const active = document.activeElement
        if (active instanceof HTMLElement && rootRef.current?.contains(active)) return
        lastRangeRef.current = null
        setPosition(null)
      }, 0)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [updatePosition])

  const handleLink = () => {
    const href = window.prompt('链接地址', 'https://')
    if (!href) return
    applyFormat('link', href)
  }

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  const mod = isMac ? '⌘' : 'Ctrl+'

  if (!position) return null

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
          title={`段落格式（${t('editor.blockScope')}）`}
          value={String(formatting.headingLevel)}
          onMouseDown={(event) => {
            // 根节点 mousedown preventDefault 会拦住原生下拉的打开动作，
            // select 单独 stopPropagation 恢复默认行为；编辑器选区在 ProseMirror 状态里保留
            event.stopPropagation()
          }}
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
        <ToolbarButton format="blockquote" label={t('editor.blockquote')} blockLevel active={formatting.blockquote} disabled={!formatting.canBlockquote}>
          <Quote size={14} />
        </ToolbarButton>
        <ToolbarButton format="bulletList" label={t('editor.bulletList')} blockLevel active={formatting.bulletList} disabled={!formatting.canBulletList}>
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton format="orderedList" label={t('editor.orderedList')} blockLevel active={formatting.orderedList} disabled={!formatting.canOrderedList}>
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton format="taskList" label={t('editor.taskList')} blockLevel active={formatting.taskList} disabled={!formatting.canTaskList}>
          <ListTodo size={14} />
        </ToolbarButton>
        <span className="ed-toolbar-divider" aria-hidden="true" />
        <ToolbarButton format="inlineCode" label={t('editor.inlineCode')} active={formatting.inlineCode} disabled={!formatting.canInlineCode}>
          <Braces size={14} />
        </ToolbarButton>
        <ToolbarButton format="codeBlock" label={t('editor.codeBlock')} blockLevel active={formatting.codeBlock} disabled={!formatting.canCodeBlock}>
          <Code2 size={14} />
        </ToolbarButton>
        <ToolbarButton format="clearFormat" label={t('editor.clearFormat')} blockLevel active={false} disabled={!formatting.canClearFormat}>
          <Eraser size={14} />
        </ToolbarButton>
        <span className="ed-toolbar-divider" aria-hidden="true" />
        <ToolbarButton format="highlight" label={t('editor.highlight')} active={Boolean(formatting.highlight) || highlightOpen} disabled={!formatting.canHighlight} onClick={() => { setTableOpen(false); setHighlightOpen((open) => !open) }}>
          <Highlighter size={14} />
        </ToolbarButton>
        <span className="ed-toolbar-divider" aria-hidden="true" />
        <ToolbarButton format="undo" label={t('editor.undo')} shortcut={`${mod}Z`} disabled={!formatting.canUndo}>
          <Undo2 size={14} />
        </ToolbarButton>
        <ToolbarButton format="redo" label={t('editor.redo')} shortcut={`${mod}⇧Z`} disabled={!formatting.canRedo}>
          <Redo2 size={14} />
        </ToolbarButton>
        <span className="ed-toolbar-divider" aria-hidden="true" />
        <ToolbarButton format="divider" label={t('editor.divider')} disabled={!formatting.canDivider}>
          <Minus size={14} />
        </ToolbarButton>
        <ToolbarButton format="indent" label={t('editor.indent')} disabled={!formatting.canIndent}>
          <IndentIncrease size={14} />
        </ToolbarButton>
        <ToolbarButton format="outdent" label={t('editor.outdent')} disabled={!formatting.canOutdent}>
          <IndentDecrease size={14} />
        </ToolbarButton>
        <ToolbarButton format="table" label={t('editor.table')} active={tableOpen} disabled={!formatting.canTable} onClick={() => { setHighlightOpen(false); setTableHover({ rows: 3, cols: 3 }); setTableOpen((open) => !open) }}>
          <Table size={14} />
        </ToolbarButton>
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
      {highlightOpen && (
        <div className="ed-highlight-pop" aria-label={t('editor.highlight')}>
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              className={`ed-highlight-swatch${formatting.highlight === color.value ? ' is-active' : ''}`}
              style={{ backgroundColor: color.value }}
              aria-label={t(`editor.${color.label}`)}
              title={t(`editor.${color.label}`)}
              onClick={() => {
                applyFormat('highlight', color.value)
                setHighlightOpen(false)
              }}
            />
          ))}
          <button
            type="button"
            className="ed-highlight-none"
            onClick={() => {
              applyFormat('highlight', '')
              setHighlightOpen(false)
            }}
          >
            {t('editor.highlightNone')}
          </button>
        </div>
      )}
      {tableOpen && (
        <div className="ed-table-pop">
          <div className="ed-table-pop-label">
            {t('editor.tableSummary', { rows: tableHover.rows, cols: tableHover.cols })}
            <span className="ed-table-pop-hint">{t('editor.tableHeaderHint')}</span>
          </div>
          <div className="ed-table-grid">
            {Array.from({ length: TABLE_GRID_MAX_ROWS - 1 }, (_, ri) => ri + 2).map((rows) =>
              Array.from({ length: TABLE_GRID_MAX_COLS }, (_, ci) => ci + 1).map((cols) => (
                <button
                  key={`${rows}x${cols}`}
                  type="button"
                  aria-label={`${rows}x${cols}`}
                  className={`ed-table-cell${rows <= tableHover.rows && cols <= tableHover.cols ? ' is-active' : ''}`}
                  onMouseEnter={() => setTableHover({ rows, cols })}
                  onFocus={() => setTableHover({ rows, cols })}
                  onClick={() => {
                    applyFormat('table', `${rows}x${cols}`)
                    setTableOpen(false)
                  }}
                />
              )),
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default EditorToolbar
