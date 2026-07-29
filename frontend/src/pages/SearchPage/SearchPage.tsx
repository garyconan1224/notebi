import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  createKnowledgeConversation,
  deleteKnowledgeConversation,
  getKnowledgeConversation,
  getKnowledgeStatus,
  listKnowledgeConversations,
  rebuildKnowledge,
  regenerateKnowledgeMessage,
  searchKnowledgeOriginals,
  updateKnowledgeConversation,
  type KnowledgeStatus,
} from '@/services/knowledge'
import { sendKnowledgeMessage } from '@/services/knowledgeStream'
import type { SearchResponse } from '@/services/search'
import { listWorkspaces } from '@/services/workspaces'
import type {
  KnowledgeConversation,
  KnowledgeMessage,
  KnowledgeSourceSnapshot,
} from '@/types/knowledgeConversation'
import type { WorkspaceRecord } from '@/types/workspace'
import { ConversationSidebar } from './ConversationSidebar'
import { KnowledgeComposer } from './KnowledgeComposer'
import {
  KnowledgeScopePicker,
  loadPersistedScope,
  persistScope,
  type KnowledgeScope,
} from './KnowledgeScopePicker'
import { SearchResultView } from './SearchResultView'
import { SourcePreviewPanel } from './SourcePreviewPanel'

import './search.css'

function scopeIds(scope: KnowledgeScope): string[] | undefined {
  return scope.type === 'all' ? undefined : [...new Set(scope.workspaceIds)]
}

function newestAssistantSources(
  conversation: KnowledgeConversation | null,
): KnowledgeSourceSnapshot[] {
  if (!conversation) return []
  return [...conversation.messages]
    .reverse()
    .find(message => message.role === 'assistant' && message.sources.length)
    ?.sources ?? []
}

