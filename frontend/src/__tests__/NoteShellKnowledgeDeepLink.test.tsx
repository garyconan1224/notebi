import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R2-D：验证 NoteShell 深链接定位与播放回退。
 *
 * 覆盖审查要求：
 * - metadata/播放器 handle 就绪后再消费 start_ms（seekTo 收到正确秒数）；
 * - 暴露可等待的 play()，而非 void togglePlay()；
 * - 自动播放拒绝后保留目标时间并显示“点击播放”提示；
 * - 同一参数只消费一次；
 * - 无 start_ms 时不 seek/不 play。
 *
 * 通过 mock 媒体面板 handle 精确断言 NoteShell 的编排逻辑。
 */

const panelMocks = vi.hoisted(() => {
  const makeHandle = () => ({
    seekTo: vi.fn(),
    togglePlay: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    captureScreenshot: vi.fn(),
    isPlaying: false,
    currentTime: 0,
    duration: 120,
    transportNode: null as unknown,
  })
  return {
    audio: makeHandle(),
    video: makeHandle(),
    companion: { seekTo: vi.fn() },
  }
})

vi.mock('@/services/workspaces', () => ({
  getItemNote: vi.fn(),
  getItemResult: vi.fn(),
  favoriteItem: vi.fn(),
  unfavoriteItem: vi.fn(),
  updateItemNote: vi.fn(),
  downloadSubtitles: vi.fn(),
  retryPipelineTask: vi.fn(),
}))
vi.mock('@/services/inlineFrames', () => ({
  listInlineFrames: vi.fn().mockResolvedValue([]),
  getSuggestedFrames: vi.fn().mockResolvedValue([]),
  saveInlineFrames: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

// 用可控 handle 替换真实播放器面板，避免依赖 jsdom 不实现的媒体加载。
vi.mock('@/pages/result/NoteShell/NoteAudioPanel', async () => {
  const React = await import('react')
  const Panel = React.forwardRef((_props: unknown, ref: unknown) => {
    React.useImperativeHandle(ref as never, () => panelMocks.audio)
    return React.createElement('div', { 'data-testid': 'mock-audio-panel' })
  })
  return { default: Panel }
})
vi.mock('@/pages/results/LearningNotesPage/LNVideoPanel', async () => {
  const React = await import('react')
  const Panel = React.forwardRef((_props: unknown, ref: unknown) => {
    React.useImperativeHandle(ref as never, () => panelMocks.video)
    return React.createElement('div', { 'data-testid': 'mock-video-panel' })
  })
  return { default: Panel }
})
vi.mock('@/pages/result/NoteShell/NoteMediaCompanion', async () => {
  const React = await import('react')
  const Panel = React.forwardRef((_props: unknown, ref: unknown) => {
    React.useImperativeHandle(ref as never, () => panelMocks.companion)
    return React.createElement('div', { 'data-testid': 'mock-companion-panel' })
  })
  return { default: Panel }
})

import { getItemNote } from '@/services/workspaces'

// jsdom 未实现滚动相关 API；seek 激活转录行会触发 scrollIntoView。
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  window.scrollTo = vi.fn() as never
})

const audioNote = {
  note_md: '# 测试笔记\n\n内容',
  frontmatter: { type: 'audio' },
  transcript: [{ t_sec: 30, text: '市场反馈', speaker: 'A' }],
  media: { audio: { url: 'http://test/audio.mp3', duration_sec: 120 } },
  summaries: [],
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/workspaces/:workspaceId/items/:itemId/note" element={<NoteShellWrapper />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('R2-D: NoteShell knowledge deep link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    panelMocks.audio.play.mockImplementation(() => Promise.resolve())
    panelMocks.video.play.mockImplementation(() => Promise.resolve())
    vi.mocked(getItemNote).mockResolvedValue(audioNote as never)
  })

  it('handle 就绪后消费 start_ms：seekTo(30) 且调用可等待 play()', async () => {
    renderAt('/workspaces/ws-1/items/item-1/note?start_ms=30000&field=transcript&from=knowledge')

    await waitFor(
      () => {
        expect(getItemNote).toHaveBeenCalledWith('ws-1', 'item-1')
        expect(panelMocks.audio.seekTo).toHaveBeenCalledWith(30)
        expect(panelMocks.audio.play).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )
    // 不应使用 void togglePlay 触发播放
    expect(panelMocks.audio.togglePlay).not.toHaveBeenCalled()
  })

  it('自动播放被拒绝时保留目标时间并显示“点击播放”提示', async () => {
    panelMocks.audio.play.mockImplementation(() => Promise.reject(new Error('NotAllowedError')))
    renderAt('/workspaces/ws-1/items/item-1/note?start_ms=30000&from=knowledge')

    await waitFor(
      () => {
        expect(panelMocks.audio.seekTo).toHaveBeenCalledWith(30)
      },
      { timeout: 5000 },
    )
    // play() 拒绝是异步微任务，等待提示出现
    await waitFor(
      () => {
        expect(screen.getByTestId('deeplink-autoplay-hint')).toBeTruthy()
      },
      { timeout: 5000 },
    )
    // 目标时间仍为 30（未因拒绝被重置）
    expect(panelMocks.audio.seekTo).toHaveBeenLastCalledWith(30)
  })

  it('同一 start_ms 只消费一次', async () => {
    const view = renderAt('/workspaces/ws-1/items/item-1/note?start_ms=30000&from=knowledge')

    await waitFor(
      () => {
        expect(panelMocks.audio.seekTo).toHaveBeenCalledTimes(1)
      },
      { timeout: 5000 },
    )
    // 触发重渲染，确认不会二次消费
    view.rerender(
      <MemoryRouter initialEntries={['/workspaces/ws-1/items/item-1/note?start_ms=30000&from=knowledge']}>
        <Routes>
          <Route path="/workspaces/:workspaceId/items/:itemId/note" element={<NoteShellWrapper />} />
        </Routes>
      </MemoryRouter>,
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(panelMocks.audio.seekTo).toHaveBeenCalledTimes(1)
    expect(panelMocks.audio.play).toHaveBeenCalledTimes(1)
  })

  it('无 start_ms 时不 seek 也不 play', async () => {
    renderAt('/workspaces/ws-1/items/item-1/note')

    await waitFor(
      () => {
        expect(getItemNote).toHaveBeenCalledWith('ws-1', 'item-1')
      },
      { timeout: 5000 },
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(panelMocks.audio.seekTo).not.toHaveBeenCalled()
    expect(panelMocks.audio.play).not.toHaveBeenCalled()
  })
})

import { lazy, Suspense } from 'react'
const NoteShell = lazy(() => import('@/pages/result/NoteShell/index'))

function NoteShellWrapper() {
  return (
    <Suspense fallback={<div>loading</div>}>
      <NoteShell />
    </Suspense>
  )
}
