import { http } from './client'
import type { SearchResponse } from './search'
import type {
  KnowledgeConversation,
  KnowledgeMessage,
} from '@/types/knowledgeConversation'

export interface KnowledgeStatus {
  ready: boolean
  running: boolean
  workspace_count: number
  indexable_workspace_count: number
  indexed_workspace_count: number
  item_count: number
  indexed_item_count: number
  stale_workspace_ids: string[]
  last_indexed_at: string | null
  embedding_model: string
  rebuild: {
    running: boolean
    started_at: string | null
    finished_at: string | null
    error: string | null
    processed_workspaces: number
    total_workspaces: number
  }
}

export interface KnowledgeAskResponse extends SearchResponse {
  status?: KnowledgeStatus
}

export async function getKnowledgeStatus(): Promise<KnowledgeStatus> {
  const res = await http.get<KnowledgeStatus>('/knowledge/status')
  return res.data
}

export async function rebuildKnowledge(
  force = false,
): Promise<KnowledgeStatus> {
  const res = await http.post<KnowledgeStatus>('/knowledge/rebuild', {
    force,
  })
  return res.data
}

export async function askKnowledge(
  question: string,
  topK = 10,
  workspaceIds?: string[],
): Promise<KnowledgeAskResponse> {
  const res = await http.post<KnowledgeAskResponse>(
    '/knowledge/ask',
    {
      question,
      top_k: topK,
      workspace_ids: workspaceIds?.length ? workspaceIds : undefined,
    },
    { timeout: 180000 },
  )
  return res.data
}

export async function listKnowledgeConversations(
  keyword = '',
): Promise<{ items: KnowledgeConversation[]; total: number }> {
  const res = await http.get('/knowledge/conversations', {
    params: { keyword },
  })
  return res.data
}

export async function createKnowledgeConversation(
  title = '新会话',
  defaultScope: string[] = [],
): Promise<KnowledgeConversation> {
  const res = await http.post('/knowledge/conversations', {
    title,
    default_scope: defaultScope,
  })
  return res.data
}

export async function getKnowledgeConversation(
  conversationId: string,
): Promise<KnowledgeConversation> {
  const res = await http.get(
    `/knowledge/conversations/${encodeURIComponent(conversationId)}`,
  )
  return res.data
}

export async function updateKnowledgeConversation(
  conversationId: string,
  patch: { title?: string; defaultScope?: string[] },
): Promise<KnowledgeConversation> {
  const res = await http.patch(
    `/knowledge/conversations/${encodeURIComponent(conversationId)}`,
    {
      title: patch.title,
      default_scope: patch.defaultScope,
    },
  )
  return res.data
}

export async function deleteKnowledgeConversation(
  conversationId: string,
): Promise<void> {
  await http.delete(
    `/knowledge/conversations/${encodeURIComponent(conversationId)}`,
  )
}

export async function regenerateKnowledgeMessage(
  conversationId: string,
  messageId: string,
): Promise<KnowledgeMessage> {
  const res = await http.post(
    `/knowledge/conversations/${encodeURIComponent(conversationId)}`
    + `/messages/${encodeURIComponent(messageId)}/regenerate`,
  )
  return res.data
}

export async function searchKnowledgeOriginals(
  query: string,
  workspaceIds?: string[],
  topK = 30,
): Promise<SearchResponse> {
  const res = await http.get('/knowledge/search', {
    params: {
      query,
      workspace_ids: workspaceIds,
      top_k: topK,
    },
  })
  return res.data
}
