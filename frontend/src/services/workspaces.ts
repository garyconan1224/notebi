// workspaces API 客户端——对应 backend/app/routes/workspaces.py
//
// 与 services/pipeline.ts 同风格：
//   - 走全局 http (axios) 实例
//   - 函数返回解析后的 .data
//   - 出错由 axios 抛，调用方用 try/catch 或 react-query 的 error 处理

import { http } from './client'
import type {
  ItemAddRequest,
  ItemNote,
  ItemType,
  PreflightSaveRequest,
  StartItemResponse,
  WorkspaceCreateRequest,
  WorkspaceRecord,
  WorkspaceUpdateRequest,
} from '@/types/workspace'

const BASE = '/workspaces'

export interface FavoriteGroup {
  group_id: string
  name: string
  item_count: number
}

export interface FavoriteGroupItem {
  workspace_id: string
  content_id: string
  note: string
  created_at: string
}

export interface ResolvedFavorite {
  workspace_id: string
  workspace_name: string
  item_id: string
  content_id: string
  item_name: string
  item_type: string
  group_ids: string[]
  favorited_at: string
  jump_url: string
}

export interface WorkspaceFolder {
  folder_id: string
  workspace_id: string
  parent_id?: string | null
  name: string
}

export interface NoteVersion {
  version_id: string
  content_id: string
  version_no: number
  content_hash: string
  source: 'BASELINE' | 'USER_EDIT' | 'RESTORE' | 'ADOPT_FROM_SIBLING'
  created_at: string
  preview: string
  body_md?: string
}

export interface LineageCopy {
  workspace_id: string
  workspace_name: string
  item_id: string
  content_id: string
  lineage_id: string
  name: string
  type: ItemType
  updated_at: string
  summary_preview: string
  jump_url: string
}

export async function listFavoriteGroups(): Promise<FavoriteGroup[]> {
  const res = await http.get<FavoriteGroup[]>(`${BASE}/metadata/favorite-groups`)
  return res.data
}

export async function listFavoriteGroupItems(
  groupId: string,
): Promise<FavoriteGroupItem[]> {
  const res = await http.get<FavoriteGroupItem[]>(
    `${BASE}/metadata/favorite-groups/${groupId}/items`,
  )
  return res.data
}

export async function createFavoriteGroup(name: string): Promise<FavoriteGroup> {
  const res = await http.post<FavoriteGroup>(
    `${BASE}/metadata/favorite-groups`,
    { name },
  )
  return res.data
}

export async function listResolvedFavorites(
  opts?: { group_id?: string },
): Promise<ResolvedFavorite[]> {
  const params = opts?.group_id ? { group_id: opts.group_id } : undefined
  const res = await http.get<ResolvedFavorite[]>(
    `${BASE}/metadata/favorites/resolved`,
    { params },
  )
  return res.data
}

export async function exportFavoriteMetadata(): Promise<Record<string, unknown>> {
  const res = await http.get<Record<string, unknown>>(
    `${BASE}/metadata/favorites/export`,
  )
  return res.data
}

export async function importFavoriteMetadata(
  payload: Record<string, unknown>,
): Promise<{ imported: number; skipped: number }> {
  const res = await http.post(
    `${BASE}/metadata/favorites/import`,
    { payload },
  )
  return res.data as { imported: number; skipped: number }
}

export async function listWorkspaceFolders(
  workspaceId: string,
): Promise<WorkspaceFolder[]> {
  const res = await http.get<WorkspaceFolder[]>(`${BASE}/${workspaceId}/folders`)
  return res.data
}

export async function createWorkspaceFolder(
  workspaceId: string,
  name: string,
  parentId?: string,
): Promise<WorkspaceFolder> {
  const res = await http.post<WorkspaceFolder>(`${BASE}/${workspaceId}/folders`, {
    name,
    parent_id: parentId,
  })
  return res.data
}

export async function moveItemToFolder(
  workspaceId: string,
  itemId: string,
  folderId: string,
): Promise<void> {
  await http.put(`${BASE}/${workspaceId}/items/${itemId}/folder`, {
    folder_id: folderId,
  })
}

/** GET /workspaces — 列表（默认排除 trashed） */
export async function listWorkspaces(opts?: {
  trashedOnly?: boolean
  includeTrashed?: boolean
}): Promise<WorkspaceRecord[]> {
  const params = new URLSearchParams()
  if (opts?.trashedOnly) params.set('trashed_only', 'true')
  if (opts?.includeTrashed) params.set('include_trashed', 'true')
  const res = await http.get<WorkspaceRecord[]>(BASE, {
    params: params.size ? params : undefined,
  })
  return res.data
}

/** GET /workspaces/{id} — 详情 */
export async function getWorkspace(workspaceId: string): Promise<WorkspaceRecord> {
  const res = await http.get<WorkspaceRecord>(`${BASE}/${workspaceId}`)
  return res.data
}

