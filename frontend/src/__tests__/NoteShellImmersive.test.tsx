import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NoteShell from '@/pages/result/NoteShell'
import { useTaskStore } from '@/store/taskStore'
import type { ItemNote } from '@/types/workspace'

const mocks = vi.hoisted(() => ({
  getItemNote: vi.fn(),
  putItemNote: vi.fn(),
  listSummaries: vi.fn(),
  createSummary: vi.fn(),
  deleteSummary: vi.fn(),
  renameSummary: vi.fn(),
  updateSpeakerMap: vi.fn(),
  downloadTranscript: vi.fn(),
  retryPipelineTask: vi.fn(),
}))

vi.mock('@/services/workspaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/workspaces')>()
  return {
    ...actual,
    getItemNote: mocks.getItemNote,
    putItemNote: mocks.putItemNote,
    updateSpeakerMap: mocks.updateSpeakerMap,
    downloadTranscript: mocks.downloadTranscript,
  }
})

vi.mock('@/services/summaries', () => ({
  listSummaries: mocks.listSummaries,
  createSummary: mocks.createSummary,
  deleteSummary: mocks.deleteSummary,
  renameSummary: mocks.renameSummary,
}))

vi.mock('@/services/pipeline', () => ({
  retryPipelineTask: mocks.retryPipelineTask,
}))

vi.mock('sonner', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/pages/result/NoteShell/MilkdownEditor', () => ({
  default: ({ markdown }: { markdown: string }) => <div data-testid="note-editor">{markdown}</div>,
}))

vi.mock('@/pages/results/LearningNotesPage/LNVideoPanel', () => ({ default: vi.fn() }))
vi.mock('@/pages/results/LearningNotesPage/LNTranscriptPanel', () => ({ default: vi.fn() }))
vi.mock('@/pages/result/NoteShell/NoteAudioPanel', () => ({ default: vi.fn() }))
vi.mock('@/pages/result/NoteShell/NoteMediaCompanion', () => ({ default: vi.fn() }))
vi.mock('@/components/NoteChatDrawer', () => ({ default: vi.fn() }))
vi.mock('@/pages/result/NoteShell/FloatingAskAi', () => ({ FloatingAskAi: vi.fn() }))

const TEXT_NOTE: ItemNote = {
  frontmatter: { title: '测试笔记', type: 'text', version: 2, created_at: '2026-07-01T00:00:00Z' },
  source_md: '',
  note_md: '---\ntitle: 测试笔记\nversion: 2\n---\n# 主笔记\n\n正文',
  summaries: [],
  note_dir: '',
  media: {},
  transcript: [],
}

function renderShell() {
  return render(
    <MemoryRouter>
      <NoteShell workspaceId="ws-1" itemId="item-1" />
    </MemoryRouter>,
  )
}

describe('NoteShell 沉浸式与顶栏（Q2）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getItemNote.mockResolvedValue(TEXT_NOTE)
    mocks.putItemNote.mockResolvedValue(TEXT_NOTE)
    mocks.listSummaries.mockResolvedValue([])
    mocks.updateSpeakerMap.mockResolvedValue({ speaker_map: {}, summary_refresh: { status: 'updated', updated_count: 0 } })
    mocks.downloadTranscript.mockResolvedValue(undefined)
    mocks.retryPipelineTask.mockResolvedValue({ task_id: 't-1' })
    useTaskStore.setState({ tasks: [], hiddenTaskIds: [], currentTaskId: null, isPolling: false })
  })

  it('顶栏版本按钮只显示「主笔记」，不带修订号', async () => {
    renderShell()
    await waitFor(() => expect(screen.getAllByTestId('note-editor').length).toBeGreaterThan(0))
    // 顶栏触发按钮：精确匹配「主笔记」（无 v2）
    expect(screen.getByRole('button', { name: '主笔记' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /主笔记 v2/ })).toBeNull()
  })

  it('版本下拉内仍保留「主笔记 v2」修订号', async () => {
    renderShell()
    await waitFor(() => expect(screen.getAllByTestId('note-editor').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: '主笔记' }))
    expect(screen.getByText(/主笔记 v2/)).not.toBeNull()
  })

  it('沉浸式打开后显示固定退出入口「退出沉浸式 Esc」，aria-pressed 同步', async () => {
    renderShell()
    await waitFor(() => expect(screen.getAllByTestId('note-editor').length).toBeGreaterThan(0))

    const trigger = screen.getByRole('button', { name: /沉浸式/ })
    fireEvent.click(trigger)

    expect(screen.getByText(/退出沉浸式/)).not.toBeNull()
    expect(trigger.getAttribute('aria-pressed')).toBe('true')
  })

  it('按 Esc 退出沉浸式，焦点回到触发按钮', async () => {
    renderShell()
    await waitFor(() => expect(screen.getAllByTestId('note-editor').length).toBeGreaterThan(0))

    const trigger = screen.getByRole('button', { name: /沉浸式/ })
    fireEvent.click(trigger)
    expect(screen.getByText(/退出沉浸式/)).not.toBeNull()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText(/退出沉浸式/)).toBeNull())
    expect(trigger.getAttribute('aria-pressed')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('再点同一「沉浸式」按钮直接退出', async () => {
    renderShell()
    await waitFor(() => expect(screen.getAllByTestId('note-editor').length).toBeGreaterThan(0))

    const trigger = screen.getByRole('button', { name: /沉浸式/ })
    fireEvent.click(trigger)
    expect(screen.getByText(/退出沉浸式/)).not.toBeNull()
    expect(trigger.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(trigger)
    await waitFor(() => expect(screen.queryByText(/退出沉浸式/)).toBeNull())
    expect(trigger.getAttribute('aria-pressed')).toBe('false')
  })
})
