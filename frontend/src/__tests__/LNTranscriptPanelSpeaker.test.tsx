import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import LNTranscriptPanel from '@/pages/results/LearningNotesPage/LNTranscriptPanel'

vi.mock('@/services/workspaces', () => ({
  updateTranscriptSegment: vi.fn(),
  translateTranscriptSegments: vi.fn(),
}))

vi.mock('@/store/lnEditorStore', () => ({
  useLnEditorStore: () => vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('LNTranscriptPanel speaker presentation', () => {
  it('音频说话人模式为字幕行显示颜色头像和名称', () => {
    Element.prototype.scrollIntoView = vi.fn()
    const { container } = render(
      <LNTranscriptPanel
        transcript={[{ t_sec: 0, t_str: '00:00', text: '欢迎收听', speaker: 'SPEAKER_00' }]}
        currentTime={0}
        onSeek={vi.fn()}
        workspaceId="ws-1"
        itemId="item-1"
        speakerMap={{ SPEAKER_00: '主持人' }}
        speakerPresentation="detailed"
      />,
    )

    const row = container.querySelector('.ln-tr-row[data-speaker="SPEAKER_00"]')
    expect(row).not.toBeNull()
    expect(row).toHaveAttribute('data-speaker-tone', 'tinted')
    expect(container.querySelector('.ln-tr-speaker-avatar')).not.toBeNull()
    expect(screen.getByText('主持人')).not.toBeNull()
  })

  it('长音频字幕启用屏幕外渲染优化', () => {
    const transcript = Array.from({ length: 500 }, (_, index) => ({
      t_sec: index,
      t_str: `00:${String(index % 60).padStart(2, '0')}`,
      text: `第 ${index + 1} 条字幕`,
    }))
    const { container } = render(
      <LNTranscriptPanel
        transcript={transcript}
        currentTime={0}
        onSeek={vi.fn()}
        workspaceId="ws-1"
        itemId="item-1"
        optimizeLongTranscript
      />,
    )

    expect(container.querySelector('.ln-transcript-panel--long')).not.toBeNull()
  })
})