/** POST /workspaces — 创建 */
export async function createWorkspace(
  req: WorkspaceCreateRequest,
): Promise<WorkspaceRecord> {
  const res = await http.post<WorkspaceRecord>(BASE, req)
  return res.data
}

/** POST /workspaces/auto-create — 根据 hint URL/text 用 LLM 自动生成名称并创建工作空间 */
export async function autoCreateWorkspace(req: {
  hint_url?: string
  hint_text?: string
  kind?: 'note'
}): Promise<WorkspaceRecord> {
  const res = await http.post<WorkspaceRecord>(`${BASE}/auto-create`, req)
  return res.data
}

/** 收纳箱 workspace 固定 ID */
export const INBOX_WORKSPACE_ID = '__inbox__'

/** POST /workspaces/ensure-inbox — 懒创建隐藏收纳箱（已存在则直接返回） */
export async function ensureInbox(): Promise<WorkspaceRecord> {
  const res = await http.post<WorkspaceRecord>(`${BASE}/ensure-inbox`)
  return res.data
}

/** PATCH /workspaces/{id} — 更新名称 / 状态 / 背景信息 */
export async function updateWorkspace(
  workspaceId: string,
  req: WorkspaceUpdateRequest,
): Promise<WorkspaceRecord> {
  const res = await http.patch<WorkspaceRecord>(`${BASE}/${workspaceId}`, req)
  return res.data
}

/** DELETE /workspaces/{id} — 删除合集；其中笔记会保留在收纳箱或其它合集。 */
export interface DeleteWorkspaceResult {
  trashed: boolean
  workspace_id: string
  moved_to_inbox: number
  already_elsewhere: number
  trashed_count: number
}

export async function deleteWorkspace(
  workspaceId: string,
  // 旧调用方可能仍传该值；后端会安全地按 keep 处理，不能因删合集删笔记。
  contentPolicy: 'keep' | 'trash' = 'keep',
): Promise<DeleteWorkspaceResult> {
  const response = await http.delete<DeleteWorkspaceResult>(`${BASE}/${workspaceId}`, {
    params: { content_policy: contentPolicy },
  })
  return response.data
}

/** POST /workspaces/{id}/restore — 从垃圾桶恢复 */
export async function restoreWorkspace(workspaceId: string): Promise<void> {
  await http.post(`${BASE}/${workspaceId}/restore`)
}

/** DELETE /workspaces/{id}/permanent — 彻底删除（必须先软删） */
export async function permanentlyDeleteWorkspace(workspaceId: string): Promise<void> {
  await http.delete(`${BASE}/${workspaceId}/permanent`)
}

/** DELETE /workspaces/trash — 清空垃圾桶 */
export async function emptyWorkspaceTrash(): Promise<{ deleted: string[]; count: number }> {
  const res = await http.delete<{ deleted: string[]; count: number }>(`${BASE}/trash`)
  return res.data
}

/** POST /workspaces/sniff-url — 嗅探 URL 的内容类型（不下载实际文件） */
export interface SniffResult {
  primary_type: 'video' | 'audio' | 'image' | 'text'
  possible_types: string[]
  platform: string | null
  title: string | null
  thumbnail: string | null
  content_type_header: string | null
  confident?: boolean  // 后端兜底时为 false
  error?: string
}

export async function sniffUrl(url: string): Promise<SniffResult> {
  const res = await http.post<SniffResult>(`${BASE}/sniff-url`, { url })
  return res.data
}

export async function probeDuration(url: string): Promise<{ duration_sec: number }> {
  const res = await http.post<{ duration_sec: number }>(`${BASE}/probe-duration`, { url })
  return res.data
}

export interface BatchSourceItem {
  source_url: string
  title: string
  platform?: string
  index?: number
  duration_seconds?: number | null
  thumbnail?: string | null
  external_id?: string
}

export interface BatchSourceResolveResponse {
  source_type: 'multi_url' | 'youtube_playlist' | 'bilibili_multipart' | 'bilibili_favorites' | 'bilibili_uploader'
  source_url: string
  title: string
  items: BatchSourceItem[]
  meta?: Record<string, unknown>
}

export interface BatchSourceImportRequest {
  workspace_name?: string
  kind?: 'note'
  source_type: string
  source_url?: string
  items: BatchSourceItem[]
  start?: boolean
  embed_frames?: boolean
  image_mode?: string
  frame_interval?: number
  vision_model?: string
  intent?: string
  note_media_kind?: string
  summary_template?: string
  diarize?: boolean
  summary_mode?: 'general' | 'speaker_aware'
  speaker_count?: number
  user_notes?: string
}

export async function resolveBatchSource(source: string): Promise<BatchSourceResolveResponse> {
  const res = await http.post<BatchSourceResolveResponse>(`${BASE}/batch-sources/resolve`, { source })
  return res.data
}

