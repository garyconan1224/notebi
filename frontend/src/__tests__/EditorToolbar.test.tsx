import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EditorToolbar from '@/pages/result/NoteShell/EditorToolbar'
import { useLnEditorStore } from '@/store/lnEditorStore'

describe('EditorToolbar（Q6 共享正文工具栏）', () => {
  beforeEach(() => {
    useLnEditorStore.getState().resetFormatting()
  })

  function renderWithSelection() {
    render(
      <div className="note-milkdown">
        <span>示例正文</span>
        <EditorToolbar />
      </div>,
    )
    const node = document.querySelector('.note-milkdown span') as Node
    const range = document.createRange()
    range.selectNodeContents(node)
    ;(range as Range & { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = vi.fn(
      () =>
        ({
          top: 100,
          left: 100,
          width: 50,
          height: 20,
          right: 150,
          bottom: 120,
          x: 100,
          y: 100,
          toJSON: () => ({}),
        }) as DOMRect,
    )
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }

  it('渲染段落格式下拉与全部格式按钮', async () => {
    renderWithSelection()
    const toolbar = await screen.findByRole('toolbar', { name: '正文格式' })
    expect(toolbar).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '段落格式' })).toBeInTheDocument()
    for (const label of ['加粗', '斜体', '删除线', '链接', '引用', '无序列表', '有序列表', '待办列表', '行内代码', '代码块', '清除格式']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('段落下拉切换会下发 heading 层级命令（H1/H2/H3 round-trip 入口）', async () => {
    const applyFormat = vi.fn()
    useLnEditorStore.setState({ applyFormat })
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })

    fireEvent.change(screen.getByRole('combobox', { name: '段落格式' }), { target: { value: '3' } })
    expect(applyFormat).toHaveBeenCalledWith('heading', '3')
  })

  it('select 抢焦点清空 DOM 选区后工具栏保持显示（下拉打开场景）', async () => {
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })

    // 下拉打开 = select 获得焦点，随后 DOM 选区被清空
    screen.getByRole('combobox', { name: '段落格式' }).focus()
    const selection = window.getSelection()
    selection?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    await screen.findByRole('toolbar', { name: '正文格式' })
    expect(screen.getByRole('combobox', { name: '段落格式' })).toBeInTheDocument()
  })

  it('没有选中文字且焦点不在工具栏时工具栏消失', async () => {
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })

    const selection = window.getSelection()
    selection?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    await waitFor(() => {
      expect(screen.queryByRole('toolbar', { name: '正文格式' })).not.toBeInTheDocument()
    })
  })

  it('加粗按钮激活态与可用性来自格式化状态', async () => {
    useLnEditorStore.setState({
      formattingState: {
        ...useLnEditorStore.getState().formattingState,
        bold: true,
        canBold: true,
        canClearFormat: false,
      },
    })
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })

    const bold = screen.getByRole('button', { name: '加粗' })
    expect(bold).toHaveAttribute('aria-pressed', 'true')
    // 无选区/不可清时清除格式禁用
    expect(screen.getByRole('button', { name: '清除格式' })).toBeDisabled()
  })

  it('点击格式按钮调用 applyFormat 对应命令', async () => {
    const applyFormat = vi.fn()
    useLnEditorStore.setState({
      applyFormat,
      formattingState: {
        ...useLnEditorStore.getState().formattingState,
        canBlockquote: true,
        canTaskList: true,
      },
    })
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })

    fireEvent.click(screen.getByRole('button', { name: '引用' }))
    expect(applyFormat).toHaveBeenCalledWith('blockquote')
    fireEvent.click(screen.getByRole('button', { name: '待办列表' }))
    expect(applyFormat).toHaveBeenCalledWith('taskList')
  })

  it('段落级按钮提示注明「作用于整段」，文字级按钮不带该提示', async () => {
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })

    for (const label of ['引用', '无序列表', '有序列表', '待办列表', '代码块', '清除格式']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('title', `${label}（作用于整段）`)
    }
    expect(screen.getByRole('combobox', { name: '段落格式' })).toHaveAttribute('title', '段落格式（作用于整段）')
    expect(screen.getByRole('button', { name: '加粗' }).getAttribute('title')).not.toContain('作用于整段')
  })

  it('渲染新功能按钮：撤销/重做/高亮/分割线/缩进/表格', async () => {
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })
    for (const label of ['撤销', '重做', '高亮', '分割线', '增加缩进', '减少缩进', '插入表格']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('撤销/重做按钮在 canUndo/canRedo 为 false 时禁用', async () => {
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled()
  })

  it('点击新功能按钮下发对应命令', async () => {
    const applyFormat = vi.fn()
    useLnEditorStore.setState({
      applyFormat,
      formattingState: {
        ...useLnEditorStore.getState().formattingState,
        canUndo: true,
        canRedo: true,
        canDivider: true,
        canIndent: true,
        canOutdent: true,
        canTable: true,
      },
    })
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(applyFormat).toHaveBeenCalledWith('undo')
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(applyFormat).toHaveBeenCalledWith('redo')
    fireEvent.click(screen.getByRole('button', { name: '分割线' }))
    expect(applyFormat).toHaveBeenCalledWith('divider')
    fireEvent.click(screen.getByRole('button', { name: '增加缩进' }))
    expect(applyFormat).toHaveBeenCalledWith('indent')
    fireEvent.click(screen.getByRole('button', { name: '减少缩进' }))
    expect(applyFormat).toHaveBeenCalledWith('outdent')
  })

  it('插入表格按钮打开尺寸网格，点格子下发 table 命令并关闭', async () => {
    const applyFormat = vi.fn()
    useLnEditorStore.setState({
      applyFormat,
      formattingState: {
        ...useLnEditorStore.getState().formattingState,
        canTable: true,
      },
    })
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })

    fireEvent.click(screen.getByRole('button', { name: '插入表格' }))
    // 默认 3x3：标签显示「3行 × 3列 表格」，网格 7 行 10 列
    expect(screen.getByText('3行 × 3列 表格')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^\d+x\d+$/ })).toHaveLength(70)

    fireEvent.mouseEnter(screen.getByRole('button', { name: '4x5' }))
    expect(screen.getByText('4行 × 5列 表格')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '4x5' }))
    expect(applyFormat).toHaveBeenCalledWith('table', '4x5')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '4x5' })).not.toBeInTheDocument()
    })
  })

  it('高亮按钮打开颜色弹层，选色下发 highlight 命令并关闭弹层', async () => {
    const applyFormat = vi.fn()
    useLnEditorStore.setState({
      applyFormat,
      formattingState: {
        ...useLnEditorStore.getState().formattingState,
        canHighlight: true,
      },
    })
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })

    fireEvent.click(screen.getByRole('button', { name: '高亮' }))
    expect(screen.getByRole('button', { name: '黄色高亮' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '绿色高亮' }))
    expect(applyFormat).toHaveBeenCalledWith('highlight', '#c5e1a5')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '黄色高亮' })).not.toBeInTheDocument()
    })
  })

  it('「无高亮」选项下发空值（移除选区高亮）', async () => {
    const applyFormat = vi.fn()
    useLnEditorStore.setState({
      applyFormat,
      formattingState: {
        ...useLnEditorStore.getState().formattingState,
        canHighlight: true,
        highlight: '#fff59d',
      },
    })
    renderWithSelection()
    await screen.findByRole('toolbar', { name: '正文格式' })

    fireEvent.click(screen.getByRole('button', { name: '高亮' }))
    // 当前选区已是黄色高亮：对应色块带激活态
    expect(screen.getByRole('button', { name: '黄色高亮' })).toHaveClass('is-active')
    fireEvent.click(screen.getByRole('button', { name: '无高亮' }))
    expect(applyFormat).toHaveBeenCalledWith('highlight', '')
  })
})
