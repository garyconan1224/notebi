import { useEffect, useRef, useState } from 'react'
import { Activity, Cpu, Download, HardDrive, MemoryStick, Pause, Play, ScrollText } from 'lucide-react'
import { Section } from '@/components/ui/section'
import { StatCard } from '@/components/ui/stat-card'
import { useHealthPulse } from '@/hooks/useHealthPulse'
import http from '@/services/client'
import { cn } from '@/lib/utils'

/**
 * 部署监控页（S2 重构）。
 *
 * - 顶部状态条：在线/离线徽章 + 版本 + uptime
 * - 指标卡片：CPU / 内存 / 磁盘
 * - 标准日志：单一日志视图，支持级别过滤、暂停/恢复、加载更早
 * - 已移除：任务活动/应用日志双标签
 */

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
}

interface LogsResponse {
  entries: LogEntry[]
  latest_id: number
  oldest_id: number
  has_more_older: boolean
}

/** 合并初始页、增量轮询和向前翻页结果，避免并发响应重复插入同一日志。 */
export function mergeLogEntries(...groups: LogEntry[][]): LogEntry[] {
  const byId = new Map<number, LogEntry>()
  for (const entries of groups) {
    for (const entry of entries) byId.set(entry.id, entry)
  }
  return [...byId.values()].sort((left, right) => left.id - right.id)
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`
}

function formatUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch {
    return ts
  }
}

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: 'text-zinc-500',
  INFO: 'text-zinc-700',
  WARNING: 'text-amber-600',
  ERROR: 'text-rose-600',
}

const LOG_POLL_MS = 2000

function scrollElementIntoView(
  element: HTMLDivElement | null,
  options?: ScrollIntoViewOptions,
) {
  if (element && typeof element.scrollIntoView === 'function') {
    element.scrollIntoView(options)
  }
}

export default function DeployMonitorPage() {
  const health = useHealthPulse(5000)

  const [stats, setStats] = useState<SystemStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)

  // 标准日志状态
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const initialParams = useRef(new URLSearchParams(window.location.search))
  const [levelFilter, setLevelFilter] = useState(initialParams.current.get('level') || 'all')
  const [categoryFilter, setCategoryFilter] = useState(initialParams.current.get('category') || '')
  const [taskFilter, setTaskFilter] = useState(initialParams.current.get('task_id') || '')
  const [batchFilter, setBatchFilter] = useState(initialParams.current.get('batch_id') || '')
  const [workspaceFilter, setWorkspaceFilter] = useState(initialParams.current.get('workspace_id') || '')
  const [keywordFilter, setKeywordFilter] = useState(initialParams.current.get('q') || '')
  const [hasMore, setHasMore] = useState(false)
  const [autoFollow, setAutoFollow] = useState(true)
  const [exporting, setExporting] = useState(false)
  const latestIdRef = useRef(0)
  const oldestIdRef = useRef(0)
  const logEndRef = useRef<HTMLDivElement>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  // 系统指标轮询
  useEffect(() => {
    let cancelled = false
    let timer: number | null = null

    const tick = async () => {
      try {
        const res = await http.get<SystemStats>('/admin/system/stats', { timeout: 5000 })
        if (!cancelled) {
          setStats(res.data)
          setStatsError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setStatsError(err instanceof Error ? err.message : String(err))
        }
      }
    }

    tick()
    timer = window.setInterval(tick, 5000)
    return () => {
      cancelled = true
      if (timer !== null) window.clearInterval(timer)
    }
  }, [])

  // 初始加载最新日志
  useEffect(() => {
    const loadInitial = async () => {
      try {
        const res = await http.get<LogsResponse>('/admin/logs', { params: { limit: 200 } })
        setLogs((prev) => mergeLogEntries(prev, res.data.entries))
        latestIdRef.current = Math.max(latestIdRef.current, res.data.latest_id)
        oldestIdRef.current = oldestIdRef.current
          ? Math.min(oldestIdRef.current, res.data.oldest_id)
          : res.data.oldest_id
        setHasMore(res.data.has_more_older)
        window.requestAnimationFrame(() => scrollElementIntoView(logEndRef.current))
      } catch {
        // 忽略初始加载错误
      }
    }
    loadInitial()
  }, [])

  // 增量轮询新日志
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (paused) return
      try {
        const res = await http.get<LogsResponse>('/admin/logs', {
          params: { after_id: latestIdRef.current, limit: 100 },
        })
        if (!cancelled && res.data.entries.length > 0) {
          setLogs((prev) => mergeLogEntries(prev, res.data.entries))
          latestIdRef.current = Math.max(latestIdRef.current, res.data.latest_id)
          if (autoFollow) {
            scrollElementIntoView(logEndRef.current, { behavior: 'smooth' })
          }
        }
      } catch {
        // 忽略轮询错误
      }
    }
    const timer = window.setInterval(tick, LOG_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [paused, autoFollow])

  // 加载更早日志
  const loadOlder = async () => {
    if (!hasMore || oldestIdRef.current === 0) return
    try {
      const container = logContainerRef.current
      const priorHeight = container?.scrollHeight || 0
      const res = await http.get<LogsResponse>('/admin/logs', {
        params: { before_id: oldestIdRef.current, limit: 100 },
      })
      if (res.data.entries.length > 0) {
        setLogs((prev) => mergeLogEntries(res.data.entries, prev))
        oldestIdRef.current = Math.min(oldestIdRef.current, res.data.oldest_id)
        setHasMore(res.data.has_more_older)
        window.requestAnimationFrame(() => {
          if (container) container.scrollTop += container.scrollHeight - priorHeight
        })
      }
    } catch {
      // 忽略错误
    }
  }

  // 过滤日志
  const filteredLogs = logs.filter((log) => {
    if (levelFilter !== 'all' && log.level !== levelFilter) return false
    if (categoryFilter && log.category !== categoryFilter) return false
    if (taskFilter && log.task_id !== taskFilter) return false
    if (batchFilter && log.batch_id !== batchFilter) return false
    if (workspaceFilter && log.workspace_id !== workspaceFilter) return false
    if (keywordFilter && !log.message.toLowerCase().includes(keywordFilter.toLowerCase())) return false
    return true
  })

  useEffect(() => {
    const params = new URLSearchParams()
    if (levelFilter !== 'all') params.set('level', levelFilter)
    if (categoryFilter) params.set('category', categoryFilter)
    if (taskFilter) params.set('task_id', taskFilter)
    if (batchFilter) params.set('batch_id', batchFilter)
    if (workspaceFilter) params.set('workspace_id', workspaceFilter)
    if (keywordFilter) params.set('q', keywordFilter)
    const query = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
  }, [levelFilter, categoryFilter, taskFilter, batchFilter, workspaceFilter, keywordFilter])

  const handleLogScroll = () => {
    const element = logContainerRef.current
    if (!element) return
    setAutoFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 24)
  }

  const exportDiagnostics = async () => {
    setExporting(true)
    try {
      const params: Record<string, string> = {}
      if (levelFilter !== 'all') params.level = levelFilter
      if (categoryFilter) params.category = categoryFilter
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
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* 状态条 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">部署监控</h1>
        <div className="flex items-center gap-4 text-sm">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium',
              health.online ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700',
            )}
          >
            <span className={cn('size-2 rounded-full', health.online ? 'bg-emerald-500' : 'bg-rose-500')} />
            {health.online ? '在线' : '离线'}
          </span>
          {health.online && health.data && (
            <>
              <span className="text-muted-foreground">版本: {health.data.version || '—'}</span>
              <span className="text-muted-foreground">运行时长: {formatUptime(health.data.uptime_sec)}</span>
            </>
          )}
        </div>
      </div>

      {/* 系统指标 */}
      <Section title="系统指标" description="CPU / 内存 / 磁盘 使用率（每 5 秒刷新）" icon={<Activity className="size-4" />}>
        {statsError ? (
          <div className="p-4 text-sm text-rose-600">{statsError}</div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              label="CPU 使用率"
              value={stats ? `${stats.cpu.percent.toFixed(1)}%` : '—'}
              icon={<Cpu className="size-4" />}
            />
            <StatCard
              label="内存使用率"
              value={stats ? `${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}` : '—'}
              icon={<MemoryStick className="size-4" />}
            />
            <StatCard
              label="磁盘使用率"
              value={stats ? `${stats.disk.percent.toFixed(1)}%` : '—'}
              icon={<HardDrive className="size-4" />}
            />
          </div>
        )}
      </Section>

      {/* 标准日志 */}
      <Section title="标准日志" description="统一的任务和应用日志（实时刷新）" icon={<ScrollText className="size-4" />}>
        {/* 控制栏 */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            {paused ? '恢复' : '暂停'}
          </button>

          <select
            aria-label="日志级别"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            <option value="all">全部级别</option>
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
          </select>

          <input
            aria-label="日志类别"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            placeholder="类别"
            className="w-28 rounded-md border px-3 py-1.5 text-sm"
          />
          <input
            aria-label="任务 ID"
            value={taskFilter}
            onChange={(event) => setTaskFilter(event.target.value)}
            placeholder="任务 ID"
            className="w-28 rounded-md border px-3 py-1.5 text-sm"
          />
          <input
            aria-label="批次 ID"
            value={batchFilter}
            onChange={(event) => setBatchFilter(event.target.value)}
            placeholder="批次 ID"
            className="w-28 rounded-md border px-3 py-1.5 text-sm"
          />
          <input
            aria-label="合集 ID"
            value={workspaceFilter}
            onChange={(event) => setWorkspaceFilter(event.target.value)}
            placeholder="合集 ID"
            className="w-28 rounded-md border px-3 py-1.5 text-sm"
          />
          <input
            aria-label="关键词"
            value={keywordFilter}
            onChange={(event) => setKeywordFilter(event.target.value)}
            placeholder="关键词"
            className="min-w-32 flex-1 rounded-md border px-3 py-1.5 text-sm"
          />

          {hasMore && (
            <button
              type="button"
              onClick={loadOlder}
              className="text-sm text-primary underline hover:no-underline"
            >
              加载更早
            </button>
          )}

          <button
            type="button"
            onClick={() => void exportDiagnostics()}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
          >
            <Download className="size-4" />
            {exporting ? '导出中…' : '导出诊断'}
          </button>
          <span className="text-xs text-muted-foreground">{filteredLogs.length} 条日志</span>
        </div>
        <div className="mb-3 text-xs text-muted-foreground">
          导出内容已自动脱敏，不包含 API 密钥和 Cookie。
        </div>

        {/* 日志列表 */}
        <div
          ref={logContainerRef}
          onScroll={handleLogScroll}
          className="relative max-h-[400px] overflow-y-auto rounded-lg border bg-zinc-50 font-mono text-xs"
        >
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">暂无日志</div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {filteredLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 px-3 py-1.5 hover:bg-zinc-100">
                  <span className="shrink-0 text-zinc-400">{formatTime(log.timestamp)}</span>
                  <span className={cn('shrink-0 font-medium', LEVEL_COLORS[log.level] || 'text-zinc-700')}>
                    {log.level}
                  </span>
                  <span className="shrink-0 text-zinc-400">[{log.category}]</span>
                  <span className="break-all text-zinc-700">{log.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
          {!autoFollow && (
            <button
              type="button"
              className="sticky bottom-3 left-full mr-3 rounded-full border bg-white px-3 py-1.5 shadow"
              onClick={() => {
                setAutoFollow(true)
                scrollElementIntoView(logEndRef.current, { behavior: 'smooth' })
              }}
            >
              回到最新
            </button>
          )}
        </div>
      </Section>
    </div>
  )
}