export async function importBatchSource(
  req: BatchSourceImportRequest,
): Promise<{ workspace: WorkspaceRecord; items_added: number; tasks: { task_id: string; item_id: string; item_type: string }[] }> {
  const res = await http.post<{ workspace: WorkspaceRecord; items_added: number; tasks: { task_id: string; item_id: string; item_type: string }[] }>(
    `${BASE}/batch-sources/import`,
    req,
  )
  return res.data
}

/** GET /workspaces/{id}/items/{itemId}/probe-media — 探测本地素材时长+首帧封面（cv2，支持 flv/mkv 等） */
export async function probeItemMedia(
  workspaceId: string,
  itemId: string,
): Promise<{ duration_sec: number; cover_url: string }> {
  const res = await http.get<{ duration_sec: number; cover_url: string }>(
    `${BASE}/${workspaceId}/items/${itemId}/probe-media`,
  )
  return res.data
}

/** POST /workspaces/{id}/items — 添加素材 */
export async function addWorkspaceItem(
  workspaceId: string,
  req: ItemAddRequest,
): Promise<WorkspaceRecord> {
  const res = await http.post<WorkspaceRecord>(`${BASE}/${workspaceId}/items`, req)
  return res.data
}

interface WorkspaceItemUploadOptions {
  name?: string
  type?: ItemType
  onProgress?: (percent: number) => void
}

/** POST /workspaces/{id}/items/upload — 上传文件并登记为素材 */
export async function uploadWorkspaceItem(
  workspaceId: string,
  file: File,
  options: WorkspaceItemUploadOptions = {},
): Promise<WorkspaceRecord> {
  const formData = new FormData()
  formData.append('file', file)
  if (options.name) formData.append('name', options.name)
  if (options.type) formData.append('type', options.type)

  const res = await http.post<WorkspaceRecord>(
    `${BASE}/${workspaceId}/items/upload`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress(progressEvent) {
        if (options.onProgress && progressEvent.total) {
          const percent = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total,
          )
          options.onProgress(percent)
        }
      },
    },
  )
  return res.data
}

/** DELETE /workspaces/{id}/items/{itemId} — 移除素材 */
export async function removeWorkspaceItem(
  workspaceId: string,
  itemId: string,
): Promise<WorkspaceRecord> {
  const res = await http.delete<WorkspaceRecord>(
    `${BASE}/${workspaceId}/items/${itemId}`,
  )
  return res.data
}

/** POST /workspaces/{id}/favorites/{itemId} — 收藏 */
export async function favoriteItem(
  workspaceId: string,
  itemId: string,
): Promise<WorkspaceRecord> {
  const res = await http.post<WorkspaceRecord>(
    `${BASE}/${workspaceId}/favorites/${itemId}`,
  )
  return res.data
}

/** DELETE /workspaces/{id}/favorites/{itemId} — 取消收藏 */
export async function unfavoriteItem(
  workspaceId: string,
  itemId: string,
): Promise<WorkspaceRecord> {
  const res = await http.delete<WorkspaceRecord>(
    `${BASE}/${workspaceId}/favorites/${itemId}`,
  )
  return res.data
}

/** PUT /workspaces/{id}/items/{itemId}/preflight — 保存前置配置 */
export async function savePreflight(
  workspaceId: string,
  itemId: string,
  req: PreflightSaveRequest,
): Promise<WorkspaceRecord> {
  const res = await http.put<WorkspaceRecord>(
    `${BASE}/${workspaceId}/items/${itemId}/preflight`,
    req,
  )
  return res.data
}

/** PUT /workspaces/{id}/items/{itemId}/tags — 更新素材标签 */
export async function updateItemTags(
  workspaceId: string,
  itemId: string,
  tags: Record<string, unknown>,
): Promise<void> {
  await http.put(`${BASE}/${workspaceId}/items/${itemId}/tags`, { tags })
}

/** POST /workspaces/{id}/items/{itemId}/start — 触发 pipeline 任务 */
export async function startItemPipeline(
  workspaceId: string,
  itemId: string,
): Promise<StartItemResponse> {
  const res = await http.post<StartItemResponse>(
    `${BASE}/${workspaceId}/items/${itemId}/start`,
  )
  return res.data
}

// ── NI.1: 生成笔记（智能识别）──────────────────────────────

export interface GenerateNoteResponse {
  workspace: WorkspaceRecord
  task_id: string
  task_type: string
  item_type: string
  item_id: string
}

/** POST /workspaces/{id}/items/generate-note — 生成笔记统一入口 */
export async function generateNote(
  workspaceId: string,
  url: string,
  name?: string,
  embedFrames: boolean = true,
  imageMode: string = 'vision',
  frameInterval: number = 5,
  visionModel: string = '',
  intent: string = 'note',
  noteMediaKind: string = 'auto',
  extra?: { diarize?: boolean; summary_mode?: 'general' | 'speaker_aware'; speaker_count?: number; summary_template?: string; user_notes?: string },
): Promise<GenerateNoteResponse> {
  const res = await http.post<GenerateNoteResponse>(
    `${BASE}/${workspaceId}/items/generate-note`,
    { url, name, embed_frames: embedFrames, image_mode: imageMode, frame_interval: frameInterval, vision_model: visionModel, intent, note_media_kind: noteMediaKind, ...extra },
  )
  return res.data
}

