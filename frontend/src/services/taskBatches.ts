import { http } from './client'
import type { BatchPreviewItem, TaskBatch } from '@/types/taskBatch'

export async function listTaskBatches(params: Record<string, string | number> = {}) {
  const response = await http.get<{ batches: TaskBatch[]; total: number }>(
    '/pipeline/batches',
    { params },
  )
  return response.data
}

export async function getTaskBatch(batchId: string) {
  const response = await http.get<TaskBatch>(`/pipeline/batches/${batchId}`)
  return response.data
}

export async function previewTaskBatch(payload: {
  source_type: string
  urls: string[]
  local_files?: string[]
  workspace_id?: string
}) {
  const response = await http.post<{ items: BatchPreviewItem[]; total: number }>(
    '/pipeline/batches/preview',
    payload,
  )
  return response.data
}

export async function createTaskBatch(payload: Record<string, unknown>) {
  const response = await http.post<TaskBatch>('/pipeline/batches', payload)
  return response.data
}

export async function pauseTaskBatch(batchId: string) {
  const response = await http.post<TaskBatch>(`/pipeline/batches/${batchId}/pause`)
  return response.data
}

export async function resumeTaskBatch(batchId: string) {
  const response = await http.post<TaskBatch>(`/pipeline/batches/${batchId}/resume`)
  return response.data
}

export async function cancelTaskBatch(batchId: string) {
  const response = await http.post<TaskBatch>(`/pipeline/batches/${batchId}/cancel`)
  return response.data
}

export async function retryFailedTaskBatch(batchId: string) {
  const response = await http.post<TaskBatch>(`/pipeline/batches/${batchId}/retry-failed`)
  return response.data
}

export async function deleteTaskBatch(batchId: string) {
  const response = await http.delete<{ deleted: boolean }>(
    `/pipeline/batches/${batchId}`,
  )
  return response.data
}
