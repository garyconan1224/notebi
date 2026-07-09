import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 配置区块容器（DESIGN_NOTES_SETTINGS.md §4.1 / §4.4）。
 *
 * - 左竖线 `border-l-2 border-primary/40` + 可选 icon + 标题 + 可选描述；
 * - 首行保留 2rem 呼吸；
 * - 支持 `collapsible` 折叠（默认展开）。
 *
 * 仅做"容器 + 可折叠"，不内嵌业务字段（字段由 <FieldRow /> 组合）。
 */
export interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** 区块标题（必填） */
  title: React.ReactNode
  /** 副标题 / 描述（可选） */
  description?: React.ReactNode
  /** 标题前图标，推荐 lucide-react size-4 */
  icon?: React.ReactNode
  /** 是否允许折叠；默认 false */
  collapsible?: boolean
  /** 折叠态默认是否展开；仅在 collapsible=true 时生效 */
  defaultOpen?: boolean
  /** 标题右侧自定义插槽（如"设为默认"按钮） */
  action?: React.ReactNode
}

function Section({
  title,
  description,
  icon,
  collapsible = false,
  defaultOpen = true,
  action,
  className,
  children,
  ...rest
}: SectionProps) {
  const [open, setOpen] = React.useState<boolean>(defaultOpen)

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-2">
        {icon ? (
          <span className="mt-0.5 inline-flex size-5 items-center justify-center text-primary">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-none tracking-tight text-foreground">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {action}
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? 'collapse' : 'expand'}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronDown
              className={cn('size-4 transition-transform', open ? '' : '-rotate-90')}
            />
          </button>
        ) : null}
      </div>
    </div>
  )

  return (
    <section
      data-slot="section"
      className={cn(
        'border-l-2 border-primary/40 pl-4 pt-2',
        className,
      )}
      {...rest}
    >
      {header}
      {(!collapsible || open) && (
        <div className="mt-4 space-y-4">{children}</div>
      )}
    </section>
  )
}

export { Section }

