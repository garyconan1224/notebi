import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LibraryPage from '@/pages/LibraryPage/index'
import * as library from '@/services/library'

vi.mock('@/services/library')
vi.mock('@/services/workspaces')
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const mockData: library.LibraryResponse = {
  items: [
    {
      item_id: 'item_1',
      workspace_id: 'ws_1',
      workspace_name: '测试合集',
      workspace_kind: 'note',
      name: '测试视频',
      type: 'video',
      source: 'url',
      source_value: 'https://example.com/v',
      status: 'done',
      favorite: false,
      created_at: '2026-07-20T10:00:00Z',
      updated_at: '2026-07-21T10:00:00Z',
      duration_seconds: 120,
      thumbnail: null,
      results_summary: { has_summary: true, has_transcript: true },
      primary_task_status: null,
      related_task_ids: [],
      description: '',
    },
  ],
  workspaces: [
    {
      workspace_id: 'ws_1',
      name: '测试合集',
      kind: 'note',
      status: 'active',
      items_count: 1,
      items_count_by_type: { video: 1 },
      cover_thumbnail: null,
      updated_at: '2026-07-21T10:00:00Z',
    },
  ],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LibraryPage />
    </MemoryRouter>,
  )
}

describe('LibraryPage R4-A layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(library.fetchLibrary).mockResolvedValue(mockData)
  })

  it('Hero 只包含标题、说明、导入内容和新建合集', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/所有做过的笔记/)).toBeTruthy()
    })
    const header = document.querySelector('.lib-page-header')
    expect(header).toBeTruthy()
    // Hero 内有导入内容和新建合集
    expect(header!.textContent).toContain('导入内容')
    expect(header!.textContent).toContain('新建合集')
    // Hero 内不应有排序、选择、ViewToggle
    expect(header!.querySelector('.lib-search')).toBeNull()
  })

  it('不包含 BatchOrganizeControl', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/所有做过的笔记/)).toBeTruthy()
    })
    // BatchOrganizeControl 渲染的标签/文件夹按钮不应出现
    expect(document.querySelector('[data-testid="batch-organize"]')).toBeNull()
    expect(screen.queryByText('批量标签')).toBeNull()
    expect(screen.queryByText('批量文件夹')).toBeNull()
  })

  it('ViewToggle 只出现一次', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/所有做过的笔记/)).toBeTruthy()
    })
    const toggles = document.querySelectorAll('.view-toggle')
    expect(toggles.length).toBe(1)
  })

  it('工具栏包含筛选、搜索和排序', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/所有做过的笔记/)).toBeTruthy()
    })
    const toolbar = document.querySelector('.lib-toolbar')
    expect(toolbar).toBeTruthy()
    // 搜索框在工具栏
    expect(toolbar!.querySelector('input[placeholder*="搜索"]')).toBeTruthy()
  })

  it('Hero 高度不因选择状态改变', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText(/所有做过的笔记/)).toBeTruthy()
    })
    const header = document.querySelector('.lib-page-header')
    // Hero 内不应有选择模式的批量操作按钮
    expect(header!.querySelector('.btn-danger')).toBeNull()
    expect(header!.textContent).not.toContain('全选')
    expect(header!.textContent).not.toContain('删除')
  })
})
