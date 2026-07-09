import type { ItemType } from '@/types/workspace'

/**
 * Preflight 任务子参数类型（N5 引入）。
 *
 * 后端 `PreflightConfig.tasks` 仍是 `Record<string, unknown>`，本文件只在前端
 * 把"老 boolean"和"新 {enabled, ...params}"两种形状统一为对象访问。
 */

// ── 视频 ────────────────────────────────────────────────
export type VideoCaptureMode = 'interval' | 'scene'
export type PromptFormat = 'mj' | 'sd' | 'json'
export type PromptLang = 'zh' | 'en'

export interface VideoFramePromptsParams {
  enabled: boolean
  capture_mode: VideoCaptureMode
  interval_sec: number
  max_frames: number
  scene_frames_per_shot: 2 | 3
  format: PromptFormat
  lang: PromptLang
}

export type VideoSummaryPath = 'subtitle' | 'detailed' | 'video_model'
export type SummaryDepth = 'brief' | 'normal' | 'deep'
export type VideoTemplate = 'auto' | '教程' | 'Vlog' | '访谈' | '影视点评' | '产品评测' | '其它'
export type VideoOutputFormat = 'summary' | 'key_points' | 'golden_quotes' | 'paragraph_rewrite'

export const VIDEO_TEMPLATE_OPTIONS: VideoTemplate[] = ['auto', '教程', 'Vlog', '访谈', '影视点评', '产品评测', '其它']
export const OUTPUT_FORMAT_OPTIONS: { value: VideoOutputFormat; label: string; desc: string }[] = [
  { value: 'summary', label: '摘要', desc: '全文结构化摘要' },
  { value: 'key_points', label: '要点', desc: '编号要点列表' },
  { value: 'golden_quotes', label: '金句', desc: '精彩语句摘录' },
  { value: 'paragraph_rewrite', label: '段落改写', desc: '保留信息，重新组织语言' },
]

export interface VideoSummaryParams {
  enabled: boolean
  path: VideoSummaryPath
  depth: SummaryDepth
  /** IP.9.3: 路径 2 时选择的视频类型模板 */
  video_template: VideoTemplate
  /** V2.2: 路径 1 输出格式（摘要/要点/金句/段落改写） */
  output_format: VideoOutputFormat
}

// ── 音频 ────────────────────────────────────────────────
export type WhisperLang =
  | 'auto'
  | 'zh'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'

export interface AudioAsrParams {
  enabled: boolean
  whisper_lang: WhisperLang
}

export interface MusicAnalysisParams {
  enabled: boolean
  suno_format: boolean
  udio_format: boolean
}

// ── 图片 ────────────────────────────────────────────────
export type AssociationDirection =
  | 'usage'
  | 'design'
  | 'competitor'
  | 'emotion'

export interface ImageFramePromptsParams {
  enabled: boolean
  format: PromptFormat
}

export interface ImageAssociationParams {
  enabled: boolean
  directions: AssociationDirection[]
}

// ── 文字 ────────────────────────────────────────────────
export type SummaryLength = 'short' | 'medium' | 'long'
export type RewriteStyle = 'formal' | 'casual' | 'concise' | 'rich'

export interface TextSummaryParams {
  enabled: boolean
  length: SummaryLength
}

export interface TextAssociationParams {
  enabled: boolean
  directions: AssociationDirection[]
}

export interface TextRewriteParams {
  enabled: boolean
  style: RewriteStyle
}

export interface TextTranslateParams {
  enabled: boolean
  target_lang: string
}

// ── 通用「只有 enabled」的简单任务 ─────────────────────
export interface EnabledOnly {
  enabled: boolean
}

// ── 默认值表 ────────────────────────────────────────────
export const DEFAULT_VIDEO_FRAME_PROMPTS: VideoFramePromptsParams = {
  enabled: true,
  capture_mode: 'scene',
  interval_sec: 5,
  max_frames: 100,
  scene_frames_per_shot: 3,
  format: 'mj',
  lang: 'en',
}

export const DEFAULT_VIDEO_SUMMARY: VideoSummaryParams = {
  enabled: true,
  path: 'detailed',
  depth: 'normal',
  video_template: 'auto',
  output_format: 'summary',
}

export const DEFAULT_AUDIO_ASR: AudioAsrParams = {
  enabled: true,
  whisper_lang: 'auto',
}

export const DEFAULT_MUSIC_ANALYSIS: MusicAnalysisParams = {
  enabled: false,
  suno_format: true,
  udio_format: false,
}

export const DEFAULT_IMAGE_FRAME_PROMPTS: ImageFramePromptsParams = {
  enabled: true,
  format: 'mj',
}

export const DEFAULT_IMAGE_ASSOCIATION: ImageAssociationParams = {
  enabled: false,
  directions: ['usage'],
}

export const DEFAULT_TEXT_SUMMARY: TextSummaryParams = {
  enabled: true,
  length: 'medium',
}

export const DEFAULT_TEXT_ASSOCIATION: TextAssociationParams = {
  enabled: false,
  directions: ['usage'],
}

export const DEFAULT_TEXT_REWRITE: TextRewriteParams = {
  enabled: false,
  style: 'formal',
}

export const DEFAULT_TEXT_TRANSLATE: TextTranslateParams = {
  enabled: false,
  target_lang: 'en',
}

// 每个 task id 的默认 params 表（按"出现位置"区分同名 task id）
// 注意：image.prompt 与 video.frame_prompt 字段不同
const DEFAULTS_BY_TYPE_AND_ID: Record<
  ItemType,
  Record<string, Record<string, unknown>>
