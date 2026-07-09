import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import { useLibraryStore, SORT_OPTIONS } from '@/store/libraryStore'

export function SortMenu() {
  const sortBy = useLibraryStore((s) => s.sortBy)
  const setSortBy = useLibraryStore((s) => s.setSortBy)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const currentLabel = SORT_OPTIONS.find((o) => o.value === sortBy)?.label ?? '排序'

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  return (
    <div ref={ref} className="sort-menu">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn btn-sm"
        style={{ gap: 6, padding: '0 12px' }}
      >
        {currentLabel}
        <ChevronDown size={13} style={{ transition: 'transform 140ms', transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && (
        <div className="sort-dropdown">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setSortBy(opt.value)
                close()
              }}
              className={`sort-option${opt.value === sortBy ? ' sort-option--active' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
