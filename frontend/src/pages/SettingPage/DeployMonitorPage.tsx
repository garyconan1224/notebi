import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  Pause,
  Play,
} from 'lucide-react'

import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { StatusBadge } from '@/components/ui/status-badge'
import { useHealthPulse } from '@/hooks/useHealthPulse'
import http from '@/services/client'
import { useTranslation } from 'react-i18next'

import './deploy-monitor.css'

/**
 * S6 — 诊断日志。
 *
 * 与后端 LogEvent 对齐：结构化字段均为可选，旧日志缺少这些字段时
 * 用 message 作为摘要，技术细节收进每条事件的可展开详情。
 */
interface LogEntry {
  id: number
  timestamp: string
  level: string
  category: string
  message: string
  task_id?: string
  batch_id?: string
  workspace_id?: string
  stage?: string
  progress?: number
  duration_ms?: number
  retry_count?: number
  details?: { task_type?: string; task_title?: string; source_type?: string }
  // ── S6 结构化诊断字段（可选）──────────────────────────────
  event_code?: string
  operation?: string
  component?: string
  outcome?: string
  summary?: string
  probable_cause?: string
  suggested_action?: string
  error_code?: string
  retry_max?: number
  engine?: string
  provider?: string
  model?: string
  device?: string
  correlation_id?: string
  technical_detail?: string
}

interface LogsResponse {
  entries: LogEntry[]
  latest_id: number
  oldest_id: number
  has_more_older: boolean
}

const STAGE_KEYS: Record<string, string> = {
  PENDING: 'monitor.stage.pending',
  DOWNLOAD: 'monitor.stage.download',
  PROBE: 'monitor.stage.probe',
  FRAMES: 'monitor.stage.frames',
  ASR: 'monitor.stage.asr',
  VLM: 'monitor.stage.vlm',
  DIARIZATION: 'monitor.stage.diarization',
  SUM: 'monitor.stage.sum',
  SUMMARY: 'monitor.stage.sum',
  STORE: 'monitor.stage.store',
}

const LOG_POLL_MS = 2000

/** 合并初始页、增量轮询和向前翻页结果，避免并发响应重复插入同一日志。 */
export function mergeLogEntries(...groups: LogEntry[][]): LogEntry[] {
  const byId = new Map<number, LogEntry>()
  for (const entries of groups) {
    for (const entry of entries) byId.set(entry.id, entry)
  }
  return [...byId.values()].sort((left, right) => left.id - right.id)
}

type LogScopeField = 'task_id' | 'batch_id' | 'workspace_id'

function scopeOptionLabel(log: LogEntry, field: LogScopeField, value: string): string {
  if (field === 'task_id' && log.details?.task_title) {
    return `${log.details.task_title} · ${value}`
  }
  return value
}

function scopeOptions(logs: LogEntry[], field: LogScopeField, selected: string) {
  const options = new Map<string, string>()
  for (const log of [...logs].reverse()) {
    const value = log[field]
    if (value && !options.has(value)) {
      options.set(value, scopeOptionLabel(log, field, value))
    }
  }
  if (selected && !options.has(selected)) options.set(selected, selected)
  return [...options].map(([value, label]) => ({ value, label }))
}

function formatUptime(seconds: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return t('monitor.uptimeDays', { days, hours })
  if (hours > 0) return t('monitor.uptimeHours', { hours, minutes })
  return t('monitor.uptimeMinutes', { minutes })
}

