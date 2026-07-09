import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * 数据指标卡片（M4 部署监控）。
 *
 * - 卡片布局：上 label + icon，中间大号 value，底部可选 hint / progress；
 * - 支持 `percent` 数值（0-100）驱动底部进度条；
 * - 色彩档位：percent>=85 红，60-85 琥珀，<60 绿；可被 `tone` 显式覆盖。
 */
export type StatTone = 'default' | 'success' | 'warning' | 'danger'

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 指标名称，如 "CPU" / "内存" */
  label: React.ReactNode
  /** 主展示值，如 "42.3%" / "5.2 GB" */
  value: React.ReactNode
  /** 可选图标（lucide size-4~5） */
  icon?: React.ReactNode
  /** 底部辅助文案，如 "8 核 / 16 线程" */
  hint?: React.ReactNode
  /** 0-100 进度值；若提供则渲染底部进度条 */
  percent?: number
  /** 色调档位；缺省时根据 percent 自动推断 */
  tone?: StatTone
  /** 加载态：展示骨架而非值 */
  loading?: boolean
}

function resolveTone(percent: number | undefined, explicit?: StatTone): StatTone {
  if (explicit) return explicit
  if (typeof percent !== 'number') return 'default'
  if (percent >= 85) return 'danger'
  if (percent >= 60) return 'warning'
  return 'success'
}

const TONE_STYLES: Record<StatTone, { bar: string; text: string; ring: string }> = {
  default: {
    bar: 'bg-zinc-400',
    text: 'text-foreground',
    ring: 'ring-zinc-200',
  },
  success: {
    bar: 'bg-emerald-500',
    text: 'text-emerald-700',
    ring: 'ring-emerald-200',
  },
  warning: {
    bar: 'bg-amber-500',
    text: 'text-amber-700',
    ring: 'ring-amber-200',
  },
  danger: {
    bar: 'bg-rose-500',
    text: 'text-rose-700',
    ring: 'ring-rose-200',
  },
}

export function StatCard({
  label,
  value,
  icon,
  hint,
  percent,
  tone,
  loading = false,
  className,
  ...rest
}: StatCardProps) {
  const actualTone = resolveTone(percent, tone)
  const styles = TONE_STYLES[actualTone]
  const safePercent = typeof percent === 'number'
    ? Math.max(0, Math.min(100, percent))
    : undefined

  return (
    <div
      data-slot="stat-card"
      className={cn(
        'relative flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm ring-1 ring-inset',
        styles.ring,
        className,
      )}
      {...rest}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon ? (
          <span className={cn('inline-flex size-4 items-center justify-center', styles.text)}>
            {icon}
          </span>
        ) : null}
      </div>

      <div className="flex items-baseline gap-2">
        {loading ? (
          <span className="inline-block h-7 w-20 animate-pulse rounded bg-zinc-100" />
        ) : (
          <span className={cn('text-2xl font-semibold tabular-nums leading-none', styles.text)}>
            {value}
          </span>
        )}
      </div>

      {typeof safePercent === 'number' && !loading ? (
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            role="progressbar"
            aria-valuenow={safePercent}
            aria-valuemin={0}
            aria-valuemax={100}
            className={cn('h-full rounded-full transition-[width] duration-500', styles.bar)}
            style={{ width: `${safePercent}%` }}
          />
        </div>
      ) : null}

      {hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  )
}

export default StatCard

