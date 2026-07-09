/**
 * 多平台 URL 检测与徽章渲染
 */

import type { ReactNode } from 'react'
import { Link } from 'lucide-react'

export type PlatformType = 'bilibili' | 'youtube' | 'douyin' | 'kuaishou' | 'twitter' | 'unknown'

export interface PlatformInfo {
  type: PlatformType
  label: string
  domains: string[]
  badge: (className?: string) => ReactNode
}

const PLATFORM_CONFIG: Record<PlatformType, PlatformInfo> = {
  bilibili: {
    type: 'bilibili',
    label: 'Bilibili',
    domains: ['bilibili.com', 'b23.tv'],
    badge: (className = '') => (
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded bg-red-500 text-[11px] font-bold text-white ${className}`}>
        B
      </span>
    ),
  },
  youtube: {
    type: 'youtube',
    label: 'YouTube',
    domains: ['youtube.com', 'youtu.be', 'youtube.co'],
    badge: (className = '') => (
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded bg-red-600 text-[9px] font-bold text-white ${className}`}>
        YT
      </span>
    ),
  },
  douyin: {
    type: 'douyin',
    label: 'Douyin',
    domains: ['douyin.com', 'v.douyin.com', 'dy.com'],
    badge: (className = '') => (
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded bg-black text-[9px] font-bold text-white ${className}`}>
        抖
      </span>
    ),
  },
  kuaishou: {
    type: 'kuaishou',
    label: 'Kuaishou',
    domains: ['kuaishou.com', 'v.kuaishou.com', 'ks.com'],
    badge: (className = '') => (
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded bg-orange-500 text-[9px] font-bold text-white ${className}`}>
        快
      </span>
    ),
  },
  twitter: {
    type: 'twitter',
    label: 'X (Twitter)',
    domains: ['x.com', 'twitter.com'],
    badge: (className = '') => (
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded bg-gray-900 text-[9px] font-bold text-white ${className}`}>
        𝕏
      </span>
    ),
  },
  unknown: {
    type: 'unknown',
    label: 'Unknown',
    domains: [],
    badge: (className = '') => (
      <Link className={`h-4 w-4 text-muted-foreground ${className}`} />
    ),
  },
}

/**
 * 根据 URL 检测视频平台类型
 */
export function detectPlatform(url: string): PlatformType {
  if (!url || !url.trim()) {
    return 'unknown'
  }

  const lowerUrl = url.toLowerCase().trim()

  for (const [type, config] of Object.entries(PLATFORM_CONFIG)) {
    if (type === 'unknown') continue
    for (const domain of config.domains) {
      if (lowerUrl.includes(domain)) {
        return type as PlatformType
      }
    }
  }

  return 'unknown'
}

/**
 * 根据平台类型获取配置信息
 */
export function getPlatformInfo(platformType: PlatformType): PlatformInfo {
  return PLATFORM_CONFIG[platformType]
}

/**
 * 根据 URL 直接获取徽章
 */
export function getPlatformBadge(url: string, className?: string): ReactNode {
  const platform = detectPlatform(url)
  const info = getPlatformInfo(platform)
  return info.badge(className)
}

/**
 * 获取所有平台信息（用于列表展示）
 */
export function getAllPlatforms(): Array<Omit<PlatformInfo, 'badge'> & { badgeLabel?: string }> {
  return [
    { type: 'bilibili', label: 'Bilibili', domains: PLATFORM_CONFIG.bilibili.domains },
    { type: 'youtube', label: 'YouTube', domains: PLATFORM_CONFIG.youtube.domains },
    { type: 'douyin', label: 'Douyin', domains: PLATFORM_CONFIG.douyin.domains },
    { type: 'kuaishou', label: 'Kuaishou', domains: PLATFORM_CONFIG.kuaishou.domains },
    { type: 'twitter', label: 'X (Twitter)', domains: PLATFORM_CONFIG.twitter.domains },
  ]
}

