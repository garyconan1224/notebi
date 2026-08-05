import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
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
})
