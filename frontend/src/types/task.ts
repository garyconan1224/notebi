// 任务状态枚举（与后端 TaskStatus 对齐 v1.1 §11）
export enum TaskStatus {
  PENDING = 'PENDING',
  DOWNLOAD = 'DOWNLOAD',    // 下载（仅链接来源）
  PROBE = 'PROBE',          // 探测（格式/时长/字幕轨）
  FRAMES = 'FRAMES',        // 截帧（画面准备）
  ASR = 'ASR',              // 转写（Whisper）
  VLM = 'VLM',              // 视觉分析（逐帧提示词）
  SUM = 'SUM',              // 总结（LLM 生成总结）
  STORE = 'STORE',          // 入库（写入任务数据库）
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  AWAITING_CONFIRM = 'AWAITING_CONFIRM',  // A3: VAD 无人声等待确认
}

// 任务日志条目
export interface TaskLogEntry {
  ts: string                           // ISO 时间戳
  level: 'info' | 'warning' | 'error'
  message: string
}

// 任务记录（对应后端 TaskRecord）
export interface TaskRecord {
  task_id: string
  project_id: string
  task_type: string                    // download|analyze|create|storyboard|note
  payload: Record<string, unknown>
  status: string                       // TaskStatus 值
  progress: number                     // 0.0 ~ 1.0
  log: TaskLogEntry[]
  result: Record<string, unknown>
  error: string
  retry_of: string
  cancel_requested: boolean
  created_at: string                   // ISO 时间戳
  updated_at: string                   // ISO 时间戳
}

// 七阶段处理流程（对齐 v1.1 §11，用于 ProcessingStepper）
export interface ProcessingStage {
  id: TaskStatus
  name: string
  icon: string                         // lucide-react 图标名
  color: string                        // 颜色 token
}

// 注意：顺序按当前 pipeline 的实际运行时为准（DOWNLOAD→PROBE→ASR→FRAMES→SUM→STORE）。
// v1.1 §11 spec 的语序是 download→probe→frames→asr→vlm→sum→store；
// 现有 pipeline_tasks.py 中 transcribe (ASR) 早于 analyze (FRAMES)，
// 待 Phase 1G 把 analyze 拆为 FRAMES（截帧）+ VLM（视觉分析）并调整执行顺序后，
// 再让 UI 顺序与 spec 完全一致。
export const PROCESSING_STAGES: ProcessingStage[] = [
  { id: TaskStatus.DOWNLOAD, name: '下载', icon: 'Download', color: 'blue' },
  { id: TaskStatus.PROBE, name: '探测', icon: 'Search', color: 'gray' },
  { id: TaskStatus.ASR, name: '转写', icon: 'Subtitles', color: 'rose' },
  { id: TaskStatus.FRAMES, name: '截帧', icon: 'Image', color: 'amber' },
  { id: TaskStatus.VLM, name: '视觉分析', icon: 'Eye', color: 'purple' },
  { id: TaskStatus.SUM, name: '总结', icon: 'BookMarked', color: 'emerald' },
  { id: TaskStatus.STORE, name: '入库', icon: 'Database', color: 'slate' },
]

// pipeline step → 阶段映射（用于按 payload.steps 过滤可见阶段）
export const STEP_TO_STAGE: Record<string, TaskStatus> = {
  download: TaskStatus.DOWNLOAD,
  transcribe: TaskStatus.ASR,
  analyze: TaskStatus.FRAMES,
  note: TaskStatus.SUM,
}

// 任务列表查询响应
export interface TaskListResponse {
  data: TaskRecord[]
}

/** analyze 任务 payload（与后端 pipeline analyze handler 对齐） */
export interface AnalyzePayload {
  url: string
  video_path?: string
  model_name: string
  // 兼容旧版本（单 provider）
  provider_id?: string
  // 双模型：文本 + 视觉，各自独立的 provider + model
  text_provider_id?: string
  text_model?: string
  vision_provider_id?: string
  vision_model?: string
  // 注：audio_model 已弃用，改用本地 faster-whisper 转录
  quality: 'fast' | 'medium' | 'slow'
  format: string[]
  style: 'academic' | 'minimalist' | 'creative'
  screenshot: boolean
  link: boolean
  video_understanding: boolean
  video_interval: number
  grid_size: [number, number]
  extras?: string
  browser?: string
  proxy?: string
  po_token?: string
  visitor_data?: string
  format_selector?: string
  cookie_base_dirs?: string[]
}

/** download 任务 payload */
export interface DownloadPayload {
  url: string
  browser?: string
  proxy?: string
  po_token?: string
  visitor_data?: string
  format_selector?: string
  cookie_base_dirs?: string[]
}

// 任务创建请求
export interface TaskCreateRequest {
  project_id: string
  task_type: 'download' | 'analyze' | 'create' | 'storyboard' | 'note' | 'text' | 'image' | 'audio'
  payload: AnalyzePayload | DownloadPayload | Record<string, unknown>
  /** 可选步骤编排，仅对 note 任务生效。默认全量执行。 */
  steps?: string[]
}

// 任务创建响应
export interface TaskCreateResponse {
  status: string
  task_id: string
}

// 终结状态集合
export const TERMINAL_STATUSES = new Set([
  TaskStatus.SUCCESS,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
])

// 判断任务是否已完成
export const isTaskTerminal = (status: string): boolean => {
  return TERMINAL_STATUSES.has(status as TaskStatus)
}

// 获取状态显示文本
export const getStatusText = (status: string): string => {
  const statusMap: Record<string, string> = {
    [TaskStatus.PENDING]: '待处理',
    [TaskStatus.DOWNLOAD]: '下载中',
    [TaskStatus.PROBE]: '探测中',
    [TaskStatus.FRAMES]: '截帧中',
    [TaskStatus.ASR]: '转录中',
    [TaskStatus.VLM]: '视觉分析中',
    [TaskStatus.SUM]: '总结中',
    [TaskStatus.STORE]: '入库中',
    [TaskStatus.SUCCESS]: '成功',
    [TaskStatus.FAILED]: '失败',
    [TaskStatus.CANCELLED]: '已取消',
    [TaskStatus.AWAITING_CONFIRM]: '等待确认',
  }
  return statusMap[status] || status
}

// 获取状态颜色（用于 UI）
export const getStatusColor = (status: string): string => {
  const colorMap: Record<string, string> = {
    [TaskStatus.PENDING]: 'bg-gray-100 text-gray-700',
    [TaskStatus.DOWNLOAD]: 'bg-cyan-100 text-cyan-700',
    [TaskStatus.PROBE]: 'bg-gray-100 text-gray-600',
    [TaskStatus.FRAMES]: 'bg-amber-100 text-amber-700',
    [TaskStatus.ASR]: 'bg-rose-100 text-rose-700',
    [TaskStatus.VLM]: 'bg-purple-100 text-purple-700',
    [TaskStatus.SUM]: 'bg-emerald-100 text-emerald-700',
    [TaskStatus.STORE]: 'bg-slate-100 text-slate-600',
    [TaskStatus.SUCCESS]: 'bg-emerald-100 text-emerald-700',
    [TaskStatus.FAILED]: 'bg-red-100 text-red-700',
    [TaskStatus.CANCELLED]: 'bg-slate-100 text-slate-700',
    [TaskStatus.AWAITING_CONFIRM]: 'bg-amber-100 text-amber-700',
  }
  return colorMap[status] || 'bg-gray-100 text-gray-700'
}
