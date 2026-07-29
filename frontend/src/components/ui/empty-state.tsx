import * as React from 'react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 空状态占位（§4.4）。
 *
 * - 插画 / icon + 主副标题 + 可选 CTA；
 * - 没有提供 illustration 时 fallback 为虚线框 + lucide Inbox 图标。
 */
export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode
  description?: React.ReactNode
  /** 插画：可传 <img /> 或自定义 ReactNode；留空使用 fallback 图标 */
  illustration?: React.ReactNode
  /** CTA 按钮 / 链接 */
  action?: React.ReactNode
}

function EmptyState({
  title,
  description,
  illustration,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-[var(--rl)] border border-dashed border-[var(--bdrs)] bg-[var(--bgalt)] px-6 py-10 text-center',
        className,
      )}
      {...rest}
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-[var(--srf)] text-[var(--mut)] shadow-[var(--sh1)]">
        {illustration ?? <Inbox className="size-6" />}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[var(--fg)]">{title}</h3>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
