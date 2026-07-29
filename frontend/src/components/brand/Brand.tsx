import type { CSSProperties } from 'react'

import { cn } from '@/lib/utils'

interface BrandMarkProps {
  className?: string
  size?: number
}

/**
 * NoteBi 的唯一品牌图形。
 *
 * 深色折页中的 N 表示笔记，右上角记录点表示音视频时间线。
 * 组件与 public 下的浏览器图标共享同一几何结构。
 */
export function BrandMark({ className, size = 32 }: BrandMarkProps) {
  return (
    <svg
      aria-label="NoteBi"
      className={cn('shrink-0', className)}
      data-brand-mark="note-timeline"
      height={size}
      role="img"
      viewBox="0 0 64 64"
      width={size}
    >
      <title>NoteBi</title>
      <rect fill="var(--fg)" height="64" rx="14" width="64" />
      <path d="M17 47V17h10l15 17V17h9v30H41L26 30v17h-9Z" fill="var(--bg)" />
      <circle
        cx="51"
        cy="13"
        data-testid="brand-recording-dot"
        fill="var(--acc)"
        r="5"
      />
    </svg>
  )
}

interface BrandLockupProps extends BrandMarkProps {
  compact?: boolean
}

export function BrandLockup({
  className,
  compact = false,
  size = 32,
}: BrandLockupProps) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <BrandMark size={size} />
      {!compact && (
        <span
          className="text-base font-semibold tracking-[-0.02em] text-[var(--fg)]"
          data-testid="brand-wordmark"
          style={{ fontFamily: 'var(--fd)' } as CSSProperties}
        >
          NoteBi
        </span>
      )}
    </span>
  )
}
