import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import NoteAudioPanel from '@/pages/result/NoteShell/NoteAudioPanel'
import { formatAudioTime } from '@/pages/result/NoteShell/audioTime'

describe('NoteAudioPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('打开音频笔记时不下载并解码整段音频生成波形', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const AudioContextMock = vi.fn()
    vi.stubGlobal('AudioContext', AudioContextMock)

    render(<NoteAudioPanel src="/static/large-audio.m4a" />)

    await waitFor(() => {
      expect(fetchSpy).not.toHaveBeenCalled()
    })
    expect(AudioContextMock).not.toHaveBeenCalled()
  })

  it('超过一小时的音频统一显示为 h:mm:ss', () => {
    expect(formatAudioTime(13_680.7)).toBe('3:48:01')
  })

  it('seeked 事件会把媒体真实时间回传给字幕联动层', () => {
    const onTimeUpdate = vi.fn()
    const { container } = render(
      <NoteAudioPanel src="/static/audio.m4a" onTimeUpdate={onTimeUpdate} />,
    )
    const audio = container.querySelector('audio') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { configurable: true, value: 100 })
    Object.defineProperty(audio, 'currentTime', { configurable: true, value: 42.5 })
    fireEvent.seeked(audio)
    expect(onTimeUpdate).toHaveBeenCalledWith(42.5)
  })
})
