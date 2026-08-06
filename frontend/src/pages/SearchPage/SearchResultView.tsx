import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Bookmark, ChevronDown, ChevronUp, ExternalLink, File, FileText, Film, Image, Mic } from 'lucide-react'
import { toast } from 'sonner'

import { favoriteItem, unfavoriteItem } from '@/services/workspaces'
import type { SearchResponse, SearchSource } from '@/services/search'
import { ITEM_TYPE_TEXT, type WorkspaceRecord } from '@/types/workspace'

const TYPE_ICON = {
  video: Film,
  image: Image,
  audio: Mic,
  text: FileText,
} as const

function TypeIcon({ type }: { type: string }) {
  const Icon = TYPE_ICON[type as keyof typeof TYPE_ICON] ?? File
  return <Icon size={18} strokeWidth={1.7} />
}

interface Props {
  result: SearchResponse
  workspaces: WorkspaceRecord[]
  onWorkspaceChange: (record: WorkspaceRecord) => void
}

function isFavorite(source: SearchSource, workspaces: WorkspaceRecord[]) {
  return workspaces
    .find(workspace => workspace.workspace_id === source.workspace_id)
    ?.favorites.includes(source.item_id) ?? false
}

export function SearchResultView({ result, workspaces, onWorkspaceChange }: Props) {
  const { t } = useTranslation('pages')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [activeSource, setActiveSource] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [showRelated, setShowRelated] = useState(false)

  const citations = useMemo(() => result.citations ?? [], [result.citations])

  // Split sources into cited and related
  const { citedSources, relatedSources } = useMemo(() => {
    const cited: { source: SearchSource; index: number; number: number }[] = []
    const related: { source: SearchSource; index: number }[] = []
    result.sources.forEach((source, index) => {
      const citation = citations.find(c => c.source_id === source.source_id)
      if (citation) {
        cited.push({ source, index, number: citation.number })
      } else {
        related.push({ source, index })
      }
    })
    cited.sort((left, right) => left.number - right.number)
    return { citedSources: cited, relatedSources: related }
  }, [result.sources, citations])

  const focusSource = (index: number) => {
    const source = result.sources[index]
    if (!source) return
    setActiveSource(source.source_id)
    document.getElementById(`search-source-${index + 1}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }

  const toggleFavorite = async (source: SearchSource) => {
    const favorite = isFavorite(source, workspaces)
    setSaving(source.source_id)
    try {
      const record = favorite
        ? await unfavoriteItem(source.workspace_id, source.item_id)
        : await favoriteItem(source.workspace_id, source.item_id)
      onWorkspaceChange(record)
      toast.success(favorite ? t('knowledge.unfavorited') : t('knowledge.favorited'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('knowledge.favoriteFailed'))
    } finally {
      setSaving(null)
    }
  }

  const renderSourceCard = (source: SearchSource, index: number, label?: number) => {
    const open = expanded.has(source.source_id)
    const favorite = isFavorite(source, workspaces)
    return (
      <li
        id={`search-source-${index + 1}`}
        key={`${source.source_id}-${source.segment_id}-${index}`}
        className={activeSource === source.source_id ? 'is-highlighted' : ''}
      >
        <article className="search-source-item">
          <div className="search-source-cover"><TypeIcon type={source.item_type} /></div>
          <div className="search-source-info">
            <div className="search-source-title">
              <span>[{label ?? index + 1}] {source.item_title || t('knowledge.noTitle')}</span>
              <span className="search-source-actions">
                <button
                  onClick={() => toggleFavorite(source)}
                  disabled={saving === source.source_id}
                  aria-label={favorite ? t('knowledge.unfavorite') : t('knowledge.favoriteSource')}
                  data-active={favorite}
                >
                  <Bookmark size={14} fill={favorite ? 'currentColor' : 'none'} />
                </button>
                <Link to={source.jump_url} aria-label={t('knowledge.jumpToOriginal')}>
                  <ExternalLink size={14} />
                </Link>
              </span>
            </div>
            <div className="search-source-meta">
              <span className="search-source-badge">
                {ITEM_TYPE_TEXT[source.item_type] ?? source.item_type}
              </span>
              <span>{source.workspace_name}</span>
              <span>{source.field === 'transcript' ? t('knowledge.transcriptSource') : t('knowledge.contentSource')}</span>
              {source.start_ms != null && (
                <span>{Math.floor(source.start_ms / 1000)} 秒</span>
              )}
            </div>
            <div className="search-source-excerpt">
              {source.excerpt || source.chunk_excerpt}
            </div>
            {open && (
              <div className="search-source-context">
                定位：{source.segment_id || source.field}。点击右上角可在原内容中查看。
              </div>
            )}
            <button
              className="search-expand-btn"
              onClick={() => setExpanded(previous => {
                const next = new Set(previous)
                if (next.has(source.source_id)) next.delete(source.source_id)
                else next.add(source.source_id)
                return next
              })}
            >
              {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {open ? t('knowledge.collapseLoc') : t('knowledge.expandLoc')}
            </button>
          </div>
        </article>
      </li>
    )
  }

  return (
    <>
      {result.mode !== 'exact' && (
        <section className="search-answer" aria-label={t('knowledge.kbAnswer')}>
          <div className="search-answer-label">{t('knowledge.kbAnswer')}</div>
          <div className="search-answer-body">
            {result.answer_status === 'insufficient_evidence'
              ? t('knowledge.noEvidenceShort')
              : result.answer || t('knowledge.noModelOutput')}
          </div>
          {citations.length > 0 ? (
            <div className="search-citations" aria-label={t('knowledge.answerCitations')}>
              {citations.map(citation => (
                <button
                  key={citation.source_id}
                  className="search-citation-chip"
                  onClick={() => focusSource(
                    result.sources.findIndex(s => s.source_id === citation.source_id)
                  )}
                  aria-label={t('knowledge.viewCitation', { index: citation.number })}
                >
                  [{citation.number}]
                </button>
              ))}
            </div>
          ) : (
            result.answer && (
              <p className="search-no-citations">{t('knowledge.noCitations')}</p>
            )
          )}
        </section>
      )}

      {/* 引用来源 */}
      {citedSources.length > 0 && (
        <section aria-label={t('knowledge.citationSources')}>
          <div className="search-sources-heading">{t('knowledge.citationSources')}（{citedSources.length}）</div>
          <ul className="search-source-list">
            {citedSources.map(({ source, index, number }) =>
              renderSourceCard(source, index, number)
            )}
          </ul>
        </section>
      )}

      {/* 相关原文（默认折叠） */}
      {result.mode !== 'exact' && relatedSources.length > 0 && (
        <section aria-label={t('knowledge.relatedSources')}>
          <button
            className="search-related-toggle"
            onClick={() => setShowRelated(v => !v)}
            aria-expanded={showRelated}
          >
            {showRelated ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {t('knowledge.relatedSources')}（{relatedSources.length}）
          </button>
          {showRelated && (
            <ul className="search-source-list">
              {relatedSources.map(({ source, index }) =>
                renderSourceCard(source, index)
              )}
            </ul>
          )}
        </section>
      )}

      {/* exact 模式：所有结果平铺 */}
      {result.mode === 'exact' && (
        <section aria-label={t('knowledge.sourceResults')}>
          <div className="search-sources-heading">{t('knowledge.sourceResults')}（{result.sources.length}）</div>
          <ul className="search-source-list">
            {result.sources.map((source, index) => renderSourceCard(source, index))}
          </ul>
        </section>
      )}
    </>
  )
}
