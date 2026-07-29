import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SearchPage from '@/pages/SearchPage/SearchPage'
import * as knowledge from '@/services/knowledge'
import * as stream from '@/services/knowledgeStream'
import * as workspaces from '@/services/workspaces'
import type { WorkspaceRecord } from '@/types/workspace'

vi.mock('@/services/knowledge')
vi.mock('@/services/knowledgeStream')
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

const conversation = {
  conversation_id: 'c1',
  title: '新会话',
  default_scope: [],
  messages: [],
  created_at: '2026-07-25T00:00:00Z',
  updated_at: '2026-07-25T00:00:00Z',
}

const source = {
  source_id: 'source-1',
  workspace_id: 'ws-1',
  workspace_name: '产品研究',
  item_id: 'item-1',
  item_type: 'video' as const,
  item_title: '发布会',
  chunk_excerpt: '支持离线搜索',
  excerpt: '支持离线搜索',
  field: 'transcript',
  segment_id: 'transcript-0',
  start_ms: 10_000,
  end_ms: 18_000,
  score: 0.9,
  jump_url: '/workspaces/ws-1/items/item-1/video_detail?start_ms=10000',
}

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(workspaces.listWorkspaces).mockResolvedValue([workspace, workspace2])
    vi.mocked(knowledge.getKnowledgeStatus).mockResolvedValue(status)
    vi.mocked(knowledge.listKnowledgeConversations).mockResolvedValue({
      items: [],
      total: 0,
    })
    vi.mocked(knowledge.createKnowledgeConversation).mockResolvedValue(conversation)
    vi.mocked(knowledge.getKnowledgeConversation).mockResolvedValue(conversation)
    vi.mocked(knowledge.searchKnowledgeOriginals).mockResolvedValue({
      answer: '',
      sources: [source],
      citations: [],
      mode: 'exact',
    })
    vi.mocked(stream.sendKnowledgeMessage).mockImplementation(async options => {
      options.onSources?.([source])
      options.onDelta?.('离线搜索见来源')
      return undefined
    })
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('shows knowledge base title and approved mode labels', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    expect(await screen.findByText('知识库')).toBeTruthy()
    expect(screen.getAllByText('问知识库').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: '找原文' })).toBeTruthy()
    expect(screen.queryByText('智能检索')).toBeNull()
    expect(screen.queryByText('智能回答')).toBeNull()
  })

  it('shows streamed answer and evidence preview', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    await screen.findByText('索引已就绪')
    fireEvent.change(screen.getByRole('textbox', { name: '知识库提问' }), {
      target: { value: '离线搜索' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }))

    expect(await screen.findByText('离线搜索见来源')).toBeTruthy()
    expect(screen.getAllByText('支持离线搜索').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '查看来源 1' }))
    expect(screen.getByRole('link', { name: '在笔记中打开' })).toHaveAttribute(
      'href',
      source.jump_url,
    )
  })

  it('passes all scope as undefined by default', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    await screen.findByText('索引已就绪')
    fireEvent.change(screen.getByRole('textbox', { name: '知识库提问' }), {
      target: { value: '测试' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }))
    await waitFor(() => {
      expect(stream.sendKnowledgeMessage).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceIds: undefined }),
      )
    })
  })

  it('passes selected workspace IDs and clearing does not become all', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    await screen.findByText('索引已就绪')
    fireEvent.click(screen.getByRole('button', { name: '知识库范围' }))
    fireEvent.click(screen.getAllByRole('option')[0])
    fireEvent.change(screen.getByRole('textbox', { name: '知识库提问' }), {
      target: { value: '测试多选' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }))
    await waitFor(() => {
      expect(stream.sendKnowledgeMessage).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceIds: ['ws-1'] }),
      )
    })
  })

  it('scope picker starts with all collections', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    expect(await screen.findByText('全部合集')).toBeTruthy()
  })

  it('exact source card updates favorite state', async () => {
    vi.mocked(workspaces.favoriteItem).mockResolvedValue({
      ...workspace,
      favorites: ['item-1'],
    })
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    await screen.findByText('索引已就绪')
    fireEvent.click(screen.getByRole('button', { name: '找原文' }))
    fireEvent.change(screen.getByRole('textbox', { name: '知识库提问' }), {
      target: { value: '离线搜索' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查找原文' }))
    expect((await screen.findAllByText('支持离线搜索')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '收藏来源' }))

    await waitFor(() => {
      expect(workspaces.favoriteItem).toHaveBeenCalledWith('ws-1', 'item-1')
    })
  })
})
