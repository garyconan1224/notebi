import { useState, useRef, useEffect } from 'react'
import {
  ArrowLeft,
  Pencil,
  Plus,
  Download,
  Sparkles,
  Share2,
  MoreHorizontal,
  Star,
  MessageCircle,
  Layers,
  FileText,
  Globe,
} from 'lucide-react'
import type { WorkspaceBackground, WorkspaceItem } from '@/types/workspace'

/** 「更多」下拉菜单项 */
export interface MoreMenuItem {
  id: string
  label: string
  icon: React.ElementType
  disabled?: boolean
  disabledHint?: string
}

interface TaskboardHeadProps {
  name: string
  materialCount: number
  background: WorkspaceBackground
  items?: WorkspaceItem[]
  description?: string
  updatedAt?: string
  onBack?: () => void
  onEditBackground?: () => void
  onAddMaterial?: () => void
  onExport?: () => void
  onMerge?: () => void
  onShareMarkdown?: () => void
  onShareHtml?: () => void
  onMenuAction?: (id: string) => void
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function getHeadThumbnail(item: WorkspaceItem): string {
  const results = item.results ?? {}
  const direct = [
    results.thumbnail,
    results.cover_url,
    results.cover,
    results.image_path,
    results.static_url,
    results.video_thumbnail_url,
  ].map(pickString).find(Boolean)
  if (direct) return direct
  const imagePaths = Array.isArray(results.image_paths) ? results.image_paths : []
  const framePaths = Array.isArray(results.frame_paths) ? results.frame_paths : []
  const firstImage = [...imagePaths, ...framePaths].map(pickString).find(Boolean)
  if (firstImage) return firstImage
  const frames = Array.isArray(results.frames) ? results.frames : []
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object') continue
    const record = frame as Record<string, unknown>
    const url = [record.thumbnail, record.url, record.frame_image_path, record.frame_image].map(pickString).find(Boolean)
    if (url) return url
  }
  return ''
}

function getCoverSlots(items: WorkspaceItem[] = []): Array<WorkspaceItem | null> {
  const sorted: Array<WorkspaceItem | null> = [...items]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 4)
  while (sorted.length < 4) sorted.push(null)
  return sorted
}

/** 「更多」菜单默认项 */
const MORE_ITEMS: MoreMenuItem[] = [
  { id: 'favs', label: '收藏夹', icon: Star },
  { id: 'chat', label: 'AI 对话', icon: MessageCircle },
  { id: 'style', label: '风格报告', icon: Sparkles, disabled: true, disabledHint: 'Phase [C]' },
]

/**
 * Taskboard 顶部 — BiliNote 式布局：
 * 名称 + 素材计数 + 操作按钮行（加入素材 / 导出 / 对比 / 融合 / 分享 / 编辑背景 / 更多）。
 */
export function TaskboardHead({
  name,
  materialCount,
  background: _background,
  items = [],
  description,
  updatedAt,
  onBack,
  onEditBackground,
  onAddMaterial,
  onExport,
  onMerge,
  onShareMarkdown,
  onShareHtml,
  onMenuAction,
}: TaskboardHeadProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const shareRef = useRef<HTMLDivElement>(null)
  const coverSlots = getCoverSlots(items)

  // 点击外部关闭下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShareOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="tb-head">
      {/* 左侧：返回 + 信息 */}
      <div className="tb-head-l">
        {onBack && (
          <button className="tb-head-back" onClick={onBack}>
            <ArrowLeft size={14} />
            返回笔记库
          </button>
        )}
        <div className="tb-head-title-row">
          <h1 className="display">
            {name}
          </h1>
        </div>
        {description && <p className="tb-head-desc">{description}</p>}
        <div className="tb-head-count">
          <span className="tb-head-tag">
            <Layers size={13} />
            {materialCount} 篇笔记
          </span>
          {updatedAt && <span>更新于 {updatedAt}</span>}
        </div>
      </div>

      <div className="tb-head-side">
        <div className="tb-head-cover" aria-label="合集封面预览">
          {coverSlots.map((item, index) => {
            const thumb = item ? getHeadThumbnail(item) : ''
            return (
              <div key={item?.item_id ?? `cover-empty-${index}`} className={`tb-head-cover-tile tb-head-cover-tile--${item?.type ?? 'empty'}`}>
                {thumb ? (
                  <img src={thumb} alt="" loading="lazy" />
                ) : (
                  <span>{item?.type?.toUpperCase() ?? (index === 0 ? 'COLLECTION' : 'EMPTY')}</span>
                )}
              </div>
            )
          })}
        </div>

        {/* 右侧：操作按钮行 */}
        <div className="tb-head-actions">
          <button className="btn btn-primary" onClick={onAddMaterial}>
            <Plus size={14} />
            加入素材
          </button>
          <button className="btn" onClick={onExport}>
            <Download size={14} />
            导出
          </button>
          <button className="btn" onClick={onMerge}>
            <Sparkles size={14} />
            融合
          </button>
          <button className="btn" onClick={() => onMenuAction?.('chat')}>
            <MessageCircle size={14} />
            AI 对话
          </button>
          {/* 分享下拉 */}
          <div className="tb-head-more-wrap" ref={shareRef}>
            <button
              className="btn"
              data-active={shareOpen}
              onClick={() => setShareOpen(!shareOpen)}
            >
              <Share2 size={14} />
              分享
            </button>
            {shareOpen && (
              <div className="tb-head-more-menu">
                <button
                  className="tb-head-more-item"
                  onClick={() => { setShareOpen(false); onShareMarkdown?.() }}
                >
                  <FileText size={14} />
                  <span>复制 Markdown</span>
                </button>
                <button
                  className="tb-head-more-item"
                  onClick={() => { setShareOpen(false); onShareHtml?.() }}
                >
                  <Globe size={14} />
                  <span>导出 HTML</span>
                </button>
              </div>
            )}
          </div>
          <button className="btn" onClick={onEditBackground}>
            <Pencil size={14} />
            合集设置
          </button>

          {/* 更多下拉 */}
          <div className="tb-head-more-wrap" ref={moreRef}>
            <button
              className="btn"
              data-active={moreOpen}
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <MoreHorizontal size={14} />
            </button>
            {moreOpen && (
              <div className="tb-head-more-menu">
                {MORE_ITEMS.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      className="tb-head-more-item"
                      disabled={item.disabled}
                      title={item.disabled ? item.disabledHint : undefined}
                      onClick={() => {
                        setMoreOpen(false)
                        onMenuAction?.(item.id)
                      }}
                    >
                      <Icon size={14} />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
