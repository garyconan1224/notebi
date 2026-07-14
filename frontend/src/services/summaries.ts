/** 总结 CRUD API。 */

import http from './client'

export interface ItemSummary {
  summary_id: string
  template: string
  version: number
  summary_mode?: 'general' | 'speaker_aware'
  name: string
  background_for_summary: string
  content_md: string
  model_used: string
  coverage?: {
    source_chars?: number
    chunk_count?: number
    chunk_ids?: string[]
    audit_passes?: number
    missing_chunk_ids?: string[]
    status?: 'complete' | 'supplemented' | 'pending_audit'
    model_used?: string
  }
  created_at: string
}

export interface SummaryTaskAccepted {
  status: 'accepted'
  task_id: string
  workspace_id: string
  item_id: string
}

/** GET 列表（按素材级连续 version 排序）。 */
export async function listSummaries(
  workspaceId: string,
  itemId: string,
): Promise<ItemSummary[]> {
  const { data } = await http.get<ItemSummary[]>(
    `/workspaces/${workspaceId}/items/${itemId}/summaries`,
  )
  return data
}

/** POST 创建后台总结任务；实际总结通过 /pipeline/tasks/{task_id} 读取。 */
export async function createSummary(
  workspaceId: string,
  itemId: string,
  template: string,
  background_for_summary = '',
  options: { provider_id?: string; model?: string; search_web?: boolean; summary_mode?: 'general' | 'speaker_aware' } = {},
): Promise<SummaryTaskAccepted> {
  const { data } = await http.post<SummaryTaskAccepted>(
    `/workspaces/${workspaceId}/items/${itemId}/summaries`,
    {
      template,
      background_for_summary,
      provider_id: options.provider_id ?? '',
      model: options.model ?? '',
      search_web: options.search_web ?? false,
      summary_mode: options.summary_mode ?? 'general',
    },
    { timeout: 30_000 },
  )
  return data
}

/** GET 单份详情。 */
export async function getSummary(
  workspaceId: string,
  itemId: string,
  summaryId: string,
): Promise<ItemSummary> {
  const { data } = await http.get<ItemSummary>(
    `/workspaces/${workspaceId}/items/${itemId}/summaries/${summaryId}`,
  )
  return data
}

/** DELETE 硬删。 */
export async function deleteSummary(
  workspaceId: string,
  itemId: string,
  summaryId: string,
): Promise<void> {
  await http.delete(
    `/workspaces/${workspaceId}/items/${itemId}/summaries/${summaryId}`,
  )
}

/** PATCH 改名（空字符串 = 清除自定义名）。 */
export async function renameSummary(
  workspaceId: string,
  itemId: string,
  summaryId: string,
  name: string,
): Promise<ItemSummary> {
  const { data } = await http.patch<ItemSummary>(
    `/workspaces/${workspaceId}/items/${itemId}/summaries/${summaryId}`,
    { name },
  )
  return data
}
