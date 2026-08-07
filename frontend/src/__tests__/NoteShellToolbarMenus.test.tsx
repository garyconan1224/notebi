import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NoteShell from '@/pages/result/NoteShell'
import { EMPTY_EDITOR_FORMATTING_STATE } from '@/pages/result/NoteShell/editorFormatting'
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
    <div
      data-testid="note-editor"
      data-register-commands={String(registerCommands)}
      className="note-milkdown"
    >
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

describe('NoteShell 统一导出面板（Q3 / D3）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadTranscript.mockResolvedValue(undefined)
    useLnEditorStore.getState().resetFormatting()
  })

  it('打开导出面板：内容 / 格式 / 选项 / 目的地四段式', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    const panel = screen.getByRole('dialog', { name: '导出' })
    expect(panel).toBeInTheDocument()
    expect(screen.getByText('1 · 内容')).toBeInTheDocument()
    expect(screen.getByText('2 · 格式')).toBeInTheDocument()
    expect(screen.getByText('3 · 选项')).toBeInTheDocument()
    expect(screen.getByText('4 · 目的地')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '转写' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '本地下载' })).toHaveAttribute('aria-checked', 'true')
  })

  it('转写默认时间轴格式，切到文档格式出现「带时间轴」开关', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    expect(screen.getByRole('radio', { name: 'SRT' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'VTT' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'ASS' })).toBeInTheDocument()
    // 时间轴格式不显示「带时间轴」开关
    expect(screen.queryByLabelText('带时间轴')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: 'Markdown' }))
    expect(screen.getByLabelText('带时间轴')).toBeInTheDocument()
  })

  it('文件名预览按 D10 规则实时更新', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    expect(screen.getByLabelText('文件名预览').textContent).toContain('_转写_仅原文.srt')
    fireEvent.click(screen.getByRole('radio', { name: 'Markdown' }))
    expect(screen.getByLabelText('文件名预览').textContent).toContain('_转写_仅原文.md')
  })

  it('无说话人数据时禁用「带说话人」开关', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    const speaker = screen.getByRole('checkbox', { name: /带说话人/ }) as HTMLInputElement
    expect(speaker).toBeDisabled()
    expect(screen.getByText('该录音未识别到说话人')).toBeInTheDocument()
  })
})

describe('NoteShell 浮动正文格式工具栏（Q6）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLnEditorStore.getState().resetFormatting()
  })

  function selectEditorText() {
    const editor = screen.getAllByTestId('note-editor')[0]
    const textNode = editor.firstChild as Node
    const range = document.createRange()
    range.selectNodeContents(textNode)
    ;(range as Range & { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = vi.fn(
      () =>
        ({
          top: 120,
          left: 160,
          width: 90,
          height: 20,
          right: 250,
          bottom: 140,
          x: 160,
          y: 120,
          toJSON: () => ({}),
        }) as DOMRect,
    )
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }

  it('选中正文文字后出现浮动工具栏并提供格式操作', async () => {
    const runFormat = vi.fn(() => true)
    useLnEditorStore.getState().setFormatFn(runFormat)
    useLnEditorStore.getState().setFormattingState({
      ...EMPTY_EDITOR_FORMATTING_STATE,
      bold: true,
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
      canUnderline: true,
    })

    await renderNoteShell(TEXT_NOTE)
    selectEditorText()

    const toolbar = await screen.findByRole('toolbar', { name: '正文格式' })
    const bold = within(toolbar).getByRole('button', { name: '加粗' })
    expect(bold).not.toBeDisabled()
    expect(bold).toHaveAttribute('aria-pressed', 'true')
    expect(within(toolbar).getByRole('button', { name: '斜体' })).not.toBeDisabled()
    // Q6：H2 开关升级为段落下拉（正文/H1/H2/H3）
    const paragraph = within(toolbar).getByRole('combobox', { name: '段落格式' })
    expect(paragraph).not.toBeDisabled()
    fireEvent.change(paragraph, { target: { value: '2' } })
    expect(runFormat).toHaveBeenCalledWith('heading', '2')
    expect(within(toolbar).getByRole('button', { name: '下划线' })).not.toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: '无序列表' })).not.toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: '删除线' })).not.toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: '链接' })).not.toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: '引用' })).not.toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: '有序列表' })).not.toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: '待办列表' })).not.toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: '代码块' })).not.toBeDisabled()
    expect(within(toolbar).getByRole('button', { name: '左对齐' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(toolbar).getByRole('button', { name: '居中' }))
    expect(within(toolbar).getByRole('button', { name: '居中' })).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getAllByTestId('note-editor').map(
        (editor) => editor.getAttribute('data-register-commands'),
      ),
    ).toEqual(['true', 'false'])

    fireEvent.mouseDown(within(toolbar).getByRole('button', { name: '无序列表' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: '无序列表' }))
    expect(runFormat).toHaveBeenCalledWith('bulletList')
  })

  it('未选中文字时不显示浮动工具栏', async () => {
    await renderNoteShell(TEXT_NOTE)
    expect(screen.queryByRole('toolbar', { name: '正文格式' })).toBeNull()
  })

  it('Esc 关闭浮动工具栏', async () => {
    await renderNoteShell(TEXT_NOTE)
    selectEditorText()
    const toolbar = await screen.findByRole('toolbar', { name: '正文格式' })
    expect(toolbar).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: '正文格式' })).toBeNull(),
    )
  })
})



