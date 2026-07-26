import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SearchResultView } from '@/pages/SearchPage/SearchResultView'
import type { SearchResponse } from '@/services/search'
import type { WorkspaceRecord } from '@/types/workspace'

vi.mock('@/services/workspaces')
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

const ws: WorkspaceRecord = {
  workspace_id: 'ws-1',
  name: '产品研究',
  status: 'active',
  trashed: false,
  background: { content_type: '', participants: [], topic: '', glossary: [], purpose: '' },
  items: [],
  favorites: [],
  created_at: '2026-07-25T00:00:00Z',
  updated_at: '2026-07-25T00:00:00Z',
  kind: 'note',
  source: 'manual',
}

const baseResult: SearchResponse = {
  answer: '根据资料 [1] 和 [3]，产品支持离线搜索。',
  sources: [
    {
      source_id: 'ws-1:item-1',
      workspace_id: 'ws-1',
      workspace_name: '产品研究',
      item_id: 'item-1',
      item_type: 'video',
      item_title: '发布会',
      chunk_excerpt: '支持离线搜索',
      excerpt: '支持离线搜索',
      field: 'transcript',
      segment_id: 'transcript-0',
      start_ms: 10_000,
      end_ms: 18_000,
      score: 0.9,
      jump_url: '/workspaces/ws-1/items/item-1/video_detail?start_ms=10000',
    },
    {
      source_id: 'ws-1:item-2',
      workspace_id: 'ws-1',
      workspace_name: '产品研究',
      item_id: 'item-2',
      item_type: 'text',
      item_title: '技术文档',
      chunk_excerpt: '未被引用的内容',
      excerpt: '未被引用的内容',
      field: 'content',
      segment_id: 'segment-0',
      start_ms: null,
      end_ms: null,
      score: 0.7,
      jump_url: '/workspaces/ws-1/items/item-2/text_detail',
    },
    {
      source_id: 'ws-1:item-3',
      workspace_id: 'ws-1',
      workspace_name: '产品研究',
      item_id: 'item-3',
      item_type: 'audio',
      item_title: '访谈录音',
      chunk_excerpt: '访谈也提到了搜索',
      excerpt: '访谈也提到了搜索',
      field: 'transcript',
      segment_id: 'transcript-5',
      start_ms: 30_000,
      end_ms: 42_000,
      score: 0.8,
      jump_url: '/workspaces/ws-1/items/item-3/note?start_ms=30000',
    },
  ],
  citations: [
    { number: 1, source_id: 'ws-1:item-1' },
    { number: 3, source_id: 'ws-1:item-3' },
  ],
  mode: 'smart',
}

describe('SearchResultView citations', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('renders only cited sources as citation chips', () => {
    render(
      <MemoryRouter>
        <SearchResultView result={baseResult} workspaces={[ws]} onWorkspaceChange={vi.fn()} />
      </MemoryRouter>,
    )
    // Should have [1] and [3] chips, not [2]
    expect(screen.getByRole('button', { name: '查看来源 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看来源 3' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '查看来源 2' })).toBeNull()
  })

  it('splits sources into cited and related sections', () => {
    render(
      <MemoryRouter>
        <SearchResultView result={baseResult} workspaces={[ws]} onWorkspaceChange={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('引用来源（2）')).toBeTruthy()
    expect(screen.getByText(/相关原文（1）/)).toBeTruthy()
  })

  it('related sources are collapsed by default', () => {
    render(
      <MemoryRouter>
        <SearchResultView result={baseResult} workspaces={[ws]} onWorkspaceChange={vi.fn()} />
      </MemoryRouter>,
    )
    // Related source title should not be visible
    expect(screen.queryByText(/技术文档/)).toBeNull()
    // Expand related
    fireEvent.click(screen.getByText(/相关原文（1）/))
    expect(screen.getByText(/技术文档/)).toBeTruthy()
  })

  it('shows notice when no citations present', () => {
    const noCitations: SearchResponse = {
      ...baseResult,
      citations: [],
    }
    render(
      <MemoryRouter>
        <SearchResultView result={noCitations} workspaces={[ws]} onWorkspaceChange={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/未包含可核验的引用标记/)).toBeTruthy()
  })

  it('citation chip click scrolls to source', () => {
    render(
      <MemoryRouter>
        <SearchResultView result={baseResult} workspaces={[ws]} onWorkspaceChange={vi.fn()} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '查看来源 1' }))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('does not display vector scores', () => {
    render(
      <MemoryRouter>
        <SearchResultView result={baseResult} workspaces={[ws]} onWorkspaceChange={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.queryByText(/0\.9/)).toBeNull()
    expect(screen.queryByText(/0\.7/)).toBeNull()
  })
})
