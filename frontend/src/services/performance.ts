/**
 * 性能档位 API 服务（R23）
 */

import { http } from './client'
import type { PerformanceTier } from '@/store/configStore'

export interface PerformanceTierResponse {
  tier: PerformanceTier
  recommended_tier: PerformanceTier
  total_ram_gb: number
  whisper_model_size: string
  interval_sec: number
  max_frames: number
}

/** 获取当前性能档位 + 内存探测推荐 */
export async function fetchPerformanceTier(): Promise<PerformanceTierResponse> {
  const res = await http.get<PerformanceTierResponse>('/performance_tier')
  return res.data
}

/** 保存性能档位（同时更新 transcriber whisper_model_size） */
export async function updatePerformanceTier(
  tier: PerformanceTier,
): Promise<PerformanceTierResponse> {
  const res = await http.post<PerformanceTierResponse>('/performance_tier', { tier })
  return res.data
}
