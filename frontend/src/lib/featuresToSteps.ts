import type { AnalysisScope, ItemType } from '@/types/workspace'

// ── Feature 定义（SPEC §2.6 一级勾选项）─────────────────────

export type Feature =
  | 'visual_analysis'        // R17: 新增，替代 visual_prompt + video_summary
  | 'visual_prompt'
  | 'video_summary'
  | 'subtitle_export'
  | 'music_analysis'
  | 'transcribe_summary'
  | 'speaker_diarize'
  | 'describe'
  | 'ocr'
  | 'prompt'
  | 'assoc'
  | 'summary_keypoints'
  | 'rewrite'
  | 'translate'
  | 'multi_compare'

export interface FeatureDef {
  id: Feature
  label: string
  defaultChecked: boolean
  hint?: string         // R17: tooltip 文案
  badge?: string        // R17: 标题前缀图标（⭐）
  highlight?: boolean   // R17: 高亮特殊样式
}

export const FEATURES_BY_TYPE: Record<ItemType, FeatureDef[]> = {
  video: [
    { id: 'visual_prompt', label: '画面提示词', defaultChecked: true },
    { id: 'video_summary', label: '文案总结', defaultChecked: true },
    { id: 'subtitle_export', label: '字幕导出', defaultChecked: true },
    { id: 'music_analysis', label: '音乐分析', defaultChecked: false },
  ],
  audio: [
    { id: 'transcribe_summary', label: '转写+总结', defaultChecked: true },
    { id: 'speaker_diarize', label: '说话人音色', defaultChecked: false },
    { id: 'subtitle_export', label: '字幕导出', defaultChecked: true },
    { id: 'music_analysis', label: '音乐分析', defaultChecked: false },
  ],
  image: [
    { id: 'describe', label: '内容识别', defaultChecked: true },
    { id: 'ocr', label: 'OCR', defaultChecked: false },
    { id: 'prompt', label: '提示词', defaultChecked: true },
    { id: 'assoc', label: '联想总结', defaultChecked: false },
  ],
  text: [
    { id: 'summary_keypoints', label: '摘要+要点+金句', defaultChecked: true },
    { id: 'rewrite', label: '改写', defaultChecked: false },
    { id: 'translate', label: '翻译', defaultChecked: false },
    { id: 'multi_compare', label: '多文对比', defaultChecked: false },
  ],
}

// ── Feature → 后端 steps 映射 ──────────────────────────────
// 后端 handle_note_task 当前支持: download / transcribe / analyze / note
// "transcribe" 步骤仅对依赖 ASR 转写的 feature 启用

const NEEDS_TRANSCRIBE: ReadonlySet<Feature> = new Set([
  'video_summary',
  'subtitle_export',
  'transcribe_summary',
  'speaker_diarize',
])

/** R17: feature → 后端 task id 映射 */
const TASK_TYPE_MAP: Record<Feature, string[]> = {
  visual_analysis:    ['frame_extract', 'vlm_analyze'],
  transcribe_summary: ['asr', 'summary'],
  music_analysis:     ['music_analyze'],
  visual_prompt:      ['frame_extract', 'vlm_analyze'],
  video_summary:      ['frame_extract', 'vlm_analyze', 'summary'],
  subtitle_export:    ['asr', 'srt_export'],
  speaker_diarize:    ['asr', 'diarize'],
  describe:           ['vlm_analyze'],
  ocr:                ['ocr'],
  prompt:             ['vlm_analyze'],
  assoc:              ['summary'],
  summary_keypoints:  ['summary'],
  rewrite:            ['summary'],
  translate:          ['summary'],
  multi_compare:      ['summary'],
}

/**
 * 将前端一级勾选的 features 翻译为后端 pipeline steps。
 * 始终包含 download + analyze + note；仅当任一 feature 需要转写时才加入 transcribe。
 */
export function featuresToSteps(_type: ItemType, features: Feature[]): string[] {
  const steps = ['download', 'analyze', 'note']
  const needsTranscribe = features.some((f) => NEEDS_TRANSCRIBE.has(f))
  if (needsTranscribe) {
    // transcribe 插在 download 之后、analyze 之前
    steps.splice(1, 0, 'transcribe')
  }
  return steps
}

/** 获取 feature 对应的后端 task id 列表 */
export function getTaskTypeMap(feature: Feature): string[] {
  return TASK_TYPE_MAP[feature] ?? []
}

/** 返回某素材类型的默认勾选 feature ID 列表 */
export function getDefaultFeatures(type: ItemType): Feature[] {
  return FEATURES_BY_TYPE[type]
    .filter((f) => f.defaultChecked)
    .map((f) => f.id)
}

/** 返回某类型所有可用的 feature ID 列表 */
export function getAllFeatures(type: ItemType): Feature[] {
  return FEATURES_BY_TYPE[type].map((f) => f.id)
}

/** 分析范围 → 允许的 feature 子集 */
export const FEATURES_BY_SCOPE: Record<AnalysisScope, Feature[]> = {
  audio_only: ['transcribe_summary', 'speaker_diarize', 'subtitle_export', 'music_analysis'],
  visual_only: ['visual_prompt', 'video_summary'],
}

/** R17 新表：scope → 主 chip 列表（仅 video 输入时按 scope 渲染） */
export const FEATURES_BY_SCOPE_V2: Record<AnalysisScope, FeatureDef[]> = {
  visual_only: [
    { id: 'visual_analysis', label: '画面分析', defaultChecked: true,
      hint: '逐帧 / AI 镜头分析画面，输出场景描述 + 提示词' },
  ],
  audio_only: [
    { id: 'transcribe_summary', label: '人声转写+总结', defaultChecked: true,
      hint: 'Whisper 转写 + LLM 总结，细调里选模板、音色、字幕' },
    { id: 'music_analysis',     label: '音乐分析',       defaultChecked: false,
      hint: 'BPM / 调性 / 乐器 / 风格 + 可选 Suno 提示词' },
  ],
}

/** R17: 新 id → 老 id 展开（submit 时兼容后端） */
export function expandFeatureIds(ids: string[]): string[] {
  const out = new Set<string>()
  for (const id of ids) {
    if (id === 'visual_analysis') {
      out.add('visual_prompt')
      out.add('video_summary')
    } else {
      out.add(id)
    }
  }
  return [...out]
}
