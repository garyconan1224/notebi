import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Cpu, HardDrive, MemoryStick, Server, CircleDot, CircleOff } from 'lucide-react'
import { Section } from '@/components/ui/section'
import { StatCard } from '@/components/ui/stat-card'
import { LogConsole, type LogLine } from '@/components/ui/log-console'
import { useHealthPulse } from '@/hooks/useHealthPulse'
import http from '@/services/client'
import { cn } from '@/lib/utils'

/**
 * 部署监控页（M4 / DESIGN_NOTES_SETTINGS.md §部署监控）。
 *
 * 组成：
 * - 顶部状态条：在线/离线徽章 + 版本 + uptime；
 * - 指标卡片：CPU / 内存 / 磁盘（定时轮询 /admin/system/stats）；
 * - 日志控制台：占位最近运行日志，后端 SSE 就绪后接入。
 */

interface SystemStats {
  cpu: { percent: number; count_logical: number; count_physical: number }
  memory: { total: number; available: number; used: number; percent: number }
  disk: { total: number; used: number; free: number; percent: number }
  timestamp: number
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

export default function DeployMonitorPage() {
  const { t } = useTranslation('settings')
  const health = useHealthPulse(5000)

  const [stats, setStats] = useState<SystemStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [logs] = useState<LogLine[]>([]) // SSE 接入前先保留空态

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

  const online = health.online
  const uptimeLabel = useMemo(
    () => (health.data ? formatUptime(health.data.uptime_sec) : '—'),
    [health.data],
  )

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">
          {t('monitor.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('monitor.subtitle')}
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
            online
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-rose-50 text-rose-700',
          )}
        >
          {online ? <CircleDot className="size-3.5" /> : <CircleOff className="size-3.5" />}
          <span>{online ? t('monitor.status.online') : t('monitor.status.offline')}</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Server className="size-4" />
          <span>{t('monitor.version')}:</span>
          <span className="font-mono text-foreground">{health.data?.version ?? '—'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Activity className="size-4" />
          <span>{t('monitor.uptime')}:</span>
          <span className="font-mono text-foreground">{uptimeLabel}</span>
        </div>
        {health.error ? (
          <div className="ml-auto text-xs text-rose-600">{health.error}</div>
        ) : null}
      </div>

      {/* 系统指标 */}
      <Section title={t('monitor.stats.title')} description={t('monitor.stats.description')} icon={<Cpu className="size-4" />}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={t('monitor.stats.cpu')}
            icon={<Cpu className="size-4" />}
            value={stats ? `${stats.cpu.percent.toFixed(1)}%` : '—'}
            percent={stats?.cpu.percent}
            hint={stats ? t('monitor.stats.cpuHint', { logical: stats.cpu.count_logical, physical: stats.cpu.count_physical }) : undefined}
            loading={!stats && !statsError}
          />
          <StatCard
            label={t('monitor.stats.memory')}
            icon={<MemoryStick className="size-4" />}
            value={stats ? `${stats.memory.percent.toFixed(1)}%` : '—'}
            percent={stats?.memory.percent}
            hint={stats ? `${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}` : undefined}
            loading={!stats && !statsError}
          />
          <StatCard
            label={t('monitor.stats.disk')}
            icon={<HardDrive className="size-4" />}
            value={stats ? `${stats.disk.percent.toFixed(1)}%` : '—'}
            percent={stats?.disk.percent}
            hint={stats ? `${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}` : undefined}
            loading={!stats && !statsError}
          />
        </div>
        {statsError ? (
          <p className="text-xs text-rose-600">{statsError}</p>
        ) : null}
      </Section>

      {/* 日志控制台 */}
      <Section title={t('monitor.logs.title')} description={t('monitor.logs.description')} icon={<Activity className="size-4" />}>
        <LogConsole lines={logs} height={360} emptyText={t('monitor.logs.empty')} />
      </Section>
    </div>
  )
}

