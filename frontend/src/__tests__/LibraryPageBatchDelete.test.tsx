import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LibraryItem, LibraryResponse, LibraryWorkspace } from '@/services/library'

// ── spies（hoisted）──────────────────────────────────────
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
const libMocks = vi.hoisted(() => ({
  fetchLibrary: vi.fn(),
  deleteItem: vi.fn(),
  batchDeleteItems: vi.fn(),
  batchAddItemsToWorkspace: vi.fn(),
}))
const wsMocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  favoriteItem: vi.fn(),
  unfavoriteItem: vi.fn(),
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

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      selectedFilters: ['all'],
      setSelectedFilters: vi.fn(),
      sortBy: 'created_desc',
      viewMode: 'grid',
      cardColumns: 3,
    }),
  ),
}))

vi.mock('sonner', () => ({ toast: toastMocks }))

vi.mock('@/services/library', () => ({
  fetchLibrary: libMocks.fetchLibrary,
  deleteItem: libMocks.deleteItem,
  batchDeleteItems: libMocks.batchDeleteItems,
  batchAddItemsToWorkspace: libMocks.batchAddItemsToWorkspace,
}))

vi.mock('@/services/workspaces', () => ({
  createWorkspace: wsMocks.createWorkspace,
  deleteWorkspace: wsMocks.deleteWorkspace,
  updateWorkspace: wsMocks.updateWorkspace,
  favoriteItem: wsMocks.favoriteItem,
  unfavoriteItem: wsMocks.unfavoriteItem,
}))

// 子组件打桩（不影响批量删除逻辑，避免渲染重型卡片）
vi.mock('@/pages/LibraryPage/FilterChips', () => ({ FilterChips: () => null }))
vi.mock('@/pages/LibraryPage/SortMenu', () => ({ SortMenu: () => null }))
vi.mock('@/pages/LibraryPage/ViewToggle', () => ({ ViewToggle: () => null }))
vi.mock('@/pages/LibraryPage/ItemCard', () => ({ ItemCard: () => null }))
vi.mock('@/pages/LibraryPage/WorkspaceCard', () => ({ WorkspaceCard: () => null }))

import LibraryPage from '@/pages/LibraryPage'

const makeItem = (
  itemId: string,
  workspaceId: string,
  taskIds: string[],
): LibraryItem => ({
  item_id: itemId,
  workspace_id: workspaceId,
  workspace_name: workspaceId,
  workspace_kind: 'note',
  type: 'video',
  source: 'url',
  source_value: 'http://example.com/x',
  name: itemId,
  status: 'done',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-02T00:00:00Z',
  duration_seconds: 10,
  thumbnail: null,
  results_summary: { has_summary: true, has_transcript: false },
  primary_task_status: 'SUCCESS',
  related_task_ids: taskIds,
})

const makeWorkspace = (id: string, count: number): LibraryWorkspace => ({
  workspace_id: id,
  name: id,
  kind: 'note',
  items_count: count,
  items_count_by_type: { video: count },
  cover_thumbnail: null,
  updated_at: '2026-07-02T00:00:00Z',
  status: 'done',
})

function renderPage() {
  return render(
    <MemoryRouter>
      <LibraryPage />
    </MemoryRouter>,
  )
}

/** 进入多选模式并全选 */
async function selectAllEntries() {
  fireEvent.click(await screen.findByText('选择'))
  fireEvent.click(await screen.findByText('全选'))
}

describe('LibraryPage 批量删除部分失败（P1 回归）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('合集部分失败时，只对删除成功的合集 removeByProject，失败合集任务保留', async () => {
    // wsA / wsB 各 2 个素材 → 显示为合集；wsC 单素材 → 独立项
    libMocks.fetchLibrary.mockResolvedValue({
      items: [
        makeItem('item-a1', 'wsA', ['t-a1']),
        makeItem('item-a2', 'wsA', ['t-a2']),
        makeItem('item-b1', 'wsB', ['t-b1']),
        makeItem('item-b2', 'wsB', ['t-b2']),
        makeItem('item-c', 'wsC', ['t-c']),
      ],
      workspaces: [makeWorkspace('wsA', 2), makeWorkspace('wsB', 2)],
    } satisfies LibraryResponse)
    // item 删除成功；wsA 删除成功、wsB 删除失败
    libMocks.batchDeleteItems.mockResolvedValue({ removed: 1, failed: 0, removed_ids: ['item-c'] })
    wsMocks.deleteWorkspace.mockImplementation(async (id: string) => {
      if (id === 'wsB') throw new Error('boom')
    })

    renderPage()
    await selectAllEntries()
    fireEvent.click(screen.getByRole('button', { name: /删除 \(/ }))

    await waitFor(() => {
      expect(taskStoreMocks.removeByProject).toHaveBeenCalled()
    })
    // 只对成功删除的 wsA 清理任务，绝不能清理失败的 wsB
    expect(taskStoreMocks.removeByProject).toHaveBeenCalledTimes(1)
    expect(taskStoreMocks.removeByProject).toHaveBeenCalledWith('wsA')
    expect(taskStoreMocks.removeByProject).not.toHaveBeenCalledWith('wsB')
    // 独立项 item-c 成功删除 → 精确清理其任务
    expect(taskStoreMocks.removeTasks).toHaveBeenCalledWith(['t-c'])
    // 存在失败项 → warning
    expect(toastMocks.warning).toHaveBeenCalled()
  })

  it('item 部分失败时，只清理 removed_ids 中成功项的任务，失败项任务保留', async () => {
    // 两个独立项（各自单独成项，非合集）
    libMocks.fetchLibrary.mockResolvedValue({
      items: [makeItem('item-c', 'wsC', ['t-c']), makeItem('item-d', 'wsD', ['t-d'])],
      workspaces: [],
    } satisfies LibraryResponse)
    // 只有 item-c 删除成功，item-d 失败
    libMocks.batchDeleteItems.mockResolvedValue({ removed: 1, failed: 1, removed_ids: ['item-c'] })

    renderPage()
    await selectAllEntries()
    fireEvent.click(screen.getByRole('button', { name: /删除 \(/ }))

    await waitFor(() => {
      expect(taskStoreMocks.removeTasks).toHaveBeenCalled()
    })
    expect(taskStoreMocks.removeTasks).toHaveBeenCalledWith(['t-c'])
    const removed = taskStoreMocks.removeTasks.mock.calls.flat()
    expect(removed).not.toContain('t-d')
    // 无合集删除 → 不应触发 removeByProject
    expect(taskStoreMocks.removeByProject).not.toHaveBeenCalled()
    expect(toastMocks.warning).toHaveBeenCalled()
  })
})
