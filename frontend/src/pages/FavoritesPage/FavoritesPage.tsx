import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Star } from 'lucide-react'
import {
  createFavoriteGroup,
  listFavoriteGroupItems,
  listFavoriteGroups,
  listWorkspaces,
  type FavoriteGroup,
} from '@/services/workspaces'
import {
  type ItemType,
  type WorkspaceItem,
  type WorkspaceRecord,
  ITEM_TYPE_TEXT,
} from '@/types/workspace'
import { FavoriteCard } from './FavoriteCard'
import { FavoriteOrganizer } from './FavoriteOrganizer'
import './favorites.css'

type TabKey = 'all' | ItemType

export interface FavoriteEntry {
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

export default function FavoritesPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('all')
  const [groups, setGroups] = useState<FavoriteGroup[]>([])
  const [groupId, setGroupId] = useState('__all__')
  const [groupContentIds, setGroupContentIds] = useState<Set<string> | null>(null)
  const [search, setSearch] = useState('')
  const [newGroup, setNewGroup] = useState('')

  const reload = () => {
    setLoading(true)
    setError(null)
    Promise.all([listWorkspaces(), listFavoriteGroups()])
      .then(([list, favoriteGroups]) => {
        setWorkspaces(list)
        setGroups(favoriteGroups)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [])

  useEffect(() => {
    if (groupId === '__all__') {
      setGroupContentIds(null)
      return
    }
    void listFavoriteGroupItems(groupId)
      .then(items => setGroupContentIds(new Set(items.map(item => item.content_id))))
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [groupId])

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

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return favorites.filter(entry => (
      (tab === 'all' || entry.item.type === tab)
      && (!groupContentIds || groupContentIds.has(entry.item.content_id ?? ''))
      && (!needle || `${entry.item.name} ${entry.workspace.name}`
        .toLocaleLowerCase().includes(needle))
    ))
  }, [favorites, groupContentIds, search, tab])

  const addGroup = async () => {
    const name = newGroup.trim()
    if (!name) return
    try {
      await createFavoriteGroup(name)
      setNewGroup('')
      setGroups(await listFavoriteGroups())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

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

      <FavoriteOrganizer
        search={search} onSearch={setSearch}
        groupId={groupId} onGroup={setGroupId} groups={groups}
        newGroup={newGroup} onNewGroup={setNewGroup} onAddGroup={addGroup}
      />

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
