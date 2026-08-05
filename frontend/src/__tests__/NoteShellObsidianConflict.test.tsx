import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Q3 / D3：Obsidian 直写同名冲突——默认「另存为新版本」，覆盖必须主动选择。
 *
 * 覆盖审查要求：
 * - 目标已存在时先弹冲突确认框，不静默写入；
 * - 弹框明确提示默认「另存为新版本」，覆盖是主动选择；
 * - 确认后按所选 on_conflict 调用后端。
 */

vi.mock('@/services/workspaces', () => ({
  getItemNote: vi.fn(),
  getItemResult: vi.fn(),
  favoriteItem: vi.fn(),
  unfavoriteItem: vi.fn(),
  updateItemNote: vi.fn(),
  downloadSubtitles: vi.fn(),
  retryPipelineTask: vi.fn(),
  downloadItemNoteExport: vi.fn(),
  downloadOriginalMedia: vi.fn(),
  downloadSoftSubMedia: vi.fn(),
  downloadTranscript: vi.fn(),
  exportItemNoteObsidian: vi.fn(),
  exportNoteToObsidianVault: vi.fn(),
  startBurnSubtitles: vi.fn(),
  createChapterSummaries: vi.fn(),
  putItemNote: vi.fn(),
  updateSpeakerMap: vi.fn(),
}))

vi.mock('@/services/settings', () => ({
  fetchSettings: vi.fn(),
}))

vi.mock('@/services/inlineFrames', () => ({
  listInlineFrames: vi.fn().mockResolvedValue([]),
  getSuggestedFrames: vi.fn().mockResolvedValue([]),
  saveInlineFrames: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/pages/result/NoteShell/NoteAudioPanel', async () => {
  const React = await import('react')
  const Panel = React.forwardRef((_props: unknown, ref: unknown) => {
    React.useImperativeHandle(ref as never, () => ({
      seekTo: vi.fn(),
      togglePlay: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      captureScreenshot: vi.fn(),
      isPlaying: false,
      currentTime: 0,
      duration: 120,
      transportNode: null as unknown,
    }))
    return React.createElement('div', { 'data-testid': 'mock-audio-panel' })
  })
  return { default: Panel }
})

vi.mock('@/pages/results/LearningNotesPage/LNVideoPanel', async () => {
  const React = await import('react')
  const Panel = React.forwardRef((_props: unknown, ref: unknown) => {
    React.useImperativeHandle(ref as never, () => ({
      seekTo: vi.fn(),
      togglePlay: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      captureScreenshot: vi.fn(),
      isPlaying: false,
      currentTime: 0,
      duration: 120,
      transportNode: null as unknown,
    }))
    return React.createElement('div', { 'data-testid': 'mock-video-panel' })
  })
  return { default: Panel }
})

vi.mock('@/pages/result/NoteShell/NoteMediaCompanion', async () => {
  const React = await import('react')
  const Panel = React.forwardRef((_props: unknown, ref: unknown) => {
    React.useImperativeHandle(ref as never, () => ({ seekTo: vi.fn() }))
    return React.createElement('div', { 'data-testid': 'mock-companion-panel' })
  })
  return { default: Panel }
})

import { exportNoteToObsidianVault, getItemNote } from '@/services/workspaces'
import { fetchSettings } from '@/services/settings'

const exported = vi.mocked(exportNoteToObsidianVault)
const getSettings = vi.mocked(fetchSettings)

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  window.scrollTo = vi.fn() as never
  vi.clearAllMocks()
})

const textNote = {
  note_md: '# 测试笔记\n\n正文内容',
  frontmatter: { type: 'text', title: '我的笔记' },
  transcript: [],
  media: {},
  summaries: [],
}

