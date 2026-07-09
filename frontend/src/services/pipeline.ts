import type { Feature } from '@/lib/featuresToSteps'
import { featuresToSteps } from '@/lib/featuresToSteps'
import type { TaskCreateRequest, TaskCreateResponse, TaskRecord } from '@/types/task'
import type { ItemType, WorkspaceBackground } from '@/types/workspace'
import { http } from './client'

/** POST /pipeline/tasks 请求路径 */
const PIPELINE_TASKS_URL = '/pipeline/tasks'

/**
 * 创建 pipeline 任务
 *
 * 请求体（TaskCreateRequest）：
 *   - project_id  : string             — 项目 ID（crypto.randomUUID()）
 *   - task_type   : 'download'|'analyze'|'create'|'storyboard'|'note'|'text'|'image'|'audio'
 *   - payload     : AnalyzePayload | DownloadPayload
 *
 * analyze payload 新增字段：
 *   - model_name          : string     — 模型标识，如 "gpt-4o-mini"
 *   - provider_id         : string     — 提供商 ID，如 "openai"
 *   - quality             : 'fast'|'medium'|'slow'
 *   - format              : string[]   — ['bulleted','mindmap','quiz','summary','key_points']
 *   - style               : 'academic'|'minimalist'|'creative'
 *   - screenshot          : boolean    — 是否插入截图
 *   - link                : boolean    — 是否保留原始链接
 *   - video_understanding : boolean    — 是否开启视觉理解
 *   - video_interval      : number     — 抽帧间隔（秒）
 *   - grid_size           : [number, number] — 网格拼图 [列, 行]
 *   - extras              : string?    — 额外 prompt
 *
 * 响应体（TaskCreateResponse）：
 *   - status   : "accepted"
 *   - task_id  : string
 */
export async function createPipelineTask(
  req: TaskCreateRequest,
): Promise<TaskCreateResponse> {
  const res = await http.post<TaskCreateResponse>(PIPELINE_TASKS_URL, req)
  return res.data
}

/** GET /pipeline/tasks/{task_id}，用于详情页补拉单个任务的完整 result/log。 */
export async function getPipelineTask(taskId: string): Promise<TaskRecord> {
  const res = await http.get<TaskRecord | { data: TaskRecord }>(`${PIPELINE_TASKS_URL}/${taskId}`)
  const raw = res.data
  return raw && typeof raw === 'object' && 'task_id' in raw
    ? raw as TaskRecord
    : (raw as { data: TaskRecord }).data
}

/**
 * 取消 pipeline 任务
 * POST /pipeline/tasks/{task_id}/cancel
 */
export async function cancelPipelineTask(taskId: string): Promise<void> {
  await http.post(`${PIPELINE_TASKS_URL}/${taskId}/cancel`)
}

/**
 * 删除已终结的 pipeline 任务记录
 * DELETE /pipeline/tasks/{task_id}
 */
export async function deletePipelineTask(taskId: string): Promise<void> {
  await http.delete(`${PIPELINE_TASKS_URL}/${taskId}`)
}

/**
 * 重试失败的 pipeline 任务
 * POST /pipeline/tasks/{task_id}/retry
 *
 * 返回新创建的重试任务记录
 */
export async function retryPipelineTask(taskId: string) {
  const res = await http.post(`${PIPELINE_TASKS_URL}/${taskId}/retry`)
  return res.data
}

/** A3: 用户确认无人声音频切换为音乐分析模式 */
export async function confirmMusicMode(taskId: string) {
  const res = await http.post(`${PIPELINE_TASKS_URL}/${taskId}/confirm-music`)
  return res.data
}

// ── Phase R: note 任务创建 ──────────────────────────────────

