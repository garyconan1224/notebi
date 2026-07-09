import { http } from './client'
import type { WorkspaceKind } from '@/config/product'
import type { SearchResponse } from './search'

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

export async function getKnowledgeStatus(kinds?: WorkspaceKind[]): Promise<KnowledgeStatus> {
  const params = new URLSearchParams()
  kinds?.forEach((kind) => params.append('kinds', kind))
  const res = await http.get<KnowledgeStatus>('/knowledge/status', {
    params: params.size ? params : undefined,
  })
  return res.data
}

export async function rebuildKnowledge(
  force = false,
  kinds?: WorkspaceKind[],
): Promise<KnowledgeStatus> {
  const res = await http.post<KnowledgeStatus>('/knowledge/rebuild', {
    force,
    kinds: kinds?.length ? kinds : undefined,
  })
  return res.data
}

export async function askKnowledge(
  question: string,
  topK = 10,
  workspaceIds?: string[],
  kinds?: WorkspaceKind[],
): Promise<KnowledgeAskResponse> {
  const res = await http.post<KnowledgeAskResponse>(
    '/knowledge/ask',
    {
      question,
      top_k: topK,
      workspace_ids: workspaceIds?.length ? workspaceIds : undefined,
      kinds: kinds?.length ? kinds : undefined,
    },
    { timeout: 180000 },
  )
  return res.data
}
