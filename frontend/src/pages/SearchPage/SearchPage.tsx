import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Search as SearchIcon, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { toast } from 'sonner'

import { listWorkspaces } from '@/services/workspaces'
import { searchGlobal, searchWorkspace, type SearchResponse } from '@/services/search'
import { ITEM_TYPE_TEXT, type WorkspaceRecord } from '@/types/workspace'
import {
  getProductStorageItem,
  setProductStorageItem,
} from '@/config/product'

import './search.css'

/* ── localStorage 搜索历史 ── */
const HISTORY_KEY = 'nibi_search_history'
const MAX_HISTORY = 12

function loadHistory(): string[] {
  try {
    return JSON.parse(getProductStorageItem('search_history', HISTORY_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveToHistory(q: string) {
  const list = loadHistory().filter(s => s !== q)
  list.unshift(q)
  setProductStorageItem('search_history', JSON.stringify(list.slice(0, MAX_HISTORY)))
}

/* ── 类型图标映射 ── */
const TYPE_ICON: Record<string, string> = {
  video: '🎬',
  image: '🖼️',
  audio: '🎙️',
  text: '📝',
}

/* ── scope key ── */
type ScopeKey = '__all__' | string

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<ScopeKey>('__all__')
  const [mode, setMode] = useState<'semantic' | 'keyword'>('semantic')
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [history, setHistory] = useState<string[]>(loadHistory)

  useEffect(() => {
    listWorkspaces()
      .then(setWorkspaces)
      .catch(err => {
        console.error(err)
        toast.error('加载合集列表失败')
      })
  }, [])

  const doSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (!trimmed) {
        toast.warning('请输入查询内容')
        return
      }
      setLoading(true)
      setSubmitted(true)
      setResult(null)
      setQuery(trimmed)
      saveToHistory(trimmed)
      setHistory(loadHistory())
      try {
        const data =
          scope === '__all__'
            ? await searchGlobal(trimmed, { topK: 10 })
            : await searchWorkspace(scope, trimmed, 5)
        setResult(data)
      } catch (err) {
        console.error(err)
        const msg = err instanceof Error ? err.message : '检索失败'
        toast.error(msg)
      } finally {
        setLoading(false)
      }
    },
    [scope],
  )

  function handleSearch() {
    doSearch(query)
  }

  function handleHistoryClick(q: string) {
    setQuery(q)
    doSearch(q)
  }

  /* ── Hero ── */
  const hero = (
    <div className="search-hero">
      <div className="search-hero-inner">
        <span className="search-kicker">AI Search · RAG Powered</span>
        <h1 className="search-title">语义搜索，跨库全局检索</h1>
        <p className="search-subtitle">
          基于 RAG 的跨合集语义检索，返回带引用的综合回答与可跳转的来源片段。
        </p>

        <div className="search-input-row">
          <div className="search-input-wrap">
            <SearchIcon size={16} />
            <input
              className="search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !loading) handleSearch()
              }}
              placeholder="输入问题，例如：发布会上提到了哪些产品特性？"
              disabled={loading}
            />
          </div>
          <button
            className="search-btn"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                检索中
              </>
            ) : (
              '搜索'
            )}
          </button>
        </div>

        <div className="search-options">
          <select
            className="search-scope-select"
            value={scope}
            onChange={e => setScope(e.target.value as ScopeKey)}
          >
            <option value="__all__">全部合集</option>
            {workspaces.map(ws => (
              <option key={ws.workspace_id} value={ws.workspace_id}>
                {ws.name}
              </option>
            ))}
          </select>

          {/* 语义/关键词模式 — 服务端暂不支持 mode，先占位 disabled */}
          <div className="search-mode-group">
            <button
              className="search-mode-btn"
              data-active={mode === 'semantic'}
              onClick={() => setMode('semantic')}
              disabled
              title="服务端暂未支持模式切换，后续接入"
            >
              语义
            </button>
            <button
              className="search-mode-btn"
              data-active={mode === 'keyword'}
              onClick={() => setMode('keyword')}
              disabled
              title="服务端暂未支持模式切换，后续接入"
            >
              关键词
            </button>
          </div>

          <span className="search-rag-badge">
            <Sparkles size={10} />
            RAG
          </span>
        </div>
      </div>
    </div>
  )

  /* ── 结果 ── */
  const results = (
    <div className="search-results">
      <div className="search-results-inner">
        {/* 加载态 */}
        {loading && (
          <div className="search-skeleton">
            <div className="search-skeleton-line" />
            <div className="search-skeleton-line" style={{ width: '75%' }} />
            <div className="search-skeleton-line" style={{ width: '50%' }} />
          </div>
        )}

        {/* 未搜索空态 */}
        {!loading && !submitted && (
          <>
            <SearchEmpty
              icon={<SearchIcon size={20} />}
              title="开始你的第一次检索"
              desc="在上方输入框中输入问题，按回车或点击搜索。"
            />
            {history.length > 0 && (
              <SearchHistory items={history} onClick={handleHistoryClick} />
            )}
          </>
        )}

        {/* 有结果 */}
        {!loading && submitted && result && (
          <SearchResultView result={result} onHistoryClick={handleHistoryClick} history={history} />
        )}

        {/* 无结果 */}
        {!loading && submitted && !result && (
          <SearchEmpty
            icon={<SearchIcon size={20} />}
            title="未返回结果"
            desc="可能是网络异常或后端报错，请查看控制台或稍后重试。"
          />
        )}
      </div>
    </div>
  )

  return (
    <div className="nibi-search-scope">
      {hero}
      {results}
    </div>
  )
}