> = {
  video: {
    frame_prompt: { ...DEFAULT_VIDEO_FRAME_PROMPTS },
    summary: { ...DEFAULT_VIDEO_SUMMARY },
    srt: { enabled: true },
    music_analysis: { ...DEFAULT_MUSIC_ANALYSIS },
  },
  audio: {
    asr_summary: { ...DEFAULT_AUDIO_ASR },
    vocal_separation: { enabled: false },
    subtitle_file: { enabled: true },
    music_analysis: { ...DEFAULT_MUSIC_ANALYSIS },
    music_transcribe: { enabled: false },
    prompt_generation: { enabled: false },
  },
  image: {
    describe: { enabled: true },
    ocr: { enabled: false },
    prompt: { ...DEFAULT_IMAGE_FRAME_PROMPTS },
    assoc: { ...DEFAULT_IMAGE_ASSOCIATION },
    compare: { enabled: false },
  },
  text: {
    summary: { ...DEFAULT_TEXT_SUMMARY },
    assoc: { ...DEFAULT_TEXT_ASSOCIATION },
    rewrite: { ...DEFAULT_TEXT_REWRITE },
    translate: { ...DEFAULT_TEXT_TRANSLATE },
    multi: { enabled: false },
  },
}

/**
 * 读 task params，兼容三种历史形状：
 * - undefined / null：返回默认
 * - boolean：视作 { enabled: <bool>, ...其余默认 }
 * - object：浅合并默认（缺字段用默认补齐）
 */
export function getTaskParams<T extends Record<string, unknown>>(
  tasks: Record<string, unknown> | undefined,
  type: ItemType,
  id: string,
): T {
  const defaults = (DEFAULTS_BY_TYPE_AND_ID[type]?.[id] ?? { enabled: false }) as T
  const raw = tasks?.[id]
  if (raw == null) return { ...defaults }
  if (typeof raw === 'boolean') return { ...defaults, enabled: raw }
  if (typeof raw === 'object') {
    return { ...defaults, ...(raw as Record<string, unknown>) } as T
  }
  return { ...defaults }
}

/** 不可变更新某个 task 的 params */
export function setTaskParams(
  tasks: Record<string, unknown>,
  id: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  return { ...tasks, [id]: { ...params } }
}

/** 一级开关读取（boolean / object 都兼容） */
export function isTaskEnabled(
  tasks: Record<string, unknown> | undefined,
  id: string,
): boolean {
  const raw = tasks?.[id]
  if (raw == null) return false
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'object') return !!(raw as { enabled?: boolean }).enabled
  return false
}

/** 把整个 tasks 升级为新形状（保存时调用，确保后续读不到旧 boolean） */
export function normalizeTasksShape(
  tasks: Record<string, unknown> | undefined,
  type: ItemType,
): Record<string, unknown> {
  const defaults = DEFAULTS_BY_TYPE_AND_ID[type] ?? {}
  const out: Record<string, unknown> = {}
  const allIds = new Set([
    ...Object.keys(defaults),
    ...Object.keys(tasks ?? {}),
  ])
  for (const id of allIds) {
    out[id] = getTaskParams(tasks, type, id)
  }
  return out
}

/** 一级任务列表（含「多图/多文对比」补全项） */
export interface TopLevelTask {
  id: string
  label: string
  desc?: string
}

export function getTopLevelTasks(type: ItemType): TopLevelTask[] {
  switch (type) {
    case 'video':
      return [
        { id: 'frame_prompt', label: '画面提示词生成', desc: '截帧 → 视觉模型 → 提示词' },
        { id: 'summary', label: '视频文案总结', desc: '三条路径选一' },
        { id: 'srt', label: '字幕导出', desc: '转写后导出 .srt' },
        { id: 'music_analysis', label: '音乐分析', desc: '背景音乐 BPM / Suno-Udio' },
      ]
    case 'audio':
      return [
        { id: 'asr_summary', label: '人声内容总结', desc: 'Whisper 转写 + LLM 总结' },
        { id: 'vocal_separation', label: '输出人声音频', desc: '分离人声与伴奏' },
        { id: 'subtitle_file', label: '生成字幕文件', desc: '.srt / .txt 导出' },
        { id: 'music_analysis', label: '音乐分析', desc: 'BPM / 乐器 / Suno-Udio 提示词' },
        { id: 'music_transcribe', label: '音乐转写', desc: '背景音乐旋律转 MIDI/乐谱' },
        { id: 'prompt_generation', label: '提示词输出', desc: '基于内容生成创作提示词' },
      ]
    case 'image':
      return [
        { id: 'describe', label: '内容识别描述', desc: '主体 / 场景 / 色调 / 构图 / 风格' },
        { id: 'ocr', label: 'OCR 文字提取' },
        { id: 'prompt', label: '画面提示词生成', desc: 'MJ / SD / JSON' },
        { id: 'assoc', label: '内容联想总结', desc: '用途 / 设计 / 竞品 / 情绪' },
        { id: 'compare', label: '多图对比', desc: '与同任务其他图片对比' },
      ]
    case 'text':
      return [
        { id: 'summary', label: '摘要 / 要点 / 金句' },
        { id: 'assoc', label: '联想归纳', desc: '4 维方向多选' },
        { id: 'rewrite', label: '改写 / 润色', desc: '正式 / 口语 / 简洁 / 丰富' },
        { id: 'translate', label: '翻译' },
        { id: 'multi', label: '多文对比', desc: '与同任务其他文本对比' },
      ]
  }
}

export const ASSOCIATION_DIRECTION_LABELS: Record<AssociationDirection, string> = {
  usage: '用途推断',
  design: '设计分析',
  competitor: '竞品洞察',
  emotion: '情绪解读',
}
