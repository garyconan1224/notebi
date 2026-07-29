import { http } from './client'

export interface LocalModelStatus {
  model_id: string
  family: string
  title: string
  description: string
  estimated_size_mb: number
  done_mb: number
  pending_mb: number
  cached: boolean
  compatible: boolean
  cache_dir: string
  status: 'ready' | 'not_downloaded' | 'downloading' | 'failed' | 'not_verified'
  progress: number
  message: string
  error: string
}

export async function listLocalModels(): Promise<LocalModelStatus[]> {
  const response = await http.get<{ models: LocalModelStatus[] }>('/local_models')
  return response.data.models
}

export async function downloadLocalModel(modelId: string): Promise<void> {
  await http.post(`/local_models/${encodeURIComponent(modelId)}/download`)
}
