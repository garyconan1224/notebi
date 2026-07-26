import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SearchPage from '@/pages/SearchPage/SearchPage'
import type { WorkspaceRecord } from '@/types/workspace'
import * as knowledge from '@/services/knowledge'
import * as search from '@/services/search'
import * as workspaces from '@/services/workspaces'

vi.mock('@/services/knowledge')
vi.mock('@/services/search')
vi.mock('@/services/workspaces')
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

const workspace: WorkspaceRecord = {
  workspace_id: 'ws-1',
  name: '产品研究',
  status: 'active',
  trashed: false,
  background: {
    content_type: '',
    participants: [],
    topic: '',
    glossary: [],
    purpose: '',
  },
  items: [],
  favorites: [],
  created_at: '2026-07-25T00:00:00Z',
  updated_at: '2026-07-25T00:00:00Z',
  kind: 'note',
  source: 'manual',
}

const workspace2: WorkspaceRecord = {
  ...workspace,
  workspace_id: 'ws-2',
  name: '技术文档',
}

const status: knowledge.KnowledgeStatus = {
  ready: true,
  running: false,
  workspace_count: 2,
  indexable_workspace_count: 2,
  indexed_workspace_count: 2,
  item_count: 2,
  indexed_item_count: 2,
  stale_workspace_ids: [],
  last_indexed_at: '2026-07-25T00:00:00Z',
  embedding_model: 'offline',
  rebuild: {
    running: false,
    started_at: null,
    finished_at: null,
    error: null,
    processed_workspaces: 2,
    total_workspaces: 2,
  },
}

describe('SearchPage', () => {
  beforeEach(() => {
    vi.mocked(workspaces.listWorkspaces).mockResolvedValue([workspace, workspace2])
    vi.mocked(knowledge.getKnowledgeStatus).mockResolvedValue(status)
    vi.mocked(search.searchGlobal).mockResolvedValue({
      answer: '离线搜索见来源 [1]',
      sources: [{
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
      }],
      citations: [{ number: 1, source_id: 'ws-1:item-1' }],
      mode: 'smart',
      status,
    })
    Element.prototype.scrollIntoView = vi.fn()
    localStorage.clear()
  })

  it('shows knowledge base title and mode labels', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    expect(await screen.findByText('知识库')).toBeTruthy()
    expect(screen.getAllByText('问知识库').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('查找原文').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('智能检索')).toBeNull()
    expect(screen.queryByText('智能回答')).toBeNull()
  })

  it('shows smart answer and navigable evidence', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    await screen.findByText('索引已就绪')
    fireEvent.change(screen.getByPlaceholderText(/哪些内容提到了/), {
      target: { value: '离线搜索' },
    })
    fireEvent.click(screen.getByRole('button', { name: '执行知识库检索' }))

    expect(await screen.findByText('离线搜索见来源 [1]')).toBeTruthy()
    expect(screen.getByText('支持离线搜索')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看来源 1' }))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('passes all scope (no workspaceIds) by default', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    await screen.findByText('索引已就绪')
    fireEvent.change(screen.getByPlaceholderText(/哪些内容提到了/), {
      target: { value: '测试' },
    })
    fireEvent.click(screen.getByRole('button', { name: '执行知识库检索' }))
    await waitFor(() => {
      expect(search.searchGlobal).toHaveBeenCalledWith('测试', expect.objectContaining({
        workspaceIds: undefined,
      }))
    })
  })

  it('passes selected workspaceIds when scope is selected', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    await screen.findByText('索引已就绪')

    // Open scope picker and select one workspace
    fireEvent.click(screen.getByRole('button', { name: '知识库范围' }))
    // Click on '产品研究' option
    const options = screen.getAllByRole('option')
    fireEvent.click(options[0]) // ws-1

    fireEvent.change(screen.getByPlaceholderText(/哪些内容提到了/), {
      target: { value: '测试多选' },
    })
    fireEvent.click(screen.getByRole('button', { name: '执行知识库检索' }))
    await waitFor(() => {
      expect(search.searchGlobal).toHaveBeenCalledWith('测试多选', expect.objectContaining({
        workspaceIds: ['ws-1'],
      }))
    })
  })

  it('scope picker shows summary text', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    await screen.findByText('索引已就绪')
    // Default is "全部合集"
    expect(screen.getByText('全部合集')).toBeTruthy()
  })

  it('updates favorite state from a source card', async () => {
    vi.mocked(workspaces.favoriteItem).mockResolvedValue({
      ...workspace,
      favorites: ['item-1'],
    })
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    await screen.findByText('索引已就绪')
    fireEvent.change(screen.getByPlaceholderText(/哪些内容提到了/), {
      target: { value: '离线搜索' },
    })
    fireEvent.click(screen.getByRole('button', { name: '执行知识库检索' }))
    await screen.findByText('支持离线搜索')
    fireEvent.click(screen.getByRole('button', { name: '收藏来源' }))

    await waitFor(() => {
      expect(workspaces.favoriteItem).toHaveBeenCalledWith('ws-1', 'item-1')
    })
  })
})
