import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Trash2, Plus, Inbox, Filter, FolderInput, FolderPlus } from 'lucide-react'
import { toast } from 'sonner'
import { fetchLibrary, deleteItem, batchDeleteItems, batchAddItemsToWorkspace, type LibraryItem, type LibraryResponse, type LibraryWorkspace } from '@/services/library'
import { createWorkspace, deleteWorkspace, updateWorkspace, favoriteItem, unfavoriteItem } from '@/services/workspaces'
import { useLibraryStore, type SortBy } from '@/store/libraryStore'
import { useTaskStore } from '@/store/taskStore'
import { FilterChips } from './FilterChips'
import { SortMenu } from './SortMenu'
import { ViewToggle } from './ViewToggle'
import { ItemCard } from './ItemCard'
import { WorkspaceCard } from './WorkspaceCard'
import {
  STATE_ORDER,
  primaryStatusToState,
} from './libraryHelpers'
import './library.css'

function matchesQuery(query: string, values: Array<string | null | undefined>): boolean {
  if (!query) return true
  return values.some((value) => value?.toLowerCase().includes(query))
}

function isItemGenerating(item: LibraryItem): boolean {
  const taskState = primaryStatusToState(item.primary_task_status)
  return taskState === 'queued' || taskState === 'running' || item.status === 'pending' || item.status === 'processing'
}

