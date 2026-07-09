/**
 * 视频截图和抽帧配置 API 服务
 */

import { http } from './client'
import type { ScreenshotConfig } from '@/store/configStore'

export interface ScreenshotConfigResponse {
  default_interval: number
  grid_size: [number, number]
  jpeg_quality: number
  embed_in_note: boolean
}

/**
 * 获取截图配置（从后端）
 */
export async function fetchScreenshotConfig(): Promise<ScreenshotConfigResponse> {
  try {
    const res = await http.get<ScreenshotConfigResponse>('/screenshot_config')
    return res.data
  } catch {
    // 如果端点不存在，返回默认值
    return {
      default_interval: 6,
      grid_size: [3, 3],
      jpeg_quality: 85,
      embed_in_note: true,
    }
  }
}

/**
 * 更新截图配置
 */
export async function updateScreenshotConfig(
  config: ScreenshotConfig,
): Promise<ScreenshotConfigResponse> {
  const res = await http.post<ScreenshotConfigResponse>('/screenshot_config', {
    default_interval: config.defaultInterval,
    grid_size: config.gridSize,
    jpeg_quality: config.jpegQuality,
    embed_in_note: config.embedInNote,
  })
  return res.data
}

/**
 * 获取 JPEG 质量级别说明
 */
export function getQualityLevels() {
  return [
    { value: 50, label: '低（50%）- 较小文件' },
    { value: 70, label: '中（70%）- 推荐' },
    { value: 85, label: '高（85%）- 默认' },
    { value: 95, label: '极高（95%）- 最佳质量' },
  ]
}

/**
 * 获取网格大小预设
 */
export function getGridPresets() {
  return [
    { label: '2x2 (4 帧)', value: [2, 2] as [number, number] },
    { label: '2x3 (6 帧)', value: [2, 3] as [number, number] },
    { label: '3x3 (9 帧)', value: [3, 3] as [number, number] },
    { label: '3x4 (12 帧)', value: [3, 4] as [number, number] },
    { label: '4x4 (16 帧)', value: [4, 4] as [number, number] },
  ]
}

