import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type StatusKind =
  | 'success'
  | 'running'
  | 'paused'
  | 'error'
  | 'offline'
  | 'queued'

const STATUS_CLASS: Record<StatusKind, string> = {
  success: 'bg-[var(--okl)] text-[var(--ok)]',
  running: 'bg-[var(--accl)] text-[var(--acc)]',
  paused: 'bg-[var(--wrnl)] text-[var(--wrn)]',
  error: 'bg-[var(--errl)] text-[var(--err)]',
  offline: 'bg-[var(--bgalt)] text-[var(--mut)]',
  queued: 'bg-[var(--bgalt)] text-[var(--fg2)]',
}

interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: StatusKind
}

export function StatusBadge({
  status,
  className,
  children,
  ...rest
}: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center gap-1.5 rounded-[var(--rf)] px-2 text-xs font-medium',
        STATUS_CLASS[status],
        className,
      )}
      data-status={status}
      {...rest}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  )
}