describe('NoteShell 正文设置（浮动工具栏 Q2）', () => {
  function selectEditorText() {
    const editor = screen.getAllByTestId('note-editor')[0]
    const textNode = editor.firstChild as Node
    const range = document.createRange()
    range.selectNodeContents(textNode)
    ;(range as Range & { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = vi.fn(
      () =>
        ({
          top: 120,
          left: 160,
          width: 90,
          height: 20,
          right: 250,
          bottom: 140,
          x: 160,
          y: 120,
          toJSON: () => ({}),
        }) as DOMRect,
    )
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }

  it('浮动工具栏不再提供正文设置入口（偏好已移入设置页「笔记显示」）', async () => {
    await renderNoteShell(TEXT_NOTE)
    selectEditorText()

    const toolbar = await screen.findByRole('toolbar', { name: '正文格式' })
    expect(within(toolbar).queryByRole('button', { name: '正文设置' })).toBeNull()
    expect(screen.queryByRole('group', { name: '正文偏好设置' })).toBeNull()

    // 顶栏也不再有 Aa 设置入口
    expect(screen.queryByRole('button', { name: /Aa 设置/ })).toBeNull()
  })
})
describe('NoteShell 菜单交互（阶段 A1）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadTranscript.mockResolvedValue(undefined)
  })

  it('点击面板外部关闭导出面板', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(screen.getByRole('dialog', { name: '导出' })).toBeTruthy()

    // 点击面板遮罩
    fireEvent.mouseDown(document.querySelector('.nibi-export-panel-backdrop') as HTMLElement)

    expect(screen.queryByRole('dialog', { name: '导出' })).toBeNull()
  })

  it('Escape 关闭导出面板', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(screen.getByRole('dialog', { name: '导出' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: '导出' })).toBeNull()
  })

  it('打开导出面板会关闭 AI 菜单', async () => {
    await renderNoteShell()

    // 先打开 AI 菜单
    fireEvent.click(screen.getByRole('button', { name: 'AI 工具' }))
    expect(screen.getByText('问 AI')).toBeTruthy()

    // 打开导出面板 → AI 菜单关闭
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(screen.queryByText('问 AI')).toBeNull()
    expect(screen.getByRole('dialog', { name: '导出' })).toBeTruthy()
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

describe('Q3 媒体导出与转写选项', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadTranscript.mockResolvedValue(undefined)
    useLnEditorStore.getState().resetFormatting()
  })

  const VIDEO_NOTE: ItemNote = {
    frontmatter: { title: '测试视频', type: 'video', version: 1, created_at: '2026-07-01T00:00:00Z' },
    source_md: '',
    note_md: '---\ntitle: 测试视频\ntype: video\nversion: 1\n---\n\n视频正文',
    summaries: [],
    note_dir: '',
    media: { video: { url: '/static/v.mp4', duration: 60 } },
    transcript: [{ t_sec: 0, t_str: '00:00', text: '字幕内容' }],
  }

  it('视频笔记导出面板媒体页只有原视频 + 带字幕开关', async () => {
    await renderNoteShell(VIDEO_NOTE)
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    fireEvent.click(screen.getByRole('radio', { name: '媒体文件' }))
    expect(screen.getByRole('radio', { name: '原视频' })).toBeInTheDocument()
    // SRT/VTT/烧录不再在媒体页出现，字幕区分放转录页
    expect(screen.queryByRole('radio', { name: /软字幕/ })).toBeNull()
    expect(screen.queryByRole('radio', { name: /烧录/ })).toBeNull()
    const subtitle = screen.getByRole('checkbox', { name: '带字幕' }) as HTMLInputElement
    expect(subtitle).toBeInTheDocument()
    // 媒体文件不支持云笔记目的地
    expect(screen.queryByRole('radio', { name: 'Notion' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Obsidian' })).toBeNull()
  })

  it('音频笔记媒体页只提供「仅音频文件」', async () => {
    await renderNoteShell()
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    fireEvent.click(screen.getByRole('radio', { name: '媒体文件' }))
    expect(screen.getByRole('radio', { name: '仅音频文件' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('radio', { name: '烧录字幕视频' })).toBeNull()
  })

  it('转写页提供说话人 / 语言选项', async () => {
    await renderNoteShell(VIDEO_NOTE)
    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    const speaker = screen.getByRole('checkbox', { name: /带说话人/ }) as HTMLInputElement
    expect(speaker).toBeDisabled()
    expect(screen.getByRole('radio', { name: '仅原文' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '双语' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '仅翻译' })).toBeInTheDocument()
  })

  it('文本内容目的地包含 Obsidian / Notion / 飞书', async () => {
    await renderNoteShell(VIDEO_NOTE)
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(screen.getByRole('radio', { name: 'Notion' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '飞书' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Obsidian' })).toBeInTheDocument()
  })
})
