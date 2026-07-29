import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportTab } from '@/pages/WorkspacePage/TaskboardPage/ExportTab'
import type { WorkspaceItem } from '@/types/workspace'

const {
  downloadBatchExportMock,
  downloadExportMock,
  successMock,
  warningMock,
  errorMock,
} = vi.hoisted(() => ({
  downloadBatchExportMock: vi.fn(),
  downloadExportMock: vi.fn(),
  successMock: vi.fn(),
  warningMock: vi.fn(),
  errorMock: vi.fn(),
}))

vi.mock('@/services/workspaces', () => ({
  downloadBatchExport: downloadBatchExportMock,
  downloadExport: downloadExportMock,
}))

vi.mock('sonner', () => ({
  toast: {
    success: successMock,
    warning: warningMock,
    error: errorMock,
  },
}))

const ITEMS = [
  {
    item_id: 'video-1',
    name: '视频素材',
    type: 'video',
    source: 'url',
    source_value: 'https://example.com/video',
    status: 'done',
    preflight: { background_overrides: {}, models: {}, tasks: {} },
    results: { transcript: [{ text: '正文' }] },
    related_task_ids: [],
    tags: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    item_id: 'audio-1',
    name: '音频素材',
    type: 'audio',
    source: 'local',
    source_value: '/tmp/audio.mp3',
    status: 'done',
    preflight: { background_overrides: {}, models: {}, tasks: {} },
    results: { transcript: '正文' },
    related_task_ids: [],
    tags: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
] satisfies WorkspaceItem[]

describe('ExportTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    downloadBatchExportMock.mockResolvedValue({
      exportedCount: 2,
      skippedCount: 0,
      failedCount: 0,
    })
  })

  it('多选时调用批量导出并传递全部选中项', async () => {
    render(<ExportTab items={ITEMS} workspaceId="workspace-1" />)

    fireEvent.click(screen.getByRole('button', { name: '打包导出 (2 项)' }))

    await waitFor(() => {
      expect(downloadBatchExportMock).toHaveBeenCalledWith(
        'workspace-1',
        ['video-1', 'audio-1'],
      )
    })
    expect(downloadExportMock).not.toHaveBeenCalled()
    expect(successMock).toHaveBeenCalledWith('已导出 2 项')
  })

  it('部分跳过时明确提示数量', async () => {
    downloadBatchExportMock.mockResolvedValue({
      exportedCount: 1,
      skippedCount: 1,
      failedCount: 0,
    })
    render(<ExportTab items={ITEMS} workspaceId="workspace-1" />)

    fireEvent.click(screen.getByRole('button', { name: '打包导出 (2 项)' }))

    await waitFor(() => {
      expect(warningMock).toHaveBeenCalledWith('已导出 1 项，跳过 1 项')
    })
    expect(successMock).not.toHaveBeenCalled()
  })

  it('部分失败时明确提示数量', async () => {
    downloadBatchExportMock.mockResolvedValue({
      exportedCount: 1,
      skippedCount: 0,
      failedCount: 1,
    })
    render(<ExportTab items={ITEMS} workspaceId="workspace-1" />)

    fireEvent.click(screen.getByRole('button', { name: '打包导出 (2 项)' }))

    await waitFor(() => {
      expect(warningMock).toHaveBeenCalledWith('已导出 1 项，失败 1 项')
    })
    expect(successMock).not.toHaveBeenCalled()
  })

  it('取消全部选择后禁用导出', () => {
    render(<ExportTab items={ITEMS} workspaceId="workspace-1" />)

    fireEvent.click(screen.getByText('视频素材'))
    fireEvent.click(screen.getByText('音频素材'))

    expect(screen.getByRole('button', { name: '打包导出 (0 项)' })).toBeDisabled()
  })
})
