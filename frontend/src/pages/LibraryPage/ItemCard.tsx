import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { LibraryItem } from '@/services/library'
import { Mic, Music, Play, Star } from 'lucide-react'
import { resolveItemRoute } from '@/lib/resolveItemRoute'
import { SYSTEM_TAG_DIMENSIONS } from '@/constants/tagDimensions'
import type { ItemTags } from '@/types/workspace'
import {
  STATE_LABEL,
  primaryStatusToState,
  formatDuration,
  extractDomain,
} from './libraryHelpers'

const TYPE_LABEL: Record<string, string> = {
  video: 'VIDEO',
  audio: 'AUDIO',
  image: 'IMAGE',
  text:  'TEXT',
}

function visibleTags(tags?: ItemTags): string[] {
  if (!tags) return []
  const systemTags = SYSTEM_TAG_DIMENSIONS
    .map((dimension) => tags[dimension.key])
    .filter((tag): tag is string => Boolean(tag))
  const customTags = Array.isArray(tags.custom_tags) ? tags.custom_tags : []
  return Array.from(new Set([...systemTags, ...customTags].map((tag) => tag.trim()).filter(Boolean))).slice(0, 4)
}

interface ItemCardProps {
  item: LibraryItem
  selected?: boolean
  selectMode?: boolean
  onToggleSelect?: (itemId: string, workspaceId: string) => void
  onDelete?: (item: LibraryItem) => void
  onToggleFavorite?: (item: LibraryItem) => void
}

