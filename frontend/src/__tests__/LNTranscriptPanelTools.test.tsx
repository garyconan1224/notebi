import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import LNTranscriptPanel from '@/pages/results/LearningNotesPage/LNTranscriptPanel'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/store/lnEditorStore', () => ({
  useLnEditorStore: (selector: (s: { insertAtCursor: () => boolean }) => unknown) =>
    selector({ insertAtCursor: () => true }),
}))

vi.mock('@/services/workspaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/workspaces')>()
  return {
    ...actual,
    updateTranscriptSegment: vi.fn(),
    translateTranscriptSegments: vi.fn(),
  }
})

const LINES = [
  { t_sec: 0, t_str: '00:00', text: '第一句' },
  { t_sec: 5, t_str: '00:05', text: '第二句' },
]

describe('LNTranscriptPanel 转录工具行（Q2）', () => {
  it('标题与条数始终显示，并带折叠按钮', () => {
    render(
      <LNTranscriptPanel
        transcript={LINES}
        currentTime={0}
        onSeek={vi.fn()}
        workspaceId="ws"
        itemId="item"
        title="转录"
        countLabel="2 条"
      />,
    )
    expect(screen.getByText('转录')).not.toBeNull()
    expect(screen.getByText('2 条')).not.toBeNull()
    const collapse = screen.getByRole('button', { name: /折叠工具|收起工具|展开工具/ })
    expect(collapse).not.toBeNull()
  })

  it('折叠只隐藏工具行，不隐藏字幕正文', () => {
    const { container } = render(
      <LNTranscriptPanel
        transcript={LINES}
        currentTime={0}
        onSeek={vi.fn()}
        workspaceId="ws"
        itemId="item"
        title="转录"
        countLabel="2 条"
      />,
    )
    const collapse = screen.getByRole('button', { name: /折叠工具|收起工具|展开工具/ })
    fireEvent.click(collapse)

    // 工具（翻译按钮/显示模式 tabs）被隐藏
    expect(container.querySelector('.ln-tr-head-tools')).toBeNull()
    // 字幕正文仍在
    expect(screen.getByText('第一句')).not.toBeNull()
    expect(screen.getByText('第二句')).not.toBeNull()

    // 再次点击恢复工具行
    fireEvent.click(screen.getByRole('button', { name: /折叠工具|收起工具|展开工具/ }))
    expect(container.querySelector('.ln-tr-head-tools')).not.toBeNull()
  })

  it('窄窗翻译入口收进 popover：提供译按钮，点击后出现语言选择', () => {
    const { container } = render(
      <LNTranscriptPanel
        transcript={LINES}
        currentTime={0}
        onSeek={vi.fn()}
        workspaceId="ws"
        itemId="item"
      />,
    )
    // 窄窗 popover 触发按钮（宽窗由 CSS 隐藏，但 DOM 存在）
    const popTrigger = container.querySelector('.ln-tr-translate-pop-trigger') as HTMLElement
    expect(popTrigger).not.toBeNull()
    fireEvent.click(popTrigger)
    const pop = container.querySelector('.ln-tr-translate-pop')
    expect(pop).not.toBeNull()
    expect(pop?.querySelector('.ln-tr-lang-select')).not.toBeNull()
  })
})