function messageSourceLabel(source: KnowledgeSourceSnapshot) {
  return source.item_title || source.title || source.excerpt || '来源'
}

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const initialized = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [status, setStatus] = useState<KnowledgeStatus | null>(null)
  const [conversations, setConversations] = useState<KnowledgeConversation[]>([])
  const [activeConversation, setActiveConversation] =
    useState<KnowledgeConversation | null>(null)
  const [scope, setScope] = useState<KnowledgeScope>({
    type: 'all',
    workspaceIds: [],
  })
  const [mode, setMode] = useState<'smart' | 'exact'>('smart')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [phase, setPhase] =
    useState<'idle' | 'retrieving' | 'generating' | 'failed'>('idle')
  const [pendingQuestion, setPendingQuestion] = useState('')
  const [streamText, setStreamText] = useState('')
  const [streamSources, setStreamSources] =
    useState<KnowledgeSourceSnapshot[]>([])
  const [exactResult, setExactResult] = useState<SearchResponse | null>(null)
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [lastError, setLastError] = useState('')

  const selectConversation = useCallback(async (conversationId: string) => {
    try {
      const conversation = await getKnowledgeConversation(conversationId)
      setActiveConversation(conversation)
      setScope(
        conversation.default_scope.length
          ? { type: 'selected', workspaceIds: conversation.default_scope }
          : { type: 'all', workspaceIds: [] },
      )
      const sources = newestAssistantSources(conversation)
      setStreamSources(sources)
      setActiveSourceId(sources[0]?.source_id ?? null)
      setExactResult(null)
      setStreamText('')
      setPendingQuestion('')
      setLastError('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载会话失败')
    }
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    void (async () => {
      try {
        const [records, currentStatus, conversationPage] = await Promise.all([
          listWorkspaces(),
          getKnowledgeStatus(),
          listKnowledgeConversations(),
        ])
        setWorkspaces(records)
        setStatus(currentStatus)
        setConversations(conversationPage.items)
        const validIds = new Set(records.map(record => record.workspace_id))
        const urlIds = (searchParams.get('workspace_ids') ?? '')
          .split(',')
          .filter(id => validIds.has(id))
        const requestedNew = searchParams.get('new') === '1'
        if (requestedNew) {
          const nextScope: KnowledgeScope = urlIds.length
            ? { type: 'selected', workspaceIds: [...new Set(urlIds)] }
            : loadPersistedScope(records)
          setScope(nextScope)
          const created = await createKnowledgeConversation(
            '新会话',
            scopeIds(nextScope) ?? [],
          )
          setConversations(previous => [
            created,
            ...previous.filter(item => item.conversation_id !== created.conversation_id),
          ])
          setActiveConversation(created)
        } else if (conversationPage.items[0]) {
          const full = await getKnowledgeConversation(
            conversationPage.items[0].conversation_id,
          )
          setActiveConversation(full)
          const nextScope = full.default_scope.length
            ? { type: 'selected' as const, workspaceIds: full.default_scope }
            : loadPersistedScope(records)
          setScope(nextScope)
          const sources = newestAssistantSources(full)
          setStreamSources(sources)
          setActiveSourceId(sources[0]?.source_id ?? null)
        } else {
          setScope(
            urlIds.length
              ? { type: 'selected', workspaceIds: [...new Set(urlIds)] }
              : loadPersistedScope(records),
          )
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '加载知识库失败')
      }
    })()
  }, [searchParams])

  const handleScopeChange = useCallback((next: KnowledgeScope) => {
    setScope(next)
    persistScope(next)
    if (activeConversation) {
      void updateKnowledgeConversation(activeConversation.conversation_id, {
        defaultScope: scopeIds(next) ?? [],
      }).then(updated => {
        setActiveConversation(updated)
        setConversations(previous => previous.map(item => (
          item.conversation_id === updated.conversation_id ? updated : item
        )))
      }).catch(error => {
        toast.error(error instanceof Error ? error.message : '保存会话范围失败')
      })
    }
  }, [activeConversation])

  const createConversation = useCallback(async () => {
    try {
      const created = await createKnowledgeConversation(
        '新会话',
        scopeIds(scope) ?? [],
      )
      setConversations(previous => [
        created,
        ...previous.filter(item => item.conversation_id !== created.conversation_id),
      ])
      setActiveConversation(created)
      setStreamText('')
      setStreamSources([])
      setExactResult(null)
      setActiveSourceId(null)
      setLastError('')
      return created
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '新建会话失败')
      return null
    }
  }, [scope])

  const removeConversation = useCallback(async (conversationId: string) => {
    if (!window.confirm('只删除这段问答记录，不会删除合集、素材或索引。继续吗？')) return
    try {
      await deleteKnowledgeConversation(conversationId)
      const next = conversations.filter(
        item => item.conversation_id !== conversationId,
      )
      setConversations(next)
      if (activeConversation?.conversation_id === conversationId) {
        setActiveConversation(null)
        setStreamSources([])
        setActiveSourceId(null)
        if (next[0]) await selectConversation(next[0].conversation_id)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除会话失败')
    }
  }, [activeConversation, conversations, selectConversation])

  const runQuery = useCallback(async () => {
    const question = query.trim()
    if (!question) return
    if (scope.type === 'selected' && scope.workspaceIds.length === 0) {
      toast.warning('请至少选择一个合集')
      return
    }
    setLastError('')
    setExactResult(null)
    setStreamText('')
    setStreamSources([])
    setActiveSourceId(null)
    setPendingQuestion(question)
    setLoading(true)
    setQuery('')

    if (mode === 'exact') {
      try {
        const result = await searchKnowledgeOriginals(
          question,
          scopeIds(scope),
        )
        setExactResult(result)
        setStreamSources(result.sources)
        setActiveSourceId(result.sources[0]?.source_id ?? null)
      } catch (error) {
        const message = error instanceof Error ? error.message : '原文搜索失败'
        setLastError(message)
        toast.error(message)
      } finally {
        setLoading(false)
        setPhase('idle')
      }
      return
    }

    const conversation = activeConversation ?? await createConversation()
    if (!conversation) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('retrieving')
    try {
      await sendKnowledgeMessage({
        conversationId: conversation.conversation_id,
        question,
        workspaceIds: scopeIds(scope),
        signal: controller.signal,
        onStatus: stage => setPhase(stage),
        onSources: sources => {
          setStreamSources(sources)
          setActiveSourceId(sources[0]?.source_id ?? null)
        },
        onDelta: text => setStreamText(previous => previous + text),
        onDone: message => {
          setStreamText(message.content)
          setStreamSources(message.sources)
          setActiveSourceId(message.sources[0]?.source_id ?? null)
        },
      })
      try {
        const refreshed = await getKnowledgeConversation(
          conversation.conversation_id,
        )
        setActiveConversation(refreshed)
        setConversations(previous => [
          refreshed,
          ...previous.filter(
            item => item.conversation_id !== refreshed.conversation_id,
          ),
        ])
        const persistedTurn = refreshed.messages.some(message => (
          message.role === 'user' && message.query_text === question
        ))
        if (persistedTurn) {
          setPendingQuestion('')
          setStreamText('')
        }
      } catch {
        // The completed streamed answer is already visible; refresh can retry later.
      }
      setPhase('idle')
    } catch (error) {
      const message = error instanceof Error ? error.message : '知识库回答失败'
      if (!controller.signal.aborted) {
        setLastError(message)
        setPhase('failed')
        toast.error(message)
      } else {
        setPhase('idle')
      }
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }, [activeConversation, createConversation, mode, query, scope])

  const retryMessage = useCallback(async (message: KnowledgeMessage) => {
    if (!activeConversation) return
    try {
      const regenerated = await regenerateKnowledgeMessage(
        activeConversation.conversation_id,
        message.message_id,
      )
      const refreshed = await getKnowledgeConversation(
        activeConversation.conversation_id,
      )
      setActiveConversation(refreshed)
      setStreamSources(regenerated.sources)
      setActiveSourceId(regenerated.sources[0]?.source_id ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重新生成失败')
    }
  }, [activeConversation])

  const refreshIndex = useCallback(async () => {
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
  }, [])

  const updateWorkspace = useCallback((record: WorkspaceRecord) => {
    setWorkspaces(previous => previous.map(item => (
      item.workspace_id === record.workspace_id ? record : item
    )))
  }, [])

  const visibleSources = useMemo(
    () => exactResult?.sources ?? (
      streamSources.length
        ? streamSources
        : newestAssistantSources(activeConversation)
    ),
    [activeConversation, exactResult, streamSources],
  )

  return (
    <div className="nibi-search-scope knowledge-workspace">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeConversation?.conversation_id ?? null}
        onSelect={conversationId => void selectConversation(conversationId)}
        onNew={() => void createConversation()}
        onDelete={conversationId => void removeConversation(conversationId)}
      />

      <main className="knowledge-message-column" aria-label="知识库消息">
        <header className="knowledge-toolbar">
          <div>
            <span className="search-kicker">KNOWLEDGE · EVIDENCE FIRST</span>
            <h1>知识库</h1>
          </div>
          <div className="knowledge-toolbar-actions">
            <KnowledgeScopePicker
              workspaces={workspaces}
              scope={scope}
              onChange={handleScopeChange}
            />
            <div className="search-mode-group" aria-label="检索方式">
              <button
                type="button"
                aria-pressed={mode === 'smart'}
                data-active={mode === 'smart'}
                onClick={() => setMode('smart')}
              >
                问知识库
              </button>
              <button
                type="button"
                aria-label="找原文"
                aria-pressed={mode === 'exact'}
                data-active={mode === 'exact'}
                onClick={() => setMode('exact')}
              >
                找原文
              </button>
            </div>
            <button
              type="button"
              className="search-index-status"
              onClick={() => void refreshIndex()}
              disabled={refreshing || status?.running}
            >
              <RefreshCw
                size={13}
                className={refreshing || status?.running ? 'animate-spin' : ''}
              />
              {status?.ready ? '索引已就绪' : status?.running ? '索引构建中' : '刷新索引'}
            </button>
          </div>
        </header>

        <section className="knowledge-message-list">
          {!activeConversation && !pendingQuestion && !exactResult && (
            <div className="knowledge-welcome">
              <h2>从一个具体问题开始</h2>
              <p>每轮都会按当前合集范围重新检索，并保存当时的来源快照。</p>
            </div>
          )}
          {activeConversation?.messages.map(message => (
            <article
              className={`knowledge-message knowledge-message-${message.role}`}
              key={message.message_id}
            >
              <div className="knowledge-message-role">
                {message.role === 'user' ? '你' : 'NoteBi'}
              </div>
              {message.status === 'insufficient_evidence' ? (
                <p>现有合集中没有足够证据。</p>
              ) : (
                <p>{message.content || (
                  message.status === 'failed' ? message.error : '处理中…'
                )}</p>
              )}
              {message.role === 'assistant' && message.sources.length > 0 && (
                <div className="knowledge-message-sources">
                  {message.sources.map((source, index) => (
                    <button
                      type="button"
                      key={source.source_id}
                      onClick={() => setActiveSourceId(source.source_id)}
                      aria-label={`查看来源 ${index + 1}`}
                    >
                      [{index + 1}] {messageSourceLabel(source)}
                    </button>
                  ))}
                </div>
              )}
              {message.role === 'assistant' && (
                <button
                  type="button"
                  className="knowledge-regenerate"
                  onClick={() => void retryMessage(message)}
                >
                  <RotateCcw size={12} /> 重新生成
                </button>
              )}
            </article>
          ))}
          {pendingQuestion && (
            <article className="knowledge-message knowledge-message-user knowledge-pending">
              <div className="knowledge-message-role">你</div>
              <p>{pendingQuestion}</p>
            </article>
          )}
          {(loading || streamText || lastError) && mode === 'smart' && (
            <article className="knowledge-message knowledge-message-assistant knowledge-pending">
              <div className="knowledge-message-role">NoteBi</div>
              {loading && (
                <div className="knowledge-progress" aria-label="回答进度">
                  <span data-active>正在检索</span>
                  {streamSources.length > 0 && (
                    <span data-active>找到 {streamSources.length} 个来源</span>
                  )}
                  {phase === 'generating' && <span data-active>正在生成</span>}
                </div>
              )}
              {!loading && streamSources.length > 0 && (
                <div className="knowledge-progress">
                  <span data-active>找到 {streamSources.length} 个来源</span>
                </div>
              )}
              {streamText && <p>{streamText}</p>}
              {lastError && (
                <div className="knowledge-error">
                  <p>{lastError}</p>
                  <button type="button" onClick={() => {
                    setQuery(pendingQuestion)
                    setLastError('')
                  }}>
                    重试
                  </button>
                </div>
              )}
              {streamSources.length > 0 && (
                <div className="knowledge-message-sources">
                  {streamSources.map((source, index) => (
                    <button
                      type="button"
                      key={source.source_id}
                      onClick={() => setActiveSourceId(source.source_id)}
                      aria-label={`查看来源 ${index + 1}`}
                    >
                      [{index + 1}] {messageSourceLabel(source)}
                    </button>
                  ))}
                </div>
              )}
            </article>
          )}
          {exactResult && (
            <SearchResultView
              result={exactResult}
              workspaces={workspaces}
              onWorkspaceChange={updateWorkspace}
            />
          )}
        </section>

        <KnowledgeComposer
          value={query}
          mode={mode}
          loading={loading}
          disabled={scope.type === 'selected' && scope.workspaceIds.length === 0}
          onChange={setQuery}
          onSubmit={() => void runQuery()}
          onStop={() => abortRef.current?.abort()}
        />
      </main>

      <SourcePreviewPanel
        sources={visibleSources}
        activeSourceId={activeSourceId}
        onSelect={setActiveSourceId}
      />
    </div>
  )
}
