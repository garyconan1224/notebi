import { http } from './client'

export interface TaskDefaults {
  summary_template: string
  video_frame_analysis: boolean
  frame_interval_sec: number
  diarize: boolean
  speaker_count: number | null
  /** 生成总结时默认使用的输出语言；source 表示跟随素材原文。 */
  summary_language: 'source' | 'zh-Hans' | 'zh-Hant' | 'en' | 'ja' | 'ko' | 'custom'
  /** 当 summary_language=custom 时使用的 BCP-47 语言标签。 */
  summary_language_custom: string
}

export async function getTaskDefaults(): Promise<TaskDefaults> {
  const response = await http.get<TaskDefaults>('/task_defaults')
  return response.data
}

export async function updateTaskDefaults(
  payload: TaskDefaults,
): Promise<TaskDefaults> {
  const response = await http.patch<TaskDefaults>('/task_defaults', payload)
  return response.data
}
