import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Star } from 'lucide-react'

import type { ResolvedFavorite } from '@/services/workspaces'

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

interface Props {
  entry: ResolvedFavorite
  onUnfavorite: (entry: ResolvedFavorite) => void
}

export function FavoriteCard({ entry, onUnfavorite }: Props) {
  const { t } = useTranslation('pages')
  return (
    <Link to={entry.jump_url} style={{ textDecoration: 'none' }}>
      <article className="note-card" data-kind={entry.item_type}>
        <div className={`note-cover ${COVER_CLASS[entry.item_type] || 'cover-video'}`}>
          <span className="media-chip">{TYPE_LABEL[entry.item_type] || 'ITEM'}</span>
          <button
            className="fav-unfav-btn"
            title={t('favorites.unFavorite')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onUnfavorite(entry)
            }}
          >
            <Star size={14} fill="currentColor" />
          </button>
        </div>
        <div className="note-card-body">
          <div className="note-title-row">
            <span className="note-type-dot" />
            <h3>{entry.item_name}</h3>
          </div>
          <p className="note-summary">{entry.workspace_name}</p>
          <div className="note-meta-row">
            <span>{t('favorites.favorited')}</span>
            <span>{t('favorites.favoritedAt', { time: new Date(entry.favorited_at).toLocaleString() })}</span>
          </div>
          <div className="note-card-actions">
            <span>收藏</span>
            <button className="note-open">{t('favorites.open')}</button>
          </div>
        </div>
      </article>
    </Link>
  )
}