// ── Phase 1G: 视频结果页聚合 ──────────────────────────────

export interface VideoResultFrame {
  idx: number
  ts: string
  sec: number
  shot_type: string
  title: string
  subtitle: string
  description: string
  tags: Record<string, string[]>
  image_path?: string
  /** 后端物化时可能用 timestamp 而非 sec；前端优先用 sec */
  timestamp?: number | string
}

export interface VideoResultTranscriptLine {
  t_sec: number
  t_str: string
  text: string
  speaker?: string
}

export interface VideoResult {
  source: 'demo_fixture' | 'item_results'
  is_demo?: boolean
  video: {
    item_id: string
    title: string
    url: string
    duration_sec: number
    duration_str: string
  }
  frames: VideoResultFrame[]
  transcript: VideoResultTranscriptLine[]
  tracks_meta: {
    total_sec: number
    frame_count: number
    transcript_count: number
  }
  /** N7b 路径 1: 摘要路径标识 */
  summary_path?: string
  /** N7b 路径 1: LLM 生成的摘要 */
  summary?: string
  /** N7b 路径 1: 视频类型模板 */
  video_template?: string
  /** V3.3: LLM 自动检测到的模板名 */
  detected_template?: string
  /** R21.P3.S3: 素材意图（learning / 空） */
  intent?: string
}

/** GET /workspaces/{id}/items/{itemId}/result — 视频三轨聚合数据 */
export async function getItemResult(
  workspaceId: string,
  itemId: string,
): Promise<VideoResult> {
  const res = await http.get<VideoResult>(
    `${BASE}/${workspaceId}/items/${itemId}/result`,
  )
  return res.data
}

// ── Phase 1H: 图片结果页聚合 ──────────────────────────────

export interface ImageResult {
  source: 'demo_fixture' | 'item_results'
  image: {
    item_id: string
    title: string
    image_url: string
  }
  description: string
  ocr_text: string
  exif?: {
    device?: string
    lens?: string
    time?: string
    aperture?: string
    shutter?: string
    iso?: string
    gps?: { lat: number; lon: number }
  }
  dimensions?: {
    width: number
    height: number
    format: string
    size_kb: number
  }
  tags: Record<string, string[]>
  associations?: Record<string, string>
}

/** GET /workspaces/{id}/items/{itemId}/image_result — 图片结果页聚合数据 */
export async function getImageResult(
  workspaceId: string,
  itemId: string,
): Promise<ImageResult> {
  const res = await http.get<ImageResult>(
    `${BASE}/${workspaceId}/items/${itemId}/image_result`,
  )
  return res.data
}

// ── N9: 多图对比 ────────────────────────────────────────────

export interface ImageCompareItem {
  item_id: string
  name: string
  is_current: boolean
  source_value: string
  description: string
  ocr_text: string
  tags: Record<string, string[]>
  associations: Record<string, string>
  has_result: boolean
}

export interface ImageCompareResult {
  workspace_id: string
  current_item_id: string
  images: ImageCompareItem[]
  vlm_summary: string
}

/** GET /workspaces/{id}/items/{itemId}/image_compare — 多图对比 */
export async function getImageCompare(
  workspaceId: string,
  itemId: string,
  itemIds?: string[],
): Promise<ImageCompareResult> {
  const params = itemIds?.length ? `?item_ids=${itemIds.join(',')}` : ''
  const res = await http.get<ImageCompareResult>(
    `${BASE}/${workspaceId}/items/${itemId}/image_compare${params}`,
  )
  return res.data
}

// ── N10: 多文对比 ────────────────────────────────────────────

export interface TextCompareItem {
  item_id: string
  name: string
  is_current: boolean
  source_value: string
  summary: string | { abstract?: string; key_points?: unknown[]; golden_quotes?: unknown[] }
  content_preview: string
  associations: Record<string, string>
  rewrites: Record<string, string>
  translations: Record<string, string>
  char_count: number
  has_result: boolean
}

export interface TextCompareResult {
  workspace_id: string
  current_item_id: string
  texts: TextCompareItem[]
  llm_summary: string
}

/** GET /workspaces/{id}/items/{itemId}/text_compare — 多文对比 */
export async function getTextCompare(
  workspaceId: string,
  itemId: string,
  itemIds?: string[],
): Promise<TextCompareResult> {
  const params = itemIds?.length ? `?item_ids=${itemIds.join(',')}` : ''
  const res = await http.get<TextCompareResult>(
    `${BASE}/${workspaceId}/items/${itemId}/text_compare${params}`,
  )
  return res.data
}

