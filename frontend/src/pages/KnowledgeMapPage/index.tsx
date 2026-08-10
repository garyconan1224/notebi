import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Network, RefreshCw, RotateCcw, Search, Star } from 'lucide-react'
import { fetchKnowledgeMap, type KnowledgeMapData, type KnowledgeMapFilters } from '@/services/knowledgeMap'
import { ITEM_TYPE_TEXT, type ItemType } from '@/types/workspace'
import { KnowledgeMapCanvas, type KnowledgeMapCanvasHandle } from './KnowledgeMapCanvas'
import './knowledge-map.css'

const INITIAL_FILTERS: KnowledgeMapFilters = { limit: 60 }

function formatSource(source: string): string {
  return source === 'url' ? 'URL' : '本地'
}

export default function KnowledgeMapPage() {
  const { t } = useTranslation('pages')
  const navigate = useNavigate()
  const canvasRef = useRef<KnowledgeMapCanvasHandle>(null)
  const [filters, setFilters] = useState<KnowledgeMapFilters>(INITIAL_FILTERS)
  const [data, setData] = useState<KnowledgeMapData | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await fetchKnowledgeMap(filters))
    } catch {
      setError(t('map.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [filters, t])

  useEffect(() => {
    void load()
  }, [load])

  const selectedNode = useMemo(
    () => data?.nodes.find((node) => node.id === selectedId) ?? null,
    [data, selectedId],
  )
  const selectedItems = useMemo(() => {
    if (!selectedNode || !data) return []
    const ids = new Set(selectedNode.item_ids)
    return data.items.filter((item) => ids.has(item.item_id))
  }, [data, selectedNode])

  const updateFilter = (key: keyof KnowledgeMapFilters, value: string | boolean) => {
    setFilters((current) => ({ ...current, [key]: value || undefined }))
    setSelectedId('')
  }

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS)
    setSelectedId('')
  }

  const openItem = (workspaceId: string, itemId: string) => {
    navigate(`/workspaces/${workspaceId}/items/${itemId}/note`)
  }

  return (
    <main className="knowledge-map-page" aria-label={t('map.title')}>
      <header className="knowledge-map-header">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Network size={16} />
            {t('map.eyebrow')}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('map.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('map.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
            {t('map.refresh')}
          </button>
          <button type="button" className="btn btn-sm" onClick={clearFilters}>
            <RotateCcw size={14} />
            {t('map.reset')}
          </button>
        </div>
      </header>

      <section className="knowledge-map-toolbar" aria-label={t('map.filters')}>
        <label className="knowledge-map-field">
          <span>{t('map.collection')}</span>
          <select
            value={filters.collection_id ?? ''}
            onChange={(event) => updateFilter('collection_id', event.target.value)}
          >
            <option value="">{t('map.all')}</option>
            {data?.facets.collections.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="knowledge-map-field">
          <span>{t('map.type')}</span>
          <select
            value={filters.item_type ?? ''}
            onChange={(event) => updateFilter('item_type', event.target.value as ItemType | '')}
          >
            <option value="">{t('map.all')}</option>
            {data?.facets.types.map((type) => <option key={type} value={type}>{ITEM_TYPE_TEXT[type as ItemType] ?? type}</option>)}
          </select>
        </label>
        <label className="knowledge-map-field">
          <span>{t('map.source')}</span>
          <select
            value={filters.source ?? ''}
            onChange={(event) => updateFilter('source', event.target.value as 'url' | 'local' | '')}
          >
            <option value="">{t('map.all')}</option>
            {data?.facets.sources.map((source) => <option key={source} value={source}>{formatSource(source)}</option>)}
          </select>
        </label>
        <label className="knowledge-map-field knowledge-map-field-search">
          <span>{t('map.tag')}</span>
          <span className="knowledge-map-search-wrap">
            <Search size={14} />
            <input
              value={filters.tag ?? ''}
              onChange={(event) => updateFilter('tag', event.target.value)}
              placeholder={t('map.tagPlaceholder')}
            />
          </span>
        </label>
        <label className="knowledge-map-check">
          <input
            type="checkbox"
            checked={filters.favorite === true}
            onChange={(event) => updateFilter('favorite', event.target.checked)}
          />
          <Star size={14} />
          {t('map.favoriteOnly')}
        </label>
        <label className="knowledge-map-check">
          <input
            type="checkbox"
            checked={filters.include_inbox === true}
            onChange={(event) => updateFilter('include_inbox', event.target.checked)}
          />
          {t('map.includeInbox')}
        </label>
      </section>

      {error ? (
        <div className="knowledge-map-empty" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-sm" onClick={() => void load()}>{t('map.retry')}</button>
        </div>
      ) : loading && !data ? (
        <div className="knowledge-map-empty" role="status">{t('map.loading')}</div>
      ) : data && data.nodes.length === 0 ? (
        <div className="knowledge-map-empty">
          <Network size={32} />
          <p>{t('map.empty')}</p>
          <span>{t('map.emptyHint')}</span>
        </div>
      ) : data ? (
        <section className="knowledge-map-workbench">
          <div className="knowledge-map-main">
            <div className="knowledge-map-stats">
              <span>{t('map.statsItems', { count: data.stats.items })}</span>
              <span>{t('map.statsTagged', { count: data.stats.tagged_items })}</span>
              <span>{t('map.statsTags', { count: data.stats.tags })}</span>
              {data.stats.hidden_tags > 0 && <span>{t('map.statsHidden', { count: data.stats.hidden_tags })}</span>}
            </div>
            <div className="knowledge-map-viewport">
              <KnowledgeMapCanvas ref={canvasRef} data={data} onSelect={setSelectedId} />
              <button type="button" className="knowledge-map-fit btn btn-sm" onClick={() => void canvasRef.current?.fitView()}>
                {t('map.fit')}
              </button>
            </div>
          </div>
          <aside className="knowledge-map-detail" aria-label={t('map.detail')}>
            {selectedNode ? (
              <>
                <div className="knowledge-map-detail-head">
                  <span className="knowledge-map-kicker">{t('map.selectedTag')}</span>
                  <h2>{selectedNode.label}</h2>
                  <p>{t('map.relatedCount', { count: selectedNode.count })}</p>
                </div>
                <div className="knowledge-map-item-list">
                  {selectedItems.map((item) => (
                    <button key={`${item.workspace_id}:${item.item_id}`} type="button" className="knowledge-map-item" onClick={() => openItem(item.workspace_id, item.item_id)}>
                      <strong>{item.name}</strong>
                      <span>{ITEM_TYPE_TEXT[item.type]} · {item.workspace_name}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="knowledge-map-detail-empty">
                <Network size={24} />
                <strong>{t('map.selectHint')}</strong>
                <span>{t('map.selectHintDetail')}</span>
              </div>
            )}
          </aside>
        </section>
      ) : null}
    </main>
  )
}
