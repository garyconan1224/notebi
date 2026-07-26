import { useMemo, useState } from 'react'
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [activeSource, setActiveSource] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [showRelated, setShowRelated] = useState(false)

  const citations = result.citations ?? []

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
      toast.success(favorite ? '已取消收藏' : '已加入收藏夹')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '收藏状态更新失败')
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
              <span>[{label ?? index + 1}] {source.item_title || '（无标题）'}</span>
              <span className="search-source-actions">
                <button
                  onClick={() => toggleFavorite(source)}
                  disabled={saving === source.source_id}
                  aria-label={favorite ? '取消收藏' : '收藏来源'}
                  data-active={favorite}
                >
                  <Bookmark size={14} fill={favorite ? 'currentColor' : 'none'} />
                </button>
                <Link to={source.jump_url} aria-label="跳转到原文">
                  <ExternalLink size={14} />
                </Link>
              </span>
            </div>
            <div className="search-source-meta">
              <span className="search-source-badge">
                {ITEM_TYPE_TEXT[source.item_type] ?? source.item_type}
              </span>
              <span>{source.workspace_name}</span>
              <span>{source.field === 'transcript' ? '转写原文' : '内容原文'}</span>
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
                next.has(source.source_id)
                  ? next.delete(source.source_id)
                  : next.add(source.source_id)
                return next
              })}
            >
              {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {open ? '收起定位信息' : '展开定位信息'}
            </button>
          </div>
        </article>
      </li>
    )
  }

  return (
    <>
      {result.mode !== 'exact' && (
        <section className="search-answer" aria-label="知识库回答">
          <div className="search-answer-label">知识库回答</div>
          <div className="search-answer-body">{result.answer || '（模型未返回内容）'}</div>
          {citations.length > 0 ? (
            <div className="search-citations" aria-label="回答引用">
              {citations.map(citation => (
                <button
                  key={citation.source_id}
                  className="search-citation-chip"
                  onClick={() => focusSource(
                    result.sources.findIndex(s => s.source_id === citation.source_id)
                  )}
                  aria-label={`查看来源 ${citation.number}`}
                >
                  [{citation.number}]
                </button>
              ))}
            </div>
          ) : (
            result.answer && (
              <p className="search-no-citations">本回答未包含可核验的引用标记。</p>
            )
          )}
        </section>
      )}

      {/* 引用来源 */}
      {citedSources.length > 0 && (
        <section aria-label="引用来源">
          <div className="search-sources-heading">引用来源（{citedSources.length}）</div>
          <ul className="search-source-list">
            {citedSources.map(({ source, index, number }) =>
              renderSourceCard(source, index, number)
            )}
          </ul>
        </section>
      )}

      {/* 相关原文（默认折叠） */}
      {relatedSources.length > 0 && (
        <section aria-label="相关原文">
          <button
            className="search-related-toggle"
            onClick={() => setShowRelated(v => !v)}
            aria-expanded={showRelated}
          >
            {showRelated ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            相关原文（{relatedSources.length}）
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
        <section aria-label="原文结果">
          <div className="search-sources-heading">原文结果（{result.sources.length}）</div>
          <ul className="search-source-list">
            {result.sources.map((source, index) => renderSourceCard(source, index))}
          </ul>
        </section>
      )}
    </>
  )
}
