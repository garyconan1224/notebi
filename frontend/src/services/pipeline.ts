import type { TaskCreateRequest, TaskCreateResponse, TaskRecord } from '@/types/task'
import { http } from './client'

const PIPELINE_TASKS_URL = '/pipeline/tasks'

export interface RetryTaskOptions {
  stage?: 'diarization' | 'summary'
}

export async function getPipelineTask(taskId: string): Promise<TaskRecord> {
  const response = await http.get<TaskRecord | { data: TaskRecord }>(`${PIPELINE_TASKS_URL}/${taskId}`)
  const payload = response.data
  return payload && typeof payload === 'object' && 'task_id' in payload
    ? payload as TaskRecord
    : (payload as { data: TaskRecord }).data
}

export async function cancelPipelineTask(taskId: string): Promise<void> {
  await http.post(`${PIPELINE_TASKS_URL}/${taskId}/cancel`)
}

export async function deletePipelineTask(taskId: string): Promise<void> {
  await http.delete(`${PIPELINE_TASKS_URL}/${taskId}`)
}

export async function retryPipelineTask(taskId: string, options?: RetryTaskOptions): Promise<TaskRecord> {
  const response = await http.post<TaskRecord>(`${PIPELINE_TASKS_URL}/${taskId}/retry`, options)
  return response.data
}

export async function createPipelineTask(request: TaskCreateRequest): Promise<TaskCreateResponse> {
  const response = await http.post<TaskCreateResponse>(PIPELINE_TASKS_URL, request)
  return response.data
}

export async function listPipelineTasks(
  params: Record<string, string | number | boolean> = {},
): Promise<TaskRecord[]> {
  const response = await http.get<TaskRecord[] | { data: TaskRecord[] }>(
    PIPELINE_TASKS_URL,
    { params },
  )
  return Array.isArray(response.data) ? response.data : response.data.data
}
