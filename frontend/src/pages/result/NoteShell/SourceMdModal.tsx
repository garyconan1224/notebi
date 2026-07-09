import { X, FileCode } from 'lucide-react'
import { toast } from 'sonner'

interface SourceMdModalProps {
  open: boolean
  sourceMd: string
  onClose: () => void
  onDownload?: () => void
  downloading?: boolean
}

/**
 * 原始素材 Markdown 悬浮框 — 仿 TranscriptPreviewModal 结构。
 * position:fixed 遮罩 + 居中卡片 + 可滚动源码。
 */
export function SourceMdModal({ open, sourceMd, onClose, onDownload, downloading = false }: SourceMdModalProps) {
  if (!open) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(sourceMd)
      toast.success('已复制原始素材 Markdown')
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  return (
    <div
      className="nibi-source-md-modal"
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
          maxWidth: 640,
          maxHeight: '80vh',
          background: 'var(--bg)',
          borderRadius: 'var(--radius-lg, 16px)',
          border: '1px solid var(--bdr)',
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
            borderBottom: '1px solid var(--bdr)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileCode size={16} style={{ color: 'var(--acc)' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>原始素材 Markdown</span>
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
              color: 'var(--mut)',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="source-md-body"
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '14px 18px',
            fontSize: 12,
            lineHeight: 1.65,
            color: 'var(--fg2)',
          }}
        >
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--fm, monospace)' }}>
            {sourceMd}
          </pre>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            padding: '12px 18px',
            borderTop: '1px solid var(--bdr)',
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleCopy}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: '1px solid var(--bdr)',
                background: 'var(--bg)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              复制
            </button>
            {onDownload && (
              <button
                onClick={onDownload}
                disabled={downloading}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--bdr)',
                  background: 'var(--bg)',
                  cursor: downloading ? 'wait' : 'pointer',
                  fontSize: 13,
                  opacity: downloading ? 0.7 : 1,
                }}
              >
                {downloading ? '下载中…' : '下载原始素材 .md'}
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid var(--bdr)',
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
