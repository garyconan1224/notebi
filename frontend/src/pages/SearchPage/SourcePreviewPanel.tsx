import { ChevronLeft, ChevronRight, ExternalLink, FileSearch } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { KnowledgeSourceSnapshot } from '@/types/knowledgeConversation'

interface Props {
  sources: KnowledgeSourceSnapshot[]
  activeSourceId: string | null
  onSelect: (sourceId: string) => void
}

function formatTime(startMs?: number | null) {
  if (startMs == null) return ''
  const seconds = Math.floor(startMs / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

export function SourcePreviewPanel({
  sources,
  activeSourceId,
  onSelect,
}: Props) {
  const index = Math.max(
    0,
    sources.findIndex(source => source.source_id === activeSourceId),
  )
  const source = sources[index]
  return (
    <aside className="knowledge-source-preview" aria-label="来源预览">
      <div className="knowledge-panel-heading">
        <div>
          <span>EVIDENCE</span>
          <strong>来源预览</strong>
        </div>
        {sources.length > 0 && <small>{index + 1} / {sources.length}</small>}
      </div>
      {!source ? (
        <div className="knowledge-source-empty">
          <FileSearch size={22} />
          <p>点击回答中的引用或来源，在这里核对原文。</p>
        </div>
      ) : (
        <div className="knowledge-source-card">
          <div className="knowledge-source-nav">
            <button
              type="button"
              aria-label="上一个来源"
              disabled={index === 0}
              onClick={() => onSelect(sources[index - 1].source_id)}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              aria-label="下一个来源"
              disabled={index >= sources.length - 1}
              onClick={() => onSelect(sources[index + 1].source_id)}
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="knowledge-source-meta">
            <span>{source.workspace_name || '未命名合集'}</span>
            <span>{source.item_type || source.source_type || '内容'}</span>
            {source.start_ms != null && <span>{formatTime(source.start_ms)}</span>}
          </div>
          <h3>{source.item_title || source.title || '未命名来源'}</h3>
          <p>{source.excerpt || source.chunk_excerpt || '暂无可预览片段'}</p>
          {typeof source.score === 'number' && (
            <small>匹配分 {source.score.toFixed(2)}</small>
          )}
          {source.jump_url && (
            <Link to={source.jump_url} className="knowledge-source-open">
              <ExternalLink size={14} />
              在笔记中打开
            </Link>
          )}
        </div>
      )}
    </aside>
  )
}
