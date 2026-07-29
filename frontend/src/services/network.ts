/**
 * 网络配置服务：与后端 /network_config API 交互。
 *
 * S1 Task 6: 前端网络页闭环。
 */

import { http } from './client'

export interface NetworkConfig {
  routing_mode: 'smart' | 'direct' | 'proxy'
  global_proxy: string
}

export interface NetworkConfigUpdate {
  routing_mode?: 'smart' | 'direct' | 'proxy'
  global_proxy?: string
}

export interface NetworkTestResult {
  target: string
  route: string
  proxy_used: boolean
  elapsed_ms: number
  ok: boolean
  message: string
}

/**
 * 获取网络配置。
 */
export async function getNetworkConfig(): Promise<NetworkConfig> {
  const res = await http.get<NetworkConfig>('/network_config')
  return res.data
}

/**
 * 更新网络配置。
 */
export async function updateNetworkConfig(data: NetworkConfigUpdate): Promise<NetworkConfig> {
  const res = await http.patch<NetworkConfig>('/network_config', data)
  return res.data
}

export async function testNetworkTarget(target: string): Promise<NetworkTestResult> {
  const res = await http.post<NetworkTestResult>('/network_config/test', { target })
  return res.data
}

/**
 * 路由模式说明。
 */
export const ROUTING_MODE_DESCRIPTIONS: Record<string, string> = {
  smart: '智能路由：国内站点（B站、抖音、小红书）直连，海外站点（YouTube 等）走代理',
  direct: '全部直连：所有站点不使用代理',
  proxy: '全部代理：所有站点使用全局代理',
}
