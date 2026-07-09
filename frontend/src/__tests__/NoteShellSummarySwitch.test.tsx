import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NoteShell from '@/pages/result/NoteShell'
import type { ItemSummary } from '@/services/summaries'
import type { ItemNote } from '@/types/workspace'

const mocks = vi.hoisted(() => ({
  getItemNote: vi.fn(),
  putItemNote: vi.fn(),
  listSummaries: vi.fn(),
  createSummary: vi.fn(),
  deleteSummary: vi.fn(),
  renameSummary: vi.fn(),
}))

vi.mock('@/services/workspaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/workspaces')>()
  return {
    ...actual,
    getItemNote: mocks.getItemNote,
    putItemNote: mocks.putItemNote,
  }
})

vi.mock('@/services/summaries', () => ({
  listSummaries: mocks.listSummaries,
  createSummary: mocks.createSummary,
  deleteSummary: mocks.deleteSummary,
  renameSummary: mocks.renameSummary,
}))

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/pages/result/NoteShell/MilkdownEditor', () => ({
  default: ({ markdown }: { markdown: string }) => (
    <div data-testid="note-editor">{markdown}</div>
  ),
}))

vi.mock('@/pages/results/LearningNotesPage/LNVideoPanel', () => ({
  default: vi.fn(),
}))

vi.mock('@/pages/results/LearningNotesPage/LNTranscriptPanel', () => ({
  default: vi.fn(),
}))

vi.mock('@/pages/result/NoteShell/NoteAudioPanel', () => ({
  default: vi.fn(),
}))

vi.mock('@/pages/result/NoteShell/NoteMediaCompanion', () => ({
  default: vi.fn(),
}))

vi.mock('@/components/NoteChatDrawer', () => ({
  default: vi.fn(),
}))

vi.mock('@/pages/result/NoteShell/FloatingAskAi', () => ({
  FloatingAskAi: vi.fn(),
}))

const MAIN_NOTE: ItemNote = {
  frontmatter: {
    title: '测试笔记',
    type: 'text',
    version: 1,
    created_at: '2026-07-01T00:00:00Z',
  },
  source_md: '',
  note_md: '---\ntitle: 测试笔记\nversion: 1\n---\n# 主笔记\n\n主笔记正文',
  summaries: [],
  note_dir: '',
  media: {},
  transcript: [],
}

const SUMMARY_V0: ItemSummary = {
  summary_id: 'summary-v0',
  template: 'standard',
  version: 0,
  name: '',
  background_for_summary: '',
  content_md: '# 标准总结 v0\n\n总结正文',
  model_used: 'test-model',
  created_at: '2026-07-01T00:10:00Z',
}

function expectAnyEditorToContain(text: string) {
  expect(screen.getAllByTestId('note-editor').some((editor) => (
    editor.textContent?.includes(text)
  ))).toBe(true)
}

describe('NoteShell summary switching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getItemNote.mockResolvedValue(MAIN_NOTE)
    mocks.putItemNote.mockResolvedValue(MAIN_NOTE)
    mocks.listSummaries.mockResolvedValue([SUMMARY_V0])
  })

  it('点击总结版本只切换正文，不写回主笔记', async () => {
    render(
      <MemoryRouter>
        <NoteShell workspaceId="ws-1" itemId="item-1" />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expectAnyEditorToContain('主笔记正文')
    })

    fireEvent.click(screen.getByRole('button', { name: /主笔记 v1/ }))
    fireEvent.click(screen.getByRole('button', { name: /v0/ }))

    expectAnyEditorToContain('总结正文')
    expect(mocks.putItemNote).not.toHaveBeenCalled()
  })
})
