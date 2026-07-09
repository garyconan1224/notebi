import type { Quality, NoteFormat, NoteStyle, DownloadMode } from '@/store/configStore'

/** 质量选项 */
export const QUALITY_OPTIONS: { value: Quality; label: string; description: string }[] = [
  { value: 'fast',   label: '快速',  description: '速度优先，适合长视频预览' },
  { value: 'medium', label: '平衡',  description: '质量与速度均衡（推荐）' },
  { value: 'slow',   label: '精细',  description: '精细分析，适合重要内容' },
]

/** 格式选项（多选） */
export const FORMAT_OPTIONS: { value: NoteFormat; label: string }[] = [
  { value: 'bulleted',   label: '要点列表' },
  { value: 'mindmap',    label: '思维导图' },
  { value: 'quiz',       label: '问答题' },
  { value: 'summary',    label: '摘要总结' },
  { value: 'key_points', label: '关键词' },
]

/** 风格选项 */
export const STYLE_OPTIONS: { value: NoteStyle; label: string; description: string }[] = [
  { value: 'academic',   label: '学术',  description: '结构严谨、术语准确' },
  { value: 'minimalist', label: '极简',  description: '简洁扼要、无冗余' },
  { value: 'creative',   label: '创意',  description: '生动有趣、易于记忆' },
]

/** Pipeline 可选步骤 */
export type PipelineStep = 'download' | 'transcribe' | 'analyze' | 'note'

export const PIPELINE_STEPS: { value: PipelineStep; label: string }[] = [
  { value: 'download',   label: '下载视频' },
  { value: 'transcribe', label: '转录音频' },
  { value: 'analyze',    label: '视觉分析' },
  { value: 'note',       label: '生成笔记' },
]

export const DEFAULT_STEPS: PipelineStep[] = ['download', 'transcribe', 'analyze', 'note']

/** 下载模式预设（映射到视频下载引擎的 format selector） */
export const DOWNLOAD_MODE_OPTIONS: {
  value: DownloadMode
  label: string
  description: string
  selector: string
}[] = [
  {
    value: 'balanced',
    label: '均衡',
    description: '兼顾画质与速度（推荐）',
    selector: 'best',
  },
  {
    value: 'speed',
    label: '优先速度',
    description: '选择较低码率以加快下载',
    selector: 'worst[ext=mp4]/worst',
  },
  {
    value: 'quality',
    label: '优先画质',
    description: '分轨下载最高画质并合成',
    selector: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
  },
  {
    value: 'audio',
    label: '仅提取音频',
    description: '不下载视频流，体积最小',
    selector: 'bestaudio[ext=m4a]/bestaudio',
  },
]

/** 将下载模式枚举映射为 format selector 字符串（未命中时回退 best） */
export function resolveFormatSelector(mode: DownloadMode): string {
  return DOWNLOAD_MODE_OPTIONS.find(o => o.value === mode)?.selector ?? 'best'
}

