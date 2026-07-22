import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star, RefreshCw } from 'lucide-react'
import { listWorkspaces } from '@/services/workspaces'
import {
  type ItemType,
  type WorkspaceItem,
  type WorkspaceRecord,
  ITEM_TYPE_TEXT,
} from '@/types/workspace'
import { resolveItemRoute } from '@/lib/resolveItemRoute'
import './favorites.css'

type TabKey = 'all' | ItemType

interface FavoriteEntry {
  workspace: WorkspaceRecord
  item: WorkspaceItem
}

const TAB_DEFS: { key: TabKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'video', label: ITEM_TYPE_TEXT.video },
  { key: 'audio', label: ITEM_TYPE_TEXT.audio },
  { key: 'image', label: ITEM_TYPE_TEXT.image },
  { key: 'text', label: ITEM_TYPE_TEXT.text },
]

const TYPE_LABEL: Record<string, string> = {
  video: 'VIDEO',
  audio: 'AUDIO',
  image: 'IMAGE',
  text:  'TEXT',
}

const COVER_CLASS: Record<string, string> = {
  video: 'cover-video',
  audio: 'cover-audio',
  image: 'cover-image',
  text:  'cover-text',
}

function collectFavorites(workspaces: WorkspaceRecord[]): FavoriteEntry[] {
  const out: FavoriteEntry[] = []
  for (const ws of workspaces) {
    const favSet = new Set(ws.favorites)
    for (const item of ws.items) {
      if (favSet.has(item.item_id)) out.push({ workspace: ws, item })
    }
  }
  out.sort(
    (a, b) =>
      new Date(b.item.updated_at).getTime() - new Date(a.item.updated_at).getTime(),
  )
  return out
}

function resultRouteFor(entry: FavoriteEntry): string {
  return resolveItemRoute(entry.workspace.workspace_id, entry.item)
}

export default function FavoritesPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('all')

  const reload = () => {
    setLoading(true)
    setError(null)
    listWorkspaces()
      .then((list) => setWorkspaces(list))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [])

  const favorites = useMemo(() => collectFavorites(workspaces), [workspaces])
  const counts = useMemo(() => {
    const acc: Record<TabKey, number> = {
      all: favorites.length,
      video: 0,
      audio: 0,
      image: 0,
      text: 0,
    }
    for (const f of favorites) acc[f.item.type] += 1
    return acc
  }, [favorites])

  const filtered = useMemo(
    () => (tab === 'all' ? favorites : favorites.filter((f) => f.item.type === tab)),
    [favorites, tab],
  )

  return (
    <div className="fav-page">
      {/* Hero */}
      <div className="lib-page-header">
        <div>
          <div className="lib-kicker">FAVORITES · LOCAL</div>
          <h2>收藏夹</h2>
          <p>在工作区里点击星标即可把素材收藏到这里。</p>
        </div>
        <div className="lib-actions">
          <button className="btn btn-sm" onClick={reload} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, marginBottom: 12, borderRadius: 'var(--rs)', border: '1px solid var(--err)', background: 'var(--errl)', color: 'var(--err)', fontSize: 13 }}>
          加载失败：{error}
        </div>
      )}

      {/* Filter tabs */}
      <div className="fav-tabs">
        {TAB_DEFS.map((t) => (
          <button
            key={t.key}
            className={`fav-tab${tab === t.key ? ' fav-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="note-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="note-card" style={{ minHeight: 200, opacity: 0.5 }}>
              <div className="note-cover" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Star size={24} strokeWidth={1.5} /></div>
          <div className="empty-state-title">
            {tab === 'all' ? '还没有收藏内容' : `还没有${TAB_DEFS.find(t => t.key === tab)?.label ?? ''}收藏`}
          </div>
          <div className="empty-state-desc">在工作区里点击星标即可把素材收藏到这里。</div>
        </div>
      ) : (
        <div className="note-grid">
          {filtered.map((entry) => (
            <FavoriteCard key={entry.item.item_id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

function FavoriteCard({ entry }: { entry: FavoriteEntry }) {
  const { workspace, item } = entry
  const typeLabel = TYPE_LABEL[item.type] || 'ITEM'
  const coverClass = COVER_CLASS[item.type] || 'cover-video'
  const updatedLabel = new Date(item.updated_at).toLocaleString()
  const kindLabel = '笔记收藏'

  return (
    <Link to={resultRouteFor(entry)} style={{ textDecoration: 'none' }}>
      <article className="note-card" data-kind={item.type}>
        <div className={`note-cover ${coverClass}`}>
          <span className="media-chip">{typeLabel}</span>
          <span className="status-pill status-done">{kindLabel}</span>
        </div>
        <div className="note-card-body">
          <div className="note-title-row">
            <span className="note-type-dot" />
            <h3>{item.name || item.source_value}</h3>
          </div>
          <p className="note-summary">{workspace.name} · {kindLabel}</p>
          <div className="note-meta-row">
            <span>笔记</span>
            <span>更新于 {updatedLabel}</span>
          </div>
          <div className="note-card-actions">
            <span>收藏</span>
            <button className="note-open">打开</button>
          </div>
        </div>
      </article>
    </Link>
  )
}
