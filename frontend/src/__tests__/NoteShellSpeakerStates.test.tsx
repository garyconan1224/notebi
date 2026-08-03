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

function videoNote(patch: Partial<ItemNote>): ItemNote {
  return {
    frontmatter: { title: '视频笔记', type: 'video', version: 1, created_at: '2026-07-01T00:00:00Z' },
    source_md: '',
    note_md: '---\ntitle: 视频笔记\n---\n\n正文',
    summaries: [],
    note_dir: '',
    media: { video: { url: '/static/v.mp4', duration: 60 } },
    transcript: [
      { t_sec: 0, t_str: '00:00', text: '第一句' },
      { t_sec: 4, t_str: '00:04', text: '第二句' },
    ],
    ...patch,
  }
}

function audioNote(patch: Partial<ItemNote>): ItemNote {
  return {
    ...videoNote(patch),
    frontmatter: { title: '音频笔记', type: 'audio', version: 1, created_at: '2026-07-01T00:00:00Z' },
    media: { audio: '/static/a.m4a' },
  }
}

function renderShell() {
  return render(
    <MemoryRouter>
      <NoteShell workspaceId="ws-1" itemId="item-1" />
    </MemoryRouter>,
  )
}

describe('NoteShell 说话人状态接线（Q2 / D1）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.putItemNote.mockImplementation(async () => mocks.getItemNote())
    mocks.listSummaries.mockResolvedValue([])
    mocks.updateSpeakerMap.mockResolvedValue({ speaker_map: {}, summary_refresh: { status: 'updated', updated_count: 0 } })
    mocks.downloadTranscript.mockResolvedValue(undefined)
    mocks.retryPipelineTask.mockResolvedValue({ task_id: 't-retry' })
    useTaskStore.setState({ tasks: [], hiddenTaskIds: [], currentTaskId: null, isPolling: false })
  })

  it('speaker_status=none（未请求）：不渲染任何说话人区域，也不显示常驻补做入口', async () => {
    mocks.getItemNote.mockResolvedValue(videoNote({ speaker_status: 'none' }))
    const { container } = renderShell()
    await waitFor(() => expect(screen.getAllByTestId('note-editor').length).toBeGreaterThan(0))
    expect(container.querySelector('.nibi-audio-speaker-empty')).toBeNull()
    expect(container.querySelector('.nibi-speaker-row')).toBeNull()
    expect(screen.queryByText(/尚未区分说话人/)).toBeNull()
  })

  it('speaker_status=failed：显示紧凑失败行和重试按钮', async () => {
    mocks.getItemNote.mockResolvedValue(
      videoNote({ speaker_status: 'failed', speaker_retry_task_id: 'note-1' }),
    )
    renderShell()
    await waitFor(() => expect(screen.getAllByTestId('note-editor').length).toBeGreaterThan(0))
    expect(screen.getByText(/区分说话人.*失败|未完成区分说话人/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))
    await waitFor(() => expect(mocks.retryPipelineTask).toHaveBeenCalled())
  })

  it('speaker_status=running：显示处理中状态行，没有重试', async () => {
    mocks.getItemNote.mockResolvedValue(videoNote({ speaker_status: 'running' }))
    const { container } = renderShell()
    await waitFor(() => expect(screen.getAllByTestId('note-editor').length).toBeGreaterThan(0))
    expect(screen.getByText(/正在区分说话人|区分说话人.*进行中/)).not.toBeNull()
    expect(container.querySelector('.nibi-speaker-row [title*="重试"]')).toBeNull()
  })

  it('speaker_status=data：默认折叠为「N 位说话人」一行', async () => {
    mocks.getItemNote.mockResolvedValue(
      audioNote({
        speaker_status: 'data',
        transcript: [
          { t_sec: 0, t_str: '00:00', text: '你好', speaker: 'SPEAKER_00' },
          { t_sec: 3, t_str: '00:03', text: '你好呀', speaker: 'SPEAKER_01' },
        ],
        speaker_map: { SPEAKER_00: '主持人', SPEAKER_01: '嘉宾' },
      }),
    )
    renderShell()
    await waitFor(() => expect(screen.getAllByTestId('note-editor').length).toBeGreaterThan(0))
    expect(screen.getByText(/2 位说话人/)).not.toBeNull()
    // 折叠态不出现重命名输入
    expect(screen.queryByLabelText('SPEAKER_00 姓名')).toBeNull()
  })
})
