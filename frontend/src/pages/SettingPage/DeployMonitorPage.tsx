import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Cpu,
  Download,
  HardDrive,
  MemoryStick,
  Pause,
  Play,
} from 'lucide-react'

import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { StatusBadge } from '@/components/ui/status-badge'
import { useHealthPulse } from '@/hooks/useHealthPulse'
import http from '@/services/client'

import './deploy-monitor.css'

interface SystemStats {
  cpu: { percent: number; count_logical: number; count_physical: number }
  memory: { total: number; available: number; used: number; percent: number }
  disk: { total: number; used: number; free: number; percent: number }
  timestamp: number
}

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
}

interface LogsResponse {
  entries: LogEntry[]
  latest_id: number
  oldest_id: number
  has_more_older: boolean
}

type ActivityView = 'progress' | 'issues'

const STAGE_LABELS: Record<string, string> = {
  PENDING: '等待开始',
  DOWNLOAD: '下载媒体',
  PROBE: '识别媒体信息',
  FRAMES: '提取关键画面',
  ASR: '语音转写',
  VLM: '画面理解',
  DIARIZATION: '区分说话人',
  SUM: '生成总结',
  SUMMARY: '生成总结',
  STORE: '保存笔记',
}

const LOG_POLL_MS = 2000
const LIFECYCLE_STAGES = new Set(['created', 'started', 'succeeded', 'failed', 'cancelled', 'application_started'])

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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)),
  )
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatDuration(value?: number) {
  if (typeof value !== 'number' || value < 0) return ''
  if (value < 1000) return `${Math.round(value)} 毫秒`
  return `${(value / 1000).toFixed(1)} 秒`
}

function stageLabel(stage?: string) {
  if (!stage) return '应用运行'
  return STAGE_LABELS[stage.toUpperCase()] || stage
}

function isIssue(log: LogEntry) {
  return log.level === 'ERROR' || log.level === 'WARNING'
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
  if (
    filters.keyword
    && !log.message.toLowerCase().includes(filters.keyword.toLowerCase())
  ) return false
  return true
}

