import type { VideoResultFrame } from '@/services/workspaces'

/** 安全获取帧的秒数（兼容旧数据用 timestamp 而非 sec） */
export function frameSec(f: VideoResultFrame): number {
  if (f.sec != null) return f.sec
  const ts = f.ts ?? (typeof f.timestamp === 'string' ? f.timestamp : '')
  if (!ts) return 0
  const parts = ts.trim().split(':')
  try {
    if (parts.length === 1) return parseFloat(parts[0]) || 0
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1])
    if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
  } catch { /* ignore */ }
  return 0
}

export function nearestFrameIdx(frames: VideoResultFrame[], sec: number): number {
  if (!frames.length) return 0
  let bestIdx = 0
  let bestDiff = Math.abs(frameSec(frames[0]) - sec)
  for (let i = 1; i < frames.length; i++) {
    const d = Math.abs(frameSec(frames[i]) - sec)
    if (d < bestDiff) {
      bestDiff = d
      bestIdx = i
    }
  }
  return bestIdx
}
