import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  ChapterEvidenceStrip,
  selectChapterEvidenceFrames,
} from '@/pages/result/NoteShell/ChapterEvidenceStrip'

const chapter = {
  start: 8,
  end: 32,
  title: '关键操作演示',
  summary: '讲解者完整演示了把素材整理为笔记的关键操作。',
  keywords: ['整理'],
  source: 'llm' as const,
}

const frames = [
  { sec: 0, url: '/frames/00.jpg' },
  { sec: 10, url: '/frames/10.jpg' },
  { sec: 20, url: '/frames/20.jpg' },
  { sec: 30, url: '/frames/30.jpg' },
  { sec: 40, url: '/frames/40.jpg' },
]

describe('ChapterEvidenceStrip', () => {
  it('均匀选取章节时间范围内的连续画面，避免把所有关键帧堆进正文', () => {
    expect(selectChapterEvidenceFrames(frames, chapter)).toEqual([
      { sec: 10, url: '/frames/10.jpg' },
      { sec: 20, url: '/frames/20.jpg' },
      { sec: 30, url: '/frames/30.jpg' },
    ])
  })

  it('把完整章节结论和可跳转的证据帧放在一起', () => {
    const onSeek = vi.fn()
    render(
      <ChapterEvidenceStrip
        chapters={[chapter]}
        frames={frames}
        onSeek={onSeek}
        sourceLabel="模型章节"
      />,
    )

    expect(screen.getByRole('region', { name: '章节画面证据' })).toBeInTheDocument()
    expect(screen.getByText('关键操作演示')).toBeInTheDocument()
    expect(screen.getByText('讲解者完整演示了把素材整理为笔记的关键操作。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /跳转到 00:20/ }))
    expect(onSeek).toHaveBeenCalledWith(20)
  })

  it('章节内没有帧时只补最近一帧，而不会产生空白卡片', () => {
    expect(selectChapterEvidenceFrames(frames, { ...chapter, start: 33, end: 34 })).toEqual([
      { sec: 30, url: '/frames/30.jpg' },
    ])
  })
})
