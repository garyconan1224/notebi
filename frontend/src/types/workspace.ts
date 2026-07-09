// 与后端 backend/app/models/workspace.py 对齐的类型定义

export type ItemType = 'video' | 'audio' | 'image' | 'text'

/** 笔记媒体类型（添加素材时的手动选择） */
export type NoteMediaKind = 'auto' | 'video' | 'image_text' | 'audio' | 'mixed'

/** 分析范围：仅对 sniff 同时返回 video+audio 时生效 */
export type AnalysisScope = 'audio_only' | 'visual_only'
export type ItemSource = 'url' | 'local'
export type ItemStatus = 'pending' | 'processing' | 'done' | 'failed'
export type WorkspaceStatus = 'active' | 'processing' | 'analyzed' | 'archived'

/** 前置配置（设计文档第 4 章）。 */
export interface PreflightConfig {
  /** 覆盖 workspace 级背景信息的字段（一般留空，跟 workspace 走） */
  background_overrides: Partial<WorkspaceBackground>
  /** 模型选择：vision/text/video → provider_id */
  models: { vision?: string; text?: string; video?: string }
  /** 任务勾选项 + 子参数；结构按 item.type 不同 */
  tasks: Record<string, unknown>
  /** 素材意图：learning（学习消费）/ replica（复刻生产）/ 空 */
  intent?: string
}

/** 工作空间内单个素材 */
/** Phase 3C: 系统标签维度（与后端 shared/config.py::TAG_DIMENSIONS 同步） */
export type SystemTagDimension =
  | 'content_type'
  | 'subject_domain'
  | 'difficulty'
  | 'duration_band'
  | 'information_density'
  | 'emotion_tone'

/** Phase 3C: WorkspaceItem.tags 形状（6 个系统维度 + custom_tags + 元数据） */
export interface ItemTags {
  content_type?: string
  subject_domain?: string
  difficulty?: string
  duration_band?: string
  information_density?: string
  emotion_tone?: string
  custom_tags?: string[]
  _generated_at?: string
  _generated_model?: string
}

export interface WorkspaceItem {
  item_id: string
  type: ItemType
  source: ItemSource
  source_value: string
  name: string
  status: ItemStatus
  preflight: PreflightConfig
  results: Record<string, unknown>
  thumbnail?: string | null
  favorite?: boolean
  related_task_ids: string[]
  tags: ItemTags
  created_at: string
  updated_at: string
}

/** 前置配置「背景信息」 */
export interface WorkspaceBackground {
  content_type: string
  participants: string[]
  topic: string
  glossary: string[]
  purpose: string
  /** 截帧间隔（秒），后端 /start 从 background_overrides 读取 */
  frame_interval_sec?: number
}

/** 工作空间记录 */
export interface WorkspaceRecord {
  workspace_id: string
  name: string
  status: WorkspaceStatus
  trashed: boolean
  background: WorkspaceBackground
  items: WorkspaceItem[]
  favorites: string[]
  created_at: string
  updated_at: string
  kind: 'note' | 'replica'
  source: string
  source_meta?: Record<string, any>
}

/** 创建工作空间请求体 */
export interface WorkspaceCreateRequest {
  name: string
  background?: Partial<WorkspaceBackground>
  kind?: 'note' | 'replica'
  source?: string
  source_meta?: Record<string, any>
}

/** 更新工作空间请求体（所有字段可选） */
export interface WorkspaceUpdateRequest {
  name?: string
  status?: WorkspaceStatus
  background?: Partial<WorkspaceBackground>
}

/** 添加素材请求体 */
export interface ItemAddRequest {
  type: ItemType
  source: ItemSource
  source_value: string
  name?: string
}

/** 保存前置配置请求体 */
export interface PreflightSaveRequest {
  intent?: string
  background_overrides?: Partial<WorkspaceBackground>
  models?: PreflightConfig['models']
  tasks?: PreflightConfig['tasks']
  prefer_subtitle?: boolean  // ④16 CC-first：优先用平台字幕（默认 true）
}

/** start 接口的返回 */
export interface StartItemResponse {
  workspace: WorkspaceRecord
  task_id: string
  task_type: 'download' | 'analyze' | 'create' | 'storyboard' | 'note'
}

/** R0.2: GET /…/note 返回的单条 summary 结构 */
export interface ItemNoteSummary {
  template: string
  version: number
  path: string
  content: string
}

/** 单张图片的结构化分析信息（来自 VLM description_parts） */
export interface ImageInfo {
  idx: number
  description: string
  ocr_text: string
  static_url: string
  description_parts: {
    subject?: string
    scene?: string
    color?: string
    composition?: string
    style?: string
    details?: string
  }
}

/** R3.1: note API 返回的 media 结构（按 item.type 填充） */
export interface NoteMedia {
  images?: string[]        // image 类型：图片 URL 列表
  image_infos?: ImageInfo[]  // image 类型：每张图的结构化分析信息
  video?: { url: string; duration: number }  // video 类型
  frames?: { sec: number; url: string }[]    // video 类型：关键帧
  audio?: string           // audio 类型：音频 URL
}

export interface TranscriptTranslationSegment {
  idx: number
  text: string
}

export type TranscriptTranslations = Record<
  string,
  Record<number, string> | TranscriptTranslationSegment[]
>

/** R0.2: GET /…/note 返回的完整 note 数据 */
export interface ItemNote {
  frontmatter: Record<string, unknown>
  source_md: string
  note_md: string
  summaries: ItemNoteSummary[]
  note_dir: string
  media: NoteMedia         // R3.1: 媒体 URL（实时从 results 提取）
  transcript: unknown      // R3.1: 转录数据（video/audio 时为 list）
  translations?: TranscriptTranslations | null
  summary_hint?: {
    content_category?: string
    default_template?: string
  }
}

/** 中文展示文案——状态 */
export const WORKSPACE_STATUS_TEXT: Record<WorkspaceStatus, string> = {
  active: '进行中',
  processing: '处理中',
  analyzed: '已分析',
  archived: '已归档',
}

/** 中文展示文案——素材类型 */
export const ITEM_TYPE_TEXT: Record<ItemType, string> = {
  video: '视频',
  audio: '音频',
  image: '图片',
  text: '文字',
}

/** 各类型对应的语义色（对齐设计文档 1.3 颜色语义） */
export const ITEM_TYPE_COLOR: Record<ItemType, string> = {
  video: 'bg-purple-100 text-purple-700',
  audio: 'bg-teal-100 text-teal-700',
  image: 'bg-blue-100 text-blue-700',
  text: 'bg-gray-100 text-gray-700',
}

/** 统计工作空间内不同类型素材的数量 */
export function countItemsByType(ws: WorkspaceRecord): Record<ItemType, number> {
  const acc: Record<ItemType, number> = { video: 0, audio: 0, image: 0, text: 0 }
  for (const it of ws.items) {
    acc[it.type] = (acc[it.type] ?? 0) + 1
  }
  return acc
}
