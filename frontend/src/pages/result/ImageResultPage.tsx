import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, BarChart2, Check, Copy, Download, FileText, Star } from 'lucide-react'

import {
  type ImageCompareResult,
  type ImageResult,
  getImageCompare,
  getImageResult,
} from '@/services/workspaces'
import { ASSOCIATION_DIRECTION_LABELS, type AssociationDirection } from '@/lib/preflightTasks'
import { SummariesTab } from '@/components/SummariesTab'

import './tokens.css'
import './image-result.css'
import { ItemTagsPanel } from '@/components/workspace/ItemTagsPanel'
import { previewSrcForProxy } from '@/components/workspace/linkCover'

export default function ImageResultPage() {
  const { workspaceId = '', itemId = '' } = useParams<{ workspaceId: string; itemId: string }>()
  const navigate = useNavigate()

  type FetchState =
    | { kind: 'loading' }
    | { kind: 'ready'; data: ImageResult }
    | { kind: 'error'; message: string }
  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'loading' })

  const [copied, setCopied] = useState(false)
  const [favored, setFavored] = useState(false)
  const [contentTab, setContentTab] = useState<'content' | 'summary'>('content')

  // N9: 多图对比
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareData, setCompareData] = useState<ImageCompareResult | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)

  // 拉图片结果
  useEffect(() => {
    let cancelled = false
    getImageResult(workspaceId, itemId)
      .then((data) => {
        if (!cancelled) setFetchState({ kind: 'ready', data })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '加载图片结果失败'
        setFetchState({ kind: 'error', message })
      })
    return () => { cancelled = true }
  }, [workspaceId, itemId])

  const result = fetchState.kind === 'ready' ? fetchState.data : null

  const handleCopyDescription = useCallback(() => {
    if (!result?.description) return
    navigator.clipboard?.writeText(result.description).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }, [result?.description])

  const handleFavorite = useCallback(() => {
    setFavored((prev) => {
      const next = !prev
      toast.success(next ? '已收藏此图' : '已取消收藏')
      return next
    })
  }, [])

  const handleCompare = useCallback(async () => {
    setCompareLoading(true)
    try {
      const data = await getImageCompare(workspaceId, itemId)
      setCompareData(data)
      setCompareOpen(true)
    } catch (err) {
      toast.error('对比失败：' + (err instanceof Error ? err.message : '未知'))
    } finally {
      setCompareLoading(false)
    }
  }, [workspaceId, itemId])

  const handleDownloadImage = useCallback(() => {
    if (!result?.image.image_url) return
    const a = document.createElement('a')
    a.href = result.image.image_url
    a.download = result.image.title || 'image'
    a.click()
  }, [result?.image.image_url, result?.image.title])

  // 键盘快捷键：C 复制描述、F 收藏
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.key === 'c' || e.key === 'C') handleCopyDescription()
      else if (e.key === 'f' || e.key === 'F') handleFavorite()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleCopyDescription, handleFavorite])

  if (fetchState.kind === 'loading') {
    return (
      <div className="vm-image-scope" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <span className="mono" style={{ color: 'var(--mut)' }}>加载图片结果…</span>
      </div>
    )
  }
  if (fetchState.kind === 'error' || !result) {
    return (
      <div
        className="vm-image-scope"
        style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}
      >
        <span style={{ color: 'var(--err)', fontWeight: 600 }}>
          {fetchState.kind === 'error' ? fetchState.message : '没有可显示的图片结果'}
        </span>
        <button className="btn-ghost" style={{ padding: '6px 12px' }} onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>
      </div>
    )
  }

  return (
    <div className="vm-image-scope im-layout">
      {/* ════════ 左：原图全尺寸 ════════ */}
      <div className="im-left">
        {/* 顶部导航 */}
        <div className="vd-nav">
          <button className="btn-ghost" onClick={() => navigate(-1)} style={{ height: 28, padding: '0 10px', fontSize: 12 }}>
            <ArrowLeft size={13} /> 任务中心
          </button>
          <span className="vd-sep" />
          <span className="vd-title">{result.image.title}</span>
          <span className="kw mono" style={{ fontSize: 10, flexShrink: 0 }}>IMAGE</span>
          <button
            className="btn-ghost"
            style={{ height: 24, padding: '0 8px', fontSize: 11, gap: 4, marginLeft: 6, borderRadius: 4, border: '1px solid var(--border)' }}
            onClick={() => navigate(`/workspaces/${workspaceId}/items/${itemId}/note`)}
            title="打开统一笔记（NoteShell）"
          >
            <FileText size={12} /> 统一笔记
          </button>
          {result.source === 'demo_fixture' && (
            <span className="mono" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'var(--wrn)', color: '#fff', fontWeight: 600 }} title="demo fixture">DEMO</span>
          )}
        </div>

        {/* 标签展示 */}
        <div style={{ padding: '10px 20px 0', flexShrink: 0 }}>
          <ItemTagsPanel workspaceId={workspaceId} itemId={itemId} />
        </div>

        {/* 原图区域 */}
        <div className="im-viewer">
          <img src={previewSrcForProxy(result.image.image_url)} alt={result.image.title} />
        </div>
      </div>

      {/* ════════ 右：信息面板 ════════ */}
      <div className="im-right">
        {/* tabs：内容 / 总结 */}
        <div className="vd-tabs-bar">
          <span className="eyebrow" style={{ flex: 1 }}>图片分析</span>
        </div>

        <div className="vd-tabs-row">
          <button className="vd-tab-btn" data-active={contentTab === 'content'} onClick={() => setContentTab('content')}>
            内容
          </button>
          <button className="vd-tab-btn" data-active={contentTab === 'summary'} onClick={() => setContentTab('summary')}>
            总结
          </button>
        </div>

        {/* 可滚动内容区 */}
        <div className="im-content-scroll">
          {contentTab === 'summary' ? (
            <div style={{ flex: 1, overflow: 'hidden', height: '100%' }}>
              <SummariesTab workspaceId={workspaceId} itemId={itemId} />
            </div>
          ) : (
          <>
          {/* 内容识别描述 */}
          <div className="im-section">
            <div className="eyebrow im-section-label">内容识别描述</div>
            <div className="im-section-body">
              {result.description}
            </div>
          </div>

          {/* OCR 提取文字（如有） */}
          {result.ocr_text && (
            <div className="im-section">
              <div className="eyebrow im-section-label">OCR 提取文字</div>
              <div className="mono im-ocr-block">
                {result.ocr_text}
              </div>
            </div>
          )}

          {/* 标签 */}
          <div className="im-section">
            <div className="eyebrow im-section-label">标签</div>
            <div className="im-tags-wrap">
              {Object.entries(result.tags).flatMap(([category, values]) =>
                values.map((v) => (
                  <span key={`${category}-${v}`} className="kw" style={{ fontSize: 10 }}>
                    {v}
                  </span>
                )),
              )}
            </div>
          </div>

          {/* N9: 联想分析（如有） */}
          {result.associations && Object.keys(result.associations).length > 0 && (
            <div className="im-section">
              <div className="eyebrow im-section-label">联想分析</div>
              <div className="im-assoc-list">
                {Object.entries(result.associations).map(([dir, text]) => (
                  <div key={dir}>
                    <div className="im-assoc-dir">
                      {ASSOCIATION_DIRECTION_LABELS[dir as AssociationDirection] ?? dir}
                    </div>
                    <div className="im-assoc-text">
                      {text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 基本信息 */}
          {result.dimensions && (
            <div className="im-section">
              <div className="eyebrow im-section-label">基本信息</div>
              <div className="im-kv">
                <span className="im-kv-label">分辨率</span>
                <span className="im-kv-value">{result.dimensions.width} × {result.dimensions.height}</span>
                <span className="im-kv-label">格式</span>
                <span className="im-kv-value">{result.dimensions.format}</span>
                <span className="im-kv-label">大小</span>
                <span className="im-kv-value">{result.dimensions.size_kb >= 1024
                  ? `${(result.dimensions.size_kb / 1024).toFixed(1)} MB`
                  : `${result.dimensions.size_kb} KB`}</span>
              </div>
            </div>
          )}

          {/* EXIF 拍摄信息 */}
          {result.exif && Object.keys(result.exif).length > 0 && (
            <div className="im-section">
              <div className="eyebrow im-section-label">EXIF 拍摄信息</div>
              <div className="im-kv">
                {result.exif.device && (<><span className="im-kv-label">设备</span><span className="im-kv-value">{result.exif.device}</span></>)}
                {result.exif.lens && (<><span className="im-kv-label">镜头</span><span className="im-kv-value mono">{result.exif.lens}</span></>)}
                {result.exif.shutter && (<><span className="im-kv-label">快门</span><span className="im-kv-value mono">{result.exif.shutter}</span></>)}
                {result.exif.iso && (<><span className="im-kv-label">ISO</span><span className="im-kv-value mono">{result.exif.iso}</span></>)}
                {result.exif.aperture && (<><span className="im-kv-label">光圈</span><span className="im-kv-value mono">{result.exif.aperture}</span></>)}
                {result.exif.time && (<><span className="im-kv-label">时间</span><span className="im-kv-value mono">{result.exif.time}</span></>)}
                {result.exif.gps && (
                  <>
                    <span className="im-kv-label">地点</span>
                    <span className="im-kv-value">
                      {result.exif.gps.lat.toFixed(4)}, {result.exif.gps.lon.toFixed(4)}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
          </>
          )}
        </div>

        {/* 底部操作按钮 */}
        <div className="im-actions">
          <button className="im-btn-main" onClick={handleCopyDescription}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? '已复制！' : '复制描述'}
          </button>
          <button
            className="im-btn-sub"
            data-favored={favored}
            onClick={handleFavorite}
          >
            <Star
              size={14}
              fill={favored ? 'var(--wrn)' : 'none'}
              color={favored ? 'var(--wrn)' : 'currentColor'}
            />
            {favored ? '已收藏此图 ★' : '收藏此图'}
          </button>
          <button
            className="im-btn-sub"
            onClick={handleCompare}
            disabled={compareLoading}
            style={{ cursor: compareLoading ? 'wait' : 'pointer' }}
          >
            <BarChart2 size={14} />
            {compareLoading ? '对比分析中...' : '多图对比'}
          </button>
          <button
            className="im-btn-sub"
            onClick={handleDownloadImage}
            title="导出原图"
          >
            <Download size={14} />
            导出原图
          </button>
          <span className="im-shortcut-hint">
            快捷键：C 复制描述 · F 收藏
          </span>
        </div>
      </div>

      {/* N9: 多图对比弹窗 */}
      {compareOpen && compareData && (
        <ImageCompareDialog
          data={compareData}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  )
}

// ── N9: 多图对比弹窗 ────────────────────────────────────────

function ImageCompareDialog({ data, onClose }: { data: ImageCompareResult; onClose: () => void }) {
  const current = data.images.find((img) => img.is_current)
  const others = data.images.filter((img) => !img.is_current && img.has_result)

  return (
    <div className="vm-image-scope im-compare-overlay" onClick={onClose}>
      <div className="im-compare-panel" onClick={(e) => e.stopPropagation()}>
        <div className="im-compare-header">
          <div className="im-compare-title">多图对比</div>
          <button className="im-compare-close" onClick={onClose}>
            关闭
          </button>
        </div>

        {others.length === 0 ? (
          <div className="im-compare-empty">
            同合集内暂无其他已完成分析的图片素材，无法对比。
          </div>
        ) : (
          <>
            {/* 结构化对比表 */}
            <div style={{ overflowX: 'auto' }}>
              <table className="im-compare-table">
                <thead>
                  <tr>
                    <th>维度</th>
                    {current && (
                      <th className="col-current">
                        {current.name}（当前）
                      </th>
                    )}
                    {others.map((img) => (
                      <th key={img.item_id}>
                        {img.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <CompareRow label="描述" values={[current, ...others].map((img) => img?.description?.slice(0, 100) || '—')} />
                  <CompareRow
                    label="标签"
                    values={[current, ...others].map((img) =>
                      img?.tags ? Object.values(img.tags).flat().join('、').slice(0, 80) || '—' : '—',
                    )}
                  />
                  <CompareRow
                    label="OCR 文字"
                    values={[current, ...others].map((img) => img?.ocr_text?.slice(0, 60) || '—')}
                  />
                </tbody>
              </table>
            </div>

            {/* VLM 总结 */}
            {data.vlm_summary && (
              <div>
                <div className="eyebrow im-section-label">AI 对比总结</div>
                <div className="im-compare-summary">
                  {data.vlm_summary}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function CompareRow({ label, values }: { label: string; values: string[] }) {
  return (
    <tr>
      <td className="label-cell">{label}</td>
      {values.map((v, i) => (
        <td key={i}>{v}</td>
      ))}
    </tr>
  )
}
