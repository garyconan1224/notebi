import { http } from './client'

export interface CpuStats {
  percent: number
  count_logical: number
  count_physical: number
}

export interface MemoryStats {
  total: number
  available: number
  used: number
  percent: number
}

export interface DiskStats {
  total: number
  used: number
  free: number
  percent: number
}

export interface SystemStats {
  cpu: CpuStats
  memory: MemoryStats
  disk: DiskStats
  timestamp: number
}

/** GET /admin/system/stats — CPU / 内存 / 磁盘实时指标 */
export async function getSystemStats(): Promise<SystemStats> {
  const res = await http.get<SystemStats>('/admin/system/stats')
  return res.data
}
