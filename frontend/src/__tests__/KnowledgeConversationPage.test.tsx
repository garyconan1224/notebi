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
  workspace_id: 'w1',
  name: '合集一',
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

const status = {
  ready: true,
  running: false,
  workspace_count: 1,
  indexable_workspace_count: 1,
  indexed_workspace_count: 1,
  item_count: 1,
  indexed_item_count: 1,
  stale_workspace_ids: [],
  last_indexed_at: '2026-07-25T00:00:00Z',
  embedding_model: 'offline',
  rebuild: {
    running: false,
    started_at: null,
    finished_at: null,
    error: null,
    processed_workspaces: 1,
    total_workspaces: 1,
  },
}

const conversation = {
  conversation_id: 'c1',
  title: '离线搜索',
  default_scope: ['w1'],
  messages: [],
  created_at: '2026-07-25T00:00:00Z',
  updated_at: '2026-07-25T00:00:00Z',
}

describe('Knowledge conversation workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(workspaces.listWorkspaces).mockResolvedValue([workspace])
    vi.mocked(knowledge.getKnowledgeStatus).mockResolvedValue(status)
    vi.mocked(knowledge.listKnowledgeConversations).mockResolvedValue({
      items: [conversation],
      total: 1,
    })
    vi.mocked(knowledge.getKnowledgeConversation).mockResolvedValue(conversation)
    vi.mocked(knowledge.createKnowledgeConversation).mockResolvedValue(conversation)
    vi.mocked(knowledge.searchKnowledgeOriginals).mockResolvedValue({
      answer: '',
      mode: 'exact',
      sources: [],
    })
    vi.mocked(stream.sendKnowledgeMessage).mockImplementation(async options => {
      options.onStatus?.('retrieving', 'm1')
      options.onSources?.([{
        source_id: 's1',
        workspace_id: 'w1',
        item_id: 'i1',
        item_title: '发布会',
        excerpt: '支持离线搜索',
        jump_url: '/note?start_ms=30000',
      }])
      options.onStatus?.('generating', 'm1')
      options.onDelta?.('答案')
      return undefined
    })
  })

  it('renders conversation, messages and source columns', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)

    expect(await screen.findByRole('navigation', { name: '知识库会话' })).toBeTruthy()
    expect(screen.getByRole('main', { name: '知识库消息' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: '来源预览' })).toBeTruthy()
  })

  it('uses URL workspace scope for a new conversation', async () => {
    render(
      <MemoryRouter initialEntries={['/knowledge?workspace_ids=w1&new=1']}>
        <SearchPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(knowledge.createKnowledgeConversation).toHaveBeenCalledWith(
        '新会话',
        ['w1'],
      )
    })
    expect(screen.getByRole('button', { name: '知识库范围' })).toHaveTextContent('合集一')
  })

  it('streams a smart answer with current scope and shows progress', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    await screen.findByText('离线搜索')
    fireEvent.change(screen.getByRole('textbox', { name: '知识库提问' }), {
      target: { value: '如何离线搜索？' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }))

    await waitFor(() => {
      expect(stream.sendKnowledgeMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'c1',
          question: '如何离线搜索？',
          workspaceIds: ['w1'],
        }),
      )
    })
    expect(await screen.findByText('答案')).toBeTruthy()
    expect(screen.getByText('找到 1 个来源')).toBeTruthy()
  })

  it('exact mode searches originals without creating an assistant message', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>)
    await screen.findByText('离线搜索')
    fireEvent.click(screen.getByRole('button', { name: '找原文' }))
    fireEvent.change(screen.getByRole('textbox', { name: '知识库提问' }), {
      target: { value: '产品' },
    })
    fireEvent.click(screen.getByRole('button', { name: '查找原文' }))

    await waitFor(() => {
      expect(knowledge.searchKnowledgeOriginals).toHaveBeenCalledWith(
        '产品',
        ['w1'],
      )
    })
    expect(stream.sendKnowledgeMessage).not.toHaveBeenCalled()
  })
})
