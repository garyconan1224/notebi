import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FavoritesPage from '@/pages/FavoritesPage/FavoritesPage'
import * as workspaces from '@/services/workspaces'

vi.mock('@/services/workspaces')
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

const resolvedEntries: workspaces.ResolvedFavorite[] = [
  {
    workspace_id: '__inbox__',
    workspace_name: '收纳箱',
    item_id: 'inbox_item_1',
    content_id: 'cid_inbox_1',
    item_name: '收纳视频',
    item_type: 'video',
    group_ids: ['default'],
    favorited_at: '2026-07-26T10:00:00Z',
    jump_url: '/workspaces/__inbox__/items/inbox_item_1/result',
  },
  {
    workspace_id: 'ws_normal',
    workspace_name: '普通合集',
    item_id: 'item_n1',
    content_id: 'cid_n1',
    item_name: '普通音频',
    item_type: 'audio',
    group_ids: ['default', 'grp_1'],
    favorited_at: '2026-07-25T08:00:00Z',
    jump_url: '/workspaces/ws_normal/items/item_n1/note',
  },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <FavoritesPage />
    </MemoryRouter>,
  )
}

describe('FavoritesPage (R3-B resolved)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(workspaces.listResolvedFavorites).mockResolvedValue(resolvedEntries)
    vi.mocked(workspaces.listFavoriteGroups).mockResolvedValue([
      { group_id: 'default', name: '默认收藏', item_count: 2 },
      { group_id: 'grp_1', name: '精选', item_count: 1 },
    ])
    vi.mocked(workspaces.unfavoriteItem).mockResolvedValue({} as never)
  })

  it('显示收纳箱和普通合集的收藏', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('收纳视频')).toBeTruthy()
      expect(screen.getByText('普通音频')).toBeTruthy()
    })
    // 来源合集名称
    expect(screen.getByText(/收纳箱/)).toBeTruthy()
    expect(screen.getByText(/普通合集/)).toBeTruthy()
  })

  it('调用 resolved favorites API 而非 listWorkspaces', async () => {
    renderPage()
    await waitFor(() => {
      expect(workspaces.listResolvedFavorites).toHaveBeenCalled()
    })
    expect(workspaces.listWorkspaces).not.toHaveBeenCalled()
  })

  it('按 favorited_at 倒序显示', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('收纳视频')).toBeTruthy()
    })
    const cards = screen.getAllByRole('article')
    // 第一条是 favorited_at 更新的收纳视频
    expect(cards[0].textContent).toContain('收纳视频')
    expect(cards[1].textContent).toContain('普通音频')
  })

  it('支持类型过滤', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('收纳视频')).toBeTruthy()
    })
    // 点击 "音频" tab
    fireEvent.click(screen.getByText('音频'))
    expect(screen.queryByText('收纳视频')).toBeNull()
    expect(screen.getByText('普通音频')).toBeTruthy()
  })

  it('支持搜索过滤', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('收纳视频')).toBeTruthy()
    })
    const input = screen.getByPlaceholderText(/搜索收藏/)
    fireEvent.change(input, { target: { value: '普通' } })
    expect(screen.queryByText('收纳视频')).toBeNull()
    expect(screen.getByText('普通音频')).toBeTruthy()
  })

  it('取消收藏后立即移除卡片', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('收纳视频')).toBeTruthy()
    })
    // 找到取消收藏按钮（星标）
    const unfavButtons = screen.getAllByTitle('取消收藏')
    fireEvent.click(unfavButtons[0])
    await waitFor(() => {
      expect(screen.queryByText('收纳视频')).toBeNull()
    })
    expect(workspaces.unfavoriteItem).toHaveBeenCalledWith('__inbox__', 'inbox_item_1')
  })

  it('取消收藏失败时保留卡片并 toast', async () => {
    const { toast } = await import('sonner')
    vi.mocked(workspaces.unfavoriteItem).mockRejectedValue(new Error('网络错误'))
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('收纳视频')).toBeTruthy()
    })
    const unfavButtons = screen.getAllByTitle('取消收藏')
    fireEvent.click(unfavButtons[0])
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
    // 卡片仍在
    expect(screen.getByText('收纳视频')).toBeTruthy()
  })

  it('支持分组过滤', async () => {
    vi.mocked(workspaces.listResolvedFavorites).mockImplementation(
      async (opts) => {
        if (opts?.group_id === 'grp_1') {
          return [resolvedEntries[1]]
        }
        return resolvedEntries
      },
    )
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('收纳视频')).toBeTruthy()
    })
    // 选择 "精选" 分组
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'grp_1' } })
    await waitFor(() => {
      expect(screen.queryByText('收纳视频')).toBeNull()
      expect(screen.getByText('普通音频')).toBeTruthy()
    })
  })

  it('R4-B: 头部使用独立 class 不依赖 lib-page-header', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('收藏夹')).toBeTruthy()
    })
    // 收藏夹头部不应使用 lib-page-header
    const favHeader = document.querySelector('.fav-header')
    expect(favHeader).toBeTruthy()
    expect(favHeader!.textContent).toContain('收藏夹')
  })
})