// ── Phase 2B: 音频结果页聚合 ──────────────────────────

/** A2: 音频转录片段（含 speaker / start / end 等扩展字段） */
export interface AudioTranscriptSegment {
  t_sec: number
  t_str: string
  text: string
  edited_text?: string
  start?: number
  end?: number
  speaker?: string
}

export interface AudioResult {
  source: 'demo_fixture' | 'item_results'
  audio: {
    item_id: string
    title: string
    filename?: string
    url: string
    duration_sec: number
    duration_str: string
  }
  transcript: VideoResultTranscriptLine[] | string
  transcript_segments?: AudioTranscriptSegment[]
  summary: string
  tracks_meta: {
    total_sec: number
    transcript_count: number
  }
  /** N8: 说话人分离结果 */
  diarization?: {
    num_speakers: number
    segments: Array<{ start: number; end: number; speaker: string }>
  }
  /** A2: 用户自定义说话人映射 */
  speaker_map?: Record<string, string>
  /** A2: 说话人角色映射 */
  speaker_roles?: Record<string, string>
}

/** GET /workspaces/{id}/items/{itemId}/audio_result — 音频结果页聚合数据 */
export async function getAudioItemResult(
  workspaceId: string,
  itemId: string,
): Promise<AudioResult> {
  const res = await http.get<AudioResult>(
    `${BASE}/${workspaceId}/items/${itemId}/audio_result`,
  )
  return res.data
}

/** PATCH /workspaces/{id}/items/{itemId}/speaker_map — 保存说话人标签映射 */
export async function updateSpeakerMap(
  workspaceId: string,
  itemId: string,
  speakerMap: Record<string, string>,
  speakerRoles: Record<string, string> = {},
): Promise<{
  speaker_map: Record<string, string>
  speaker_roles: Record<string, string>
  summary_refresh?: { status: string; reason: string; updated_count?: number }
}> {
  const { data } = await http.patch(`${BASE}/${workspaceId}/items/${itemId}/speaker_map`, {
    speaker_map: speakerMap,
    speaker_roles: speakerRoles,
  })
  return data
}

/** PATCH /workspaces/{id}/items/{itemId}/transcript/segments/{idx} — 编辑单段转录文本 */
export async function updateTranscriptSegment(
  workspaceId: string,
  itemId: string,
  segmentIdx: number,
  editedText: string,
): Promise<{ segment_idx: number; edited_text: string | null }> {
  const res = await http.patch(
    `${BASE}/${workspaceId}/items/${itemId}/transcript/segments/${segmentIdx}`,
    { edited_text: editedText },
  )
  return res.data
}

// ── Stage 3: 字幕翻译 ──────────────────────────────────────

export interface TranslateSegmentsResponse {
  target_lang: string
  segments: { idx: number; text: string }[]
  cached: boolean
  complete?: boolean
  filled?: number
  total?: number
}

/** POST /workspaces/{id}/items/{item_id}/translate — 逐段翻译字幕 */
export async function translateTranscriptSegments(
  workspaceId: string,
  itemId: string,
  targetLang: string,
  force = false,
): Promise<TranslateSegmentsResponse> {
  const res = await http.post<TranslateSegmentsResponse>(
    `${BASE}/${workspaceId}/items/${itemId}/translate`,
    { target_lang: targetLang, force },
    { timeout: 600_000 },
  )
  return res.data
}

// ── Phase 2C.2: 文本结果页 ──────────────────

export interface KeyPoint {
  text: string
  source_excerpt?: string
  char_start?: number
  char_end?: number
  para_index?: number
}

export interface GoldenQuote {
  quote_text: string
  char_start: number
  char_end: number
  para_index: number
}

export interface StructuredSummary {
  abstract: string
  key_points: KeyPoint[]
  golden_quotes: GoldenQuote[]
}

/** T1.2: 逐段对照用的段落数组结构 */
export interface AlignedTextSection {
  full_text: string
  paragraphs: string[]
}

/** 兼容旧版纯字符串和 T1.2 新版结构化格式 */
export type MaybeAligned = string | AlignedTextSection

export function normalizeAligned(val: MaybeAligned | undefined): AlignedTextSection | null {
  if (!val) return null
  if (typeof val === 'string') {
    return {
      full_text: val,
      paragraphs: val.split(/\n{2,}/).filter(p => p.trim()),
    }
  }
  return val
}

export interface TextResult {
  source: string
  title: string
  content: string
  summary: string | StructuredSummary
  summary_version?: number
  char_count: number
  source_type: string
  source_url: string
  meta: Record<string, unknown>
  /** N10: 联想归纳 {方向: 分析} */
  associations?: Record<string, string>
  /** N10: 改写/润色 {风格: 结果} — T1.2 升级为 AlignedTextSection */
  rewrites?: Record<string, MaybeAligned>
  /** N10: 翻译 {语言代码: 结果} — T1.2 升级为 AlignedTextSection */
  translations?: Record<string, MaybeAligned>
}