function formatTime(value: string, locale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatDuration(value: number | undefined, t: (k: string, o?: Record<string, unknown>) => string) {
  if (typeof value !== 'number' || value < 0) return ''
  if (value < 1000) return t('monitor.durationMs', { ms: Math.round(value) })
  return t('monitor.durationSec', { s: (value / 1000).toFixed(1) })
}

/** 人能理解的摘要：优先结构化 summary，旧日志回退到 message。 */
function summaryOf(log: LogEntry): string {
  return log.summary || log.message
}

function matchesScope(
  log: LogEntry,
  filters: {
    level: string
    task: string
    batch: string
    workspace: string
    keyword: string
  },
) {
  if (filters.level !== 'all' && log.level !== filters.level) return false
  if (filters.task && log.task_id !== filters.task) return false
  if (filters.batch && log.batch_id !== filters.batch) return false
  if (filters.workspace && log.workspace_id !== filters.workspace) return false
  if (filters.keyword) {
    const keyword = filters.keyword.toLowerCase()
    const haystack = [
      summaryOf(log),
      log.message,
      log.probable_cause,
      log.suggested_action,
    ].filter(Boolean).join(' ').toLowerCase()
    if (!haystack.includes(keyword)) return false
  }
  return true
}

export default function DeployMonitorPage() {
  const { t, i18n } = useTranslation('settings')
  const stageLabel = (stage?: string) => {
    if (!stage) return ''
    const key = STAGE_KEYS[stage.toUpperCase()]
    return key ? t(key) : stage
  }
  const health = useHealthPulse(5000)
  const initialParams = useRef(new URLSearchParams(window.location.search))
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [levelFilter, setLevelFilter] = useState(
    initialParams.current.get('level') || 'all',
  )
  const [taskFilter, setTaskFilter] = useState(
    initialParams.current.get('task_id') || '',
  )
  const [batchFilter, setBatchFilter] = useState(
    initialParams.current.get('batch_id') || '',
  )
  const [workspaceFilter, setWorkspaceFilter] = useState(
    initialParams.current.get('workspace_id') || '',
  )
  const [keywordFilter, setKeywordFilter] = useState(
    initialParams.current.get('q') || '',
  )
  const [hasMore, setHasMore] = useState(false)
  const [exporting, setExporting] = useState(false)
  const latestIdRef = useRef(0)
  const oldestIdRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const loadInitial = async () => {
      try {
        const response = await http.get<LogsResponse>(
          '/admin/logs',
          { params: { limit: 200 } },
        )
        if (cancelled) return
        setLogs((previous) => mergeLogEntries(previous, response.data.entries))
        latestIdRef.current = Math.max(
          latestIdRef.current,
          response.data.latest_id,
        )
        oldestIdRef.current = oldestIdRef.current
          ? Math.min(oldestIdRef.current, response.data.oldest_id)
          : response.data.oldest_id
        setHasMore(response.data.has_more_older)
      } catch {
        // 日志会在下一轮继续尝试。
      }
    }
    void loadInitial()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (paused) return
      try {
        const response = await http.get<LogsResponse>('/admin/logs', {
          params: { after_id: latestIdRef.current, limit: 100 },
        })
        if (!cancelled && response.data.entries.length > 0) {
          setLogs((previous) =>
            mergeLogEntries(previous, response.data.entries),
          )
          latestIdRef.current = Math.max(
            latestIdRef.current,
            response.data.latest_id,
          )
        }
      } catch {
        // 增量失败不清空已经展示的事件。
      }
    }
    const timer = window.setInterval(tick, LOG_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [paused])

  const scopeFilters = useMemo(() => ({
    level: levelFilter,
    task: taskFilter,
    batch: batchFilter,
    workspace: workspaceFilter,
    keyword: keywordFilter,
  }), [
    levelFilter,
    taskFilter,
    batchFilter,
    workspaceFilter,
    keywordFilter,
  ])

  const scopedLogs = useMemo(
    () => logs.filter((log) => matchesScope(log, scopeFilters)),
    [logs, scopeFilters],
  )
  // 最新事件始终在最上方
  const visibleEvents = useMemo(() => scopedLogs.slice().reverse(), [scopedLogs])
  const taskOptions = useMemo(() => scopeOptions(logs, 'task_id', taskFilter), [logs, taskFilter])
  const batchOptions = useMemo(() => scopeOptions(logs, 'batch_id', batchFilter), [logs, batchFilter])
  const workspaceOptions = useMemo(() => scopeOptions(logs, 'workspace_id', workspaceFilter), [logs, workspaceFilter])

  useEffect(() => {
    const params = new URLSearchParams()
    if (levelFilter !== 'all') params.set('level', levelFilter)
    if (taskFilter) params.set('task_id', taskFilter)
    if (batchFilter) params.set('batch_id', batchFilter)
    if (workspaceFilter) params.set('workspace_id', workspaceFilter)
    if (keywordFilter) params.set('q', keywordFilter)
    const query = params.toString()
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    )
  }, [
    levelFilter,
    taskFilter,
    batchFilter,
    workspaceFilter,
    keywordFilter,
  ])

  const loadOlder = async () => {
    if (!hasMore || oldestIdRef.current === 0) return
    try {
      const response = await http.get<LogsResponse>('/admin/logs', {
        params: { before_id: oldestIdRef.current, limit: 100 },
      })
      setLogs((previous) =>
        mergeLogEntries(response.data.entries, previous),
      )
      oldestIdRef.current = Math.min(
        oldestIdRef.current,
        response.data.oldest_id,
      )
      setHasMore(response.data.has_more_older)
    } catch {
      // 保持当前列表，用户可再次尝试。
    }
  }

  const exportDiagnostics = async () => {
    setExporting(true)
    try {
      const params: Record<string, string> = {}
      if (levelFilter !== 'all') params.level = levelFilter
      if (taskFilter) params.task_id = taskFilter
      if (batchFilter) params.batch_id = batchFilter
      if (workspaceFilter) params.workspace_id = workspaceFilter
      const response = await http.get('/admin/logs/export', {
        params,
        responseType: 'blob',
      })
      const href = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = href
      link.download = 'notebi-diagnostics.json'
      link.click()
      URL.revokeObjectURL(href)
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className="deploy-monitor-page">
      <div className="deploy-monitor-shell">
        <PageHeader
          eyebrow="RUNTIME · LOCAL"
          title={t('monitor.title')}
          description={t('monitor.description')}
          actions={(
            <div className="monitor-health">
              <StatusBadge status={health.online ? 'success' : 'offline'}>
                {health.online ? t('monitor.status.online') : t('monitor.status.offline')}
              </StatusBadge>
              {health.online && health.data && (
                <span>
                  {health.data.version || t('monitor.versionUnknown')} · {t('monitor.running', { uptime: formatUptime(health.data.uptime_sec, t) })}
                </span>
              )}
            </div>
          )}
        />

        <Section
          title={t('monitor.eventsTitle')}
          description={t('monitor.eventsDescription')}
          action={(
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPaused((value) => !value)}
            >
              {paused
                ? <Play className="size-4" />
                : <Pause className="size-4" />}
              {paused ? t('monitor.resume') : t('monitor.pause')}
            </button>
          )}
        >
          <div className="monitor-diagnostic-controls">
            <select
              aria-label={t('monitor.levelAria')}
              className="input"
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value)}
            >
              <option value="all">{t('monitor.allLevels')}</option>
              <option value="DEBUG">DEBUG</option>
              <option value="INFO">INFO</option>
              <option value="WARNING">WARNING</option>
              <option value="ERROR">ERROR</option>
            </select>
            <select
              aria-label={t('monitor.taskAria')}
              className="input"
              value={taskFilter}
              onChange={(event) => setTaskFilter(event.target.value)}
            >
              <option value="">{t('monitor.allTasks')}</option>
              {taskOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select
              aria-label={t('monitor.batchAria')}
              className="input"
              value={batchFilter}
              onChange={(event) => setBatchFilter(event.target.value)}
            >
              <option value="">{t('monitor.allBatches')}</option>
              {batchOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select
              aria-label={t('monitor.workspaceAria')}
              className="input"
              value={workspaceFilter}
              onChange={(event) => setWorkspaceFilter(event.target.value)}
            >
              <option value="">{t('monitor.allWorkspaces')}</option>
              {workspaceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input
              aria-label={t('monitor.keywordAria')}
              className="input"
              value={keywordFilter}
              onChange={(event) => setKeywordFilter(event.target.value)}
              placeholder={t('monitor.keywordPlaceholder')}
            />
            <button
              type="button"
              className="btn"
              disabled={exporting}
              onClick={() => void exportDiagnostics()}
            >
              <Download className="size-4" />
              {exporting ? t('monitor.exporting') : t('monitor.export')}
            </button>
          </div>
          <p className="monitor-privacy">
            {t('monitor.privacy')}
          </p>
          {hasMore && (
            <button type="button" className="btn" onClick={() => void loadOlder()}>
              加载更早
            </button>
          )}

          <div className="monitor-activity-list">
            {visibleEvents.length === 0 && (
              <div className="monitor-empty">{t('monitor.empty')}</div>
            )}
            {visibleEvents.map((log) => (
              <article
                key={log.id}
                className="monitor-activity-card"
                data-level={log.level}
              >
                <div className="monitor-stage-marker" aria-hidden="true" />
                <div className="monitor-activity-main">
                  <div className="monitor-activity-heading">
                    <div>
                      <strong>{summaryOf(log)}</strong>
                      <span>{formatTime(log.timestamp, i18n.language)}</span>
                    </div>
                    <b data-level={log.level}>{log.level}</b>
                  </div>
                  {log.probable_cause && (
                    <p className="monitor-cause">{t('monitor.cause', { cause: log.probable_cause })}</p>
                  )}
                  {log.suggested_action && (
                    <p className="monitor-action">{t('monitor.action', { action: log.suggested_action })}</p>
                  )}
                  <div className="monitor-activity-meta">
                    {stageLabel(log.stage) && <span>{t('monitor.stageMeta', { stage: stageLabel(log.stage) })}</span>}
                    {log.details?.task_title && <span>{log.details.task_title}</span>}
                    {log.task_id && <span>{t('monitor.taskMeta', { id: log.task_id })}</span>}
                    {log.batch_id && <span>{t('monitor.batchMeta', { id: log.batch_id })}</span>}
                    {log.workspace_id && <span>{t('monitor.workspaceMeta', { id: log.workspace_id })}</span>}
                    {log.correlation_id && <span>{t('monitor.correlationMeta', { id: log.correlation_id })}</span>}
                    {typeof log.progress === 'number' && (
                      <span>{t('monitor.progressMeta', { percent: Math.round(log.progress * 100) })}</span>
                    )}
                    {typeof log.duration_ms === 'number' && formatDuration(log.duration_ms, t) && (
                      <span>{t('monitor.durationMeta', { duration: formatDuration(log.duration_ms, t) })}</span>
                    )}
                    {typeof log.retry_count === 'number' && log.retry_count > 0 && (
                      <span>
                        {t('monitor.retryMeta', { count: `${log.retry_count}${typeof log.retry_max === 'number' ? `/${log.retry_max}` : ''}` })}
                      </span>
                    )}
                  </div>
                  {typeof log.progress === 'number' && (
                    <div
                      className="monitor-progress"
                      role="progressbar"
                      aria-label={t('monitor.progressAria', { summary: summaryOf(log) })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(log.progress * 100)}
                    >
                      <span style={{ width: `${Math.round(log.progress * 100)}%` }} />
                    </div>
                  )}
                  <details className="monitor-event-detail">
                    <summary>{t('monitor.detailSummary')}</summary>
                    <div className="monitor-event-detail-body">
                      <div>{t('monitor.detailLevel', { value: log.level })}</div>
                      <div>{t('monitor.detailModule', { value: log.category })}</div>
                      {log.stage && <div>{t('monitor.detailStage', { value: log.stage })}</div>}
                      {log.operation && <div>{t('monitor.detailOperation', { value: log.operation })}</div>}
                      {log.component && <div>{t('monitor.detailComponent', { value: log.component })}</div>}
                      {log.event_code && <div>{t('monitor.detailEventCode', { value: log.event_code })}</div>}
                      {log.error_code && <div>{t('monitor.detailErrorCode', { value: log.error_code })}</div>}
                      {log.outcome && <div>{t('monitor.detailOutcome', { value: log.outcome })}</div>}
                      {log.engine && <div>{t('monitor.detailEngine', { value: log.engine })}</div>}
                      {log.provider && <div>{t('monitor.detailProvider', { value: log.provider })}</div>}
                      {log.model && <div>{t('monitor.detailModel', { value: log.model })}</div>}
                      {log.device && <div>{t('monitor.detailDevice', { value: log.device })}</div>}
                      {log.summary && log.summary !== log.message && (
                        <div>{t('monitor.detailRaw', { value: log.message })}</div>
                      )}
                      {log.technical_detail && (
                        <code className="monitor-technical">{log.technical_detail}</code>
                      )}
                    </div>
                  </details>
                </div>
              </article>
            ))}
          </div>
        </Section>
      </div>
    </main>
  )
}
