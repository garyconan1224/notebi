import { Star } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { WorkspaceItem } from '@/types/workspace'
import { resolveItemRoute } from '@/lib/resolveItemRoute'

interface FavoritesTabProps {
  /** 当前 workspace 的 favorites（item_id 列表） */
  favoriteIds: string[]
  /** 当前 workspace 的所有 items */
  items: WorkspaceItem[]
  workspaceId: string
}

/**
 * Favorites tab — 收藏夹，展示当前 workspace 中被收藏的素材。
 * 设计稿来源：taskboard.jsx TBFavorites（简化版，单列列表 + 点击跳详情）。
 */
export function FavoritesTab({ favoriteIds, items, workspaceId }: FavoritesTabProps) {
  const navigate = useNavigate()
  const favSet = new Set(favoriteIds)
  const favItems = items.filter((it) => favSet.has(it.item_id))

  if (favItems.length === 0) {
    return (
      <div className="tb-placeholder" style={{ minHeight: 240 }}>
        暂无收藏
      </div>
    )
  }

  const handleClick = (item: WorkspaceItem) => {
    navigate(resolveItemRoute(workspaceId, item))
  }

  return (
    <>
      <div className="tb-head-mini">
        <div>
          <div
            className="eyebrow"
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
            }}
          >
            收藏夹 · {favItems.length} 条
          </div>
          <h2 className="display" style={{ fontSize: 28, margin: '4px 0 0' }}>
            收藏夹 · Favorites
          </h2>
        </div>
      </div>

      <div className="fav-list">
        {favItems.map((item) => (
          <div
            key={item.item_id}
            className="fav-item"
            onClick={() => handleClick(item)}
          >
            <div className="fav-th">
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--ink-4)',
                  fontSize: 10,
                }}
              >
                {item.type}
              </div>
            </div>
            <div className="fav-meta">
              <div className="fav-note">{item.name || '未命名素材'}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                {item.source_value}
              </div>
            </div>
            <Star size={14} style={{ color: 'var(--accent-warm)', fill: 'var(--accent-warm)' }} />
          </div>
        ))}
      </div>
    </>
  )
}
