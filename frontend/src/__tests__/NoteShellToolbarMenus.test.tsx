import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NoteShell from '@/pages/result/NoteShell'
import { useLnEditorStore } from '@/store/lnEditorStore'
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
  default: ({
    markdown,
    registerCommands,
  }: {
    markdown: string
    registerCommands?: boolean
  }) => (
    <div data-testid="note-editor" data-register-commands={String(registerCommands)}>
      {markdown}
    </div>
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

const TEXT_NOTE: ItemNote = {
  ...AUDIO_NOTE,
  frontmatter: {
    ...AUDIO_NOTE.frontmatter,
    title: '测试文本',
    type: 'text',
  },
  note_md: '---\ntitle: 测试文本\ntype: text\nversion: 1\n---\n\n文本正文',
  media: {},
  transcript: [],
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
  await screen.findAllByTestId('note-editor')
}

describe('NoteShell 导出菜单信息架构（阶段 A1）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadTranscript.mockResolvedValue(undefined)
    useLnEditorStore.getState().resetFormatting()
  })

  it('导出先选择内容来源，再选择文件格式', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    expect(screen.getByText('选择内容')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /当前显示内容/ })).toBeInTheDocument()
    // 顶栏版本按钮也叫「主笔记」，这里只断言导出菜单内的内容来源项
    expect(within(document.querySelector('.nibi-note-export-menu') as HTMLElement).getByRole('button', { name: /^主笔记$/ })).toBeInTheDocument()
    expect(screen.queryByText('Markdown')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /当前显示内容/ }))
    expect(screen.getByText('选择格式')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Markdown' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'HTML' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回内容选择' })).toBeInTheDocument()
  })

  it('转写菜单项不包含笔记标题', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('button', { name: /转写文本$/ }))

    expect(screen.getByRole('button', { name: 'TXT 文章' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SRT 字幕' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'VTT 字幕' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ASS 字幕' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument()
  })

  it('按用途分组笔记与字幕导出格式', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(within(document.querySelector('.nibi-note-export-menu') as HTMLElement).getByRole('button', { name: /^主笔记$/ }))

    const exportMenu = document.querySelector('.nibi-note-export-menu')
    expect(exportMenu).not.toBeNull()
    const menu = within(exportMenu as HTMLElement)
    expect(menu.getByText('文档与打印')).toBeInTheDocument()
    expect(menu.getByText('演示与阅读')).toBeInTheDocument()
    expect(menu.getByText('知识管理')).toBeInTheDocument()
    expect(menu.getByRole('button', { name: 'Obsidian 包' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '返回内容选择' }))
    fireEvent.click(screen.getByRole('button', { name: /转写文本$/ }))
    expect(within(document.querySelector('.nibi-note-export-menu') as HTMLElement).getByText('字幕格式')).toBeInTheDocument()
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

describe('NoteShell 文本编辑器工具栏（S4）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLnEditorStore.getState().resetFormatting()
  })

  it('提供四个可访问的可执行格式按钮并反映选中状态', async () => {
    const runFormat = vi.fn(() => true)
    useLnEditorStore.getState().setFormatFn(runFormat)
    useLnEditorStore.getState().setFormattingState({
      bold: true,
      italic: false,
      strike: false,
      inlineCode: false,
      link: false,
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      taskList: false,
      codeBlock: false,
      canBold: true,
      canItalic: true,
      canStrike: true,
      canInlineCode: true,
      canLink: true,
      canHeading: true,
      canBlockquote: true,
      canBulletList: true,
      canOrderedList: true,
      canTaskList: true,
      canCodeBlock: true,
    })

    await renderNoteShell(TEXT_NOTE)

    const bold = screen.getByRole('button', { name: '加粗' })
    expect(bold).not.toBeDisabled()
    expect(bold).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '斜体' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '二级标题' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '无序列表' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '删除线' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '链接' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '引用' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '有序列表' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '待办列表' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '代码块' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '左对齐' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '居中' }))
    expect(screen.getByRole('button', { name: '居中' })).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getAllByTestId('note-editor').map(
        (editor) => editor.getAttribute('data-register-commands'),
      ),
    ).toEqual(['true', 'false'])

    fireEvent.mouseDown(screen.getByRole('button', { name: '无序列表' }))
    fireEvent.click(screen.getByRole('button', { name: '无序列表' }))
    expect(runFormat).toHaveBeenCalledWith('bulletList')
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

describe('NoteShell AI 工具菜单（S3）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadTranscript.mockResolvedValue(undefined)
  })

  it('删除重复总结入口并提供七种笔记工具', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: 'AI 工具' }))

    expect(screen.getByText('问 AI')).toBeTruthy()
    expect(screen.queryByText('生成新总结')).not.toBeInTheDocument()
    for (const label of [
      '思维导图',
      '行动项',
      '要点卡',
      '闪卡与测验',
      '术语表',
      '时间线',
      '选区改写',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })
})
