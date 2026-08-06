import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Search as SearchIcon } from 'lucide-react'
import type { KnowledgeItemRef } from '@/types/knowledgeConversation'
import type { WorkspaceRecord } from '@/types/workspace'

export type ScopeType = 'all' | 'selected'

export interface KnowledgeScopeItemOption {
  workspaceId: string
  itemId: string
  name: string
  workspaceName: string
  type: string
}

export interface KnowledgeScope {
  type: ScopeType
  workspaceIds: string[]
  itemRefs: KnowledgeItemRef[]
}

interface KnowledgeScopePickerProps {
  workspaces: WorkspaceRecord[]
  items: KnowledgeScopeItemOption[]
  scope: KnowledgeScope
  onChange: (scope: KnowledgeScope) => void
}

const SCOPE_STORAGE_KEY = 'nibi_knowledge_scope'

function uniqueItemRefs(itemRefs: KnowledgeItemRef[]): KnowledgeItemRef[] {
  const seen = new Set<string>()
  return itemRefs.filter((item) => {
    const key = `${item.workspace_id}:${item.item_id}`
    if (seen.has(key)) return false
    seen.add(key)
    return Boolean(item.workspace_id && item.item_id)
  })
}

/** 从 localStorage 恢复范围，并过滤已删除的合集和笔记。 */
export function loadPersistedScope(
  workspaces: WorkspaceRecord[],
  items: KnowledgeScopeItemOption[] = [],
): KnowledgeScope {
  try {
    const raw = localStorage.getItem(SCOPE_STORAGE_KEY)
    if (!raw) return { type: 'all', workspaceIds: [], itemRefs: [] }
    const parsed = JSON.parse(raw) as {
      type?: string
      workspaceIds?: string[]
      itemRefs?: KnowledgeItemRef[]
    }
    if (parsed.type !== 'selected') {
      return { type: 'all', workspaceIds: [], itemRefs: [] }
    }
    const validIds = new Set(workspaces.map(workspace => workspace.workspace_id))
    const workspaceIds = [...new Set(
      (parsed.workspaceIds ?? []).filter(id => validIds.has(id)),
    )]
    const validItemKeys = new Set(
      items.map(item => `${item.workspaceId}:${item.itemId}`),
    )
    const itemRefs = uniqueItemRefs(parsed.itemRefs ?? []).filter(ref => (
      validItemKeys.has(`${ref.workspace_id}:${ref.item_id}`)
    ))
    if (workspaceIds.length === 0 && itemRefs.length === 0) {
      return { type: 'all', workspaceIds: [], itemRefs: [] }
    }
    return { type: 'selected', workspaceIds, itemRefs }
  } catch {
    return { type: 'all', workspaceIds: [], itemRefs: [] }
  }
}

export function persistScope(scope: KnowledgeScope): void {
  try {
    localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope))
  } catch { /* ignore quota errors */ }
}

/** 范围摘要文案。合集和单篇笔记按并集检索。 */
export function scopeSummary(
  t: (k: string, o?: Record<string, unknown>) => string,
  scope: KnowledgeScope,
  workspaces: WorkspaceRecord[],
  items: KnowledgeScopeItemOption[] = [],
): string {
  if (scope.type === 'all') return t('knowledge.allNotes')
  const itemRefs = scope.itemRefs ?? []
  const count = scope.workspaceIds.length + itemRefs.length
  if (count === 0) return t('knowledge.chooseScope')
  if (count === 1 && scope.workspaceIds.length === 1) {
    const workspace = workspaces.find(item => item.workspace_id === scope.workspaceIds[0])
    return workspace?.name ?? t('knowledge.oneCollection')
  }
  if (count === 1 && itemRefs.length === 1) {
    const ref = itemRefs[0]
    const item = items.find(option => (
      option.workspaceId === ref.workspace_id && option.itemId === ref.item_id
    ))
    return item ? t('knowledge.noteItem', { name: item.name }) : t('knowledge.oneNote')
  }
  return t('knowledge.multiScope', { workspaces: scope.workspaceIds.length, notes: itemRefs.length })
}

