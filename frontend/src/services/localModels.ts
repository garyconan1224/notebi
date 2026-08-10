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
  status: 'ready' | 'not_downloaded' | 'downloading' | 'failed' | 'not_verified' | 'needs_token'
  progress: number
  message: string
  error: string
  requires_token?: boolean
  active?: boolean
}

export async function listLocalModels(): Promise<LocalModelStatus[]> {
  const response = await http.get<{ models: LocalModelStatus[] }>('/local_models')
  return response.data.models
}

export async function downloadLocalModel(modelId: string): Promise<void> {
  await http.post(`/local_models/${encodeURIComponent(modelId)}/download`)
}

export async function activateLocalModel(modelId: string): Promise<void> {
  await http.post(`/local_models/${encodeURIComponent(modelId)}/activate`)
}

export interface LocalModelStorage {
  directory: string
  effective_cache_dir: string
}

export async function getLocalModelStorage(): Promise<LocalModelStorage> {
  const response = await http.get<LocalModelStorage>('/local_models/storage')
  return response.data
}

export async function updateLocalModelStorage(directory: string): Promise<LocalModelStorage> {
  const response = await http.put<LocalModelStorage>('/local_models/storage', { directory })
  return response.data
}