/** GET /workspaces/{id}/items/{itemId}/text_result — 文本结果页聚合数据 */
export async function getTextItemResult(
  workspaceId: string,
  itemId: string,
): Promise<TextResult> {
  const res = await http.get<TextResult>(
    `${BASE}/${workspaceId}/items/${itemId}/text_result`,
  )
  return res.data
}

/** GET /workspaces/{id}/items/{itemId}/export — 下载笔记素材包 zip */
export async function downloadExport(workspaceId: string, itemId: string): Promise<void> {
  const res = await http.get(`${BASE}/${workspaceId}/items/${itemId}/export`, {
    responseType: 'blob',
  })
  // 从 Content-Disposition 提取文件名
  const disposition = res.headers['content-disposition'] as string | undefined
  let filename = '笔记素材包.zip'
  if (disposition) {
    const match = disposition.match(/filename\*=(?:UTF-8''|")?([^";]+)/i)
    if (match) filename = decodeURIComponent(match[1])
  }
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface BatchExportResult {
  exportedCount: number
  skippedCount: number
  failedCount: number
}

/** POST /workspaces/{id}/items/batch-export — 下载所选素材的单个 ZIP。 */
export async function downloadBatchExport(
  workspaceId: string,
  itemIds: string[],
): Promise<BatchExportResult> {
  const res = await http.post(
    `${BASE}/${workspaceId}/items/batch-export`,
    { item_ids: itemIds },
    { responseType: 'blob' },
  )
  const disposition = res.headers['content-disposition'] as string | undefined
  let filename = '笔记素材包_批量.zip'
  if (disposition) {
    const match = disposition.match(/filename\*=\s*(?:UTF-8''|")?([^";]+)/i)
    if (match) filename = decodeURIComponent(match[1])
  }
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)

  const readCount = (name: string, fallback: number) => {
    const value = Number.parseInt(String(res.headers[name] ?? ''), 10)
    return Number.isFinite(value) ? value : fallback
  }
  return {
    exportedCount: readCount('x-exported-count', itemIds.length),
    skippedCount: readCount('x-skipped-count', 0),
    failedCount: readCount('x-failed-count', 0),
  }
}

/** GET /workspaces/{id}/export-html — 下载合集全部笔记的自包含 HTML 文件 */
export async function downloadCollectionHtml(workspaceId: string): Promise<void> {
  const res = await http.get(`${BASE}/${workspaceId}/export-html`, {
    responseType: 'blob',
  })
  const disposition = res.headers['content-disposition'] as string | undefined
  let filename = '合集笔记.html'
  if (disposition) {
    const match = disposition.match(/filename\*=(?:UTF-8''|")?([^";]+)/i)
    if (match) filename = decodeURIComponent(match[1])
  }
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 融合笔记数据结构 */
export interface MergedNote {
  merged_id: string
  title: string
  item_ids: string[]
  content_md: string
  created_at: string
  current_version_id: string
  versions: MergedNoteVersion[]
  updated_at: string
  deleted_at: string
}

export interface MergedNoteVersion {
  version_id: string
  content_md: string
  item_ids: string[]
  source_snapshot: Array<{
    item_id: string
    content_id: string
    lineage_id: string
    title: string
    summary_hash: string
  }>
  created_at: string
  created_by: 'ai' | 'user' | 'restore'
}

/** POST /workspaces/{id}/merge — 融合选中素材笔记 */
export async function mergeNotes(
  workspaceId: string,
  itemIds: string[],
  style: string = '综合大纲',
): Promise<MergedNote> {
  const res = await http.post(`${BASE}/${workspaceId}/merge`, { item_ids: itemIds, style })
  return res.data as MergedNote
}

/** GET /workspaces/{id}/merged-notes — 列出融合笔记 */
export async function listMergedNotes(workspaceId: string): Promise<MergedNote[]> {
  const res = await http.get(`${BASE}/${workspaceId}/merged-notes`)
  return res.data as MergedNote[]
}

export async function createMergedNote(
  workspaceId: string,
  payload: { title: string; content_md: string; item_ids: string[] },
): Promise<MergedNote> {
  const response = await http.post<MergedNote>(`${BASE}/${workspaceId}/merged-notes`, payload)
  return response.data
}

export async function updateMergedNote(
  workspaceId: string,
  mergedId: string,
  payload: { title?: string; content_md?: string; item_ids?: string[] },
): Promise<MergedNote> {
  const response = await http.patch<MergedNote>(
    `${BASE}/${workspaceId}/merged-notes/${mergedId}`,
    payload,
  )
  return response.data
}

