import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  ChapterTimelineStrip,
  pickChapterAlignedFrames,
  type TimedFrame,
} from '@/pages/result/NoteShell/ChapterTimelineStrip'

const FRAMES: TimedFrame[] = [
  { sec: 0, url: '/static/f0.jpg' },
  { sec: 10, url: '/static/f10.jpg' },
  { sec: 20, url: '/static/f20.jpg' },
  { sec: 40, url: '/static/f40.jpg' },
  { sec: 70, url: '/static/f70.jpg' },
]

describe('pickChapterAlignedFrames', () => {
  it('有章节时每章取最接近章节起点的帧', () => {
    const picked = pickChapterAlignedFrames(FRAMES, [
      { start: 5, end: 25, title: 'A' },
      { start: 35, end: 60, title: 'B' },
    ])
    expect(picked.map((frame) => frame.sec)).toEqual([10, 40])
  })

  it('无章节时按时长均匀取样且不超过上限', () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      sec: index * 5,
      url: `/static/f${index}.jpg`,
    }))
    const picked = pickChapterAlignedFrames(many, [], 12)
    expect(picked).toHaveLength(12)
    expect(picked[0].sec).toBe(0)
    expect(picked[picked.length - 1].sec).toBe(145)
  })

  it('非法帧与空帧返回空', () => {
    expect(pickChapterAlignedFrames([], [], 12)).toEqual([])
    expect(
      pickChapterAlignedFrames(
        [
          { sec: -1, url: '/static/x.jpg' },
          { sec: 3, url: '' },
        ],
        [],
      ),
    ).toEqual([])
  })
})

describe('ChapterTimelineStrip', () => {
  it('章节段与截帧渲染在同一条轨上，点击可跳转', () => {
    const onSeek = vi.fn()
    render(
      <ChapterTimelineStrip
        frames={FRAMES}
        chapters={[
          { start: 0, end: 30, title: '开场', source: 'fallback' },
          { start: 30, end: 80, title: '正文', source: 'fallback' },
        ]}
        duration={80}
        currentTime={10}
        onSeek={onSeek}
      />,
    )

    expect(screen.getByRole('group', { name: '章节与画面时间轴' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '跳到章节 开场' }))
    expect(onSeek).toHaveBeenCalledWith(0)
    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:40' }))
    expect(onSeek).toHaveBeenCalledWith(40)
  })

  it('无帧且无章节时整条不渲染', () => {
    const { container } = render(
      <ChapterTimelineStrip frames={[]} chapters={[]} duration={0} currentTime={0} onSeek={vi.fn()} />,
    )
    expect(container.querySelector('.nibi-chapter-timeline')).toBeNull()
  })
})