export function ItemCard({ item, selected, selectMode, onToggleSelect, onDelete, onToggleFavorite }: ItemCardProps) {
  const navigate = useNavigate()
  const state = primaryStatusToState(item.primary_task_status)
  const stateLabel = STATE_LABEL[state] || 'queued'
  const dur = formatDuration(item.duration_seconds)
  const hasDur = item.duration_seconds != null && item.duration_seconds > 0
  const srcLabel = extractDomain(item.source_value)

  const isDone = state === 'done'
  const isRunning = state === 'running'
  const isError = state === 'error'

  const statusText: Record<string, string> = {
    done: '已完成',
    running: '运行中',
    queued: '等待中',
    error: '失败',
  }

  const summaryBits: string[] = []
  if (item.results_summary.has_transcript) summaryBits.push('已转写')
  if (item.results_summary.has_summary) summaryBits.push('已总结')
  if (item.has_chapters) summaryBits.push('章节')
  if (item.type === 'video' && (item.frames_count ?? 0) > 0) summaryBits.push(`${item.frames_count} 帧`)
  if (item.has_subtitle) summaryBits.push('字幕')
  const fallbackSummaryLine = summaryBits.length > 0
    ? summaryBits.join(' · ')
    : state === 'error'
      ? '处理失败，请检查链接或重新提交。'
      : isRunning
        ? '正在生成结构化笔记与素材索引。'
        : '等待开始分析。'
  const summaryLine = item.description?.trim() || fallbackSummaryLine

  const actionLabel = isDone ? '打开' : '进度'
  const progressPct = isDone ? 100 : isRunning ? 46 : isError ? 100 : 18

  const handleCardClick = () => {
    if (selectMode && onToggleSelect) {
      onToggleSelect(item.item_id, item.workspace_id)
    } else if (isDone) {
      navigate(resolveItemRoute(item.workspace_id, item))
    } else {
      const tid = item.related_task_ids?.[0] ?? ''
      if (tid) {
        navigate(`/processing/${tid}`)
      } else {
        toast.info('该笔记尚在分析中，请从任务面板查看进度')
      }
    }
  }

  const hasThumb = !!item.thumbnail
  const coverClass = hasThumb ? '' : `cover-${item.type}` || 'cover-video'
  const statusClass = isDone ? 'note-inline-chip note-inline-chip--done'
    : isRunning ? 'note-inline-chip note-inline-chip--run'
    : isError ? 'note-inline-chip note-inline-chip--error'
    : 'note-inline-chip'
  const typeLabel = TYPE_LABEL[item.type] || 'ITEM'
  const tags = visibleTags(item.tags)

  const metaLabels: string[] = [srcLabel || item.source]
  if (item.type === 'video' && (item.frames_count ?? 0) > 0) metaLabels.push(`${item.frames_count} 帧`)

  return (
    <article
      className={`note-card${selected ? ' note-card--selected' : ''}`}
      onClick={handleCardClick}
      data-kind={item.type}
    >
      {/* Cover */}
      <div className={`note-cover ${coverClass}`}>
        {hasThumb ? (
          <img src={item.thumbnail ?? undefined} alt={item.name} referrerPolicy="no-referrer"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : null}
        <span className="media-chip">{typeLabel}</span>
        {!hasThumb && item.type === 'video' && (
          <div className="cover-icon"><Play fill="currentColor" /></div>
        )}
        {!hasThumb && item.type === 'audio' && (
          <div className="audio-wave">
            {Array.from({ length: 7 }, (_, i) => <i key={i} />)}
          </div>
        )}
        {!hasThumb && item.type === 'image' && (
          <div className="image-cluster">
            {Array.from({ length: 4 }, (_, i) => <span key={i} />)}
          </div>
        )}
        {!hasThumb && item.type === 'text' && (
          <div className="doc-lines">
            {Array.from({ length: 4 }, (_, i) => <i key={i} />)}
          </div>
        )}

        {/* audio nature badge */}
        {item.type === 'audio' && item.audio_nature && (
          <span style={{
            position: 'absolute', left: 9, bottom: 9, zIndex: 1,
            borderRadius: 'var(--rs)', background: 'oklch(0% 0 0 / .55)',
            color: 'oklch(100% 0 0)', fontSize: 10, fontFamily: 'var(--fm)',
            fontWeight: 800, padding: '3px 7px', display: 'inline-flex',
            alignItems: 'center', gap: 4,
          }}>
            {item.audio_nature === 'speech' ? <Mic size={11} /> : <Music size={11} />}
            {item.audio_nature === 'speech' ? '人声' : '音乐'}
          </span>
        )}

        {/* selection / actions overlay */}
        <div style={{ position: 'absolute', top: 9, right: 9, zIndex: 2, display: 'flex', gap: 6 }}>
          {selectMode ? (
            <span
              onClick={(e) => { e.stopPropagation(); onToggleSelect?.(item.item_id, item.workspace_id) }}
              style={{
                width: 22, height: 22, borderRadius: 99, display: 'grid', placeItems: 'center',
                cursor: 'pointer', fontSize: 11,
                background: selected ? 'oklch(100% 0 0)' : 'oklch(0% 0 0 / .45)',
                color: selected ? 'var(--fg)' : 'oklch(100% 0 0)',
                border: selected ? '1.5px solid oklch(100% 0 0)' : '1.5px solid oklch(100% 0 0 / .5)',
              }}
            >
              {selected && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </span>
          ) : (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(item) }}
                title={item.favorite ? '取消收藏' : '收藏'}
                className={`card-fav-btn${item.favorite ? ' card-fav-btn--active' : ''}`}
              >
                <Star size={13} fill={item.favorite ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete?.(item) }}
                title="删除"
                style={{
                  width: 28, height: 28, borderRadius: 'var(--rs)', border: 'none',
                  background: 'oklch(0% 0 0 / .45)', color: 'oklch(100% 0 0)',
                  display: 'grid', placeItems: 'center', cursor: 'pointer',
                  opacity: 0, transition: 'all .15s',
                }}
                className="card-delete-btn"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="note-card-body">
        <div className="note-title-row">
          <span className="note-type-dot" />
          <h3>{item.name || '未命名'}</h3>
        </div>

        <p className="note-summary">{summaryLine}</p>

        <div className="note-status-line">
          <span className={statusClass}>{statusText[state] ?? stateLabel}</span>
          {hasDur && <span className="note-inline-chip">{dur}</span>}
          {item.favorite && <span className="note-inline-chip">已收藏</span>}
        </div>

        {tags.length > 0 && (
          <div className="note-tag-row" aria-label="内容标签">
            {tags.map((tag) => <span key={tag} className="note-tag-chip">{tag}</span>)}
          </div>
        )}

        <div className="note-meta-row">
          {metaLabels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
          <span>{item.workspace_name}</span>
        </div>

        <div className="note-progress-mini">
          <span style={{ width: `${progressPct}%` }} />
        </div>

        <div className="note-card-actions">
          <span>{isDone ? summaryBits[0] || '已完成' : isRunning ? '生成中…' : ''}</span>
          <button className="note-open" onClick={(e) => { e.stopPropagation(); handleCardClick() }}>
            {actionLabel}
          </button>
        </div>
      </div>
    </article>
  )
}
