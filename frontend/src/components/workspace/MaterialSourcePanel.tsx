import { Check, CheckCircle2, Clock, FileAudio, FileText, Image as ImageIcon, Layers, Link2, PlayCircle, Search, Upload, Video } from 'lucide-react'
import type { BatchSourceItem, BatchSourceResolveResponse, SniffResult } from '@/services/workspaces'
import type { LibraryItem } from '@/services/library'
import { decodeProxySrc, previewSrcForProxy } from './linkCover'

/* ─── helpers (shared with modal) ─── */

export function formatDuration(sec: number): string {
  if (sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function localFileTypeLabel(type?: string): string {
  if (type === 'audio') return '音频'
  if (type === 'image') return '图片'
  if (type === 'text') return '文本'
  return '视频'
}

export function itemTypeLabel(type?: string): string {
  if (type === 'audio') return '音频'
  if (type === 'image') return '图片'
  if (type === 'text') return '文本'
  // Q5：probe 回写前的未知类型，不得默认标成视频
  if (type === 'unknown') return '待识别'
  return '视频'
}

export function normalizePreviewImageUrl(url?: string | null): string {
  const value = (url ?? '').trim()
  if (!value) return ''
  // 协议相对地址补 https
  if (value.startsWith('//')) return `https:${value}`
  // 只允许 http/https，其他协议（javascript:, data: 等）返回空
  if (!/^https?:\/\//i.test(value)) return ''
  return value
}

export function previewImageFallback(url: string): string {
  if (!url.includes('hdslb.com')) return ''
  const clean = url.replace(/@[^/?#]+(?=($|[?#]))/, '')
  return clean !== url ? clean : ''
}

export function libraryItemKey(item: LibraryItem): string {
  return `${item.workspace_id}:${item.item_id}`
}

export function batchSourceItemKey(item: BatchSourceItem, index: number): string {
  return item.external_id?.trim() || item.source_url || `batch-item-${index}`
}

export function computeAutoInterval(durationSec?: number): number {
  if (!durationSec || durationSec <= 0) return 10
  return Math.min(60, Math.max(5, Math.round(durationSec / 25)))
}

export function estimateFrames(durationSec: number, intervalSec: number): number {
  if (durationSec <= 0 || intervalSec <= 0) return 0
  return Math.max(1, Math.round(durationSec / intervalSec))
}

/* ─── props ─── */

export interface MaterialSourcePanelProps {
  isLocalFile: boolean
  localCover: string
  localFileType?: string
  localFileName?: string
  videoDuration: number
  isBatchMode: boolean
  onSwitchSourceMode: (mode: 'single' | 'batch') => void
  urlValue?: string
  internalUrl: string
  onInternalUrlChange: (value: string) => void
  onPickLocalFile?: () => void
  localUploadPending?: boolean
  showBatchSourcePanel: boolean
  canResolveBatchSource: boolean
  batchResolving: boolean
  batchImporting: boolean
  batchResult: BatchSourceResolveResponse | null
  batchSelectedKeys: Set<string>
  onBatchSelectedKeysChange: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void
  selectedBatchItemsCount: number
  onResolveBatchSource: () => void
  onImportBatchSource: () => void
  targetWorkspaceId: string
  existingPanelOpen: boolean
  onToggleExistingPanel: () => void
  existingQuery: string
  onExistingQueryChange: (value: string) => void
  existingLoading: boolean
  filteredExistingItems: LibraryItem[]
  existingSelectedIds: Set<string>
  onToggleExistingItem: (key: string) => void
  selectedExistingRefsCount: number
  existingAdding: boolean
  onAddExistingMaterials: () => void
  effectiveSniff: SniffResult | null
  sniffFailed: boolean
  effectiveUrl: string
  previewThumbUrl: string
  linkTitle: string
  linkDesc: string
  linkWarning?: string
}

export function MaterialSourcePanel({
  isLocalFile,
  localCover,
  localFileType,
  localFileName,
  videoDuration,
  isBatchMode,
  onSwitchSourceMode,
  urlValue,
  internalUrl,
  onInternalUrlChange,
  onPickLocalFile,
  localUploadPending,
  showBatchSourcePanel,
  canResolveBatchSource,
  batchResolving,
  batchImporting,
  batchResult,
  batchSelectedKeys,
  onBatchSelectedKeysChange,
  selectedBatchItemsCount,
  onResolveBatchSource,
  onImportBatchSource,
  targetWorkspaceId,
  existingPanelOpen,
  onToggleExistingPanel,
  existingQuery,
  onExistingQueryChange,
  existingLoading,
  filteredExistingItems,
  existingSelectedIds,
  onToggleExistingItem,
  selectedExistingRefsCount,
  existingAdding,
  onAddExistingMaterials,
  effectiveSniff,
  sniffFailed,
  effectiveUrl,
  previewThumbUrl,
  linkTitle,
  linkDesc,
  linkWarning,
}: MaterialSourcePanelProps) {
  return (
    <div className="m-section">
      <div className="eyebrow" style={{ marginBottom: 10 }}>① 素材源</div>
      {!isLocalFile && (
        <div className="modal-source-mode">
          <button
            type="button"
            data-active={!isBatchMode ? 'true' : undefined}
            onClick={() => onSwitchSourceMode('single')}
          >
            单条内容
          </button>
          <button
            type="button"
            data-active={isBatchMode ? 'true' : undefined}
            onClick={() => onSwitchSourceMode('batch')}
          >
            批量合集
          </button>
        </div>
      )}
      {isLocalFile ? (
        <div className="sniff-card">
          <div className="sniff-thumb">
            {localCover ? (
              <img
                src={localCover}
                alt=""
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              localFileType === 'audio' ? (
                <FileAudio size={20} style={{ color: 'var(--mut)' }} />
              ) : localFileType === 'image' ? (
                <ImageIcon size={20} style={{ color: 'var(--mut)' }} />
              ) : localFileType === 'text' ? (
                <FileText size={20} style={{ color: 'var(--mut)' }} />
              ) : (
                <PlayCircle size={20} style={{ color: 'var(--mut)' }} />
              )
            )}
          </div>
          <div className="sniff-meta">
            <div className="sniff-title">{localFileName || '本地文件'}</div>
            <div className="sniff-tags">
              <span className="kw" style={{ fontSize: 11 }}>
                本地{localFileTypeLabel(localFileType)}
              </span>
              {videoDuration > 0 && (
                <span className="kw" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Clock size={11} /> {formatDuration(videoDuration)}
                </span>
              )}
              <span className="sniff-ok">
                <CheckCircle2 size={11} /> 已上传
              </span>
            </div>
          </div>
        </div>
      ) : urlValue ? (
        <div className="composer-url modal-composer-url">
          <div className="platform"><Link2 size={16} /></div>
          <span className="modal-source-value">{urlValue}</span>
          <span className="kw">Composer 传入</span>
        </div>
      ) : (
        <div className="composer-url modal-composer-url">
          <div className="platform"><Link2 size={16} /></div>
          <input
            value={internalUrl}
            onChange={(e) => onInternalUrlChange(e.target.value)}
            placeholder="B站 / 小红书 / 抖音 / YouTube / 本地文件路径"
          />
          {onPickLocalFile && (
            <button
              type="button"
              className="pp-add"
              onClick={onPickLocalFile}
              disabled={localUploadPending}
            >
              <Upload size={11} />
              {localUploadPending ? '上传中…' : '本地上传'}
            </button>
          )}
        </div>
      )}
      {!isLocalFile && !urlValue && !effectiveSniff && (
        <div className="modal-kw-row">
          <span className="kw"><Link2 size={11} /> 支持网络链接</span>
          <span className="kw"><Upload size={11} /> 支持本地上传</span>
          <span className="kw" data-state={effectiveSniff ? 'recognized' : undefined}>
            {effectiveSniff ? '已识别' : '输入后自动识别'}
          </span>
        </div>
      )}
      {!isLocalFile && showBatchSourcePanel && (
        <div className="batch-source-panel">
          <div className="batch-source-toolbar">
            <button
              type="button"
              className="pp-add"
              onClick={onResolveBatchSource}
              disabled={!canResolveBatchSource || batchResolving || batchImporting}
            >
              <Layers size={11} />
              {batchResolving ? '解析中…' : '解析批量来源'}
            </button>
            <span className="kw">B 站多 P / 收藏夹 / UP 主页 / 系列 / YouTube 播放列表 / 多链接</span>
          </div>
          {batchResult && (
            <div className="batch-source-result">
              <div className="batch-source-result-head">
                <div className="batch-source-title-wrap">
                  <div className="batch-source-title">
                    {batchResult.title || '批量来源'}
                  </div>
                  <div className="mono batch-source-meta">
                    {batchResult.source_type} · 已选 {selectedBatchItemsCount} / {batchResult.items.length} 条
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary batch-source-import-btn"
                  onClick={onImportBatchSource}
                  disabled={batchImporting || selectedBatchItemsCount === 0}
                >
                  {batchImporting ? '导入中…' : `导入 ${selectedBatchItemsCount} 条为新合集`}
                </button>
              </div>
              <div className="batch-source-controls">
                <span className="kw">每条视频会创建一个子任务，并自动归入同一合集</span>
                <div className="batch-source-control-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => onBatchSelectedKeysChange(new Set(batchResult.items.map((item, idx) => batchSourceItemKey(item, idx))))}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => onBatchSelectedKeysChange(new Set())}
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="batch-source-list">
                {batchResult.items.map((item, idx) => {
                  const itemKey = batchSourceItemKey(item, idx)
                  const checked = batchSelectedKeys.has(itemKey)
                  // Q5：合集/播放列表类来源可确定是视频；多链接来源逐条未知，
                  // 显示「待识别」而不是默认视频（反馈 #16）。
                  const rowResolved = batchResult.source_type === 'multi_url' ? 'unknown' : 'video'
                  return (
                    <button
                      key={itemKey}
                      type="button"
                      className="batch-source-row"
                      data-selected={checked ? 'true' : undefined}
                      onClick={() => {
                        onBatchSelectedKeysChange((current) => {
                          const next = new Set(current)
                          if (next.has(itemKey)) next.delete(itemKey)
                          else next.add(itemKey)
                          return next
                        })
                      }}
                    >
                      <span aria-hidden className="batch-source-check">
                        <Check size={13} />
                      </span>
                      <span className="batch-source-thumb" data-empty={item.thumbnail ? undefined : 'true'}>
                        {item.thumbnail ? (
                          <img
                            src={previewSrcForProxy(item.thumbnail)}
                            alt=""
                            referrerPolicy="no-referrer"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : rowResolved === 'video' ? (
                          <Video size={15} />
                        ) : (
                          <span className="batch-source-unknown-dot" aria-hidden />
                        )}
                      </span>
                      <span className="batch-source-main">
                        <span className="batch-source-item-title">
                          {item.index ? `P${item.index} · ` : ''}{item.title || item.source_url}
                        </span>
                        <span className="mono batch-source-url">
                          {item.source_url}
                        </span>
                      </span>
                      {item.duration_seconds ? (
                        <span className="kw batch-source-duration">
                          {formatDuration(Math.round(item.duration_seconds))}
                        </span>
                      ) : (
                        <span
                          className="kw batch-source-duration"
                          data-type={rowResolved}
                        >
                          {rowResolved === 'video' ? (item.platform || '视频') : '待识别'}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {!isLocalFile && targetWorkspaceId && (
        <div className="existing-material-entry">
          <button
            type="button"
            className="pp-add"
            onClick={onToggleExistingPanel}
          >
            <Layers size={11} />
            已分析内容
          </button>
          <span className="kw">将已有笔记归入当前合集；编辑和总结会始终同步</span>
        </div>
      )}
      {existingPanelOpen && (
        <div className="existing-material-panel">
          <div className="pp-search">
            <Search size={14} />
            <input
              placeholder="搜索标题、来源或合集..."
              value={existingQuery}
              onChange={(event) => onExistingQueryChange(event.target.value)}
            />
          </div>
          <div className="existing-material-list">
            {existingLoading ? (
              <div className="existing-material-empty">正在读取已分析内容…</div>
            ) : filteredExistingItems.length === 0 ? (
              <div className="existing-material-empty">暂无可加入的已完成内容</div>
            ) : (
              filteredExistingItems.map((item) => {
                const itemKey = libraryItemKey(item)
                return (
                  <button
                    key={itemKey}
                    type="button"
                    className="existing-material-row"
                    data-on={existingSelectedIds.has(itemKey)}
                    onClick={() => onToggleExistingItem(itemKey)}
                  >
                    <span className="pp-check">
                      <Check size={11} strokeWidth={3} />
                    </span>
                    <span className="existing-material-thumb">
                      {item.thumbnail ? (
                        <img src={previewSrcForProxy(item.thumbnail)} alt="" loading="lazy" />
                      ) : (
                        itemTypeLabel(item.type).slice(0, 1)
                      )}
                    </span>
                    <span className="existing-material-main">
                      <strong>{item.name || '未命名内容'}</strong>
                      <em>{item.workspace_name} · {itemTypeLabel(item.type)} · {item.source === 'local' ? '本地' : '链接'}</em>
                    </span>
                  </button>
                )
              })
            )}
          </div>
          <div className="existing-material-foot">
            <span>已选 {selectedExistingRefsCount} 项</span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={existingAdding || selectedExistingRefsCount === 0}
              onClick={onAddExistingMaterials}
            >
              {existingAdding ? '加入中…' : '加入当前合集'}
            </button>
          </div>
        </div>
      )}
      {!isBatchMode && effectiveSniff && effectiveSniff.confident === false && (
        <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 6 }}>
          无法确认链接类型，将自动识别
        </div>
      )}
      {!isBatchMode && effectiveSniff && effectiveSniff.confident !== false && (
        <div className="sniff-card">
          <div className="sniff-thumb">
            {previewThumbUrl ? (
              <img
                src={previewThumbUrl}
                alt=""
                referrerPolicy="no-referrer"
                onError={(e) => {
                  const img = e.currentTarget
                  if (img.dataset.fallbackApplied === 'true') {
                    img.style.visibility = 'hidden'
                    img.parentElement?.classList.add('sniff-thumb--fallback')
                    return
                  }
                  const original = decodeProxySrc(img.src)
                  const fallback =
                    previewImageFallback(original) ||
                    (original !== img.src ? original : '')
                  if (fallback) {
                    img.dataset.fallbackApplied = 'true'
                    img.src = fallback
                    return
                  }
                  // 封面加载失败显示稳定占位，不留空白
                  img.style.visibility = 'hidden'
                  img.parentElement?.classList.add('sniff-thumb--fallback')
                }}
              />
            ) : (
              <ImageIcon size={20} style={{ color: 'var(--mut)' }} />
            )}
            {effectiveSniff.primary_type === 'video' && <PlayCircle size={22} className="sniff-play" />}
          </div>
          <div className="sniff-meta">
            <div className="sniff-title">
              {effectiveSniff.title || linkTitle || `已识别${{ video: '视频', audio: '音频', image: '图片', text: '网页' }[effectiveSniff.primary_type] ?? '内容'}`}
            </div>
            {linkDesc && <div className="sniff-desc">{linkDesc}</div>}
            <div className="sniff-tags">
              {effectiveSniff.platform && (
                <span className="kw" style={{ fontSize: 11 }}>{effectiveSniff.platform}</span>
              )}
              {videoDuration > 0 && (
                <span className="kw" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Clock size={11} /> {formatDuration(videoDuration)}
                </span>
              )}
              <span className="sniff-ok">
                <CheckCircle2 size={11} /> 已识别{{ video: '视频', audio: '音频', image: '图片', text: '网页' }[effectiveSniff.primary_type] ?? '内容'}
              </span>
            </div>
          </div>
        </div>
      )}
      {!isBatchMode && linkWarning && (
        <div
          role="status"
          style={{ fontSize: 12, color: 'var(--err, #b33737)', marginTop: 6 }}
        >
          {linkWarning}
        </div>
      )}
      {!isBatchMode && sniffFailed && !effectiveSniff && effectiveUrl && (
        <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 6 }}>
          无法识别该链接，可仍尝试提交
        </div>
      )}
    </div>
  )
}
