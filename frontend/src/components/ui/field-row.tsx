import * as React from 'react'
import { cn } from '@/lib/utils'
import { DirtyDot } from '@/components/ui/dirty-dot'

/**
 * 表单行布局：Label / Control / Hint / Error 四栏（§4.4）。
 *
 * - 默认纵向堆叠；`inline` 模式下 label 与 control 同行（常用于开关类短字段）；
 * - `dirty` 为 true 时 Label 右侧挂 DirtyDot；
 * - `error` 优先级高于 `hint`。
 */
export interface FieldRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 字段 id，会传给 label.htmlFor */
  htmlFor?: string
  /** 字段标题 */
  label: React.ReactNode
  /** 是否必填（label 后加红色星号） */
  required?: boolean
  /** 是否处于脏（未保存）状态 */
  dirty?: boolean
  /** 辅助说明 */
  hint?: React.ReactNode
  /** 错误信息；存在时盖过 hint */
  error?: React.ReactNode
  /** inline 模式：label 与 control 同一行 */
  inline?: boolean
  /** 控件内容（input / select / switch 等） */
  children: React.ReactNode
}

function FieldRow({
  htmlFor,
  label,
  required,
  dirty,
  hint,
  error,
  inline = false,
  className,
  children,
  ...rest
}: FieldRowProps) {
  const helperId = htmlFor ? `${htmlFor}-hint` : undefined

  const labelNode = (
    <label
      htmlFor={htmlFor}
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium text-foreground',
      )}
    >
      <span>{label}</span>
      {required ? <span className="text-rose-500">*</span> : null}
      {dirty ? <DirtyDot aria-label="未保存变更" /> : null}
    </label>
  )

  const helper = error ? (
    <p id={helperId} role="alert" className="text-xs text-rose-600">
      {error}
    </p>
  ) : hint ? (
    <p id={helperId} className="text-xs text-muted-foreground">
      {hint}
    </p>
  ) : null

  return (
    <div
      data-slot="field-row"
      className={cn(
        inline
          ? 'flex items-center justify-between gap-4'
          : 'flex flex-col gap-2',
        className,
      )}
      {...rest}
    >
      {inline ? (
        <>
          <div className="flex flex-col gap-1 min-w-0">
            {labelNode}
            {helper}
          </div>
          <div className="shrink-0">{children}</div>
        </>
      ) : (
        <>
          {labelNode}
          {children}
          {helper}
        </>
      )}
    </div>
  )
}

export { FieldRow }

