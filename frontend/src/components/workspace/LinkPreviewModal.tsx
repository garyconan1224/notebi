/** URL 预览确认模态 — 显示抓取结果，用户确认后再入库 */

import { useState, useEffect } from 'react'
import { X, ExternalLink, FileText, AlertTriangle } from 'lucide-react'
import { fetchLinkPreviewWithContent, type LinkPreviewWithContent } from '@/services/linkPreview'

interface LinkPreviewModalProps {
  open: boolean
  url: string
  onConfirm: (preview: LinkPreviewWithContent) => void
  onFallback: () => void
  onCancel: () => void
}

export function LinkPreviewModal({ open, url, onConfirm, onFallback, onCancel }: LinkPreviewModalProps) {
  const [result, setResult] = useState<{
    url: string
    preview: LinkPreviewWithContent | null
    error: string | null
  }>({ url: '', preview: null, error: null })

  useEffect(() => {
    if (!open || !url) return
    let cancelled = false
    fetchLinkPreviewWithContent(url)
      .then((data) => {
        if (cancelled) return
        setResult({ url, preview: data, error: data.warning ?? null })
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ url, preview: null, error: '抓取失败，请检查链接是否有效' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, url])

  if (!open) return null

  const current = result.url === url ? result : { url, preview: null, error: null }
  const loading = Boolean(url) && result.url !== url
  const preview = current.preview
  const error = current.error
  const contentPreview = preview?.content?.slice(0, 500) || ''
  const hasContent = contentPreview.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-medium text-gray-900">网页预览</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-500 text-sm">
              正在抓取网页内容…
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm">
              <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
              <span className="text-amber-700">{error}</span>
            </div>
          )}

          {preview && !loading && (
            <>
              {/* 标题 + 链接 */}
              <div className="space-y-1">
                <h4 className="text-sm font-medium text-gray-900">
                  {preview.title || '无标题'}
                </h4>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <ExternalLink size={12} />
                  <span className="truncate">{url}</span>
                </a>
              </div>

              {/* 字数统计 */}
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <FileText size={12} />
                <span>{preview.word_count.toLocaleString()} 字</span>
                {preview.parser && (
                  <span className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded text-gray-400">
                    {preview.parser}
                  </span>
                )}
              </div>

              {/* 正文预览 */}
              {hasContent && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">正文预览：</p>
                  <div className="p-3 bg-gray-50 rounded-md text-xs text-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {contentPreview}
                    {preview.content.length > 500 && '…'}
                  </div>
                </div>
              )}

              {/* 描述 */}
              {preview.description && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">描述：</p>
                  <p className="text-xs text-gray-600">{preview.description}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900"
          >
            取消
          </button>
          <div className="flex items-center gap-2">
            {/* 降级：正文为空或抓取失败时仍可链接入库 */}
            <button
              onClick={onFallback}
              disabled={loading}
              className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              链接直接入库
            </button>
            <button
              onClick={() => preview && onConfirm(preview)}
              disabled={loading || !preview || !hasContent}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              确认入库
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
