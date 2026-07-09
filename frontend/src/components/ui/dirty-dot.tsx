import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * 未保存状态指示点（§4.2 Dirty 指示）。
 *
 * 设计尺寸 2px 的视觉要求指的是"视觉尺寸"，Tailwind 里采用 `size-1.5`（6px）
 * 同时用 `ring` 制造轻微内发光，保证在深浅背景下都足够醒目。
 */
export interface DirtyDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 颜色 token；默认 violet-500（主色） */
  tone?: 'primary' | 'warning' | 'danger'
}

const toneMap: Record<NonNullable<DirtyDotProps['tone']>, string> = {
  primary: 'bg-violet-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
}

function DirtyDot({ tone = 'primary', className, ...rest }: DirtyDotProps) {
  return (
    <span
      data-slot="dirty-dot"
      aria-hidden={rest['aria-label'] ? undefined : true}
      className={cn(
        'inline-block size-1.5 rounded-full align-middle',
        toneMap[tone],
        className,
      )}
      {...rest}
    />
  )
}

export { DirtyDot }

