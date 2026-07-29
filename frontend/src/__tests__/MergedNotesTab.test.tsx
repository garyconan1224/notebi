import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MergedNotesTab } from '@/pages/WorkspacePage/TaskboardPage/MergedNotesTab'
import type { MergedNote } from '@/services/workspaces'

const {
  createMock,
  deleteMock,
  listVersionsMock,
  restoreMock,
  updateMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  deleteMock: vi.fn(),
  listVersionsMock: vi.fn(),
  restoreMock: vi.fn(),
  updateMock: vi.fn(),
}))

vi.mock('@/services/workspaces', () => ({
  createMergedNote: createMock,
  deleteMergedNote: deleteMock,
  listMergedNoteVersions: listVersionsMock,
  restoreMergedNoteVersion: restoreMock,
  updateMergedNote: updateMock,
}))

const note: MergedNote = {
  merged_id: 'merged-1',
  title: '综合主题',
  item_ids: ['item-1'],
  content_md: '第二版',
  created_at: '2026-01-01',
  current_version_id: 'v2',
  updated_at: '2026-01-02',
  deleted_at: '',
  versions: [
    {
      version_id: 'v1',
      content_md: '第一版',
      item_ids: ['item-1'],
      source_snapshot: [{
        item_id: 'item-1',
        content_id: 'content-1',
        lineage_id: 'lineage-1',
        title: '素材一',
        summary_hash: 'hash',
      }],
      created_at: '2026-01-01',
      created_by: 'user',
    },
    {
      version_id: 'v2',
      content_md: '第二版',
      item_ids: ['item-1'],
      source_snapshot: [{
        item_id: 'item-1',
        content_id: 'content-1',
        lineage_id: 'lineage-1',
        title: '素材一',
        summary_hash: 'hash',
      }],
      created_at: '2026-01-02',
      created_by: 'user',
    },
  ],
}

describe('MergedNotesTab', () => {
  beforeEach(() => {
    createMock.mockReset()
    deleteMock.mockReset()
    listVersionsMock.mockReset()
    restoreMock.mockReset()
    updateMock.mockReset()
    listVersionsMock.mockResolvedValue(note.versions)
    restoreMock.mockResolvedValue(note)
  })

  it('显示当前版本来源并允许查看版本历史', async () => {
    render(
      <MemoryRouter>
        <MergedNotesTab workspaceId="ws" notes={[note]} items={[]} onRefresh={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('第二版')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '来源：素材一' })).toHaveAttribute(
      'href',
      '/workspaces/ws/items/item-1/note',
    )
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }))
    expect(await screen.findByLabelText('综合主题版本历史')).toBeInTheDocument()
  })

  it('恢复版本需要确认且追加版本，不静默覆盖', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true)
    const refresh = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <MergedNotesTab workspaceId="ws" notes={[note]} items={[]} onRefresh={refresh} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }))
    await screen.findByLabelText('综合主题版本历史')
    const restoreButtons = screen.getAllByRole('button', { name: '恢复此版本' })
    fireEvent.click(restoreButtons[0])
    expect(restoreMock).not.toHaveBeenCalled()
    fireEvent.click(restoreButtons[0])
    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith('ws', 'merged-1', 'v1'))
    expect(refresh).toHaveBeenCalled()
    confirm.mockRestore()
  })
})
