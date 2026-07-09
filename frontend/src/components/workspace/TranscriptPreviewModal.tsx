import { useEffect, useState } from 'react'
import { X, Subtitles, Loader2 } from 'lucide-react'

import { http } from '@/services/client'

interface TranscriptPreviewModalProps {
  open: boolean
  sourceUrl: string
  onClose: () => void
}

interface TranscriptResult {
  source: string
  text: string
  meta: Record<string, unknown>
  elapsed_ms: number
}

/**
 * 轻量字幕预览 Modal — 不入库，关闭即丢。
 * 直接调 POST /transcript/extract，不走 task 系统。
 */
export function TranscriptPreviewModal({ open, sourceUrl, onClose }: TranscriptPreviewModalProps) {
  const [result, setResult] = useState<TranscriptResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true) // eslint-disable-line react-hooks/set-state-in-effect
    setError(null)
    setResult(null)

    http
      .post<TranscriptResult>('/transcript/extract', { url: sourceUrl })
      .then((res) => {
        if (!cancelled) setResult(res.data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '抽取失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, sourceUrl])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '90vw',
          maxWidth: 600,
          maxHeight: '80vh',
          background: 'var(--bg)',
          borderRadius: 'var(--radius-lg, 16px)',
          border: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Subtitles size={16} style={{ color: 'var(--accent-3)' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>快速字幕预览</span>
          </div>
          <button
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 8,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--ink-3)',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
          {loading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: 40,
                color: 'var(--ink-3)',
              }}
            >
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              正在抽取字幕…
            </div>
          )}

          {error && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--accent-pink)', fontSize: 13 }}>
              {error}
            </div>
          )}

          {result && (
            <>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--ink-4)',
                  fontFamily: 'var(--mono)',
                  marginBottom: 12,
                }}
              >
                来源: {result.source} · 耗时 {result.elapsed_ms}ms
              </div>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.8,
                  color: 'var(--ink-2)',
                  whiteSpace: 'pre-wrap',
                  maxHeight: 500,
                  overflow: 'auto',
                }}
              >
                {result.text}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '12px 18px',
            borderTop: '1px solid var(--line)',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--line)',
              background: 'var(--bg)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
