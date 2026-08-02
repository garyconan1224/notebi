import * as React from 'react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
export interface PositiveIntInputProps
  extends Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'max'> {
  /** 最近一次有效值（父组件状态）；编辑中的非法输入不会改动它 */
  value: number
  /** 输入到有效正整数、或点选快捷值时触发；空值/0/负数/非数值不触发 */
  onChange: (value: number) => void
  /** 常用值快捷按钮（只给常用选项，不引入最大值） */
  quickOptions?: readonly number[]
}

/** 解析输入文本；仅接受正整数（>=1 的整数），其余返回 null。 */
function parsePositiveInt(raw: string): number | null {
  const text = raw.trim()
  if (text === '') return null
  const parsed = Number(text)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return null
  return parsed
}

/**
 * 「任意正整数」契约的数字输入。
 *
 * - 清空或输入非法值时不立即强制回默认值，输入框保持用户正在编辑的内容；
 * - 键入过程中一旦出现有效正整数就立即提交（下游估算可实时更新）；
 * - blur 时若仍非法（空 / 0 / 负数 / 非数值）回退到最近有效值；
 * - 不渲染 max 属性：接受任意正整数。
 */
export function PositiveIntInput({
  value,
  onChange,
  quickOptions,
  className,
  disabled,
  ...rest
}: PositiveIntInputProps) {
  const [text, setText] = useState(String(value))
  // 渲染期同步（React「在渲染期间调整状态」模式）：父值变化当帧即生效，
  // 避免 useEffect 异步同步导致读回旧值；编辑中的非法文本不受影响。
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    setText(String(value))
  }

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value
    setText(raw)
    const parsed = parsePositiveInt(raw)
    if (parsed !== null) {
      onChange(parsed)
    }
  }

  const handleBlur = () => {
    if (parsePositiveInt(text) === null) {
      setText(String(value))
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <input
        type="number"
        min={1}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        onChange={handleChange}
        onBlur={handleBlur}
        className={className}
        {...rest}
      />
      {quickOptions && quickOptions.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {quickOptions.map((option) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option)}
              className={cn(
                'rounded border border-input px-2 py-0.5 text-xs text-muted-foreground',
                'hover:border-foreground hover:text-foreground',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {option} 秒
            </button>
          ))}
        </span>
      )}
    </span>
  )
}
