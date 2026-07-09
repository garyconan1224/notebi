import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  SYSTEM_TAG_DIMENSIONS,
  type DimensionSpec,
} from '@/constants/tagDimensions'
import type { SystemTagDimension } from '@/types/workspace'

/** 一个维度的当前选中值（多选） */
export type DimensionSelection = Partial<Record<SystemTagDimension, string[]>>

export interface TagFilterState {
  dimensions: DimensionSelection
  /** custom_tags 走 contains，前端文本框输入 */
  customQuery: string
}

interface Props {
  value: TagFilterState
  onChange: (next: TagFilterState) => void
}

export function TagFilterBar({ value, onChange }: Props) {
  const totalSelected = useMemo(() => {
    let n = 0
    for (const arr of Object.values(value.dimensions)) {
      if (arr && arr.length > 0) n += arr.length
    }
    if (value.customQuery.trim()) n += 1
    return n
  }, [value])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">筛选：</span>
      {SYSTEM_TAG_DIMENSIONS.map(dim => (
        <DimensionChip
          key={dim.key}
          dim={dim}
          selected={value.dimensions[dim.key] ?? []}
          onChange={next =>
            onChange({
              ...value,
              dimensions: { ...value.dimensions, [dim.key]: next },
            })
          }
        />
      ))}
      <CustomTagsInput
        value={value.customQuery}
        onChange={next => onChange({ ...value, customQuery: next })}
      />
      {totalSelected > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() => onChange({ dimensions: {}, customQuery: '' })}
        >
          <X size={12} className="mr-1" />
          清除（{totalSelected}）
        </Button>
      )}
    </div>
  )
}

function DimensionChip({
  dim,
  selected,
  onChange,
}: {
  dim: DimensionSpec
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const toggle = (choice: string) => {
    if (selected.includes(choice)) {
      onChange(selected.filter(c => c !== choice))
    } else {
      onChange([...selected, choice])
    }
  }

  const activeLabel =
    selected.length === 0
      ? dim.label
      : selected.length === 1
        ? `${dim.label}: ${selected[0]}`
        : `${dim.label} (${selected.length})`

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-full border px-3 text-xs transition-colors',
          selected.length > 0
            ? 'border-primary/40 bg-primary/10 text-foreground'
            : 'border-border bg-background text-muted-foreground hover:bg-accent',
        )}
      >
        {activeLabel}
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-[160px] rounded-md border border-border bg-popover p-2 shadow-md">
          <ul className="space-y-1">
            {dim.choices.map(choice => (
              <li key={choice}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent">
                  <Checkbox
                    checked={selected.includes(choice)}
                    onCheckedChange={() => toggle(choice)}
                  />
                  <span>{choice}</span>
                </label>
              </li>
            ))}
          </ul>
          {selected.length > 0 && (
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent"
              >
                清除选择
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CustomTagsInput({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <Input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="自定义标签…"
      className="h-7 w-40 text-xs"
    />
  )
}
