import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import StoryboardStrip from '@/pages/result/NoteShell/StoryboardStrip'

interface Frame {
  sec: number | null
  url: string
}

function frames(count: number): Frame[] {
  return Array.from({ length: count }, (_, i) => ({
    sec: (i + 1) * 10,
    url: `/static/frame-${i + 1}.jpg`,
  }))
}

describe('StoryboardStrip（Q2 故事板）', () => {
  it('最多渲染 12 帧，超出部分截断', () => {
    const { container } = render(
      <StoryboardStrip frames={frames(15)} currentTime={0} onSeek={vi.fn()} />,
    )
    expect(container.querySelectorAll('.nibi-storyboard-frame')).toHaveLength(12)
  })

  it('无帧时不渲染任何骨架或占位', () => {
    const { container } = render(<StoryboardStrip frames={[]} currentTime={0} onSeek={vi.fn()} />)
    expect(container.querySelector('.nibi-storyboard')).toBeNull()
  })

  it('点击帧跳到对应时间', () => {
    const onSeek = vi.fn()
    render(<StoryboardStrip frames={frames(3)} currentTime={0} onSeek={onSeek} />)
    fireEvent.click(screen.getByRole('button', { name: /跳转到 00:20/ }))
    expect(onSeek).toHaveBeenCalledWith(20)
  })

  it('离当前时间最近的帧高亮', () => {
    const { container } = render(
      <StoryboardStrip frames={frames(3)} currentTime={21} onSeek={vi.fn()} />,
    )
    const active = container.querySelector('.nibi-storyboard-frame.is-active')
    expect(active).not.toBeNull()
    expect(active?.querySelector('img')?.getAttribute('src')).toBe('/static/frame-2.jpg')
  })

  it('无时间戳的旧版帧（sec=null）不参与故事板（无法定位）', () => {
    const legacy: Frame[] = [
      { sec: null, url: '/static/a.jpg' },
      { sec: null, url: '/static/b.jpg' },
    ]
    const { container } = render(<StoryboardStrip frames={legacy} currentTime={0} onSeek={vi.fn()} />)
    expect(container.querySelector('.nibi-storyboard')).toBeNull()
  })
})
