import type { PlatformInfo } from './types'

export const PLATFORMS: Record<string, PlatformInfo> = {
  'bilibili.com':    { name: 'Bilibili', color: '#00A1D6', types: ['video'] },
  'youtube.com':     { name: 'YouTube',  color: '#FF0000', types: ['video'] },
  'youtu.be':        { name: 'YouTube',  color: '#FF0000', types: ['video'] },
  'douyin.com':      { name: '抖音',      color: '#010101', types: ['video'] },
  'xiaohongshu.com': { name: '小红书',    color: '#FF2442', types: ['video', 'image', 'article'] },
  'kuaishou.com':    { name: '快手',      color: '#FF6600', types: ['video'] },
  'weixin.qq.com':   { name: '微信公众号', color: '#07C160', types: ['article'] },
}

export function detectPlatform(url: string): PlatformInfo | null {
  let s = (url || "").trim();
  if (!s) return null;
  // 缺 scheme 时 new URL() 会抛异常，先补齐
  if (!s.includes('://')) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.replace('www.', '')
    const entry = Object.entries(PLATFORMS).find(([k]) => host.includes(k))
    return entry ? entry[1] : null
  } catch {
    return null
  }
}
