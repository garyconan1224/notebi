/**
 * MusicTab — 音频结果页「音乐分析」标签页容器。
 *
 * 三 sub-tab：素材库 / 报告 / 拆解
 */

import { useCallback, useState } from 'react'
import type { MusicSegmentData } from '@/services/workspaces'
import { MusicMaterialLibrary } from './MusicMaterialLibrary'
import { MusicReport } from './MusicReport'
import { MusicBreakdown } from './MusicBreakdown'

type SubTab = 'material' | 'report' | 'breakdown'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'material', label: '素材库' },
  { id: 'report', label: '报告' },
  { id: 'breakdown', label: '拆解' },
]

interface MusicTabProps {
  segments: MusicSegmentData[]
  onSeek: (sec: number) => void
  workspaceId: string
  itemId: string
}

export function MusicTab({ segments, onSeek, workspaceId, itemId }: MusicTabProps) {
  // 从 localStorage 恢复上次选中的 sub-tab
  const storageKey = `audio-music-subtab-${workspaceId}-${itemId}`
  const [sub, setSub] = useState<SubTab>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved === 'material' || saved === 'report' || saved === 'breakdown') return saved
    } catch { /* ignore */ }
    return 'material'
  })

  const handleSubChange = useCallback((newSub: SubTab) => {
    setSub(newSub)
    try {
      localStorage.setItem(storageKey, newSub)
    } catch { /* ignore */ }
  }, [storageKey])

  if (!segments || segments.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
        未勾选「音乐分析」或暂无数据
      </div>
    )
  }

  return (
    <div>
      {/* Sub-tab 切换 */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--line)',
        marginBottom: 16,
      }}>
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleSubChange(tab.id)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: sub === tab.id ? 600 : 400,
              color: sub === tab.id ? 'var(--accent-pink)' : 'var(--ink-3)',
              background: 'transparent',
              border: 'none',
              borderBottom: sub === tab.id ? '2px solid var(--accent-pink)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-tab 内容 */}
      <div>
        {sub === 'material' && <MusicMaterialLibrary segments={segments} />}
        {sub === 'report' && <MusicReport segments={segments} />}
        {sub === 'breakdown' && (
          <MusicBreakdown
            segments={segments}
            onSeek={onSeek}
            workspaceId={workspaceId}
            itemId={itemId}
          />
        )}
      </div>
    </div>
  )
}
