import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { favoriteItem, unfavoriteItem } from '@/services/workspaces'
import type { SearchResponse } from '@/services/search'
import { ITEM_TYPE_TEXT, type WorkspaceRecord } from '@/types/workspace'

const TYPE_ICON: Record<string, string> = {
  video: '🎬',
  image: '🖼️',
  audio: '🎙️',
  text: '📝',
}

interface Props {
  result: SearchResponse
  workspaces: WorkspaceRecord[]
  onWorkspaceChange: (record: WorkspaceRecord) => void
}

function isFavorite(source: SearchResponse['sources'][number], workspaces: WorkspaceRecord[]) {
  return workspaces
    .find(workspace => workspace.workspace_id === source.workspace_id)
    ?.favorites.includes(source.item_id) ?? false
}

export function SearchResultView({ result, workspaces, onWorkspaceChange }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [activeSource, setActiveSource] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const focusSource = (index: number) => {
    const source = result.sources[index]
    if (!source) return
    setActiveSource(source.source_id)
    document.getElementById(`search-source-${index + 1}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }

  const toggleFavorite = async (source: SearchResponse['sources'][number]) => {
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

  return (
    <>
      {result.mode !== 'exact' && (
        <section className="search-answer" aria-label="智能回答">
          <div className="search-answer-label">智能回答</div>
          <div className="search-answer-body">{result.answer || '（模型未返回内容）'}</div>
          {result.sources.length > 0 && (
          <div className="search-citations" aria-label="回答引用">
            {result.sources.map((source, index) => (
              <button
                key={`${source.source_id}-${index}`}
                className="search-citation-chip"
                onClick={() => focusSource(index)}
                aria-label={`查看来源 ${index + 1}`}
              >
                [{index + 1}]
              </button>
            ))}
          </div>
          )}
        </section>
      )}

      <section aria-label="原文来源">
        <div className="search-sources-heading">
          {result.mode === 'exact' ? '原文结果' : '原文来源'}（{result.sources.length}）
        </div>
        <ul className="search-source-list">
          {result.sources.map((source, index) => {
            const open = expanded.has(source.source_id)
            const favorite = isFavorite(source, workspaces)
            return (
              <li
                id={`search-source-${index + 1}`}
                key={`${source.source_id}-${source.segment_id}-${index}`}
                className={activeSource === source.source_id ? 'is-highlighted' : ''}
              >
                <article className="search-source-item">
                  <div className="search-source-cover">{TYPE_ICON[source.item_type] ?? '📄'}</div>
                  <div className="search-source-info">
                    <div className="search-source-title">
                      <span>[{index + 1}] {source.item_title || '（无标题）'}</span>
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
          })}
        </ul>
      </section>
    </>
  )
}
