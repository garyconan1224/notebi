/**
 * Q6：共享正文编辑工具栏（EditorToolbar）。
 *
 * 从文本笔记抽出，视频/音频/图文/文本四类笔记共用同一组件：
 * 段落下拉（正文/H1/H2/H3）+ 粗体/斜体/删除线/链接/引用/
 * 无序/有序/待办/行内代码/代码块/清除格式。
 * 通过 lnEditorStore 作用于当前挂载的 Milkdown 编辑器；
 * 窄窗水平滚动（声明横滚豁免），不覆盖正文。
 */
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
  Quote,
  Strikethrough,
} from 'lucide-react'

import { useLnEditorStore } from '@/store/lnEditorStore'
import type { EditorFormat } from '@/pages/result/NoteShell/editorFormatting'

const PARAGRAPH_OPTIONS = [
  { value: '0', label: '正文' },
  { value: '1', label: '标题 1' },
  { value: '2', label: '标题 2' },
  { value: '3', label: '标题 3' },
] as const

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
}

export function EditorToolbar({ textAlign, onTextAlignChange }: EditorToolbarProps) {
  const formatting = useLnEditorStore((state) => state.formattingState)
  const applyFormat = useLnEditorStore((state) => state.applyFormat)

  const handleLink = () => {
    const href = window.prompt('链接地址', 'https://')
    if (!href) return
    applyFormat('link', href)
  }

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  const mod = isMac ? '⌘' : 'Ctrl+'

  return (
    <div className="ed-toolbar" role="toolbar" aria-label="正文格式">
      <select
        className="ed-toolbar-paragraph"
        aria-label="段落格式"
        value={String(formatting.headingLevel)}
        onChange={(event) => applyFormat('heading', event.target.value)}
      >
        {PARAGRAPH_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="ed-toolbar-divider" aria-hidden="true" />
      <ToolbarButton format="bold" label="加粗" shortcut={`${mod}B`} active={formatting.bold} disabled={!formatting.canBold}>
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton format="italic" label="斜体" shortcut={`${mod}I`} active={formatting.italic} disabled={!formatting.canItalic}>
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton format="strike" label="删除线" active={formatting.strike} disabled={!formatting.canStrike}>
        <Strikethrough size={14} />
      </ToolbarButton>
      <ToolbarButton format="link" label="链接" shortcut={`${mod}K`} active={formatting.link} disabled={!formatting.canLink} onClick={handleLink}>
        <LinkIcon size={14} />
      </ToolbarButton>
      <span className="ed-toolbar-divider" aria-hidden="true" />
      <ToolbarButton format="blockquote" label="引用" active={formatting.blockquote} disabled={!formatting.canBlockquote}>
        <Quote size={14} />
      </ToolbarButton>
      <ToolbarButton format="bulletList" label="无序列表" active={formatting.bulletList} disabled={!formatting.canBulletList}>
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton format="orderedList" label="有序列表" active={formatting.orderedList} disabled={!formatting.canOrderedList}>
        <ListOrdered size={14} />
      </ToolbarButton>
      <ToolbarButton format="taskList" label="待办列表" active={formatting.taskList} disabled={!formatting.canTaskList}>
        <ListTodo size={14} />
      </ToolbarButton>
      <span className="ed-toolbar-divider" aria-hidden="true" />
      <ToolbarButton format="inlineCode" label="行内代码" active={formatting.inlineCode} disabled={!formatting.canInlineCode}>
        <Braces size={14} />
      </ToolbarButton>
      <ToolbarButton format="codeBlock" label="代码块" active={formatting.codeBlock} disabled={!formatting.canCodeBlock}>
        <Code2 size={14} />
      </ToolbarButton>
      <ToolbarButton format="clearFormat" label="清除格式" active={false} disabled={!formatting.canClearFormat}>
        <Eraser size={14} />
      </ToolbarButton>
      {onTextAlignChange && (
        <>
          <span className="ed-toolbar-divider" aria-hidden="true" />
          <ToolbarButton label="左对齐" active={textAlign === 'left'} onClick={() => onTextAlignChange('left')}>
            <AlignLeft size={14} />
          </ToolbarButton>
          <ToolbarButton label="居中" active={textAlign === 'center'} onClick={() => onTextAlignChange('center')}>
            <AlignCenter size={14} />
          </ToolbarButton>
          <ToolbarButton label="右对齐" active={textAlign === 'right'} onClick={() => onTextAlignChange('right')}>
            <AlignRight size={14} />
          </ToolbarButton>
        </>
      )}
    </div>
  )
}

export default EditorToolbar