export function KnowledgeScopePicker({
  workspaces,
  items,
  scope,
  onChange,
}: KnowledgeScopePickerProps) {
  const { t } = useTranslation('pages')
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const query = filter.trim().toLowerCase()
  const filteredWorkspaces = useMemo(() => (
    !query ? workspaces : workspaces.filter(workspace => (
      workspace.name.toLowerCase().includes(query)
    ))
  ), [query, workspaces])
  const filteredItems = useMemo(() => (
    !query ? items : items.filter(item => (
      item.name.toLowerCase().includes(query)
      || item.workspaceName.toLowerCase().includes(query)
    ))
  ), [items, query])

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    setFilter('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const selectedItemRefs = scope.itemRefs ?? []

  const toggleWorkspace = useCallback((workspaceId: string) => {
    const workspaceIds = scope.workspaceIds.includes(workspaceId)
      ? scope.workspaceIds.filter(id => id !== workspaceId)
      : [...scope.workspaceIds, workspaceId]
    onChange({ type: 'selected', workspaceIds, itemRefs: selectedItemRefs })
  }, [onChange, scope])

  const toggleItem = useCallback((item: KnowledgeScopeItemOption) => {
    const exists = selectedItemRefs.some(ref => (
      ref.workspace_id === item.workspaceId && ref.item_id === item.itemId
    ))
    const nextItemRefs = exists
      ? selectedItemRefs.filter(ref => (
        ref.workspace_id !== item.workspaceId || ref.item_id !== item.itemId
      ))
      : [...selectedItemRefs, {
        workspace_id: item.workspaceId,
        item_id: item.itemId,
      }]
    onChange({
      type: 'selected',
      workspaceIds: scope.workspaceIds,
      itemRefs: nextItemRefs,
    })
  }, [onChange, scope])

  const selectAll = useCallback(() => {
    onChange({ type: 'all', workspaceIds: [], itemRefs: [] })
  }, [onChange])

  const clearSelection = useCallback(() => {
    onChange({ type: 'selected', workspaceIds: [], itemRefs: [] })
  }, [onChange])

  const isAll = scope.type === 'all'
  const summary = scopeSummary(t, scope, workspaces, items)
  const selectedCount = scope.workspaceIds.length + selectedItemRefs.length

  return (
    <div className="scope-picker" ref={containerRef}>
      <button
        type="button"
        className="scope-picker-trigger"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('knowledge.scopeTitle')}
      >
        <span className="scope-picker-label">{summary}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="scope-picker-popover" role="listbox" aria-label={t('knowledge.chooseScopeTitle')}>
          <div className="scope-picker-search">
            <SearchIcon size={13} />
            <input
              ref={inputRef}
              value={filter}
              onChange={event => setFilter(event.target.value)}
              placeholder={t('knowledge.searchPlaceholder')}
              aria-label={t('knowledge.searchAria')}
            />
          </div>

          <div className="scope-picker-actions">
            <button
              type="button"
              className="scope-picker-action-btn"
              onClick={selectAll}
              data-active={isAll}
            >
              全部笔记
            </button>
            <button
              type="button"
              className="scope-picker-action-btn"
              onClick={clearSelection}
              disabled={isAll || selectedCount === 0}
            >
              清空
            </button>
          </div>

          <div className="scope-picker-list">
            <div className="scope-picker-section-label">{t('knowledge.collectionsTab')}</div>
            {filteredWorkspaces.map(workspace => {
              const checked = isAll || scope.workspaceIds.includes(workspace.workspace_id)
              return (
                <button
                  key={workspace.workspace_id}
                  type="button"
                  className="scope-picker-item"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggleWorkspace(workspace.workspace_id)}
                >
                  <span className="scope-picker-check">
                    {checked && <Check size={13} />}
                  </span>
                  <span className="scope-picker-name">{workspace.name}</span>
                  <span className="scope-picker-meta">{t('knowledge.collectionsTab')}</span>
                </button>
              )
            })}
            <div className="scope-picker-section-label">{t('knowledge.notesTab')}</div>
            {filteredItems.map(item => {
              const checked = isAll || selectedItemRefs.some(ref => (
                ref.workspace_id === item.workspaceId && ref.item_id === item.itemId
              ))
              return (
                <button
                  key={`${item.workspaceId}:${item.itemId}`}
                  type="button"
                  className="scope-picker-item"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggleItem(item)}
                >
                  <span className="scope-picker-check">
                    {checked && <Check size={13} />}
                  </span>
                  <span className="scope-picker-name">{item.name}</span>
                  <span className="scope-picker-meta">{item.workspaceName}</span>
                </button>
              )
            })}
            {filteredWorkspaces.length === 0 && filteredItems.length === 0 && (
              <div className="scope-picker-empty">{t('knowledge.noMatch')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
