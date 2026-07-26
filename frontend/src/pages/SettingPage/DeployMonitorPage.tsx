import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  Cpu,
  HardDrive,
  ListChecks,
  MemoryStick,
  Pause,
  Play,
  ScrollText,
  Server,
  CircleDot,
  CircleOff,
  Trash2,
} from 'lucide-react'
import { Section } from '@/components/ui/section'
import { StatCard } from '@/components/ui/stat-card'
import { LogConsole, type LogLevel, type LogLine } from '@/components/ui/log-console'
import { useHealthPulse } from '@/hooks/useHealthPulse'
import http from '@/services/client'
import {
  buildActivityItems,
  fetchAdminLogs,
  fetchMonitorTasks,
  summarizeTasks,
  type AdminLogEntry,
} from '@/services/monitor'
import type { TaskRecord } from '@/types/task'
import { cn } from '@/lib/utils'

/**
 * 部署监控页（M4 / R6-B）。
 *
 * 组成：
 * - 顶部状态条：在线/离线徽章 + 版本 + uptime；
 * - 指标卡片：CPU / 内存 / 磁盘（定时轮询 /admin/system/stats）；
 * - 任务活动 / 应用日志切换：
 *   - 任务活动：复用 /pipeline/tasks?include_logs=true&limit=50，统计
 *     queued/running/failed/success，空日志任务从生命周期生成活动项，点击进入处理页；
 *   - 应用日志：按 latest_id 每 2 秒增量轮询 /admin/logs，支持暂停/恢复/
 *     自动跟随/level/类别/关键词过滤，清空只清浏览器视图。
 *
 * 只读：不修改任务状态，不清理服务端日志。
 */

interface SystemStats {
  cpu: { percent: number; count_logical: number; count_physical: number }
  memory: { total: number; available: number; used: number; percent: number }
  disk: { total: number; used: number; free: number; percent: number }
  timestamp: number
}

const LOG_POLL_MS = 2000
const TASK_POLL_MS = 3000

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

