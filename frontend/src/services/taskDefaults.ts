import { http } from './client'

export interface TaskDefaults {
  summary_template: string
  video_frame_analysis: boolean
  frame_interval_sec: number
  diarize: boolean
  speaker_count: number | null
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
