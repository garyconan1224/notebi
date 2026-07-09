/** 学习模式视频按需补图 API。 */

import http from './client'

export interface InlineFrame {
  segment_idx: number
  frame_timestamp: number
  frame_path: string
  source: string
  created_at: string
}

export interface SuggestedFrame {
  segment_idx: number
  frame_timestamp: number
  frame_path: string
  scene_description: string
}

/** GET 已插入的帧列表。 */
export async function listInlineFrames(
  workspaceId: string,
  itemId: string,
): Promise<InlineFrame[]> {
  const { data } = await http.get<InlineFrame[]>(
    `/workspaces/${workspaceId}/items/${itemId}/inline-frames`,
  )
  return data
}

/** GET 系统推荐的帧位置（不持久化）。 */
export async function getSuggestedFrames(
  workspaceId: string,
  itemId: string,
): Promise<SuggestedFrame[]> {
  const { data } = await http.get<SuggestedFrame[]>(
    `/workspaces/${workspaceId}/items/${itemId}/inline-frames/suggested`,
  )
  return data
}

/** PUT 整体覆盖保存 inline_frames。 */
export async function saveInlineFrames(
  workspaceId: string,
  itemId: string,
  frames: InlineFrame[],
): Promise<void> {
  await http.put(
    `/workspaces/${workspaceId}/items/${itemId}/inline-frames`,
    { inline_frames: frames },
  )
}