export interface NotePreflightOverrides {
  models?: { vision?: string; text?: string }
  summary?: { path?: string; video_template?: string; output_format?: string }
  text_rewrite?: { enabled: boolean; style: string }
  text_translate?: { enabled: boolean; target_lang: string }
  /** #5: 视频帧分析参数（capture_params），透传到 note 的 analyze 步骤 */
  frame_prompt?: {
    mode?: 'interval' | 'ai_shot'
    interval_sec?: number
    max_frames?: number
    frames_per_shot?: number
  }
}

export interface CreateNoteTaskParams {
  url: string
  material_type: ItemType
  enabled_features: Feature[]
  background?: Partial<WorkspaceBackground>
  workspace_id: string
  preflight?: NotePreflightOverrides
}

/** 按 material_type 分派 pipeline 任务。
 *
 * - video/audio → task_type: 'note'（现有复合流水线：download→transcribe→analyze→note）
 * - text → task_type: 'text'（handle_text_task：FETCH→PARSE→SUM→STORE）
 * - image → task_type: 'image'（handle_image_task：FETCH→VLM→STORE）
 *
 * 返回扩展了 task_type 的响应，供前端 store 使用正确类型。
 * 解决 R5 误判：text/image 不再经 yt-dlp 下载（#3/#4）。
 */
export async function createNoteTask(
  params: CreateNoteTaskParams,
): Promise<TaskCreateResponse & { task_type: string }> {
  const { url, material_type, enabled_features, background, workspace_id, preflight } = params
  const bg = background ?? {}

  // ── text: 转派给 handle_text_task ──────────────────────────
  if (material_type === 'text') {
    const payload: Record<string, unknown> = { source: url }

    // summary_keypoints → 默认 summary（handler 始终执行）
    if (enabled_features.includes('summary_keypoints')) {
      payload.summary = {}
    }
    // rewrite → rewrite 子参数
    if (preflight?.text_rewrite?.enabled) {
      payload.rewrite = { enabled: true, style: preflight.text_rewrite.style }
    } else if (enabled_features.includes('rewrite')) {
      payload.rewrite = { enabled: true, style: 'concise' }
    }
    // translate → translate 子参数
    if (preflight?.text_translate?.enabled) {
      payload.translate = { enabled: true, target_lang: preflight.text_translate.target_lang }
    } else if (enabled_features.includes('translate')) {
      payload.translate = { enabled: true, target_lang: 'en' }
    }
    // preflight.models → 模型配置
    if (preflight?.models?.text) {
      payload.text_model = preflight.models.text
    }
    if (bg) payload.background = bg

    const res = await createPipelineTask({
      project_id: workspace_id,
      task_type: 'text',
      payload,
    })
    return { ...res, task_type: 'text' }
  }

  // ── image: 转派给 handle_image_task ────────────────────────
  if (material_type === 'image') {
    const payload: Record<string, unknown> = { source: url }

    // features → handler 子参数
    if (enabled_features.includes('ocr')) {
      payload.ocr = { enabled: true }
    }
    if (enabled_features.includes('prompt')) {
      payload.prompt = { enabled: true, format: 'mj' }
    }
    if (enabled_features.includes('assoc')) {
      payload.assoc = { enabled: true, directions: ['usage'] }
    }
    // preflight.models → 模型配置
    if (preflight?.models?.text) payload.text_model = preflight.models.text
    if (preflight?.models?.vision) payload.vision_model = preflight.models.vision
    if (bg) payload.background = bg

    const res = await createPipelineTask({
      project_id: workspace_id,
      task_type: 'image',
      payload,
    })
    return { ...res, task_type: 'image' }
  }

  // ── video / audio: 现有 note 复合任务 ─────────────────────
  const steps = featuresToSteps(material_type, enabled_features)
  const res = await createPipelineTask({
    project_id: workspace_id,
    task_type: 'note',
    payload: {
      url,
      material_type,
      enabled_features,
      background: bg,
      workspace_id,
      ...(preflight ? { preflight } : {}),
    },
    steps,
  })
  return { ...res, task_type: 'note' }
}