function renderNote() {
  return render(
    <MemoryRouter initialEntries={['/workspaces/ws-1/items/item-1/note']}>
      <Routes>
        <Route path="/workspaces/:workspaceId/items/:itemId/note" element={<NoteShellWrapper />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openObsidianWrite(directWrite = true) {
  vi.mocked(getItemNote).mockResolvedValue(textNote as never)
  getSettings.mockResolvedValue({
    obsidian: { vault_path: '/vault', subdir: 'Inbox', direct_write: directWrite },
  } as never)
  renderNote()
  await waitFor(() => expect(vi.mocked(getItemNote)).toHaveBeenCalledWith('ws-1', 'item-1'), { timeout: 5000 })
  // 打开统一导出面板，选择 Obsidian 目的地并提交
  fireEvent.click(screen.getByTitle('导出'))
  await waitFor(() => expect(screen.getByRole('dialog', { name: '导出' })).toBeTruthy(), { timeout: 5000 })
  fireEvent.click(screen.getByRole('radio', { name: 'Obsidian' }))
  fireEvent.click(screen.getByRole('button', { name: /导出到 Obsidian/ }))
}

// 冲突确认框内的按钮（避免与历史面板里的同名文案冲突）
function withinDialog() {
  const dialog = screen.getByRole('alertdialog')
  return within(dialog)
}

describe('Q3 / D3: Obsidian 直写同名冲突', () => {
  it('设置关闭本地直写时不调用写入接口', async () => {
    await openObsidianWrite(false)

    await waitFor(() => expect(screen.getByText(/本地直写已关闭/)).toBeTruthy())
    expect(exported).not.toHaveBeenCalled()
  })

  it('目标已存在时先弹冲突确认框，不静默写入', async () => {
    exported.mockResolvedValueOnce({
      path: '/vault/Inbox/我的笔记.md',
      relative: 'Inbox/我的笔记.md',
      created: false,
      overwritten: false,
      dry_run: true,
      exists: true,
    } as never)
    await openObsidianWrite()

    await waitFor(
      () => expect(screen.getByText('Obsidian 已有同名文件')).toBeTruthy(),
      { timeout: 5000 },
    )
    // 描述文字里也有同名文案，用按钮角色精确定位
    expect(withinDialog().getByRole('button', { name: '另存为新版本' })).toBeTruthy()
    expect(
      withinDialog().getByRole('button', { name: '覆盖' }).classList.contains('bg-destructive'),
    ).toBe(true)
    // dry_run 预检已调用；尚未真正写入
    expect(exported).toHaveBeenCalledWith(
      'ws-1',
      'item-1',
      expect.objectContaining({ dry_run: true, source_kind: 'main' }),
    )
    expect(exported).not.toHaveBeenCalledWith(
      'ws-1',
      'item-1',
      expect.objectContaining({ on_conflict: 'overwrite' }),
    )
  })

  it('无冲突时直接另存（rename）写入', async () => {
    exported.mockResolvedValueOnce({
      path: '/vault/Inbox/我的笔记.md',
      relative: 'Inbox/我的笔记.md',
      created: true,
      overwritten: false,
      dry_run: true,
      exists: false,
    } as never)
    exported.mockResolvedValueOnce({
      path: '/vault/Inbox/我的笔记.md',
      relative: 'Inbox/我的笔记.md',
      created: true,
      overwritten: false,
    } as never)
    await openObsidianWrite()

    await waitFor(
      () =>
        expect(exported).toHaveBeenCalledWith(
          'ws-1',
          'item-1',
          expect.objectContaining({ on_conflict: 'rename' }),
        ),
      { timeout: 5000 },
    )
    // 无冲突时不出现确认框
    expect(screen.queryByText('Obsidian 已有同名文件')).toBeNull()
  })

  it('冲突弹框点「覆盖」才以 overwrite 写入', async () => {
    exported.mockResolvedValueOnce({
      path: '/vault/Inbox/我的笔记.md',
      relative: 'Inbox/我的笔记.md',
      created: false,
      overwritten: false,
      dry_run: true,
      exists: true,
    } as never)
    await openObsidianWrite()
    await waitFor(() => expect(screen.getByText('Obsidian 已有同名文件')).toBeTruthy(), { timeout: 5000 })

    exported.mockResolvedValueOnce({
      path: '/vault/Inbox/我的笔记.md',
      relative: 'Inbox/我的笔记.md',
      created: false,
      overwritten: true,
    } as never)
    fireEvent.click(withinDialog().getByRole('button', { name: '覆盖' }))

    await waitFor(
      () =>
        expect(exported).toHaveBeenCalledWith(
          'ws-1',
          'item-1',
          expect.objectContaining({ on_conflict: 'overwrite' }),
        ),
      { timeout: 5000 },
    )
  })

  it('冲突弹框点「另存为新版本」以 rename 写入', async () => {
    exported.mockResolvedValueOnce({
      path: '/vault/Inbox/我的笔记.md',
      relative: 'Inbox/我的笔记.md',
      created: false,
      overwritten: false,
      dry_run: true,
      exists: true,
    } as never)
    await openObsidianWrite()
    await waitFor(() => expect(screen.getByText('Obsidian 已有同名文件')).toBeTruthy(), { timeout: 5000 })

    exported.mockResolvedValueOnce({
      path: '/vault/Inbox/我的笔记-1.md',
      relative: 'Inbox/我的笔记-1.md',
      created: true,
      overwritten: false,
    } as never)
    fireEvent.click(withinDialog().getByRole('button', { name: '另存为新版本' }))

    await waitFor(
      () =>
        expect(exported).toHaveBeenCalledWith(
          'ws-1',
          'item-1',
          expect.objectContaining({ on_conflict: 'rename' }),
        ),
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
