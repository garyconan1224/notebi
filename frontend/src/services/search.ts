// Phase 3B：跨工作空间 / 单工作空间 RAG 检索 API 客户端。
//
// 后端契约：
//   POST /search                         { query, top_k?, workspace_ids? }
//   POST /workspaces/{wid}/search        { query, top_k? }
//
// 共用返回 { answer: string, sources: SearchSource[] }

import { http } from './client'

export interface SearchSource {
  source_id: string
  workspace_id: string
  workspace_name: string
  item_id: string
  item_type: 'video' | 'image' | 'audio' | 'text'
  item_title: string
  chunk_excerpt: string
  excerpt: string
  field: string
  segment_id: string
  start_ms: number | null
  end_ms: number | null
  score: number
  jump_url: string
}

export interface SearchResponse {
  answer: string
  sources: SearchSource[]
  mode?: 'smart' | 'exact'
  status?: import('./knowledge').KnowledgeStatus
}

export interface GlobalSearchOptions {
  topK?: number
  workspaceIds?: string[]
  mode?: 'smart' | 'exact'
  itemTypes?: string[]
  tags?: string[]
}

/** POST /search — 跨工作空间 */
export async function searchGlobal(
  query: string,
  opts: GlobalSearchOptions = {},
): Promise<SearchResponse> {
  const body: Record<string, unknown> = { query, mode: opts.mode ?? 'smart' }
  if (opts.topK != null) body.top_k = opts.topK
  if (opts.workspaceIds && opts.workspaceIds.length > 0)
    body.workspace_ids = opts.workspaceIds
  if (opts.itemTypes?.length) body.item_types = opts.itemTypes
  if (opts.tags?.length) body.tags = opts.tags
  const res = await http.post<SearchResponse>('/search', body, { timeout: 60000 })
  return res.data
}

/** POST /workspaces/{wid}/search — 单工作空间 */
export async function searchWorkspace(
  workspaceId: string,
  query: string,
  topK?: number,
): Promise<SearchResponse> {
  const body: Record<string, unknown> = { query }
  if (topK != null) body.top_k = topK
  const res = await http.post<SearchResponse>(
    `/workspaces/${workspaceId}/search`,
    body,
    { timeout: 60000 },
  )
  return res.data
}
