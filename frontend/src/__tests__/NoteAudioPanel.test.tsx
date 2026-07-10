import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import NoteAudioPanel from '@/pages/result/NoteShell/NoteAudioPanel'

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
})
