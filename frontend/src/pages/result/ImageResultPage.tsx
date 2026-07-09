import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, BarChart2, Check, Copy, Download, FileText, Settings2, Star } from 'lucide-react'

import {
  type ImageCompareResult,
  type ImageResult,
  type PromptVersion,
  addPromptVersion,
  // downloadExport, -- N11: 导出功能 UI 隐藏
  getImageCompare,
  getImageResult,
  listPromptVersions,
} from '@/services/workspaces'
import { PromptVersionStack } from '@/components/result/PromptVersionStack'
import {
  type PromptFormat,
  type PromptFormatsConfig,
  getPromptFormatsConfig,
  imageToFrameAdapter,
  isJsonFormat,
  renderJsonForImage,
  renderTemplate,
  savePromptFormatsConfig,
} from '@/services/promptFormats'
import { ASSOCIATION_DIRECTION_LABELS, type AssociationDirection } from '@/lib/preflightTasks'
import { SummariesTab } from '@/components/SummariesTab'

import './tokens.css'
import './image-result.css'
import { ItemTagsPanel } from '@/components/workspace/ItemTagsPanel'

const ACTIVE_LIMIT = 3

interface TabDescriptor {
  key: string
  label: string
  format: PromptFormat
}

export default function ImageResultPage() {
  const { workspaceId = '', itemId = '' } = useParams<{ workspaceId: string; itemId: string }>()
  const navigate = useNavigate()

  type FetchState =
    | { kind: 'loading' }
    | { kind: 'ready'; data: ImageResult }
    | { kind: 'error'; message: string }
  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'loading' })

  const [promptStyle, setPromptStyle] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [favored, setFavored] = useState(false)
  const [formatsCfg, setFormatsCfg] = useState<PromptFormatsConfig | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSelection, setPickerSelection] = useState<string[]>([])
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([])
  const [contentTab, setContentTab] = useState<'content' | 'summary'>('content')

  // N9: 多图对比
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareData, setCompareData] = useState<ImageCompareResult | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)

  // 拉提示词格式配置
  useEffect(() => {
    let cancelled = false
    getPromptFormatsConfig()
      .then((data) => {
        if (!cancelled) setFormatsCfg(data)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // 拉图片结果 + 提示词版本（合并为单个 effect 避免重复 cleanup）
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
    listPromptVersions(workspaceId, itemId)
      .then((data) => {
        if (!cancelled) setPromptVersions(data)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, itemId])

  const result = fetchState.kind === 'ready' ? fetchState.data : null

  // 构造 tabs：复用 VideoResultPage 的逻辑
  const tabs = useMemo<TabDescriptor[]>(() => {
    const formats = formatsCfg?.formats ?? []
    const imageFormats = formats.filter((f) => f.category === 'image')
    if (!imageFormats.length) return []
    const idMap = new Map(imageFormats.map((f) => [f.id, f]))
    const active = formatsCfg?.active_image_ids ?? []
    const picked: PromptFormat[] = []
    for (const id of active) {
      const fmt = idMap.get(id)
      if (fmt && !isJsonFormat(fmt) && !picked.find((p) => p.id === fmt.id)) {
        picked.push(fmt)
      }
    }
    if (picked.length < ACTIVE_LIMIT) {
      for (const fmt of imageFormats) {
        if (picked.length >= ACTIVE_LIMIT) break
        if (isJsonFormat(fmt)) continue
        if (!picked.find((p) => p.id === fmt.id)) picked.push(fmt)
      }
    }
    const jsonFmt = imageFormats.find((f) => isJsonFormat(f))
    const built: TabDescriptor[] = picked.slice(0, ACTIVE_LIMIT).map((f) => ({
      key: f.id,
      label: f.name,
      format: f,
    }))
    if (jsonFmt) built.push({ key: jsonFmt.id, label: jsonFmt.name, format: jsonFmt })
    return built
  }, [formatsCfg])

  const activeTab = tabs.find((t) => t.key === promptStyle) ?? tabs[0]

  const promptText = useMemo(() => {
    if (!result || !activeTab) return ''
    if (isJsonFormat(activeTab.format)) return renderJsonForImage(result)
    const frame = imageToFrameAdapter(result)
    return renderTemplate(activeTab.format.template, frame)
  }, [result, activeTab])

  const handleCopy = useCallback(() => {
    if (!promptText) return
    navigator.clipboard?.writeText(promptText).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }, [promptText])

  const handleFavorite = useCallback(() => {
    setFavored((prev) => {
      const next = !prev
      toast.success(next ? '已收藏此图' : '已取消收藏')
      return next
    })
  }, [])

  /* N11: 导出功能 UI 隐藏（代码保留，见 SPEC §8.2）
  const handleExport = useCallback(async () => {
    try {
      await downloadExport(workspaceId, itemId)
      toast.success('工作包已下载')
    } catch (err) {
      toast.error('导出失败：' + (err instanceof Error ? err.message : '未知'))
    }
  }, [workspaceId, itemId])
  */

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

  const handleAddPromptVersion = useCallback(async (content: string) => {
    const pv = await addPromptVersion(workspaceId, itemId, content)
    setPromptVersions((prev) => [...prev, pv])
    toast.success(`已保存 v${pv.version}`)
  }, [workspaceId, itemId])

  const handleDownloadImage = useCallback(() => {
    if (!result?.image.image_url) return
    const a = document.createElement('a')
    a.href = result.image.image_url
    a.download = result.image.title || 'image'
    a.click()
  }, [result?.image.image_url, result?.image.title])

  const openPicker = useCallback(() => {
    if (!formatsCfg) return
    setPickerSelection(tabs.filter((t) => !isJsonFormat(t.format)).map((t) => t.key))
    setPickerOpen(true)
  }, [formatsCfg, tabs])

  const togglePickerId = useCallback((id: string) => {
    setPickerSelection((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      if (cur.length >= ACTIVE_LIMIT) {
        toast.error(`最多选 ${ACTIVE_LIMIT} 个`)
        return cur
      }
      return [...cur, id]
    })
  }, [])

  const savePicker = useCallback(async () => {
    if (!formatsCfg) return
    if (pickerSelection.length !== ACTIVE_LIMIT) {
      toast.error(`请选满 ${ACTIVE_LIMIT} 个`)
      return
    }
    try {
      const saved = await savePromptFormatsConfig({ active_image_ids: pickerSelection })
      setFormatsCfg(saved)
      setPickerOpen(false)
      toast.success('已更新提示词格式 tabs')
    } catch (err) {
      toast.error('保存失败：' + (err instanceof Error ? err.message : '未知'))
    }
  }, [formatsCfg, pickerSelection])

  // 键盘快捷键：C 复制、F 收藏、1-9 切 tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.key === 'c' || e.key === 'C') handleCopy()
      else if (e.key === 'f' || e.key === 'F') handleFavorite()
      else if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1
        if (idx < tabs.length) setPromptStyle(tabs[idx].key)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleCopy, handleFavorite, tabs])

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
            <FileText size={12} /> 统一笔记 <span style={{ fontSize: 9, opacity: 0.6 }}>beta</span>
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
          <img src={result.image.image_url} alt={result.image.title} />
        </div>
      </div>

      {/* ════════ 右：信息面板 ════════ */}
      <div className="im-right">
        {/* 提示词 tabs 标题行 */}
        <div className="vd-tabs-bar">
          <span className="eyebrow" style={{ flex: 1 }}>提示词格式</span>
          <button className="im-settings-btn" onClick={openPicker} title="选择 3 个图片类格式作为 tabs（JSON 自动附加）">
            <Settings2 size={11} /> 选择
          </button>
        </div>

        {/* tabs 按钮行 */}
        <div className="vd-tabs-row">
          {tabs.map((t) => (
            <button key={t.key} className="vd-tab-btn" data-active={contentTab === 'content' && promptStyle === t.key} onClick={() => { setContentTab('content'); setPromptStyle(t.key) }}>
              {t.label}
            </button>
          ))}
          <button className="vd-tab-btn" data-active={contentTab === 'summary'} onClick={() => setContentTab('summary')}>
            总结
          </button>
          {!tabs.length && contentTab !== 'summary' && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--mut)' }}>（提示词格式未加载）</span>
          )}
        </div>

        {/* 可滚动内容区 */}
        <div className="im-content-scroll">
          {contentTab === 'summary' ? (
            <div style={{ flex: 1, overflow: 'hidden', height: '100%' }}>
              <SummariesTab workspaceId={workspaceId} itemId={itemId} />
            </div>
          ) : (
          <>
          {/* 提示词文本 */}
          <div className="im-prompt-text">
            {promptText}
          </div>

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

          {/* 提示词版本栈 */}
          <div style={{ marginTop: 14 }}>
            <PromptVersionStack
              versions={promptVersions}
              onAddVersion={handleAddPromptVersion}
            />
          </div>
          </>
          )}
        </div>

        {/* 底部操作按钮 */}
        <div className="im-actions">
          <button className="im-btn-main" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? '已复制！' : '一键复制提示词'}
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
            快捷键：C 复制 · F 收藏 · 1/2/3 切格式
          </span>
        </div>
      </div>

      {/* FormatPicker 弹窗 */}
      {pickerOpen && formatsCfg && (
        <FormatPicker
          allFormats={formatsCfg.formats.filter((f) => f.category === 'image' && !isJsonFormat(f))}
          selection={pickerSelection}
          onToggle={togglePickerId}
          onCancel={() => setPickerOpen(false)}
          onSave={savePicker}
        />
      )}

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

