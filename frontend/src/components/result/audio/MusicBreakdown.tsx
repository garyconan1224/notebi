/**
 * MusicBreakdown — sub-tab 3：教学拆解
 *
 * 每段 1 张教学卡片，时间轴纵向排列
 * 点段卡片 → 跳转音频对应位置
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { MusicSegmentData } from '@/services/workspaces'

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function estimateStyle(bpm: number, key: string): string {
  const bpmDesc = bpm < 80 ? '缓慢' : bpm < 120 ? '中等' : '快速'
  const isMinor = key?.toLowerCase().includes('minor')
  const moodDesc = isMinor ? '忧郁/深沉' : '明亮/积极'
  return `${moodDesc}风格，${bpmDesc}节奏`
}

const CACHE_PREFIX = 'music-teaching-'

function getCacheKey(workspaceId: string, itemId: string, segIdx: number): string {
  return `${CACHE_PREFIX}${workspaceId}-${itemId}-${segIdx}`
}

function getCachedExplanation(workspaceId: string, itemId: string, segIdx: number): string | null {
  try {
    return localStorage.getItem(getCacheKey(workspaceId, itemId, segIdx))
  } catch {
    return null
  }
}

function setCachedExplanation(workspaceId: string, itemId: string, segIdx: number, explanation: string): void {
  try {
    localStorage.setItem(getCacheKey(workspaceId, itemId, segIdx), explanation)
  } catch { /* ignore */ }
}

interface MusicBreakdownProps {
  segments: MusicSegmentData[]
  onSeek: (sec: number) => void
  workspaceId: string
  itemId: string
}

export function MusicBreakdown({ segments, onSeek, workspaceId, itemId }: MusicBreakdownProps) {
  const [explanations, setExplanations] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState<Record<number, boolean>>({})

  // 初始化：从缓存加载已有解释
  useEffect(() => {
    const initial: Record<number, string> = {}
    segments.forEach((_, i) => {
      const cached = getCachedExplanation(workspaceId, itemId, i)
      if (cached) initial[i] = cached
    })
    setExplanations(initial)
  }, [segments, workspaceId, itemId])

  const fetchExplanation = useCallback(async (segIdx: number) => {
    if (loading[segIdx] || explanations[segIdx]) return

    setLoading(prev => ({ ...prev, [segIdx]: true }))
    try {
      const seg = segments[segIdx]
      const res = await fetch(
        `/api/workspaces/${workspaceId}/items/${itemId}/music-teaching/${segIdx}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bpm: seg.bpm,
            key: seg.key,
            music_prompt: seg.music_prompt,
          }),
        }
      )
      if (!res.ok) throw new Error('请求失败')
      const data = await res.json()
      const explanation = data.explanation || '暂无分析'
      setExplanations(prev => ({ ...prev, [segIdx]: explanation }))
      setCachedExplanation(workspaceId, itemId, segIdx, explanation)
    } catch (err) {
      toast.error('获取教学分析失败')
      console.error(err)
    } finally {
      setLoading(prev => ({ ...prev, [segIdx]: false }))
    }
  }, [segments, workspaceId, itemId, loading, explanations])

  if (!segments || segments.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
        暂无音乐段数据
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {segments.map((seg, i) => {
        const startSec = seg.start ?? 0
        const endSec = seg.end ?? 0
        const bpm = seg.bpm || 0
        const key = seg.key || '未知'
        const style = estimateStyle(bpm, key)
        const explanation = explanations[i]
        const isLoading = loading[i]
        const scenarios = seg.scenarios || []
        const references = seg.similar_references || []

        return (
          <div
            key={i}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 10,
              padding: 16,
              background: 'var(--bg-elev)',
              cursor: 'pointer',
            }}
            onClick={() => onSeek(startSec)}
          >
            {/* 头部：时刻 + 基本信息 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-pink)' }}>
                {formatSec(startSec)} – {formatSec(endSec)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                片段 {i + 1}
              </span>
              <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                {bpm} BPM · {key}
              </span>
            </div>

            {/* 风格判断 */}
            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 8 }}>
              <strong>风格：</strong>{style}
            </div>

            {/* 为什么动人（LLM 生成） */}
            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 8 }}>
              <strong>为什么动人：</strong>
              {explanation ? (
                <span>{explanation}</span>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    fetchExplanation(i)
                  }}
                  disabled={isLoading}
                  style={{
                    padding: '2px 8px',
                    fontSize: 11,
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    cursor: isLoading ? 'wait' : 'pointer',
                    color: 'var(--accent-pink)',
                  }}
                >
                  {isLoading ? '分析中…' : '点击生成'}
                </button>
              )}
            </div>

            {/* 使用场景 */}
            {scenarios.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 6 }}>
                <strong>使用场景：</strong>{scenarios.join('、')}
              </div>
            )}

            {/* 类似作品 */}
            {references.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                <strong>类似作品：</strong>{references.join('、')}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
