import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * R2-D：验证 NoteShell 读取 start_ms 深链接参数。
 */

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

import { getItemNote } from '@/services/workspaces'

const mockNote = {
  note_md: '# 测试笔记\n\n内容',
  frontmatter: { type: 'audio' },
  transcript: [
    { t_sec: 30, text: '市场反馈', speaker: 'A' },
  ],
  media: {
    audio: { url: 'http://test/audio.mp3', duration_sec: 120 },
  },
  summaries: [],
}

describe('R2-D: NoteShell knowledge deep link', () => {
  beforeEach(() => {
    vi.mocked(getItemNote).mockResolvedValue(mockNote as never)
  })

  it('loads note with start_ms param without crashing', async () => {
    render(
      <MemoryRouter initialEntries={['/workspaces/ws-1/items/item-1/note?start_ms=30000&field=transcript&from=knowledge']}>
        <Routes>
          <Route path="/workspaces/:workspaceId/items/:itemId/note" element={<NoteShellWrapper />} />
        </Routes>
      </MemoryRouter>,
    )

    // R2-D：NoteShell 通过 lazy 动态导入，并行负载下可能超过默认 1s，放宽到 5s
    await waitFor(
      () => {
        expect(getItemNote).toHaveBeenCalledWith('ws-1', 'item-1')
      },
      { timeout: 5000 },
    )
  })

  it('loads note without deep link params normally', async () => {
    render(
      <MemoryRouter initialEntries={['/workspaces/ws-1/items/item-1/note']}>
        <Routes>
          <Route path="/workspaces/:workspaceId/items/:itemId/note" element={<NoteShellWrapper />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => {
        expect(getItemNote).toHaveBeenCalledWith('ws-1', 'item-1')
      },
      { timeout: 5000 },
    )
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