function formatClock(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function mapLevel(level: string): LogLevel {
  const upper = String(level).toUpperCase()
  if (upper === 'ERROR') return 'error'
  if (upper === 'WARNING' || upper === 'WARN') return 'warn'
  if (upper === 'DEBUG') return 'debug'
  return 'info'
}

const LEVEL_DOT: Record<string, string> = {
  info: 'bg-zinc-400',
  warning: 'bg-amber-400',
  error: 'bg-rose-500',
}

const COUNT_TONE: Record<string, string> = {
  gray: 'text-zinc-700',
  blue: 'text-cyan-700',
  rose: 'text-rose-700',
  emerald: 'text-emerald-700',
}

function CountBadge({
  testId,
  label,
  value,
  tone,
}: {
  testId: string
  label: string
  value: number
  tone: keyof typeof COUNT_TONE
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div data-testid={testId} className={cn('mt-0.5 text-xl font-semibold', COUNT_TONE[tone])}>
        {value}
      </div>
    </div>
  )
}

export default function DeployMonitorPage() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
  const health = useHealthPulse(5000)

  const [stats, setStats] = useState<SystemStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)

  // 任务活动 / 应用日志 切换
  const [tab, setTab] = useState<'activity' | 'logs'>('activity')

  // 任务活动
  const [tasks, setTasks] = useState<TaskRecord[]>([])

  // 应用日志
  const [logs, setLogs] = useState<AdminLogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [autoFollow, setAutoFollow] = useState(true)
  const [levelFilter, setLevelFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const latestIdRef = useRef(0)

  // 系统指标轮询（保留 M4 行为）
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

  // 任务列表轮询（复用 /pipeline/tasks?include_logs=true&limit=50）
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const list = await fetchMonitorTasks(50)
        if (!cancelled) setTasks(list)
      } catch {
        // 网络失败保留旧内容
      }
    }
    tick()
    const timer = window.setInterval(tick, TASK_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  // 应用日志增量轮询（每 2 秒按 latest_id）
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (paused) return
      try {
        const resp = await fetchAdminLogs(latestIdRef.current, 200)
        if (cancelled) return
        if (resp.entries.length > 0) {
          setLogs((prev) => [...prev, ...resp.entries])
        }
        latestIdRef.current = resp.latest_id
      } catch {
        // 网络失败保留旧内容
      }
    }
    tick()
    const timer = window.setInterval(tick, LOG_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [paused])

  const counts = useMemo(() => summarizeTasks(tasks), [tasks])
  const activity = useMemo(() => buildActivityItems(tasks), [tasks])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const l of logs) set.add(l.category)
    return Array.from(set).sort()
  }, [logs])

  const visibleLogs = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return logs.filter((l) => {
      if (levelFilter !== 'all' && String(l.level).toUpperCase() !== levelFilter) return false
      if (categoryFilter !== 'all' && l.category !== categoryFilter) return false
      if (kw && !l.message.toLowerCase().includes(kw)) return false
      return true
    })
  }, [logs, levelFilter, categoryFilter, keyword])

  const logLines: LogLine[] = useMemo(
    () =>
      visibleLogs.map((l) => ({
        id: l.id,
        text: `[${l.category}] ${l.message}`,
        level: mapLevel(l.level),
        ts: l.timestamp * 1000,
      })),
    [visibleLogs],
  )

  const online = health.online
  const uptimeLabel = useMemo(
    () => (health.data ? formatUptime(health.data.uptime_sec) : '—'),
    [health.data],
  )

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">{t('monitor.title', '部署监控')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('monitor.subtitle', '实时查看后端服务状态、系统资源占用与运行日志')}
        </p>
      </div>

      {/* 顶部状态条：在线/离线徽章 + 版本 + uptime */}
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
      >
        <div
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
            online ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
          )}
        >
          {online ? <CircleDot className="size-3.5" /> : <CircleOff className="size-3.5" />}
          <span>{online ? t('monitor.status.online', '在线') : t('monitor.status.offline', '离线')}</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Server className="size-4" />
          <span>{t('monitor.version', '版本')}:</span>
          <span className="font-mono text-foreground">{health.data?.version ?? '—'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Activity className="size-4" />
          <span>{t('monitor.uptime', '运行时长')}:</span>
          <span className="font-mono text-foreground">{uptimeLabel}</span>
        </div>
        {health.error ? <div className="ml-auto text-xs text-rose-600">{health.error}</div> : null}
      </div>

      {/* 系统指标 */}
      <Section
        title={t('monitor.stats.title', '系统指标')}
        description={t('monitor.stats.description', 'CPU / 内存 / 磁盘 使用率（每 5 秒刷新）')}
        icon={<Cpu className="size-4" />}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={t('monitor.stats.cpu', 'CPU 使用率')}
            icon={<Cpu className="size-4" />}
            value={stats ? `${stats.cpu.percent.toFixed(1)}%` : '—'}
            percent={stats?.cpu.percent}
            hint={
              stats
                ? t('monitor.stats.cpuHint', {
                    logical: stats.cpu.count_logical,
                    physical: stats.cpu.count_physical,
                  })
                : undefined
            }
            loading={!stats && !statsError}
          />
          <StatCard
            label={t('monitor.stats.memory', '内存使用率')}
            icon={<MemoryStick className="size-4" />}
            value={stats ? `${stats.memory.percent.toFixed(1)}%` : '—'}
            percent={stats?.memory.percent}
            hint={stats ? `${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}` : undefined}
            loading={!stats && !statsError}
          />
          <StatCard
            label={t('monitor.stats.disk', '磁盘使用率')}
            icon={<HardDrive className="size-4" />}
            value={stats ? `${stats.disk.percent.toFixed(1)}%` : '—'}
            percent={stats?.disk.percent}
            hint={stats ? `${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}` : undefined}
            loading={!stats && !statsError}
          />
        </div>
        {statsError ? <p className="text-xs text-rose-600">{statsError}</p> : null}
      </Section>

      {/* 任务活动 / 应用日志 */}
      <Section
        title={t('monitor.runtime.title', '任务活动与应用日志')}
        description={t('monitor.runtime.description', '查看后台任务进展与脱敏后的应用日志')}
        icon={<Activity className="size-4" />}
      >
        {/* 切换 */}
        <div className="mb-4 inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
          <button
            type="button"
            onClick={() => setTab('activity')}
            aria-pressed={tab === 'activity'}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === 'activity' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ListChecks className="size-4" />
            {t('monitor.activity.tab', '任务活动')}
          </button>
          <button
            type="button"
            onClick={() => setTab('logs')}
            aria-pressed={tab === 'logs'}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === 'logs' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ScrollText className="size-4" />
            {t('monitor.logs.tab', '应用日志')}
          </button>
        </div>

        {tab === 'activity' ? (
          <div>
            {/* 数量统计 */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <CountBadge testId="count-queued" label={t('monitor.activity.queued', '排队中')} value={counts.queued} tone="gray" />
              <CountBadge testId="count-running" label={t('monitor.activity.running', '运行中')} value={counts.running} tone="blue" />
              <CountBadge testId="count-failed" label={t('monitor.activity.failed', '失败')} value={counts.failed} tone="rose" />
              <CountBadge testId="count-success" label={t('monitor.activity.success', '成功')} value={counts.success} tone="emerald" />
            </div>

            {/* 活动列表 */}
            <div className="max-h-[360px] space-y-1.5 overflow-y-auto pr-1">
              {activity.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  {t('monitor.activity.empty', '暂无任务活动')}
                </p>
              ) : (
                activity.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    data-testid={`activity-item-${item.taskId}`}
                    onClick={() => navigate(`/processing/${item.taskId}`)}
                    className="flex w-full items-start gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-50"
                  >
                    <span className={cn('mt-1 size-2 shrink-0 rounded-full', LEVEL_DOT[item.level] ?? LEVEL_DOT.info)} />
                    <span className="flex-1 break-all text-foreground">{item.text}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatClock(item.ts)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div>
            {/* 控制台工具条 */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50"
              >
                {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
                {paused ? t('monitor.logs.resume', '恢复') : t('monitor.logs.pause', '暂停')}
              </button>
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={autoFollow}
                  onChange={(e) => setAutoFollow(e.target.checked)}
                  className="size-3.5"
                />
                {t('monitor.logs.autoFollow', '自动跟随')}
              </label>
              <select
                data-testid="log-level-filter"
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
              >
                <option value="all">{t('monitor.logs.allLevels', '全部级别')}</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="ERROR">ERROR</option>
              </select>
              <select
                data-testid="log-category-filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
              >
                <option value="all">{t('monitor.logs.allCategories', '全部类别')}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t('monitor.logs.keyword', '关键词过滤')}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={() => setLogs([])}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="size-3.5" />
                {t('monitor.logs.clear', '清空')}
              </button>
            </div>
            <LogConsole
              lines={logLines}
              height={360}
              autoScroll={autoFollow}
              emptyText={t('monitor.logs.empty', '暂无日志')}
            />
          </div>
        )}
      </Section>
    </div>
  )
}
