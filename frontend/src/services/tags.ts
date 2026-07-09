// Phase 3C.6：标签 API 客户端
//
// 后端契约：
//   GET  /workspaces/{wid}/items/{iid}/tags         → { tags: ItemTags }
//   POST /workspaces/{wid}/items/{iid}/tags/regenerate → { tags: ItemTags }

import { http } from './client'
import type { ItemTags } from '@/types/workspace'

/** GET /workspaces/{wid}/items/{iid}/tags */
export async function getItemTags(
  workspaceId: string,
  itemId: string,
): Promise<ItemTags> {
  const res = await http.get<{ tags: ItemTags }>(
    `/workspaces/${workspaceId}/items/${itemId}/tags`,
  )
  return res.data.tags
}

/** POST /workspaces/{wid}/items/{iid}/tags/regenerate（LLM 调用可能慢，timeout 60s） */
export async function regenerateItemTags(
  workspaceId: string,
  itemId: string,
): Promise<ItemTags> {
  const res = await http.post<{ tags: ItemTags }>(
    `/workspaces/${workspaceId}/items/${itemId}/tags/regenerate`,
    {},
    { timeout: 60000 },
  )
  return res.data.tags
}
