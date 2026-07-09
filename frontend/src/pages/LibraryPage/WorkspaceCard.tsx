import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LibraryWorkspace, LibraryItem } from '@/services/library'
import { SYSTEM_TAG_DIMENSIONS } from '@/constants/tagDimensions'

const TYPE_TONE: Record<string, { badge: string; label: string }> = {
  video: { badge: 'collection-mini--video', label: 'VIDEO' },
  audio: { badge: 'collection-mini--audio', label: 'AUDIO' },
  image: { badge: 'collection-mini--image', label: 'IMAGE' },
  text: { badge: 'collection-mini--text', label: 'TEXT' },
}

const TYPE_NAME: Record<string, string> = {
  video: '视频',
  audio: '音频',
  image: '图文',
  text: '文本',
}

function formatRelative(iso: string): string {
  if (!iso) return ''
  try {
    const deltaDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    if (deltaDays <= 0) return '今天'
    if (deltaDays === 1) return '昨天'
    if (deltaDays < 7) return `${deltaDays} 天前`
    return `${Math.floor(deltaDays / 7)} 周前`
  } catch {
    return iso.slice(0, 10)
  }
}

function buildSourceSummary(items: LibraryItem[]): string {
  const labels = Array.from(new Set(items.map((item) => TYPE_TONE[item.type]?.label ?? item.type)))
  if (labels.length === 0) return '空合集'
  if (labels.length === 1) return `来自${labels[0]}`
  return `来自${labels.slice(0, 2).join(' / ')}`
}

function getPreviewSlots(items: LibraryItem[]): Array<LibraryItem | null> {
  const visible: Array<LibraryItem | null> = [...items]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 4)
  while (visible.length < 4) visible.push(null)
  return visible
}

function aggregateTags(items: LibraryItem[]): string[] {
  const tags: string[] = []
  for (const item of items) {
    const itemTags = item.tags
    if (!itemTags) continue
    for (const dimension of SYSTEM_TAG_DIMENSIONS) {
      const tag = itemTags[dimension.key]
      if (tag) tags.push(tag)
    }
    if (Array.isArray(itemTags.custom_tags)) tags.push(...itemTags.custom_tags)
  }
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 5)
}

interface WorkspaceCardProps {
  workspace: LibraryWorkspace
  items: LibraryItem[]
  selectMode?: boolean
  selected?: boolean
  onToggleSelect?: (workspaceId: string) => void
  onDelete?: (workspaceId: string) => void
  onRename?: (workspaceId: string, name: string) => Promise<void>
}

