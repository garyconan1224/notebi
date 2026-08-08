import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import LNTranscriptPanel from '@/pages/results/LearningNotesPage/LNTranscriptPanel'
import { updateTranscriptSegment, updateTranscriptTranslation } from '@/services/workspaces'

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
    updateTranscriptTranslation: vi.fn(),
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

const TRANSLATIONS = {
  zh: [
    { idx: 0, text: '第一句译文' },
    { idx: 1, text: '第二句译文' },
  ],
}

describe('LNTranscriptPanel 字幕编辑（原文/译文）', () => {
  it('译文模式：双击行编辑译文，保存后回显并调译文接口', async () => {
    vi.mocked(updateTranscriptTranslation).mockResolvedValue({
      segment_idx: 0,
      target_lang: 'zh',
      edited_text: '改过的译文',
    })
    render(
      <LNTranscriptPanel
        transcript={LINES}
        currentTime={0}
        onSeek={vi.fn()}
        workspaceId="ws"
        itemId="item"
        translations={TRANSLATIONS}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '译文' }))
    const row = screen.getByText('第一句译文').closest('.ln-tr-row') as HTMLElement
    fireEvent.doubleClick(row)

    const input = screen.getByDisplayValue('第一句译文')
    fireEvent.change(input, { target: { value: '改过的译文' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(updateTranscriptTranslation).toHaveBeenCalledWith('ws', 'item', 0, 'zh', '改过的译文')
    })
    expect(await screen.findByText('改过的译文')).not.toBeNull()
  })

  it('双语模式：双击译文 span 进入译文编辑（预填译文），双击行进入原文编辑', () => {
    render(
      <LNTranscriptPanel
        transcript={LINES}
        currentTime={0}
        onSeek={vi.fn()}
        workspaceId="ws"
        itemId="item"
        translations={TRANSLATIONS}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '双语' }))

    // 双击译文 span → 预填译文
    fireEvent.doubleClick(screen.getByText('第一句译文'))
    expect(screen.getByDisplayValue('第一句译文')).not.toBeNull()
    fireEvent.keyDown(screen.getByDisplayValue('第一句译文'), { key: 'Escape' })

    // 双击行 → 预填原文
    const row = screen.getByText('第一句').closest('.ln-tr-row') as HTMLElement
    fireEvent.doubleClick(row)
    expect(screen.getByDisplayValue('第一句')).not.toBeNull()
  })

  it('原文模式：保存后合并后端返回的跟随译文，译文视图即时更新', async () => {
    vi.mocked(updateTranscriptSegment).mockResolvedValue({
      segment_idx: 0,
      edited_text: '第一句改',
      updated_translations: { zh: '跟随新译' },
    })
    render(
      <LNTranscriptPanel
        transcript={LINES}
        currentTime={0}
        onSeek={vi.fn()}
        workspaceId="ws"
        itemId="item"
        translations={TRANSLATIONS}
      />,
    )

    const row = screen.getByText('第一句').closest('.ln-tr-row') as HTMLElement
    fireEvent.doubleClick(row)
    const input = screen.getByDisplayValue('第一句')
    fireEvent.change(input, { target: { value: '第一句改' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(updateTranscriptSegment).toHaveBeenCalledWith('ws', 'item', 0, '第一句改')
    })

    fireEvent.click(screen.getByRole('button', { name: '译文' }))
    expect(await screen.findByText('跟随新译')).not.toBeNull()
  })
})