export async function listMergedNoteVersions(
  workspaceId: string,
  mergedId: string,
): Promise<MergedNoteVersion[]> {
  const response = await http.get<MergedNoteVersion[]>(
    `${BASE}/${workspaceId}/merged-notes/${mergedId}/versions`,
  )
  return response.data
}

export async function restoreMergedNoteVersion(
  workspaceId: string,
  mergedId: string,
  versionId: string,
): Promise<MergedNote> {
  const response = await http.post<MergedNote>(
    `${BASE}/${workspaceId}/merged-notes/${mergedId}/versions/${versionId}/restore`,
  )
  return response.data
}

/** DELETE /workspaces/{id}/merged-notes/{mergedId} — 删除融合笔记 */
export async function deleteMergedNote(
  workspaceId: string,
  mergedId: string,
): Promise<void> {
  await http.delete(`${BASE}/${workspaceId}/merged-notes/${mergedId}`)
}

/** POST /workspaces/{id}/items/batch-export — 批量导出多个素材 */
export async function batchExportItems(workspaceId: string, itemIds: string[]): Promise<void> {
  const res = await http.post(
    `${BASE}/${workspaceId}/items/batch-export`,
    { item_ids: itemIds },
    { responseType: 'blob' },
  )
  const disposition = res.headers['content-disposition'] as string | undefined
  let filename = '批量导出.zip'
  if (disposition) {
    const match = disposition.match(/filename\*=(?:UTF-8''|")?([^";]+)/i)
    if (match) filename = decodeURIComponent(match[1])
  }
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** PATCH /workspaces/{id}/items/{itemId}/frames/{idx}/title — 帧标题改名 */
export async function updateFrameTitle(
  workspaceId: string,
  itemId: string,
  frameIdx: number,
  title: string,
): Promise<void> {
  await http.patch(`${BASE}/${workspaceId}/items/${itemId}/frames/${frameIdx}/title`, { title })
}

/** GET /workspaces/{id}/items/{itemId}/subtitles?format=srt|vtt|ass — 下载字幕文件 */
export async function downloadSubtitles(
  workspaceId: string,
  itemId: string,
  format: 'srt' | 'vtt' | 'ass' = 'srt',
  withSpeaker = false,
): Promise<void> {
  const res = await http.get(`${BASE}/${workspaceId}/items/${itemId}/subtitles`, {
    params: { format, with_speaker: withSpeaker },
    responseType: 'blob',
  })
  const disposition = res.headers['content-disposition'] as string | undefined
  let filename = `subtitles.${format}`
  if (disposition) {
    const match = disposition.match(/filename\*=(?:UTF-8''|")?([^";]+)/i)
    if (match) filename = decodeURIComponent(match[1])
  }
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export type TranscriptExportMode = 'article' | 'speaker_grouped'

/** 把标题转成安全文件名片段（去掉路径/非法字符）。 */
function safeTitleForFilename(title: string): string {
  return title.replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 80)
}

/** GET /workspaces/{id}/items/{itemId}/transcript — 下载无时间轴文章或说话人归组文章 */
export async function downloadTranscript(
  workspaceId: string,
  itemId: string,
  mode: TranscriptExportMode,
  title?: string,
): Promise<void> {
  const res = await http.get(`${BASE}/${workspaceId}/items/${itemId}/transcript`, {
    params: { mode },
    responseType: 'blob',
  })
  const disposition = res.headers['content-disposition'] as string | undefined
  const suffix = mode === 'speaker_grouped'
    ? '转写文本（无时间轴·区分说话人）'
    : '转写文本（无时间轴）'
  // fallback 文件名必须带标题，否则用户本地无法区分多篇笔记；后端 header 为权威源。
  const safeTitle = title ? safeTitleForFilename(title) : ''
  let filename = safeTitle ? `${safeTitle}-${suffix}.txt` : `${suffix}.txt`
  if (disposition) {
    const match = disposition.match(/filename\*=(?:UTF-8''|")?([^";]+)/i)
    if (match) filename = decodeURIComponent(match[1])
  }
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** GET /workspaces/{id}/ln — 获取学习笔记 markdown 原文 */
export async function getLnMarkdown(workspaceId: string): Promise<string> {
  const res = await http.get<string>(`${BASE}/${workspaceId}/ln`, {
    responseType: 'text',
  } as never)
  return res.data as unknown as string
}

/** PATCH /workspaces/{id}/ln — 保存学习笔记 markdown */
export async function patchLnMarkdown(
  workspaceId: string,
  markdown: string,
): Promise<{ saved_at: string; version: number }> {
  const res = await http.patch<{ saved_at: string; version: number }>(
    `${BASE}/${workspaceId}/ln`,
    { markdown },
  )
  return res.data
}

/** PATCH /workspaces/{id}/items/{itemId}/text_content — T2 纯文在线编辑 */
export async function updateTextContent(
  workspaceId: string,
  itemId: string,
  content: string,
): Promise<{ content: string; saved_at: string }> {
  const res = await http.patch<{ content: string; saved_at: string }>(
    `${BASE}/${workspaceId}/items/${itemId}/text_content`,
    { content },
  )
  return res.data
}

