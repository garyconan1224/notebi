import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search as SearchIcon } from 'lucide-react'
import type { WorkspaceRecord } from '@/types/workspace'

export type ScopeType = 'all' | 'selected'

export interface KnowledgeScope {
  type: ScopeType
  workspaceIds: string[]
}

interface KnowledgeScopePickerProps {
  workspaces: WorkspaceRecord[]
  scope: KnowledgeScope
  onChange: (scope: KnowledgeScope) => void
}

const SCOPE_STORAGE_KEY = 'nibi_knowledge_scope'

/** 从 localStorage 恢复范围，过滤已不存在的 workspace ID */
export function loadPersistedScope(workspaces: WorkspaceRecord[]): KnowledgeScope {
  try {
    const raw = localStorage.getItem(SCOPE_STORAGE_KEY)
    if (!raw) return { type: 'all', workspaceIds: [] }
    const parsed = JSON.parse(raw) as { type?: string; workspaceIds?: string[] }
    if (parsed.type === 'selected' && Array.isArray(parsed.workspaceIds)) {
      const validIds = new Set(workspaces.map(w => w.workspace_id))
      const filtered = [...new Set(parsed.workspaceIds.filter(id => validIds.has(id)))]
      if (filtered.length === 0) return { type: 'all', workspaceIds: [] }
      return { type: 'selected', workspaceIds: filtered }
    }
    return { type: 'all', workspaceIds: [] }
  } catch {
    return { type: 'all', workspaceIds: [] }
  }
}

export function persistScope(scope: KnowledgeScope): void {
  try {
    localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope))
  } catch { /* ignore quota errors */ }
}

/** 范围摘要文案 */
export function scopeSummary(scope: KnowledgeScope, workspaces: WorkspaceRecord[]): string {
  if (scope.type === 'all') return '全部合集'
  if (scope.workspaceIds.length === 1) {
    const ws = workspaces.find(w => w.workspace_id === scope.workspaceIds[0])
    return ws?.name ?? '已选 1 个合集'
  }
  return `已选 ${scope.workspaceIds.length} 个合集`
}

export function KnowledgeScopePicker({ workspaces, scope, onChange }: KnowledgeScopePickerProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return workspaces
    return workspaces.filter(w => w.name.toLowerCase().includes(q))
  }, [workspaces, filter])

  // Click outside to close
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Esc to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      setFilter('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const toggleWorkspace = useCallback((id: string) => {
    const current = scope.workspaceIds
    const next = current.includes(id)
      ? current.filter(x => x !== id)
      : [...current, id]
    if (next.length === 0) {
      onChange({ type: 'all', workspaceIds: [] })
    } else {
      onChange({ type: 'selected', workspaceIds: next })
    }
  }, [scope, onChange])

  const selectAll = useCallback(() => {
    onChange({ type: 'all', workspaceIds: [] })
  }, [onChange])

  const clearSelection = useCallback(() => {
    onChange({ type: 'all', workspaceIds: [] })
  }, [onChange])

  const isAll = scope.type === 'all'
  const summary = scopeSummary(scope, workspaces)

  return (
    <div className="scope-picker" ref={containerRef}>
      <button
        type="button"
        className="scope-picker-trigger"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="知识库范围"
      >
        <span className="scope-picker-label">{summary}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="scope-picker-popover" role="listbox" aria-label="选择合集范围">
          <div className="scope-picker-search">
            <SearchIcon size={13} />
            <input
              ref={inputRef}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="搜索合集…"
              aria-label="搜索合集"
            />
          </div>

          <div className="scope-picker-actions">
            <button
              type="button"
              className="scope-picker-action-btn"
              onClick={selectAll}
              data-active={isAll}
            >
              全选（全部合集）
            </button>
            <button
              type="button"
              className="scope-picker-action-btn"
              onClick={clearSelection}
            >
              清空
            </button>
          </div>

          <ul className="scope-picker-list">
            {filtered.map(ws => {
              const checked = isAll || scope.workspaceIds.includes(ws.workspace_id)
              return (
                <li key={ws.workspace_id}>
                  <button
                    type="button"
                    className="scope-picker-item"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggleWorkspace(ws.workspace_id)}
                  >
                    <span className="scope-picker-check">
                      {checked && <Check size={13} />}
                    </span>
                    <span className="scope-picker-name">{ws.name}</span>
                  </button>
                </li>
              )
            })}
            {filtered.length === 0 && (
              <li className="scope-picker-empty">无匹配合集</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
