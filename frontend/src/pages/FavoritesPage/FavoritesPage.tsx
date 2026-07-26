import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Star } from 'lucide-react'
import { toast } from 'sonner'
import {
  createFavoriteGroup,
  listFavoriteGroups,
  listResolvedFavorites,
  unfavoriteItem,
  type FavoriteGroup,
  type ResolvedFavorite,
} from '@/services/workspaces'
import { ITEM_TYPE_TEXT } from '@/types/workspace'
import { FavoriteCard } from './FavoriteCard'
import { FavoriteOrganizer } from './FavoriteOrganizer'
import { FavoriteTransferActions } from './FavoriteTransferActions'
import './favorites.css'

type TabKey = 'all' | 'video' | 'audio' | 'image' | 'text'

const TAB_DEFS: { key: TabKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'video', label: ITEM_TYPE_TEXT.video },
  { key: 'audio', label: ITEM_TYPE_TEXT.audio },
  { key: 'image', label: ITEM_TYPE_TEXT.image },
  { key: 'text', label: ITEM_TYPE_TEXT.text },
]

export default function FavoritesPage() {
  const [entries, setEntries] = useState<ResolvedFavorite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('all')
  const [groups, setGroups] = useState<FavoriteGroup[]>([])
  const [groupId, setGroupId] = useState('__all__')
  const [search, setSearch] = useState('')
  const [newGroup, setNewGroup] = useState('')

  const reload = useCallback((gid?: string) => {
    setLoading(true)
    setError(null)
    const effectiveGid = gid ?? groupId
    Promise.all([
      listResolvedFavorites(
        effectiveGid !== '__all__' ? { group_id: effectiveGid } : undefined,
      ),
      listFavoriteGroups(),
    ])
      .then(([resolved, favoriteGroups]) => {
        setEntries(resolved)
        setGroups(favoriteGroups)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [groupId])

  useEffect(() => {
    reload()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // 分组切换时重新拉取
  const handleGroup = (value: string) => {
    setGroupId(value)
    reload(value)
  }

  const counts = useMemo(() => {
    const acc: Record<TabKey, number> = {
      all: entries.length,
      video: 0,
      audio: 0,
      image: 0,
      text: 0,
    }
    for (const e of entries) {
      const t = e.item_type as TabKey
      if (t in acc) acc[t] += 1
    }
    return acc
  }, [entries])

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return entries.filter(entry => (
      (tab === 'all' || entry.item_type === tab)
      && (!needle || `${entry.item_name} ${entry.workspace_name}`
        .toLocaleLowerCase().includes(needle))
    ))
  }, [entries, search, tab])

  const handleUnfavorite = async (entry: ResolvedFavorite) => {
    try {
      await unfavoriteItem(entry.workspace_id, entry.item_id)
      setEntries(prev => prev.filter(
        e => !(e.workspace_id === entry.workspace_id && e.item_id === entry.item_id),
      ))
    } catch (err) {
      toast.error('取消收藏失败：' + (err instanceof Error ? err.message : '未知错误'))
    }
  }

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
      {/* Hero：独立头部，不依赖 lib-page-header */}
      <div className="fav-header">
        <div className="fav-header-text">
          <div className="lib-kicker">FAVORITES · LOCAL</div>
          <h2>收藏夹</h2>
          <p>在工作区里点击星标即可把素材收藏到这里。</p>
        </div>
        <div className="fav-header-actions">
          <FavoriteTransferActions onImported={message => {
            setError(message)
            reload()
          }} />
          <button className="btn btn-sm" onClick={() => reload()} disabled={loading}>
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
        groupId={groupId} onGroup={handleGroup} groups={groups}
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
            <FavoriteCard
              key={`${entry.workspace_id}:${entry.item_id}`}
              entry={entry}
              onUnfavorite={handleUnfavorite}
            />
          ))}
        </div>
      )}
    </div>
  )
}
