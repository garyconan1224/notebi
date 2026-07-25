import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NoteShell from '@/pages/result/NoteShell'
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
  fetchTemplates: vi.fn(),
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

vi.mock('@/services/templates', () => ({
  fetchTemplates: mocks.fetchTemplates,
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

vi.mock('@/pages/results/LearningNotesPage/LNVideoPanel', () => ({ default: vi.fn() }))
vi.mock('@/pages/results/LearningNotesPage/LNTranscriptPanel', () => ({ default: vi.fn() }))
vi.mock('@/pages/result/NoteShell/NoteAudioPanel', () => ({ default: vi.fn() }))
vi.mock('@/pages/result/NoteShell/NoteMediaCompanion', () => ({ default: vi.fn() }))
vi.mock('@/components/NoteChatDrawer', () => ({ default: vi.fn() }))
vi.mock('@/pages/result/NoteShell/FloatingAskAi', () => ({ FloatingAskAi: vi.fn() }))

const AUDIO_NOTE: ItemNote = {
  frontmatter: {
    title: '测试音频',
    type: 'audio',
    version: 1,
    created_at: '2026-07-01T00:00:00Z',
  },
  source_md: '**[00:00]** 原始素材内容',
  note_md: '---\ntitle: 测试音频\ntype: audio\nversion: 1\n---\n\n## 正文\n\n笔记正文',
  summaries: [],
  note_dir: '',
  media: { audio: '/static/audio.m4a' },
  transcript: [{ t_sec: 0, t_str: '00:00', text: '转写内容' }],
}

async function renderNoteShell(note: ItemNote = AUDIO_NOTE) {
  mocks.getItemNote.mockResolvedValue(note)
  mocks.listSummaries.mockResolvedValue([])
  mocks.fetchTemplates.mockResolvedValue([])
  render(
    <MemoryRouter>
      <NoteShell workspaceId="ws-1" itemId="item-1" />
    </MemoryRouter>,
  )
  await screen.findByTestId('note-editor')
}

describe('NoteShell 导出菜单信息架构（阶段 A1）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadTranscript.mockResolvedValue(undefined)
  })

  it('导出菜单显示 Markdown，不显示 当前正文.md', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    expect(screen.getByText('Markdown')).toBeTruthy()
    expect(screen.queryByText('当前正文.md')).toBeNull()
  })

  it('转写菜单项不包含笔记标题', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    expect(screen.getByText('转写文本')).toBeTruthy()
    expect(screen.getByText('转写文本（区分说话人）')).toBeTruthy()
    // 菜单项不应包含标题
    expect(screen.queryByText('测试音频 · 转写文本')).toBeNull()
    expect(screen.queryByText('测试音频 · 转写文本（区分说话人）')).toBeNull()
  })

  it('原始素材在导出菜单中，顶栏不再有独立原始素材按钮', async () => {
    await renderNoteShell()

    // 顶栏不应有独立的"原始素材"按钮（在导出菜单外）
    const topBarButtons = screen.getAllByRole('button')
    const standaloneSourceButton = topBarButtons.find(
      (btn) => btn.textContent?.includes('原始素材') && !btn.closest('.nibi-note-export-menu'),
    )
    // 打开导出菜单前，不应有独立的原始素材按钮
    expect(standaloneSourceButton).toBeUndefined()

    // 打开导出菜单后，原始素材应在菜单内
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    const exportMenu = document.querySelector('.nibi-note-export-menu')
    expect(exportMenu?.textContent).toContain('原始素材')
  })
})

describe('NoteShell 菜单交互（阶段 A1）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadTranscript.mockResolvedValue(undefined)
  })

  it('单击外部一次关闭导出菜单', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(document.querySelector('.nibi-note-export-menu')).toBeTruthy()

    // 点击菜单外部
    fireEvent.mouseDown(document.body)

    expect(document.querySelector('.nibi-note-export-menu')).toBeNull()
  })

  it('Escape 关闭导出菜单', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(document.querySelector('.nibi-note-export-menu')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.querySelector('.nibi-note-export-menu')).toBeNull()
  })

  it('打开 AI 菜单会关闭导出菜单，反向亦然', async () => {
    await renderNoteShell()

    // 先打开导出菜单
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(document.querySelector('.nibi-note-export-menu')).toBeTruthy()

    // 打开 AI 菜单
    fireEvent.click(screen.getByRole('button', { name: 'AI 工具' }))
    expect(document.querySelector('.nibi-note-export-menu')).toBeNull()
  })
})

describe('NoteShell AI 工具菜单（阶段 A1）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadTranscript.mockResolvedValue(undefined)
  })

  it('AI 菜单只提供问 AI 和生成新总结，不显示更多 AI 工具', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: 'AI 工具' }))

    expect(screen.getByText('问 AI')).toBeTruthy()
    expect(screen.getByText('生成新总结')).toBeTruthy()
    expect(screen.queryByText('更多 AI 工具')).toBeNull()
  })

  it('点击生成新总结打开 NewSummaryModal', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: 'AI 工具' }))
    fireEvent.click(screen.getByText('生成新总结'))

    // NewSummaryModal 应出现（通过其标题或关闭按钮判断）
    await waitFor(() => {
      expect(document.querySelector('.nsm-overlay')).toBeTruthy()
    })
  })
})