// ── FormatPicker 弹窗（复用 VideoResultPage 的实现） ───────

interface FormatPickerProps {
  allFormats: PromptFormat[]
  selection: string[]
  onToggle: (id: string) => void
  onCancel: () => void
  onSave: () => void
}

function FormatPicker({ allFormats, selection, onToggle, onCancel, onSave }: FormatPickerProps) {
  return (
    <div className="vm-image-scope im-picker-overlay" onClick={onCancel}>
      <div className="im-picker-panel" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="im-picker-title">选择 3 个图片类格式</div>
          <div className="im-picker-hint">
            选中的格式将作为提示词 tabs 显示，JSON 格式始终附加在末尾。
          </div>
        </div>
        <div className="im-picker-list">
          {allFormats.map((fmt) => {
            const selected = selection.includes(fmt.id)
            return (
              <button
                key={fmt.id}
                className="im-picker-item"
                data-selected={selected}
                onClick={() => onToggle(fmt.id)}
              >
                <div className="im-picker-check">
                  {selected && <Check size={12} color="#fff" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="im-picker-fmt-name">{fmt.name}</div>
                  {fmt.description && (
                    <div className="im-picker-fmt-desc">{fmt.description}</div>
                  )}
                </div>
              </button>
            )
          })}
          {!allFormats.length && (
            <div className="im-compare-empty">
              暂无可用的图片类格式
            </div>
          )}
        </div>
        <div className="im-picker-actions">
          <button className="im-picker-cancel" onClick={onCancel}>
            取消
          </button>
          <button className="im-picker-confirm" onClick={onSave}>
            确认（{selection.length}/{ACTIVE_LIMIT}）
          </button>
        </div>
      </div>
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
