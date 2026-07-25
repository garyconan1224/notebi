import { Link } from 'react-router-dom'

import { resolveItemRoute } from '@/lib/resolveItemRoute'
import type { FavoriteEntry } from './FavoritesPage'

const TYPE_LABEL: Record<string, string> = {
  video: 'VIDEO',
  audio: 'AUDIO',
  image: 'IMAGE',
  text: 'TEXT',
}

const COVER_CLASS: Record<string, string> = {
  video: 'cover-video',
  audio: 'cover-audio',
  image: 'cover-image',
  text: 'cover-text',
}

export function FavoriteCard({ entry }: { entry: FavoriteEntry }) {
  const { workspace, item } = entry
  const kindLabel = '笔记收藏'
  return (
    <Link to={resolveItemRoute(workspace.workspace_id, item)}
      style={{ textDecoration: 'none' }}>
      <article className="note-card" data-kind={item.type}>
        <div className={`note-cover ${COVER_CLASS[item.type] || 'cover-video'}`}>
          <span className="media-chip">{TYPE_LABEL[item.type] || 'ITEM'}</span>
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
            <span>更新于 {new Date(item.updated_at).toLocaleString()}</span>
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
