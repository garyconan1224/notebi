/** Provider 列表 API（用于总结弹窗选模型）。 */

import http from './client'

export interface ProviderInfo {
  id: string
  name: string
  kind: string
  enabled: boolean
  capabilities: string[]
  base_url: string
  has_api_key: boolean
}

/** GET /providers — 获取所有已启用的 provider。 */
export async function listProviders(): Promise<ProviderInfo[]> {
  // 后端从裸数组改为 { data: [...], default_provider_for_* }，两种结构都兼容
  const res = await http.get<ProviderInfo[] | { data: ProviderInfo[] }>('/providers')
  const list: ProviderInfo[] = Array.isArray(res.data) ? res.data : (res.data?.data ?? [])
  return list.filter((p) => p.enabled && p.capabilities.includes('chat'))
}
