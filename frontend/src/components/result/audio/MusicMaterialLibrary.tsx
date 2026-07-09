/**
 * MusicMaterialLibrary — sub-tab 1：派生二创素材库
 *
 * 每段 1 张卡片，含 Suno/Udio/即梦 三平台提示词 + 画面建议
 */

import { useCallback } from 'react'
import { toast } from 'sonner'
import type { MusicSegmentData } from '@/services/workspaces'

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function buildUdioPrompt(seg: MusicSegmentData): string {
  return `${seg.music_prompt || '未知风格'}, ${seg.bpm || 0} BPM, key of ${seg.key || '未知'}, high quality production`
}

function buildJimengPrompt(seg: MusicSegmentData): string {
  const dur = Math.round((seg.end ?? 0) - (seg.start ?? 0))
  return `${seg.music_prompt || '未知风格'}\n节奏：${seg.bpm || 0} BPM\n调性：${seg.key || '未知'}\n时长：${dur}秒`
}

function suggestVisual(bpm: number): string {
  if (bpm < 80) return '建议：慢镜头 / 长镜头 / 大景深'
  if (bpm < 120) return '建议：标准节奏 / 中景切换'
  return '建议：快剪 / 卡点 / 短镜头堆叠'
}

function CopyButton({ text }: { text: string }) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    toast.success('已复制到剪贴板')
  }, [text])

  return (
    <button
      onClick={handleCopy}
      style={{
        padding: '4px 8px',
        fontSize: 11,
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 4,
        cursor: 'pointer',
        color: 'var(--ink-2)',
      }}
      title="复制"
    >
      📋 复制
    </button>
  )
}

interface MusicMaterialLibraryProps {
  segments: MusicSegmentData[]
}

export function MusicMaterialLibrary({ segments }: MusicMaterialLibraryProps) {
  if (!segments || segments.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
        暂无音乐段数据
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {segments.map((seg, i) => {
        const sunoPrompt = seg.music_prompt || '暂无提示词'
        const udioPrompt = buildUdioPrompt(seg)
        const jimengPrompt = buildJimengPrompt(seg)
        const visual = suggestVisual(seg.bpm || 0)

        return (
          <div
            key={i}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 10,
              padding: 16,
              background: 'var(--bg-elev)',
            }}
          >
            {/* 头部：段时刻 + BPM + key */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                片段 {i + 1}
              </span>
              <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                {formatSec(seg.start ?? 0)} – {formatSec(seg.end ?? 0)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--accent-pink)', fontWeight: 500 }}>
                {seg.bpm || 0} BPM
              </span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {seg.key || '未知调性'}
              </span>
            </div>

            {/* 三平台提示词卡片 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {/* Suno */}
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 6 }}>Suno</div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2)', marginBottom: 8, minHeight: 40 }}>
                  {sunoPrompt}
                </div>
                <CopyButton text={sunoPrompt} />
              </div>

              {/* Udio */}
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 6 }}>Udio</div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2)', marginBottom: 8, minHeight: 40 }}>
                  {udioPrompt}
                </div>
                <CopyButton text={udioPrompt} />
              </div>

              {/* 即梦 */}
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 6 }}>即梦</div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-2)', marginBottom: 8, minHeight: 40 }}>
                  {jimengPrompt}
                </div>
                <CopyButton text={jimengPrompt} />
              </div>
            </div>

            {/* 底部：画面建议 + 外链 */}
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{visual}</span>
              <a
                href="https://suno.com/create"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, color: 'var(--accent-pink)', textDecoration: 'none' }}
              >
                复制 → 去 Suno 生成同风格音乐 ↗
              </a>
            </div>
          </div>
        )
      })}
    </div>
  )
}