export default function DeployMonitorPage() {
  const health = useHealthPulse(5000)
  const initialParams = useRef(new URLSearchParams(window.location.search))
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [view, setView] = useState<ActivityView>('progress')
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
  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const response = await http.get<SystemStats>(
          '/admin/system/stats',
          { timeout: 5000 },
        )
        if (!cancelled) {
          setStats(response.data)
          setStatsError(null)
        }
      } catch (reason) {
        if (!cancelled) {
          setStatsError(reason instanceof Error ? reason.message : String(reason))
        }
      }
    }
    void tick()
    const timer = window.setInterval(tick, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

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
        // 监控页仍可显示系统状态；日志会在下一轮继续尝试。
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
        // 增量失败不清空已经展示的活动。
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
  const progressLogs = useMemo(
    () => scopedLogs.filter((log) => log.stage && !LIFECYCLE_STAGES.has(String(log.stage).toLowerCase()) && !isIssue(log)).slice().reverse(),
    [scopedLogs],
  )
  const issueLogs = useMemo(
    () => scopedLogs.filter(isIssue).slice().reverse(),
    [scopedLogs],
  )
  const visibleActivity = view === 'progress' ? progressLogs : issueLogs
  const recentScopedLogs = useMemo(() => scopedLogs.slice().reverse(), [scopedLogs])
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
      const previousHeight = logContainerRef.current?.scrollHeight || 0
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
      window.requestAnimationFrame(() => {
        if (logContainerRef.current) {
          logContainerRef.current.scrollTop +=
            logContainerRef.current.scrollHeight - previousHeight
        }
      })
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
          title="诊断日志"
          description="结构化诊断事件：处理阶段、失败原因、建议动作；原始技术日志收在高级诊断中。"
          actions={(
            <div className="monitor-health">
              <StatusBadge status={health.online ? 'success' : 'offline'}>
                {health.online ? '在线' : '离线'}
              </StatusBadge>
              {health.online && health.data && (
                <span>
                  {health.data.version || '版本未知'} · 已运行{' '}
                  {formatUptime(health.data.uptime_sec)}
                </span>
              )}
            </div>
          )}
        />

        <Section
          title="诊断事件"
          description="处理事件与排错日志来自同一条实时事件流；最新事件始终在最上方。"
          action={(
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setPaused((value) => !value)}
            >
              {paused
                ? <Play className="size-4" />
                : <Pause className="size-4" />}
              {paused ? '恢复更新' : '暂停更新'}
            </button>
          )}
        >
          <div className="monitor-view-tabs">
            <button
              type="button"
              aria-pressed={view === 'progress'}
              onClick={() => setView('progress')}
            >
              处理进度 ({progressLogs.length})
            </button>
            <button
              type="button"
              aria-pressed={view === 'issues'}
              onClick={() => setView('issues')}
            >
              需要处理 ({issueLogs.length})
            </button>
          </div>

          <div className="monitor-activity-list">
            {visibleActivity.length === 0 && (
              <div className="monitor-empty">
                {view === 'progress'
                  ? '当前没有可展示的处理进度'
                  : '当前没有需要处理的问题'}
              </div>
            )}
            {visibleActivity.map((log) => (
              <article
                key={log.id}
                className="monitor-activity-card"
                data-level={log.level}
              >
                <div className="monitor-stage-marker" aria-hidden="true" />
                <div className="monitor-activity-main">
                  <div className="monitor-activity-heading">
                    <div>
                      <strong>{stageLabel(log.stage)}</strong>
                      <span>{formatTime(log.timestamp)}</span>
                    </div>
                    {typeof log.progress === 'number' && (
                      <b>{Math.round(log.progress * 100)}%</b>
                    )}
                  </div>
                  {isIssue(log) && <p>{log.message}</p>}
                  {log.details?.task_title && (
                    <p className="monitor-task-title">
                      {log.details.task_title}
                      {log.details.source_type ? ` · ${log.details.source_type}` : ''}
                    </p>
                  )}
                  <div className="monitor-activity-meta">
                    {log.task_id && <span>任务 {log.task_id}</span>}
                    {log.batch_id && <span>批次 {log.batch_id}</span>}
                    {typeof log.duration_ms === 'number' && (
                      <span>本环节 {formatDuration(log.duration_ms)}</span>
                    )}
                    {Boolean(log.retry_count) && (
                      <span>已重试 {log.retry_count} 次</span>
                    )}
                  </div>
                  {typeof log.progress === 'number' && (
                    <div
                      className="monitor-progress"
                      role="progressbar"
                      aria-label={`${stageLabel(log.stage)}进度`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(log.progress * 100)}
                    >
                      <span style={{ width: `${Math.round(log.progress * 100)}%` }} />
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>

          <details className="monitor-diagnostics">
          <summary>高级诊断日志</summary>
          <div className="monitor-diagnostics-body">
            <p>面向排错的原始事件。日常使用只需查看上方任务活动。</p>
            <div className="monitor-diagnostic-controls">
              <select
                aria-label="日志级别"
                className="input"
                value={levelFilter}
                onChange={(event) => setLevelFilter(event.target.value)}
              >
                <option value="all">全部级别</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="ERROR">ERROR</option>
              </select>
              <select
                aria-label="任务 ID"
                className="input"
                value={taskFilter}
                onChange={(event) => setTaskFilter(event.target.value)}
              >
                <option value="">全部任务</option>
                {taskOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select
                aria-label="批次 ID"
                className="input"
                value={batchFilter}
                onChange={(event) => setBatchFilter(event.target.value)}
              >
                <option value="">全部批次</option>
                {batchOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select
                aria-label="合集 ID"
                className="input"
                value={workspaceFilter}
                onChange={(event) => setWorkspaceFilter(event.target.value)}
              >
                <option value="">全部合集</option>
                {workspaceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <input
                aria-label="关键词"
                className="input"
                value={keywordFilter}
                onChange={(event) => setKeywordFilter(event.target.value)}
                placeholder="关键词"
              />
              <button
                type="button"
                className="btn"
                disabled={exporting}
                onClick={() => void exportDiagnostics()}
              >
                <Download className="size-4" />
                {exporting ? '导出中…' : '导出诊断'}
              </button>
            </div>
            <p className="monitor-privacy">
              导出内容已自动脱敏，不包含 API 密钥和 Cookie。
            </p>
            {hasMore && (
              <button type="button" className="btn" onClick={() => void loadOlder()}>
                加载更早
              </button>
            )}
            <div ref={logContainerRef} className="monitor-raw-logs">
              {scopedLogs.length === 0 ? (
                <div className="monitor-empty">暂无日志</div>
              ) : recentScopedLogs.map((log) => (
                <div key={log.id}>
                  <time>{formatTime(log.timestamp)}</time>
                  <b data-level={log.level}>{log.level}</b>
                  <code>{log.category}</code>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </div>
          </details>
        </Section>
      </div>
    </main>
  )
}
