import * as React from 'react'
import { List, useListRef, type RowComponentProps } from 'react-window'
import { cn } from '@/lib/utils'

/**
 * 虚拟滚动日志控制台（M4 部署监控）。
 *
 * 设计要点：
 * - 基于 react-window v2 的 `<List>`，单行高度固定以保证 O(1) 虚拟化；
 * - 自动滚动到底部：默认开启，当用户手动向上滚动（脱离底部）后暂停，
 *   回到底部后恢复；避免"越滚越跳"的恶劣体验；
 * - 支持不同 level（info/warn/error）的前缀色彩；
 * - 10 万条以内均可流畅渲染，远超常规日志页需求。
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogLine {
  /** 单行唯一 id，用于 React key（调用方可传 index 或服务端 id） */
  id: string | number
  /** 日志主文本 */
  text: string
  /** 级别（影响前缀色彩） */
  level?: LogLevel
  /** 时间戳（毫秒）；若提供则在每行前渲染 HH:mm:ss */
  ts?: number
}

export interface LogConsoleProps {
  lines: LogLine[]
  /** 行高（像素），默认 20 */
  rowHeight?: number
  /** 控制台高度（像素），默认 320 */
  height?: number
  /** 空态文案 */
  emptyText?: React.ReactNode
  /** 是否自动滚到底部；默认 true */
  autoScroll?: boolean
  className?: string
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: 'text-zinc-200',
  warn: 'text-amber-300',
  error: 'text-rose-400',
  debug: 'text-zinc-500',
}

function formatTs(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 行组件接收的业务 props（react-window v2 会再合入 index/style/ariaAttributes） */
interface LogRowProps {
  lines: LogLine[]
}

function LogRow({
  index,
  style,
  ariaAttributes,
  lines,
}: RowComponentProps<LogRowProps>) {
  const line = lines[index]
  if (!line) return null
  const color = LEVEL_COLORS[line.level ?? 'info']
  return (
    <div
      {...ariaAttributes}
      style={style}
      className={cn('flex items-baseline gap-2 whitespace-pre px-3 font-mono text-xs leading-5', color)}
    >
      {typeof line.ts === 'number' ? (
        <span className="text-zinc-500">{formatTs(line.ts)}</span>
      ) : null}
      <span className="flex-1 break-all">{line.text}</span>
    </div>
  )
}

export function LogConsole({
  lines,
  rowHeight = 20,
  height = 320,
  emptyText = 'No logs yet',
  autoScroll = true,
  className,
}: LogConsoleProps) {
  const listRef = useListRef(null)
  // 用户是否脱离底部：一旦向上滚动，暂停自动跟随
  const stickToBottomRef = React.useRef(true)

  // 新日志到达时，若仍处于"贴底"状态则滚到末尾
  React.useEffect(() => {
    if (!autoScroll) return
    if (!stickToBottomRef.current) return
    if (lines.length === 0) return
    listRef.current?.scrollToRow({ index: lines.length - 1, align: 'end', behavior: 'instant' })
  }, [lines.length, autoScroll, listRef])

  const onRowsRendered = React.useCallback(
    (visibleRows: { startIndex: number; stopIndex: number }) => {
      // 若已渲染到最后一行，认为用户"贴底"；否则视为已手动上滚
      stickToBottomRef.current = visibleRows.stopIndex >= lines.length - 1
    },
    [lines.length],
  )

  return (
    <div
      data-slot="log-console"
      className={cn(
        'overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-200',
        className,
      )}
      style={{ height }}
    >
      {lines.length === 0 ? (
        <div className="flex h-full items-center justify-center text-xs text-zinc-500">
          {emptyText}
        </div>
      ) : (
        <List
          listRef={listRef}
          rowCount={lines.length}
          rowHeight={rowHeight}
          rowComponent={LogRow}
          rowProps={{ lines }}
          onRowsRendered={onRowsRendered}
          overscanCount={5}
          style={{ height }}
        />
      )}
    </div>
  )
}

export default LogConsole