/* ── 结果子组件 ── */

function SearchResultView({
  result,
  onHistoryClick,
  history,
}: {
  result: SearchResponse
  onHistoryClick: (q: string) => void
  history: string[]
}) {
  return (
    <>
      {/* AI 综合回答 */}
      <div className="search-answer">
        <div className="search-answer-label">AI 综合回答</div>
        <div className="search-answer-body">
          <ReactMarkdown>{result.answer || '（模型未返回内容）'}</ReactMarkdown>
        </div>
      </div>

      {/* 引用 citations */}
      {result.sources.length > 0 && (
        <div>
          <div className="search-citations">
            {result.sources.map((_, idx) => (
              <span key={idx} className="search-citation-chip">
                [{idx + 1}]
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 来源文档 */}
      <div>
        <div className="search-sources-heading">
          来源文档（{result.sources.length}）
        </div>
        {result.sources.length === 0 ? (
          <SearchEmpty
            icon={<SearchIcon size={20} />}
            title="无引用来源"
            desc="模型未能在选定范围内匹配到相关片段。"
          />
        ) : (
          <ul className="search-source-list">
            {result.sources.map((s, idx) => (
              <li key={`${s.workspace_id}-${s.item_id}-${idx}`}>
                <Link to={s.jump_url} className="search-source-item">
                  <div className="search-source-cover">
                    {TYPE_ICON[s.item_type] ?? '📄'}
                  </div>
                  <div className="search-source-info">
                    <div className="search-source-title">
                      {s.item_title || '（无标题）'}
                    </div>
                    <div className="search-source-meta">
                      <span className="search-source-badge">
                        {ITEM_TYPE_TEXT[s.item_type] ?? s.item_type}
                      </span>
                      <span>{s.workspace_name}</span>
                    </div>
                    {s.chunk_excerpt && (
                      <div className="search-source-excerpt">{s.chunk_excerpt}</div>
                    )}
                    <div className="search-score-bar-wrap">
                      <div className="search-score-bar-track">
                        <div
                          className="search-score-bar-fill"
                          style={{ width: `${Math.min(s.score * 100, 100)}%` }}
                        />
                      </div>
                      <span className="search-score-label">{s.score.toFixed(2)}</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 最近搜索 */}
      {history.length > 0 && (
        <SearchHistory items={history} onClick={onHistoryClick} />
      )}
    </>
  )
}

function SearchEmpty({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <div className="search-empty">
      <div className="search-empty-icon">{icon}</div>
      <div className="search-empty-title">{title}</div>
      <div className="search-empty-desc">{desc}</div>
    </div>
  )
}

function SearchHistory({
  items,
  onClick,
}: {
  items: string[]
  onClick: (q: string) => void
}) {
  return (
    <div className="search-history">
      <div className="search-history-label">最近搜索</div>
      <div className="search-history-chips">
        {items.map(q => (
          <button key={q} className="search-history-chip" onClick={() => onClick(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
