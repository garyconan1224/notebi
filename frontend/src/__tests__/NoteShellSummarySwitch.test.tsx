import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NoteShell from '@/pages/result/NoteShell'
import type { ItemSummary } from '@/services/summaries'
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

const AUDIO_NOTE: ItemNote = {
  frontmatter: {
    title: '测试音频',
    type: 'audio',
    version: 1,
    created_at: '2026-07-01T00:00:00Z',
  },
  source_md: '**[00:00]** 原始转写',
  note_md: '---\ntitle: 测试音频\ntype: audio\nversion: 1\n---\n\n## 转写正文\n\n**[00:00]** 原始转写不应进入编辑器',
  summaries: [],
  note_dir: '',
  media: { audio: '/static/audio.m4a' },
  transcript: [{ t_sec: 0, t_str: '00:00', text: '原始转写不应进入编辑器' }],
}

const VIDEO_NOTE: ItemNote = {
  ...AUDIO_NOTE,
  frontmatter: { ...AUDIO_NOTE.frontmatter, title: '测试视频', type: 'video' },
  media: { video: { url: '/static/video.mp4', duration: 60 } },
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
    mocks.updateSpeakerMap.mockResolvedValue({
      speaker_map: { SPEAKER_00: '主持人' },
      summary_refresh: {
        status: 'updated',
        reason: '已同步替换 1 份区分说话人总结',
        updated_count: 1,
      },
    })
    mocks.downloadTranscript.mockResolvedValue(undefined)
    mocks.retryPipelineTask.mockResolvedValue({ task_id: 'audio-summary-retry' })
    useTaskStore.setState({
      tasks: [],
      hiddenTaskIds: [],
      currentTaskId: null,
      isPolling: false,
    })
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
    fireEvent.click(screen.getByRole('button', { name: /V0/ }))

    expectAnyEditorToContain('总结正文')
    expect(screen.getByRole('button', { name: /标准总结 · V0/ })).not.toBeNull()
    expect(mocks.putItemNote).not.toHaveBeenCalled()
  })

  it('总结版本菜单按素材级 V0、V1、V2 连续排序，不按模板分组排序', async () => {
    mocks.listSummaries.mockResolvedValue([
      { ...SUMMARY_V0, summary_id: 'summary-v2', template: 'standard', version: 2 },
      { ...SUMMARY_V0, summary_id: 'summary-v0', template: 'speaker_consultant_detailed', version: 0, summary_mode: 'speaker_aware' },
      { ...SUMMARY_V0, summary_id: 'summary-v1', template: 'speaker_consultant_meeting_customer_voice', version: 1, summary_mode: 'speaker_aware' },
    ])

    render(
      <MemoryRouter>
        <NoteShell workspaceId="ws-1" itemId="item-1" />
      </MemoryRouter>,
    )

    await waitFor(() => expectAnyEditorToContain('主笔记正文'))
    fireEvent.click(screen.getByRole('button', { name: /主笔记 v1/ }))

    const versions = Array.from(document.querySelectorAll('.nibi-note-version-choice strong'))
      .map((node) => node.textContent)
    expect(versions).toEqual(['V0', 'V1', 'V2'])
  })

  it.each([
    ['音频', AUDIO_NOTE],
    ['视频', VIDEO_NOTE],
  ])('%s笔记不把完整转写正文交给 Milkdown 编辑器', async (_label, mediaNote) => {
    mocks.getItemNote.mockResolvedValue(mediaNote)
    mocks.listSummaries.mockResolvedValue([])

    render(
      <MemoryRouter>
        <NoteShell workspaceId="ws-1" itemId="item-1" />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.queryByTestId('note-editor')).not.toBeNull()
    })

    expect(screen.getByTestId('note-editor').textContent).not.toContain('原始转写不应进入编辑器')
  })

  it('音频没有总结时显示明确空态和生成入口', async () => {
    mocks.getItemNote.mockResolvedValue(AUDIO_NOTE)
    mocks.listSummaries.mockResolvedValue([])

    render(
      <MemoryRouter>
        <NoteShell workspaceId="ws-1" itemId="item-1" />
      </MemoryRouter>,
    )

    expect(await screen.findByText('尚未生成总结')).not.toBeNull()
    expect(screen.getByRole('button', { name: '生成默认总结' })).not.toBeNull()
  })

  it('音频自动总结因服务繁忙失败时给出仅重试摘要的入口', async () => {
    mocks.getItemNote.mockResolvedValue({
      ...AUDIO_NOTE,
      summary_failure: { stage: 'summary', code: 'rate_limited', message: '摘要生成失败：服务繁忙' },
      summary_retry_task_id: 'audio-failed-summary',
    })
    mocks.listSummaries.mockResolvedValue([])

    render(
      <MemoryRouter>
        <NoteShell workspaceId="ws-1" itemId="item-1" />
      </MemoryRouter>,
    )

    expect(await screen.findByText('自动总结暂未完成')).not.toBeNull()
    expect(screen.getByText('模型服务当前繁忙，转录和说话人结果已保留。')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '仅重试摘要' }))

    await waitFor(() => {
      expect(mocks.retryPipelineTask).toHaveBeenCalledWith('audio-failed-summary', { stage: 'summary' })
    })
  })

  it('长音频关键时间点覆盖到音频末段', async () => {
    const transcript = Array.from({ length: 14 }, (_, index) => ({
      t_sec: index * 1080,
      t_str: `${Math.floor(index * 18 / 60)}:${String(index * 18 % 60).padStart(2, '0')}:00`,
      text: `第 ${index + 1} 段内容`,
    }))
    mocks.getItemNote.mockResolvedValue({ ...AUDIO_NOTE, transcript })
    mocks.listSummaries.mockResolvedValue([])

    render(
      <MemoryRouter>
        <NoteShell workspaceId="ws-1" itemId="item-1" />
      </MemoryRouter>,
    )

    expect(await screen.findByText('3:36:00')).not.toBeNull()
  })

  it('音频导出菜单提供无时间轴文章和按说话人分组版本', async () => {
    mocks.getItemNote.mockResolvedValue({
      ...AUDIO_NOTE,
      speaker_map: { SPEAKER_00: '主持人' },
      transcript: [{ t_sec: 0, t_str: '00:00', text: '开场。', speaker: 'SPEAKER_00' }],
    })
    mocks.listSummaries.mockResolvedValue([])

    render(
      <MemoryRouter>
        <NoteShell workspaceId="ws-1" itemId="item-1" />
      </MemoryRouter>,
    )

    await screen.findByText('尚未生成总结')
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    // 新契约：菜单项不带笔记标题
    expect(screen.getByRole('button', { name: '转写文本' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '转写文本（区分说话人）' }))
    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }))

    await waitFor(() => {
      // downloadTranscript 现在接收标题作为第 4 个参数，用于 fallback 文件名
      expect(mocks.downloadTranscript).toHaveBeenCalledWith(
        'ws-1',
        'item-1',
        'speaker_grouped',
        '测试音频',
      )
    })
  })

  it('新总结完成后自动切到服务端返回的新版本', async () => {
    const newSummary = {
      ...SUMMARY_V0,
      summary_id: 'summary-v1',
      version: 1,
      content_md: '# 标准总结 v1\n\n最新总结正文',
    }
    mocks.createSummary.mockResolvedValue({ task_id: 'summary-task-1' })
    mocks.listSummaries.mockResolvedValue([SUMMARY_V0, newSummary])

    render(
      <MemoryRouter>
        <NoteShell workspaceId="ws-1" itemId="item-1" />
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: /主笔记 v1/ })
    fireEvent.click(screen.getByRole('button', { name: '新建总结' }))
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    await waitFor(() => expect(mocks.createSummary).toHaveBeenCalled())

    useTaskStore.getState().updateTask('summary-task-1', {
      status: 'SUCCESS',
      progress: 1,
      result: { summary: newSummary },
      updated_at: '2026-07-01T00:20:00Z',
    })

    await screen.findByText('V1 总结生成完成')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /标准总结 · V1/ })).not.toBeNull()
      expectAnyEditorToContain('最新总结正文')
    })
  })

  it('生成期间用户主动切换版本时不抢回新总结', async () => {
    const newSummary = {
      ...SUMMARY_V0,
      summary_id: 'summary-v1',
      version: 1,
      content_md: '# 标准总结 v1\n\n最新总结正文',
    }
    mocks.createSummary.mockResolvedValue({ task_id: 'summary-task-2' })
    mocks.listSummaries.mockResolvedValue([SUMMARY_V0, newSummary])

    render(
      <MemoryRouter>
        <NoteShell workspaceId="ws-1" itemId="item-1" />
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: /主笔记 v1/ })
    fireEvent.click(screen.getByRole('button', { name: '新建总结' }))
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    await waitFor(() => expect(mocks.createSummary).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /主笔记 v1/ }))
    fireEvent.click(screen.getByRole('button', { name: /V0/ }))

    useTaskStore.getState().updateTask('summary-task-2', {
      status: 'SUCCESS',
      progress: 1,
      result: { summary: newSummary },
      updated_at: '2026-07-01T00:20:00Z',
    })

    await screen.findByText('V1 总结生成完成')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /标准总结 · V0/ })).not.toBeNull()
      expectAnyEditorToContain('总结正文')
    })
  })

  it('改名说话人后刷新当前区分说话人总结正文', async () => {
    const rawSummary = {
      ...SUMMARY_V0,
      summary_mode: 'speaker_aware' as const,
      content_md: '# 总结\n\nSPEAKER_00 提出关键结论',
    }
    const renamedSummary = {
      ...rawSummary,
      content_md: '# 总结\n\n主持人 提出关键结论',
    }
    mocks.getItemNote.mockResolvedValue({
      ...AUDIO_NOTE,
      transcript: [{ t_sec: 0, t_str: '00:00', text: '开场。', speaker: 'SPEAKER_00' }],
    })
    mocks.listSummaries.mockImplementation(() => Promise.resolve(
      mocks.updateSpeakerMap.mock.calls.length > 0 ? [renamedSummary] : [rawSummary],
    ))

    render(
      <MemoryRouter>
        <NoteShell workspaceId="ws-1" itemId="item-1" />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /主笔记 v1/ })).not.toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: /主笔记 v1/ }))
    fireEvent.click(screen.getByRole('button', { name: /V0/ }))
    expectAnyEditorToContain('SPEAKER_00 提出关键结论')

    fireEvent.click(screen.getByRole('button', { name: /S00/ }))
    const input = document.querySelector<HTMLInputElement>('.nibi-audio-speaker-input')
    expect(input).not.toBeNull()
    fireEvent.change(input!, { target: { value: '主持人' } })
    fireEvent.keyDown(input!, { key: 'Enter' })

    await waitFor(() => {
      expect(mocks.updateSpeakerMap).toHaveBeenCalledWith('ws-1', 'item-1', { SPEAKER_00: '主持人' }, {})
      expectAnyEditorToContain('主持人 提出关键结论')
    })
  })
})