export function WorkspaceCard({
  workspace,
  items,
  selectMode,
  selected,
  onToggleSelect,
  onDelete,
  onRename,
}: WorkspaceCardProps) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(workspace.name)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraftName(workspace.name)
  }, [workspace.name])

  const previewItems = useMemo(
    () => [...items].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 4),
    [items],
  )
  const previewSlots = useMemo(() => getPreviewSlots(items), [items])

  const progressPct = workspace.items_count === 0 ? 12 : Math.min(100, 28 + workspace.items_count * 24)
  const typeMix = Object.entries(workspace.items_count_by_type ?? {})
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${TYPE_NAME[type] ?? type} ${count}`)
    .join(' · ')
  const summaryText = workspace.items_count > 0
    ? `${typeMix || `${workspace.items_count} 项内容`}，可继续生成融合笔记或补充新素材。`
    : workspace.kind === 'replica'
      ? '空复刻合集：适合先收纳参考图、视频与分镜素材。'
      : '空笔记合集：适合按主题收纳视频、音频、图片和文本。'
  const coverThumbnail = workspace.cover_thumbnail
  const collectionTags = useMemo(() => aggregateTags(items), [items])

  const handleSave = async () => {
    const nextName = draftName.trim()
    if (!nextName || nextName === workspace.name || saving || !onRename) {
      setEditing(false)
      setDraftName(workspace.name)
      return
    }
    setSaving(true)
    try {
      await onRename(workspace.workspace_id, nextName)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <article
      className={`note-card collection-card${selected ? ' note-card--selected' : ''}`}
      data-kind="collection"
      onClick={() => {
        if (selectMode) onToggleSelect?.(workspace.workspace_id)
        else navigate(`/workspaces/${workspace.workspace_id}`)
      }}
    >
      <div className="note-cover collection-cover">
        <span className="media-chip">COLLECTION</span>
        {selectMode ? (
          <span
            onClick={(event) => {
              event.stopPropagation()
              onToggleSelect?.(workspace.workspace_id)
            }}
            className={`ws-select-dot${selected ? ' ws-select-dot--on' : ''}`}
          >
            {selected && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </span>
        ) : (
          onDelete && (
            <button
              className="ws-delete-btn"
              onClick={(event) => {
                event.stopPropagation()
                onDelete(workspace.workspace_id)
              }}
              title="删除"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
              </svg>
            </button>
          )
        )}

        {coverThumbnail ? (
          <div className="collection-hero-cover">
            <img src={coverThumbnail} alt={`${workspace.name} 封面`} loading="lazy" />
            <div className="collection-hero-overlay">
              <span>{workspace.kind === 'replica' ? 'REPLICA COLLECTION' : 'NOTE COLLECTION'}</span>
              <strong>{workspace.items_count} 项内容</strong>
            </div>
          </div>
        ) : (
          <div className="collection-folder">
            <div className="collection-tab" />
            <div className="collection-preview-grid">
              {previewSlots.map((item, index) => {
                const tone = item ? TYPE_TONE[item.type]?.badge.replace('collection-mini', 'collection-preview-tile') : 'collection-preview-tile--empty'
                return (
                  <div
                    key={item?.item_id ?? `empty-${index}`}
                    className={`collection-preview-tile ${tone ?? 'collection-preview-tile--video'}`}
                  >
                    {item?.thumbnail ? (
                      <img src={item.thumbnail} alt="" loading="lazy" />
                    ) : (
                      <div className="collection-preview-fallback">
                        <span>{item ? (TYPE_TONE[item.type]?.label ?? item.type.toUpperCase()) : (workspace.kind === 'replica' ? 'REPLICA' : 'NOTE')}</span>
                        <strong>{item?.name || (index === 0 ? '先往这个合集里放一条内容' : '等待内容')}</strong>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="note-card-body">
        <div className="note-title-row">
          <span className="note-type-dot" />
          <div className="collection-title-wrap">
            {editing ? (
              <input
                autoFocus
                className="collection-title-input"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onBlur={() => void handleSave()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleSave()
                  }
                  if (event.key === 'Escape') {
                    setEditing(false)
                    setDraftName(workspace.name)
                  }
                }}
              />
            ) : (
              <h3 onDoubleClick={(event) => {
                event.stopPropagation()
                setEditing(true)
              }}
              >
                {workspace.name}
              </h3>
            )}
          </div>
        </div>

        <p className="note-summary">{summaryText}</p>

        <div className="note-status-line">
          <span className="note-inline-chip note-inline-chip--done">文件夹</span>
          <span className="note-inline-chip">{workspace.kind === 'replica' ? '复刻合集' : '笔记合集'}</span>
        </div>

        {collectionTags.length > 0 && (
          <div className="note-tag-row" aria-label="合集标签">
            {collectionTags.map((tag) => <span key={tag} className="note-tag-chip">{tag}</span>)}
          </div>
        )}

        <div className="note-meta-row">
          <span>合集</span>
          <span>{workspace.items_count} 项内容</span>
          <span>更新 {formatRelative(workspace.updated_at)}</span>
        </div>

        <div className="note-progress-mini">
          <span style={{ width: `${progressPct}%` }} />
        </div>

        <div className="note-card-actions">
          <span>{buildSourceSummary(previewItems)}</span>
          <button className="note-open" onClick={(event) => {
            event.stopPropagation()
            navigate(`/workspaces/${workspace.workspace_id}`)
          }}
          >
            打开
          </button>
        </div>
      </div>
    </article>
  )
}
