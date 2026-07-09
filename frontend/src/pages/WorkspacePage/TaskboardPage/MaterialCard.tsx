import { useNavigate } from 'react-router-dom'
import { FileVideo, FileAudio, FileImage, FileText, Check, Star, Trash2 } from 'lucide-react'
import type { WorkspaceItem, ItemType } from '@/types/workspace'
import { resolveItemRoute } from '@/lib/resolveItemRoute'
import { SYSTEM_TAG_DIMENSIONS } from '@/constants/tagDimensions'

/** 类型 → 图标 */
const TYPE_ICON: Record<ItemType, React.ElementType> = {
  video: FileVideo,
  audio: FileAudio,
  image: FileImage,
  text: FileText,
}

/** 类型 → 中文 label */
const TYPE_LABEL: Record<ItemType, string> = {
  video: '视频',
  audio: '音频',
  image: '图片',
  text: '文字',
}

/** 类型 → 设计稿 tone（颜色语义） */
const TYPE_TONE: Record<ItemType, string> = {
  video: 'pink',
  audio: 'purple',
  image: 'blue',
  text: 'amber',
}

function getMaterialThumbnail(item: WorkspaceItem): string | null {
  const results = item.results as Record<string, unknown>
  const candidates: Array<string | null | undefined> = [
    item.thumbnail,
    typeof results.thumbnail === 'string' ? results.thumbnail : null,
    typeof results.cover_thumbnail === 'string' ? results.cover_thumbnail : null,
    typeof results.video_thumbnail_url === 'string' ? results.video_thumbnail_url : null,
    typeof results.cover_url === 'string' ? results.cover_url : null,
    typeof results.image_path === 'string' ? results.image_path : null,
    Array.isArray(results.image_paths) ? results.image_paths.find((entry): entry is string => typeof entry === 'string') : null,
    Array.isArray(results.frame_paths) ? results.frame_paths.find((entry): entry is string => typeof entry === 'string') : null,
    Array.isArray(results.images) ? results.images.find((entry): entry is string => typeof entry === 'string') : null,
  ]
  const frames = results.frames
  if (Array.isArray(frames) && typeof frames[0] === 'object' && frames[0] !== null) {
    const firstFrame = frames[0] as Record<string, unknown>
    for (const key of ['thumbnail', 'frame_image_path', 'frame_image']) {
      const value = firstFrame[key]
      if (typeof value === 'string' && value.length > 0) candidates.push(value)
    }
  }
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0) ?? null
}

/** 后端 status → 设计稿 state dot 颜色 */
const STATUS_DOT: Record<string, string> = {
  done: 'var(--accent-green)',
  processing: 'var(--ink)',
  pending: 'var(--ink-4)',
  failed: 'var(--accent-pink)',
}

/** 后端 status → 设计稿中文 */
const STATUS_LABEL: Record<string, string> = {
  done: '完成',
  processing: '处理中',
  pending: '等待中',
  failed: '失败',
}

function visibleTags(item: WorkspaceItem): string[] {
  const itemTags = item.tags
  if (!itemTags) return []
  const systemTags = SYSTEM_TAG_DIMENSIONS
    .map((dimension) => itemTags[dimension.key])
    .filter((tag): tag is string => Boolean(tag))
  const customTags = Array.isArray(itemTags.custom_tags) ? itemTags.custom_tags : []
  return Array.from(new Set([...systemTags, ...customTags].map((tag) => tag.trim()).filter(Boolean))).slice(0, 5)
}

interface MaterialCardProps {
  item: WorkspaceItem
  workspaceId: string
  /** 该 item 关联任务的进度（0~1），仅 processing 时有意义 */
  progress?: number
  /** 多选模式下是否已选中 */
  selected?: boolean
  /** 多选模式切换选中 */
  onSelect?: (itemId: string) => void
  onToggleFavorite?: (item: WorkspaceItem) => void
  onDelete?: (item: WorkspaceItem) => void
}

/**
 * 单张素材卡片。
 * 设计稿来源：taskboard.jsx MaterialCard + legacy prototype .mat-* 类。
 */
export function MaterialCard({ item, workspaceId, progress, selected, onSelect, onToggleFavorite, onDelete }: MaterialCardProps) {
  const navigate = useNavigate()
  const Icon = TYPE_ICON[item.type]
  const tone = TYPE_TONE[item.type]
  const dotColor = STATUS_DOT[item.status] ?? 'var(--ink-4)'
  const isRunning = item.status === 'processing'
  const tags = visibleTags(item)
  const thumbnail = getMaterialThumbnail(item)
  const route = resolveItemRoute(workspaceId, item)

  const handleClick = () => {
    if (onSelect) {
      onSelect(item.item_id)
    } else {
      navigate(route)
    }
  }

  return (
    <div className="mat-card" data-type={item.type} data-selected={selected ? 'true' : undefined} onClick={handleClick}>
      <div className="mat-thumb">
        {/* 多选勾选框 */}
        {onSelect && (
          <div className="mat-select-chk" data-checked={selected ? 'true' : undefined} onClick={(e) => { e.stopPropagation(); onSelect(item.item_id) }}>
            {selected && <Check size={12} />}
          </div>
        )}
        {!onSelect && (
          <div className="mat-card-tools">
            <button
              className={`mat-icon-btn${item.favorite ? ' mat-icon-btn--active' : ''}`}
              title={item.favorite ? '取消收藏' : '收藏'}
              onClick={(event) => {
                event.stopPropagation()
                onToggleFavorite?.(item)
              }}
            >
              <Star size={13} fill={item.favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              className="mat-icon-btn mat-icon-btn--danger"
              title="删除"
              onClick={(event) => {
                event.stopPropagation()
                onDelete?.(item)
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
        {thumbnail ? (
          <img src={thumbnail} alt={item.name || '素材封面'} />
        ) : (
          <div className={`mat-thumb-fallback mat-thumb-fallback--${item.type}`}>
            <Icon size={32} />
          </div>
        )}
        <span className="mat-type" data-tone={tone}>
          <Icon size={11} />
          {TYPE_LABEL[item.type]}
        </span>
        {isRunning && progress != null && (
          <div className="mat-prog">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}

      </div>
      <div className="mat-body">
        <div className="mat-title">{item.name || '未命名素材'}</div>
        <div className="mat-meta">
          <span className="dot" style={{ background: dotColor }} />
          <span>{STATUS_LABEL[item.status] ?? item.status}</span>
        </div>
        <div className="mat-sub" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-4)' }}>
          {item.source_value}
        </div>
        {tags.length > 0 && (
          <div className="mat-tags">
            {tags.slice(0, 4).map((t) => (
              <span key={t} className="kw">{t}</span>
            ))}
            {tags.length > 4 && (
              <span className="kw" style={{ opacity: 0.5 }}>+{tags.length - 4}</span>
            )}
          </div>
        )}
        <div className="mat-actions">
          <span>{item.status === 'done' ? '已完成' : STATUS_LABEL[item.status] ?? item.status}</span>
          <button
            className="note-open"
            onClick={(event) => {
              event.stopPropagation()
              navigate(route)
            }}
          >
            打开
          </button>
        </div>
      </div>
    </div>
  )
}