function sortItems(items: LibraryItem[], sortBy: SortBy): LibraryItem[] {
  const arr = [...items]

  switch (sortBy) {
    case 'created_desc':
      return arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    case 'created_asc':
      return arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    case 'completed_desc':
      return arr.sort((a, b) => {
        const aDone = a.status === 'done' ? new Date(a.updated_at).getTime() : 0
        const bDone = b.status === 'done' ? new Date(b.updated_at).getTime() : 0
        if (aDone && bDone) return bDone - aDone
        if (aDone) return -1
        if (bDone) return 1
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
    case 'duration_desc':
      return arr.sort((a, b) => {
        const da = a.duration_seconds ?? -1
        const db = b.duration_seconds ?? -1
        if (da >= 0 && db >= 0) return db - da
        if (da >= 0) return -1
        if (db >= 0) return 1
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
    case 'duration_asc':
      return arr.sort((a, b) => {
        const da = a.duration_seconds ?? -1
        const db = b.duration_seconds ?? -1
        if (da >= 0 && db >= 0) return da - db
        if (da >= 0) return -1
        if (db >= 0) return 1
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
    case 'status':
      return arr.sort((a, b) => {
        const sa = STATE_ORDER[primaryStatusToState(a.primary_task_status)] ?? 9
        const sb = STATE_ORDER[primaryStatusToState(b.primary_task_status)] ?? 9
        if (sa !== sb) return sa - sb
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
    default:
      return arr
  }
}

type LibraryEntry =
  | { kind: 'workspace'; workspace: LibraryWorkspace; items: LibraryItem[] }
  | { kind: 'item'; item: LibraryItem }

function entryCreatedAt(entry: LibraryEntry): number {
  const iso = entry.kind === 'item' ? entry.item.created_at : entry.workspace.updated_at
  return new Date(iso).getTime()
}

function entryUpdatedAt(entry: LibraryEntry): number {
  const iso = entry.kind === 'item' ? entry.item.updated_at : entry.workspace.updated_at
  return new Date(iso).getTime()
}

function entryDoneAt(entry: LibraryEntry): number {
  if (entry.kind === 'item') {
    return entry.item.status === 'done' ? new Date(entry.item.updated_at).getTime() : 0
  }
  const isRunning = entry.workspace.status === 'running' || entry.items.some(isItemGenerating)
  return isRunning ? 0 : new Date(entry.workspace.updated_at).getTime()
}

function entryDuration(entry: LibraryEntry): number {
  return entry.kind === 'item' ? entry.item.duration_seconds ?? -1 : -1
}

function entryStateOrder(entry: LibraryEntry): number {
  if (entry.kind === 'item') {
    return STATE_ORDER[primaryStatusToState(entry.item.primary_task_status)] ?? 9
  }
  const state = entry.workspace.status === 'running' || entry.items.some(isItemGenerating) ? 'running' : 'done'
  return STATE_ORDER[state] ?? 9
}

function sortLibraryEntries(entries: LibraryEntry[], sortBy: SortBy): LibraryEntry[] {
  const arr = [...entries]
  switch (sortBy) {
    case 'created_desc':
      return arr.sort((a, b) => entryCreatedAt(b) - entryCreatedAt(a))
    case 'created_asc':
      return arr.sort((a, b) => entryCreatedAt(a) - entryCreatedAt(b))
    case 'completed_desc':
      return arr.sort((a, b) => {
        const aDone = entryDoneAt(a)
        const bDone = entryDoneAt(b)
        if (aDone && bDone) return bDone - aDone
        if (aDone) return -1
        if (bDone) return 1
        return entryCreatedAt(b) - entryCreatedAt(a)
      })
    case 'duration_desc':
      return arr.sort((a, b) => {
        const da = entryDuration(a)
        const db = entryDuration(b)
        if (da >= 0 && db >= 0) return db - da
        if (da >= 0) return -1
        if (db >= 0) return 1
        return entryCreatedAt(b) - entryCreatedAt(a)
      })
    case 'duration_asc':
      return arr.sort((a, b) => {
        const da = entryDuration(a)
        const db = entryDuration(b)
        if (da >= 0 && db >= 0) return da - db
        if (da >= 0) return -1
        if (db >= 0) return 1
        return entryCreatedAt(b) - entryCreatedAt(a)
      })
    case 'status':
      return arr.sort((a, b) => {
        const sa = entryStateOrder(a)
        const sb = entryStateOrder(b)
        if (sa !== sb) return sa - sb
        return entryUpdatedAt(b) - entryUpdatedAt(a)
      })
    default:
      return arr
  }
}

export default function LibraryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const intentFilter = searchParams.get('intent') || ''
  const [data, setData] = useState<LibraryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [addingToCollection, setAddingToCollection] = useState(false)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [collectionTargetId, setCollectionTargetId] = useState('')
  const [query, setQuery] = useState('')

  const selectedFilters = useLibraryStore((s) => s.selectedFilters)
  const setSelectedFilters = useLibraryStore((s) => s.setSelectedFilters)
  const sortBy = useLibraryStore((s) => s.sortBy)
  const viewMode = useLibraryStore((s) => s.viewMode)
  const cardColumns = useLibraryStore((s) => s.cardColumns)
  const selectionKey = (wsId: string, itemId: string) => `${wsId}:${itemId}`

  const toggleSelect = useCallback((itemId: string, wsId: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      const key = `${wsId}:${itemId}`
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  const toggleWorkspaceSelect = useCallback((wsId: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      const key = `ws:${wsId}`
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedSet(new Set())
    setSelecting(false)
  }, [])

  const enterSelectMode = useCallback(() => {
    setSelectedSet(new Set())
    setSelecting(true)
  }, [])

  const selectMode = selecting

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchLibrary(false)
      setData(res)
    } catch {
      setError('加载资料库失败，请确认后端已启动')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const typeFilters = selectedFilters.filter(
    (k): k is LibraryItem['type'] => k === 'video' || k === 'audio' || k === 'image' || k === 'text',
  )
  const showCollections = selectedFilters.includes('collection')
  const showRunning = selectedFilters.includes('running')
  const showAll = selectedFilters.includes('all')
  const normalizedQuery = query.trim().toLowerCase()

  const scopedItems = useMemo(() => {
    if (!data) return []
    let items = data.items
    if (intentFilter) items = items.filter((it) => it.preflight?.intent === intentFilter)
    return items
  }, [data, intentFilter])

  const scopedWorkspaces = useMemo(() => {
    if (!data) return []
    return data.workspaces
  }, [data])

  const itemsByWorkspace = useMemo(() => {
    const map = new Map<string, LibraryItem[]>()
    scopedItems.forEach((item) => {
      const current = map.get(item.workspace_id)
      if (current) current.push(item)
      else map.set(item.workspace_id, [item])
    })
    return map
  }, [scopedItems])

  const collectionWorkspaces = useMemo(
    () => scopedWorkspaces.filter((ws) => {
      const count = itemsByWorkspace.get(ws.workspace_id)?.length ?? ws.items_count
      return count === 0 || count > 1
    }),
    [scopedWorkspaces, itemsByWorkspace],
  )

  const collectionWorkspaceIds = useMemo(
    () => new Set(collectionWorkspaces.map((ws) => ws.workspace_id)),
    [collectionWorkspaces],
  )

  useEffect(() => {
    if (collectionWorkspaces.length === 0) {
      if (collectionTargetId) setCollectionTargetId('')
      return
    }
    if (!collectionTargetId || !collectionWorkspaces.some((ws) => ws.workspace_id === collectionTargetId)) {
      setCollectionTargetId(collectionWorkspaces[0].workspace_id)
    }
  }, [collectionTargetId, collectionWorkspaces])

  const visibleWorkspaces = useMemo(() => {
    if (!data) return []
    if (!(showAll || showCollections || showRunning)) return []
    return collectionWorkspaces.filter((ws) => {
      const wsItems = itemsByWorkspace.get(ws.workspace_id) ?? []
      if (typeFilters.length > 0 && !wsItems.some((item) => typeFilters.includes(item.type))) return false
      if (showRunning && !(ws.status === 'running' || wsItems.some(isItemGenerating))) return false
      if (!matchesQuery(normalizedQuery, [ws.name, ...wsItems.flatMap((item) => [item.name, item.source_value, item.workspace_name, item.description])])) return false
      return true
    })
  }, [data, showAll, showCollections, showRunning, collectionWorkspaces, itemsByWorkspace, typeFilters, normalizedQuery])

  const visibleWorkspaceIds = useMemo(
    () => new Set(visibleWorkspaces.map((ws) => ws.workspace_id)),
    [visibleWorkspaces],
  )

  const visibleItems = useMemo(() => {
    let items = scopedItems
    if (!showAll) {
      if (typeFilters.length > 0) {
        items = items.filter((item) => typeFilters.includes(item.type))
      }
      if (showRunning) {
        items = items.filter(isItemGenerating)
      }
      if (showCollections && typeFilters.length === 0 && !showRunning) {
        return []
      }
      if (typeFilters.length === 0 && !showRunning && !showCollections) {
        return []
      }
    }
    if (visibleWorkspaceIds.size > 0) {
      items = items.filter((item) => !visibleWorkspaceIds.has(item.workspace_id))
    }
    if (normalizedQuery) {
      items = items.filter((item) => matchesQuery(normalizedQuery, [item.name, item.source_value, item.workspace_name, item.description]))
    }
    return sortItems(items, sortBy)
  }, [scopedItems, showAll, showRunning, showCollections, typeFilters, visibleWorkspaceIds, normalizedQuery, sortBy])

  const visibleEntries = useMemo<LibraryEntry[]>(() => {
    const workspaceEntries: LibraryEntry[] = visibleWorkspaces.map((workspace) => ({
      kind: 'workspace',
      workspace,
      items: itemsByWorkspace.get(workspace.workspace_id) ?? [],
    }))
    const itemEntries: LibraryEntry[] = visibleItems.map((item) => ({ kind: 'item', item }))
    return sortLibraryEntries([...workspaceEntries, ...itemEntries], sortBy)
  }, [visibleWorkspaces, visibleItems, itemsByWorkspace, sortBy])

  const hasVisibleEntries = visibleEntries.length > 0

  const selectedItemRefs = useMemo(() => {
    const refs = new Map<string, { workspace_id: string; item_id: string }>()
    Array.from(selectedSet).forEach((key) => {
      if (key.startsWith('ws:')) {
        const wsId = key.slice(3)
        ;(itemsByWorkspace.get(wsId) ?? []).forEach((item) => {
          refs.set(`${item.workspace_id}:${item.item_id}`, {
            workspace_id: item.workspace_id,
            item_id: item.item_id,
          })
        })
        return
      }
      const [ws, ...rest] = key.split(':')
      const itemId = rest.join(':')
      if (ws && itemId) refs.set(key, { workspace_id: ws, item_id: itemId })
    })
    return Array.from(refs.values())
  }, [selectedSet, itemsByWorkspace])

  const selectAll = useCallback(() => {
    const next = new Set<string>()
    visibleItems.forEach((it) => next.add(selectionKey(it.workspace_id, it.item_id)))
    visibleWorkspaces.forEach((ws) => next.add(`ws:${ws.workspace_id}`))
    setSelectedSet(next)
  }, [visibleItems, visibleWorkspaces])

  const handleDeleteOne = useCallback(async (item: LibraryItem) => {
    const label = item.name || '未命名'
    const ok = window.confirm(`确定删除「${label}」？`)
    if (!ok) return
    try {
      await deleteItem(item.workspace_id, item.item_id)
      // 阶段 C2：只精确移除该 item 的 related_task_ids，不清掉同合集其它素材的任务。
      // related_task_ids 缺失时不兜底 removeByProject——后端已删任务，下一轮轮询会同步掉。
      const tids = item.related_task_ids ?? []
      if (tids.length > 0) useTaskStore.getState().removeTasks(tids)
      toast.success(`已删除「${label}」`)
      load()
    } catch {
      toast.error('删除失败，请重试')
    }
  }, [load])

  const handleDeleteWorkspace = useCallback(async (wsId: string) => {
    const ws = data?.workspaces.find((w) => w.workspace_id === wsId)
    const label = ws?.name || '未命名合集'
    const ok = window.confirm(`确定删除合集「${label}」？`)
    if (!ok) return
    try {
      await deleteWorkspace(wsId)
      // 1-C：即时移除该 workspace 关联的所有任务
      useTaskStore.getState().removeByProject(wsId)
      toast.success(`已删除合集「${label}」`)
      load()
    } catch {
      toast.error('删除合集失败，请重试')
    }
  }, [data, load])

  const handleBatchDelete = useCallback(async () => {
    if (selectedSet.size === 0) return
    const ok = window.confirm(`确定删除选中的 ${selectedSet.size} 项？此操作不可撤销。`)
    if (!ok) return
    setDeleting(true)
    try {
      const items: { workspace_id: string; item_id: string }[] = []
      const wsIds: string[] = []
      Array.from(selectedSet).forEach((key) => {
        if (key.startsWith('ws:')) {
          wsIds.push(key.slice(3))
        } else {
          const [ws, ...rest] = key.split(':')
          items.push({ workspace_id: ws, item_id: rest.join(':') })
        }
      })
      let removedCount = 0
      let failedCount = 0
      const removedItemIds = new Set<string>()
      const fulfilledWorkspaceIds = new Set<string>()
      if (items.length > 0) {
        const result = await batchDeleteItems(items)
        removedCount += result.removed
        failedCount += result.failed
        result.removed_ids.forEach((id) => removedItemIds.add(id))
      }
      if (wsIds.length > 0) {
        // 合集逐个删除，用 allSettled 汇总，避免单个失败吞掉整体结果
        const settled = await Promise.allSettled(wsIds.map((id) => deleteWorkspace(id)))
        settled.forEach((r, i) => {
          if (r.status === 'fulfilled') {
            removedCount += 1
            fulfilledWorkspaceIds.add(wsIds[i])
          } else {
            failedCount += 1
          }
        })
      }
      // P1 修复：
      // - 删除单个 item：只根据 removed_ids 精确移除关联任务，失败项任务保留，
      //   避免失败素材的任务被错误隐藏、刷新后又重新出现。
      // - 软删除整个合集：只对实际删除成功的合集用 removeByProject
      //   （后端 list_tasks 已过滤 trashed workspace）；删除失败的合集任务必须保留。
      const store = useTaskStore.getState()
      const itemTaskIds = items
        .filter((it) => removedItemIds.has(it.item_id))
        .flatMap((it) => {
          const found = itemsByWorkspace.get(it.workspace_id)?.find((x) => x.item_id === it.item_id)
          return found?.related_task_ids ?? []
        })
      if (itemTaskIds.length > 0) store.removeTasks(itemTaskIds)
      fulfilledWorkspaceIds.forEach((pid) => store.removeByProject(pid))
      if (failedCount > 0) {
        toast.warning(`已删除 ${removedCount} 项，${failedCount} 项删除失败`)
      } else {
        toast.success(`已删除 ${removedCount} 项`)
      }
      setSelectedSet(new Set())
      load()
    } catch {
      toast.error('批量删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }, [selectedSet, load, itemsByWorkspace])

  const handleBatchAddToCollection = useCallback(async () => {
    if (!collectionTargetId) {
      toast.error('请先选择目标合集')
      return
    }
    if (selectedItemRefs.length === 0) {
      toast.error('请选择要复制到合集的内容')
      return
    }
    setAddingToCollection(true)
    const targetName = collectionWorkspaces.find((ws) => ws.workspace_id === collectionTargetId)?.name || '合集'
    try {
      const res = await batchAddItemsToWorkspace(collectionTargetId, selectedItemRefs)
      if (res.added > 0) {
        toast.success(`已复制 ${res.added} 项到「${targetName}」${res.skipped ? `，${res.skipped} 项已存在` : ''}`)
        setSelectedSet(new Set())
        setSelecting(false)
      } else if (res.skipped > 0) {
        toast.info(`选中内容已在「${targetName}」中`)
      } else {
        toast.error('没有内容被复制到合集')
      }
      if (res.failed > 0) {
        toast.error(`${res.failed} 项加入失败，请检查目标合集类型`)
      }
      await load()
    } catch {
      toast.error('复制到合集失败，请重试')
    } finally {
      setAddingToCollection(false)
    }
  }, [collectionTargetId, selectedItemRefs, collectionWorkspaces, load])

  const handleCreateCollection = useCallback(async () => {
    setCreatingWorkspace(true)
    try {
      const name = '新笔记合集'
      await createWorkspace({ name })
      setSelectedFilters(['collection'])
      toast.success('已创建笔记合集')
      await load()
    } catch {
      toast.error('创建合集失败，请重试')
    } finally {
      setCreatingWorkspace(false)
    }
  }, [load, setSelectedFilters])

  const handleRenameWorkspace = useCallback(async (workspaceId: string, name: string) => {
    try {
      await updateWorkspace(workspaceId, { name })
      toast.success(`已重命名为「${name}」`)
      await load()
    } catch {
      toast.error('重命名合集失败，请重试')
    }
  }, [load])

  const handleToggleFavorite = useCallback(async (item: LibraryItem) => {
    try {
      if (item.favorite) {
        await unfavoriteItem(item.workspace_id, item.item_id)
        toast.success('已取消收藏')
      } else {
        await favoriteItem(item.workspace_id, item.item_id)
        toast.success('已加入笔记收藏')
      }
      await load()
    } catch {
      toast.error('收藏状态更新失败，请重试')
    }
  }, [load])

  const chipCounts = useMemo(() => {
    if (!data) return undefined
    const standaloneItems = scopedItems.filter((item) => !collectionWorkspaceIds.has(item.workspace_id))
    return {
      all: standaloneItems.length + collectionWorkspaces.length,
      video: scopedItems.filter((i) => i.type === 'video').length,
      audio: scopedItems.filter((i) => i.type === 'audio').length,
      image: scopedItems.filter((i) => i.type === 'image').length,
      text: scopedItems.filter((i) => i.type === 'text').length,
      collection: collectionWorkspaces.length,
      running:
        standaloneItems.filter(isItemGenerating).length +
        collectionWorkspaces.filter((ws) => ws.status === 'running' || (itemsByWorkspace.get(ws.workspace_id) ?? []).some(isItemGenerating)).length,
    }
  }, [data, scopedItems, collectionWorkspaces, collectionWorkspaceIds, itemsByWorkspace])

  const emptyTitle = '暂无笔记'
  const emptyDesc = '去工作台添加学习素材，或粘贴一个链接开始吧'

  const pageTone = 'note'
  const pageKicker = 'NOTE LIBRARY'

  return (
    <div className={`lib-page lib-page--${pageTone}`}>
      {/* ── Hero：只保留标题、说明、导入内容、新建合集 ── */}
      <div className="lib-page-header">
        <div>
          <div className="lib-kicker">{pageKicker} · LOCAL</div>
          <h2>
            所有做过的笔记，都在这里汇总。
          </h2>
          <p>
            视频、音频、图片和文本都保留各自入口，只把最需要的操作放在第一层。
          </p>
          <div className="lib-hero-actions">
            <button className="lib-cta lib-cta-primary" onClick={() => navigate('/')}>
              <Plus size={15} />
              导入内容
            </button>
            <button
              className="lib-cta lib-cta-secondary"
              onClick={handleCreateCollection}
              disabled={creatingWorkspace}
            >
              <FolderPlus size={15} />
              {creatingWorkspace ? '创建中…' : '新建合集'}
            </button>
          </div>
        </div>
      </div>

      {/* ── 工具栏 / 批量栏 ── */}
      {selectMode ? (
        <div className="lib-toolbar lib-toolbar--batch">
          <span className="batch-count">已选 {selectedItemRefs.length} 项</span>
          <button className="btn btn-sm" onClick={selectAll}>全选</button>
          <button className="btn btn-sm" onClick={clearSelection}>取消</button>
          {collectionWorkspaces.length > 0 && (
            <div className="batch-collection-control">
              <select
                value={collectionTargetId}
                onChange={(event) => setCollectionTargetId(event.target.value)}
                title="选择目标合集"
              >
                {collectionWorkspaces.map((ws) => (
                  <option key={ws.workspace_id} value={ws.workspace_id}>
                    {ws.name}
                  </option>
                ))}
              </select>
              <button
                className={`btn btn-sm${selectedItemRefs.length > 0 ? ' btn-secondary' : ''}`}
                disabled={addingToCollection || selectedItemRefs.length === 0 || !collectionTargetId}
                onClick={handleBatchAddToCollection}
              >
                <FolderInput size={13} />
                {addingToCollection ? '复制中…' : '复制到合集'}
              </button>
            </div>
          )}
          <button
            className={`btn btn-sm${selectedSet.size > 0 ? ' btn-danger' : ''}`}
            disabled={deleting || selectedSet.size === 0}
            onClick={handleBatchDelete}
          >
            <Trash2 size={13} />
            删除{selectedSet.size > 0 ? ` (${selectedSet.size})` : ''}
          </button>
        </div>
      ) : (
        <div className="lib-toolbar">
          <FilterChips counts={chipCounts} />
          <div className="lib-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="搜索标题、来源、摘要..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <SortMenu />
          {hasVisibleEntries && (
            <button className="btn btn-sm" onClick={enterSelectMode}>选择</button>
          )}
          <ViewToggle />
        </div>
      )}

      {/* ── 内容区 ── */}
      {loading && (
        <div className="empty-state">
          <div className="spinner" />
          <div className="empty-state-desc">加载资料库…</div>
        </div>
      )}

      {error && (
        <div className="empty-state lib-error">
          <div className="empty-state-title">{error}</div>
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={load}>
            重试
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {!hasVisibleEntries ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                {(showCollections || showRunning || typeFilters.length > 0 || query.trim()) ? (
                  <Filter size={24} strokeWidth={1.5} />
                ) : (
                  <Inbox size={24} strokeWidth={1.5} />
                )}
              </div>
              <div className="empty-state-title">
                {showAll && chipCounts?.all === 0 ? emptyTitle : '没有匹配的笔记'}
              </div>
              <div className="empty-state-desc">
                {showAll && chipCounts?.all === 0 ? emptyDesc : '试试切换筛选条件或清除 chip'}
              </div>
            </div>
          ) : (
            <div className={`note-grid note-grid--cols-${cardColumns}${viewMode === 'list' ? ' is-list' : ''}`}>
              {visibleEntries.map((entry) => (
                entry.kind === 'workspace' ? (
                  <WorkspaceCard
                    key={entry.workspace.workspace_id}
                    workspace={entry.workspace}
                    items={entry.items}
                    selectMode={selectMode}
                    selected={selectedSet.has(`ws:${entry.workspace.workspace_id}`)}
                    onToggleSelect={toggleWorkspaceSelect}
                    onDelete={handleDeleteWorkspace}
                    onRename={handleRenameWorkspace}
                  />
                ) : (
                  <ItemCard
                    key={`${entry.item.workspace_id}:${entry.item.item_id}`}
                    item={entry.item}
                    selected={selectedSet.has(selectionKey(entry.item.workspace_id, entry.item.item_id))}
                    selectMode={selectMode}
                    onToggleSelect={toggleSelect}
                    onDelete={handleDeleteOne}
                    onToggleFavorite={handleToggleFavorite}
                  />
                )
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
