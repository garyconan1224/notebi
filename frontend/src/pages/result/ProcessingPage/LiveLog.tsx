import { useEffect, useRef } from 'react'

interface LiveLogProps {
  logs: Array<{ ts: string; level: string; message: string }>
}

export function LiveLog({ logs }: LiveLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs.length])

  if (logs.length === 0) return null

  return (
    <div className="side-card">
      <h4>
        实时日志
        <span className="mono" style={{ fontSize: 10, opacity: 0.6 }}>
          {logs.length} lines
        </span>
      </h4>
      <div
        ref={scrollRef}
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          color: 'var(--ink-3)',
          maxHeight: 300,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {logs.map((l, i) => {
          const time = l.ts ? new Date(l.ts).toLocaleTimeString('zh-CN', { hour12: false }) : ''
          const levelColor =
            l.level === 'error'
              ? 'var(--accent-pink)'
              : l.level === 'warning'
                ? 'var(--accent-warm)'
                : 'var(--ink-3)'
          return (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--ink-4)', flexShrink: 0 }}>{time}</span>
              <span style={{ color: levelColor, flexShrink: 0 }}>[{l.level}]</span>
              <span>{l.message}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
