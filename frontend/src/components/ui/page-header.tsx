import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex min-w-0 flex-wrap items-start justify-between gap-4',
        className,
      )}
      data-slot="page-header"
    >
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--mut)]">
            {eyebrow}
          </div>
        )}
        <h1 className="font-[var(--fd)] text-3xl font-semibold leading-tight tracking-[-0.02em] text-[var(--fg)]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-sm leading-6 text-[var(--fg2)]">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex min-h-11 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      )}
    </header>
  )
}

