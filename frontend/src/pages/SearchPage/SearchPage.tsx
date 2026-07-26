import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Search as SearchIcon, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { getProductStorageItem, setProductStorageItem } from '@/config/product'
import { getKnowledgeStatus, rebuildKnowledge, type KnowledgeStatus } from '@/services/knowledge'
import { searchGlobal, type SearchResponse } from '@/services/search'
import { listWorkspaces } from '@/services/workspaces'
import type { WorkspaceRecord } from '@/types/workspace'
import { SearchResultView } from './SearchResultView'
import { SearchEmptyState } from './SearchEmptyState'
import { useSearchSuggestions } from './useSearchSuggestions'
import {
  KnowledgeScopePicker,
  loadPersistedScope,
  persistScope,
  type KnowledgeScope,
} from './KnowledgeScopePicker'

import './search.css'

const HISTORY_KEY = 'nibi_search_history'
const MAX_HISTORY = 12

function loadHistory(): string[] {
  try {
    return JSON.parse(getProductStorageItem('search_history', HISTORY_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveHistory(query: string): string[] {
  const next = [query, ...loadHistory().filter(item => item !== query)].slice(0, MAX_HISTORY)
  setProductStorageItem('search_history', JSON.stringify(next))
  return next
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<KnowledgeScope>({ type: 'all', workspaceIds: [] })
  const [mode, setMode] = useState<'smart' | 'exact'>('smart')
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [status, setStatus] = useState<KnowledgeStatus | null>(null)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [history, setHistory] = useState(loadHistory)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const suggestions = useSearchSuggestions(query)

  const loadInitial = useCallback(async () => {
    try {
      const [records, currentStatus] = await Promise.all([listWorkspaces(), getKnowledgeStatus()])
      setWorkspaces(records)
      setStatus(currentStatus)
      // 从 localStorage 恢复范围，过滤已不存在的 ID
      setScope(loadPersistedScope(records))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载知识库状态失败')
    }
  }, [])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  const handleScopeChange = useCallback((next: KnowledgeScope) => {
    setScope(next)
    persistScope(next)
  }, [])

  const runSearch = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      toast.warning('请输入要查找的问题')
      return
    }
    if (scope.type === 'selected' && scope.workspaceIds.length === 0) {
      toast.warning('请至少选择一个合集')
      return
    }
    setLoading(true)
    setResult(null)
    setHistory(saveHistory(trimmed))
    try {
      const response = await searchGlobal(trimmed, {
        mode,
        topK: 10,
        workspaceIds: scope.type === 'all' ? undefined : [...new Set(scope.workspaceIds)],
      })
      setResult(response)
      if (response.status) setStatus(response.status)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '知识库检索失败')
    } finally {
      setLoading(false)
    }
  }, [mode, scope])

  const refreshIndex = async () => {
    setRefreshing(true)
    try {
      const next = await rebuildKnowledge(true)
      setStatus(next)
      toast.success('索引刷新已开始')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '索引刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  const updateWorkspace = (record: WorkspaceRecord) => {
    setWorkspaces(previous => previous.map(item => (
      item.workspace_id === record.workspace_id ? record : item)))
  }

  return (
    <div className="nibi-search-scope">
      <header className="search-hero">
        <div className="search-hero-inner">
          <span className="search-kicker">Knowledge Base · Evidence First</span>
          <h1 className="search-title">知识库</h1>
          <p className="search-subtitle">先给出答案，再把每条结论落回可跳转的原文证据。</p>
          <div className="search-input-row">
            <div className="search-input-wrap">
              <SearchIcon size={16} />
              <input
                className="search-input"
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !loading) void runSearch(query)
                }}
                placeholder="例如：哪些内容提到了离线搜索？"
                list="nibi-search-suggestions"
                disabled={loading}
              />
              <datalist id="nibi-search-suggestions">
                {suggestions.map(suggestion => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </div>
            <button
              className="search-btn"
              aria-label="执行知识库检索"
              onClick={() => void runSearch(query)}
              disabled={loading || !query.trim()}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {loading ? '检索中' : mode === 'smart' ? '问知识库' : '查找原文'}
            </button>
          </div>
          <div className="search-options">
            <KnowledgeScopePicker
              workspaces={workspaces}
              scope={scope}
              onChange={handleScopeChange}
            />
            <div className="search-mode-group" aria-label="检索方式">
              <button className="search-mode-btn" data-active={mode === 'smart'}
                type="button" aria-pressed={mode === 'smart'}
                onClick={() => setMode('smart')}>
                问知识库
              </button>
              <button className="search-mode-btn" data-active={mode === 'exact'}
                type="button" aria-pressed={mode === 'exact'}
                onClick={() => setMode('exact')}>
                查找原文
              </button>
            </div>
            <button
              className="search-index-status"
              onClick={() => void refreshIndex()}
              disabled={refreshing || status?.running}
              title="刷新检索索引"
            >
              <RefreshCw size={12} className={refreshing || status?.running ? 'animate-spin' : ''} />
              {status?.ready ? '索引已就绪' : status?.running ? '索引构建中' : '刷新索引'}
            </button>
          </div>
        </div>
      </header>

      <main className="search-results">
        <div className="search-results-inner">
          {loading && <div className="search-skeleton" aria-label="检索中" />}
          {!loading && result && (
            <SearchResultView
              result={result}
              workspaces={workspaces}
              onWorkspaceChange={updateWorkspace}
            />
          )}
          {!loading && !result && (
            <SearchEmptyState history={history} onQuery={setQuery}
              onSearch={item => void runSearch(item)} />
          )}
        </div>
      </main>
    </div>
  )
}
