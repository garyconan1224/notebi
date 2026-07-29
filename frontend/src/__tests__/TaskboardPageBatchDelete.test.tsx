import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceItem, WorkspaceRecord } from '@/types/workspace'

// ── spies（hoisted，供 mock 工厂引用）──────────────────────
const taskStoreMocks = vi.hoisted(() => ({
  removeTasks: vi.fn(),
  removeByProject: vi.fn(),
}))
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
}))
const serviceMocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  listMergedNotes: vi.fn(),
  batchDeleteItems: vi.fn(),
}))

// ── mocks ────────────────────────────────────────────────
vi.mock('@/store/taskStore', () => ({
  useTaskStore: Object.assign(vi.fn(), {
    getState: () => ({
      removeTasks: taskStoreMocks.removeTasks,
      removeByProject: taskStoreMocks.removeByProject,
    }),
  }),
}))

vi.mock('sonner', () => ({ toast: toastMocks }))

vi.mock('@/hooks/usePipelineTasks', () => ({ usePipelineTasks: vi.fn() }))

vi.mock('@/lib/statusToast', () => ({
  withStatusToast: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))

vi.mock('@/services/workspaces', () => ({
  getWorkspace: serviceMocks.getWorkspace,
  getItemNote: vi.fn(),
  downloadCollectionHtml: vi.fn(),
  mergeNotes: vi.fn(),
  listMergedNotes: serviceMocks.listMergedNotes,
  favoriteItem: vi.fn(),
  removeWorkspaceItem: vi.fn(),
  unfavoriteItem: vi.fn(),
}))

vi.mock('@/services/library', () => ({
  batchDeleteItems: serviceMocks.batchDeleteItems,
}))

// 重型子组件打桩，只保留批量删除入口按钮
vi.mock('@/pages/WorkspacePage/TaskboardPage/TaskboardHead', () => ({
  TaskboardHead: () => null,
}))
vi.mock('@/pages/WorkspacePage/TaskboardPage/MaterialsTab', () => ({
  MaterialsTab: (props: { onDeleteSelected?: (ids: string[]) => void }) => (
    <button onClick={() => props.onDeleteSelected?.(['item-a', 'item-b'])}>
      删除选中
    </button>
  ),
}))
vi.mock('@/components/workspace/AddMaterialModal', () => ({ AddMaterialModal: () => null }))
vi.mock('@/pages/WorkspacePage/TaskboardPage/BackgroundEditor', () => ({ BackgroundEditor: () => null }))
vi.mock('@/pages/WorkspacePage/TaskboardPage/MergeModal', () => ({ MergeModal: () => null }))
vi.mock('@/pages/WorkspacePage/TaskboardPage/ChatTab', () => ({ ChatTab: () => null }))
vi.mock('@/pages/WorkspacePage/TaskboardPage/ExportTab', () => ({ ExportTab: () => null }))
vi.mock('@/pages/WorkspacePage/TaskboardPage/FavoritesTab', () => ({ FavoritesTab: () => null }))

import TaskboardPage from '@/pages/WorkspacePage/TaskboardPage'

const makeItem = (id: string, taskIds: string[]): WorkspaceItem => ({
  item_id: id,
  type: 'video',
  source: 'url',
  source_value: 'http://example.com/x',
  name: id,
  status: 'done',
  preflight: { background_overrides: {}, models: {}, tasks: {} },
  results: {},
  thumbnail: null,
  favorite: false,
  related_task_ids: taskIds,
  tags: {},
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
})

const WORKSPACE: WorkspaceRecord = {
  workspace_id: 'ws1',
  name: '合集1',
  status: 'active',
  trashed: false,
  background: { content_type: '', participants: [], topic: '', glossary: [], purpose: '' },
  items: [makeItem('item-a', ['t-a']), makeItem('item-b', ['t-b'])],
  favorites: [],
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  kind: 'note',
  source: 'url',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/workspaces/ws1']}>
      <Routes>
        <Route path="/workspaces/:id" element={<TaskboardPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TaskboardPage 批量删除部分失败（P1 回归）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    serviceMocks.getWorkspace.mockResolvedValue(WORKSPACE)
    serviceMocks.listMergedNotes.mockResolvedValue([])
  })

  it('item 部分失败时，只清理成功项（removed_ids）的任务，失败项任务保留', async () => {
    // item-a 删除成功，item-b 删除失败
    serviceMocks.batchDeleteItems.mockResolvedValue({
      removed: 1,
      failed: 1,
      removed_ids: ['item-a'],
    })

    renderPage()

    const btn = await screen.findByText('删除选中')
    fireEvent.click(btn)

    await waitFor(() => {
      expect(taskStoreMocks.removeTasks).toHaveBeenCalledTimes(1)
    })
    // 只移除成功项 item-a 的任务 t-a，不能误删失败项 item-b 的 t-b
    expect(taskStoreMocks.removeTasks).toHaveBeenCalledWith(['t-a'])
    const removedIds = taskStoreMocks.removeTasks.mock.calls.flat()
    expect(removedIds).not.toContain('t-b')
    // 部分失败应给出 warning 而非 success
    expect(toastMocks.warning).toHaveBeenCalled()
  })

  it('全部成功时清理所有选中项任务并提示成功', async () => {
    serviceMocks.batchDeleteItems.mockResolvedValue({
      removed: 2,
      failed: 0,
      removed_ids: ['item-a', 'item-b'],
    })

    renderPage()
    fireEvent.click(await screen.findByText('删除选中'))

    await waitFor(() => {
      expect(taskStoreMocks.removeTasks).toHaveBeenCalledTimes(1)
    })
    expect(taskStoreMocks.removeTasks).toHaveBeenCalledWith(['t-a', 't-b'])
    expect(toastMocks.success).toHaveBeenCalled()
    expect(toastMocks.warning).not.toHaveBeenCalled()
  })
})
