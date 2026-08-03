import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LNVideoPanel from '@/pages/results/LearningNotesPage/LNVideoPanel'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/services/lnScreenshots', () => ({
  uploadLnScreenshot: vi.fn(),
}))

vi.mock('@/store/lnEditorStore', () => ({
  useLnEditorStore: (selector: (s: { insertAtCursor: () => boolean }) => unknown) =>
    selector({ insertAtCursor: () => true }),
}))

function mockMediaPlayback() {
  const play = vi.fn().mockResolvedValue(undefined)
  const pause = vi.fn()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause)
  return { play, pause }
}

function setVideoReady(video: HTMLVideoElement, duration = 120) {
  Object.defineProperty(video, 'duration', { configurable: true, value: duration })
  Object.defineProperty(video, 'readyState', { configurable: true, value: 4 })
  fireEvent.loadedMetadata(video)
}

describe('LNVideoPanel 画面与控制带（Q2）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('点击视频画面开始播放；再点暂停', () => {
    const { play, pause } = mockMediaPlayback()
    const { container } = render(
      <LNVideoPanel src="/static/v.mp4" title="" renderTransportInline />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    setVideoReady(video)

    const surface = container.querySelector('.ln-video-wrapper') as HTMLElement
    fireEvent.click(surface)
    expect(play).toHaveBeenCalledTimes(1)

    // 模拟浏览器进入播放态（原生 paused 变 false）
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent.play(video)
    fireEvent.click(surface)
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('中心播放按钮与字幕层点击不会二次触发画面切换', () => {
    const { play } = mockMediaPlayback()
    const { container } = render(
      <LNVideoPanel src="/static/v.mp4" title="" renderTransportInline subtitle="一句字幕" />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    setVideoReady(video)

    const overlay = container.querySelector('.note-play-overlay') as HTMLElement
    expect(overlay).not.toBeNull()
    fireEvent.click(overlay)
    // overlay 自己触发一次播放，不得冒泡让画面再触发一次
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('画面可键盘操作：role=button，Enter/Space 触发播放', () => {
    const { play } = mockMediaPlayback()
    const { container } = render(
      <LNVideoPanel src="/static/v.mp4" title="" renderTransportInline />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    setVideoReady(video)

    const surface = container.querySelector('.ln-video-wrapper') as HTMLElement
    expect(surface.getAttribute('role')).toBe('button')
    expect(surface.tabIndex).toBe(0)
    fireEvent.keyDown(surface, { code: 'Enter' })
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('transport 与时间/进度合并为一条控制带，低频按钮收进更多菜单', () => {
    const { container } = render(
      <LNVideoPanel src="/static/v.mp4" title="" renderTransportInline />,
    )
    const band = container.querySelector('.note-ctl-band')
    expect(band).not.toBeNull()
    // 播放/倍速/音量在控制带内
    expect(band?.querySelector('[title*="播放"]')).not.toBeNull()
    // 循环/画中画/全屏/截图收进「更多」菜单，不在控制带直接可见
    expect(band?.querySelector('[title="循环播放"]')).toBeNull()
    const more = band?.querySelector('.note-ctl-more') as HTMLElement
    expect(more).not.toBeNull()
    fireEvent.click(more)
    const menu = container.querySelector('.note-ctl-more-menu')
    expect(menu?.querySelector('[title="循环播放"]')).not.toBeNull()
    expect(menu?.querySelector('[title*="画中画"]')).not.toBeNull()
  })

  it('时间轴是 role=slider，键盘 ←/→ 步进 5 秒并带 aria 值', () => {
    const { container } = render(
      <LNVideoPanel src="/static/v.mp4" title="" renderTransportInline />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    setVideoReady(video, 120)
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 30, writable: true })

    const slider = container.querySelector('[role="slider"]') as HTMLElement
    expect(slider).not.toBeNull()
    expect(slider.getAttribute('aria-valuemin')).toBe('0')
    expect(slider.getAttribute('aria-valuemax')).toBe('120')

    fireEvent.keyDown(slider, { code: 'ArrowRight' })
    expect(video.currentTime).toBe(35)
    fireEvent.keyDown(slider, { code: 'ArrowLeft' })
    expect(video.currentTime).toBe(30)
  })

  it('时间轴 hover 预览显示最近故事板帧与时间码', () => {
    const { container } = render(
      <LNVideoPanel
        src="/static/v.mp4"
        title=""
        renderTransportInline
        frames={[
          { sec: 10, url: '/static/f10.jpg' },
          { sec: 60, url: '/static/f60.jpg' },
        ]}
      />,
    )
    const video = container.querySelector('video') as HTMLVideoElement
    setVideoReady(video, 120)

    const slider = container.querySelector('[role="slider"]') as HTMLElement
    const rect = { left: 0, width: 120, top: 0, right: 120, bottom: 12, height: 12 }
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
    fireEvent.mouseMove(slider, { clientX: 66 }) // 66/120 * 120s = 66s → 最近帧 60s

    const preview = container.querySelector('.note-timeline-preview')
    expect(preview).not.toBeNull()
    expect(preview?.querySelector('img')?.getAttribute('src')).toBe('/static/f60.jpg')
    expect(preview?.textContent).toContain('01:06')
  })
})