/** GET /workspaces/{id}/ln/export?format=obsidian — 导出 Obsidian zip 包 */
export async function exportLnObsidian(workspaceId: string): Promise<Blob> {
  const res = await http.get(`${BASE}/${workspaceId}/ln/export`, {
    params: { format: 'obsidian' },
    responseType: 'blob',
  })
  return res.data as Blob
}

/** GET /workspaces/{id}/items/{itemId}/text/export — 导出文章笔记 md 或 obsidian */
export async function exportTextNote(
  workspaceId: string,
  itemId: string,
  format: 'md' | 'obsidian',
): Promise<void> {
  const extMap = { md: 'md', obsidian: 'zip' }
  const res = await http.get(
    `${BASE}/${workspaceId}/items/${itemId}/text/export`,
    { params: { format }, responseType: 'blob' },
  )
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `文章笔记.${extMap[format]}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** R0.2: GET /workspaces/{id}/items/{itemId}/note — 读取 note 文件（惰性组装） */
export async function getItemNote(
  workspaceId: string,
  itemId: string,
): Promise<ItemNote> {
  const res = await http.get(`${BASE}/${workspaceId}/items/${itemId}/note`)
  return res.data as ItemNote
}

/** R1.1: PUT /workspaces/{id}/items/{itemId}/note — 写入 note 正文（保留 frontmatter） */
export async function putItemNote(
  workspaceId: string,
  itemId: string,
  body: string,
): Promise<ItemNote> {
  const res = await http.put(`${BASE}/${workspaceId}/items/${itemId}/note`, { body })
  return res.data as ItemNote
}

export async function listNoteVersions(
  workspaceId: string,
  itemId: string,
): Promise<NoteVersion[]> {
  const res = await http.get<NoteVersion[]>(
    `${BASE}/${workspaceId}/items/${itemId}/note/versions`,
  )
  return res.data
}

export async function getNoteVersion(
  workspaceId: string,
  itemId: string,
  versionId: string,
): Promise<NoteVersion> {
  const res = await http.get<NoteVersion>(
    `${BASE}/${workspaceId}/items/${itemId}/note/versions/${versionId}`,
  )
  return res.data
}

export async function restoreNoteVersion(
  workspaceId: string,
  itemId: string,
  versionId: string,
): Promise<ItemNote> {
  const res = await http.post<ItemNote>(
    `${BASE}/${workspaceId}/items/${itemId}/note/versions/${versionId}/restore`,
  )
  return res.data
}

export async function listItemLineage(
  workspaceId: string,
  itemId: string,
): Promise<{ content_id: string; lineage_id: string; copies: LineageCopy[] }> {
  const res = await http.get(
    `${BASE}/${workspaceId}/items/${itemId}/lineage`,
  )
  return res.data as { content_id: string; lineage_id: string; copies: LineageCopy[] }
}

export async function adoptSiblingNote(
  workspaceId: string,
  itemId: string,
  siblingContentId: string,
): Promise<ItemNote> {
  const res = await http.post<ItemNote>(
    `${BASE}/${workspaceId}/items/${itemId}/note/adopt-sibling`,
    { sibling_content_id: siblingContentId },
  )
  return res.data
}

/** R4.3: GET /workspaces/{id}/items/{itemId}/note/export?format=obsidian */
export async function exportItemNoteObsidian(
  workspaceId: string,
  itemId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await http.get(`${BASE}/${workspaceId}/items/${itemId}/note/export`, {
    params: { format: 'obsidian' },
    responseType: 'blob',
    signal,
  })
  return res.data as Blob
}

export type ItemNoteExportFormat =
  | 'md'
  | 'html'
  | 'pdf'
  | 'docx'
  | 'long_image'
  | 'pptx'
  | 'obsidian'
  | 'transcript_txt'
  | 'srt'
  | 'vtt'
  | 'ass'

/** GET /workspaces/{id}/items/{itemId}/note/export?format=... */
export async function downloadItemNoteExport(
  workspaceId: string,
  itemId: string,
  format: ItemNoteExportFormat,
  fallbackFilename: string,
  signal?: AbortSignal,
  sourceKind: 'main' | 'summary' = 'main',
  summaryId?: string,
): Promise<void> {
  const res = await http.get(`${BASE}/${workspaceId}/items/${itemId}/note/export`, {
    params: { format, source_kind: sourceKind, summary_id: summaryId },
    responseType: 'blob',
    signal,
  })
  const disposition = res.headers['content-disposition'] as string | undefined
  let filename = fallbackFilename
  if (disposition) {
    const match = disposition.match(/filename\*=(?:UTF-8''|")?([^";]+)/i)
    if (match) filename = decodeURIComponent(match[1])
  }
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
