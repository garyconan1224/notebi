// Phase 3B：跨工作空间 / 单工作空间 RAG 检索 API 客户端。
//
// 后端契约：
//   POST /search                         { query, top_k?, workspace_ids? }
//   POST /workspaces/{wid}/search        { query, top_k? }
//
// 共用返回 { answer: string, sources: SearchSource[] }

import { http } from './client'

export interface SearchSource {
  workspace_id: string
  workspace_name: string
  item_id: string
  item_type: 'video' | 'image' | 'audio' | 'text'
  item_title: string
  chunk_excerpt: string
  score: number
  jump_url: string
}

export interface SearchResponse {
  answer: string
  sources: SearchSource[]
}

export interface GlobalSearchOptions {
  topK?: number
  workspaceIds?: string[]
}

/** POST /search — 跨工作空间 */
export async function searchGlobal(
  query: string,
  opts: GlobalSearchOptions = {},
): Promise<SearchResponse> {
  const body: Record<string, unknown> = { query }
  if (opts.topK != null) body.top_k = opts.topK
  if (opts.workspaceIds && opts.workspaceIds.length > 0)
    body.workspace_ids = opts.workspaceIds
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
