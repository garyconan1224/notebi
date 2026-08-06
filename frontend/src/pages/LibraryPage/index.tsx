import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Trash2, Plus, Inbox, Filter, FolderInput, FolderPlus } from 'lucide-react'
import { toast } from 'sonner'
import { fetchLibrary, deleteItem, batchDeleteItems, batchAddItemsToWorkspace, type LibraryItem, type LibraryResponse, type LibraryWorkspace } from '@/services/library'
import { createWorkspace, deleteWorkspace, updateWorkspace, favoriteItem, unfavoriteItem, uploadWorkspaceCover, resetWorkspaceCover, uploadItemCover, resetItemCover } from '@/services/workspaces'
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

const PAGE_SIZE = 24
const COLLECTION_PICKER_PAGE_SIZE = 50

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
  const { t } = useTranslation('pages')
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
  const [filterOpen, setFilterOpen] = useState(false)
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false)
  const [collectionQuery, setCollectionQuery] = useState('')
  const [collectionPickerLimit, setCollectionPickerLimit] = useState(COLLECTION_PICKER_PAGE_SIZE)
  const [page, setPage] = useState(1)

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
      setError(t('library.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const typeFilters = selectedFilters.filter(
    (k): k is 'video' | 'audio' | 'image' | 'text' => k === 'video' || k === 'audio' || k === 'image' || k === 'text',
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

  // 展示上仍把多素材 workspace 做成合集卡片；归类目标不能因当前
  // 只有一条笔记而消失，所有非收纳箱 workspace 都可以承载共享笔记。
  const collectionTargets = scopedWorkspaces

  const collectionWorkspaceIds = useMemo(
    () => new Set(collectionWorkspaces.map((ws) => ws.workspace_id)),
    [collectionWorkspaces],
  )

  useEffect(() => {
    if (collectionTargets.length === 0) {
      if (collectionTargetId) setCollectionTargetId('')
      return
    }
    if (!collectionTargetId || !collectionTargets.some((ws) => ws.workspace_id === collectionTargetId)) {
      setCollectionTargetId(collectionTargets[0].workspace_id)
    }
  }, [collectionTargetId, collectionTargets])

  const visibleWorkspaces = useMemo(() => {
    if (!data) return []
    if (!(showAll || showCollections || showRunning)) return []
    return collectionWorkspaces.filter((ws) => {
      const wsItems = itemsByWorkspace.get(ws.workspace_id) ?? []
      if (typeFilters.length > 0 && !wsItems.some((item) => typeFilters.includes(item.type as 'video' | 'audio' | 'image' | 'text'))) return false
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
        items = items.filter((item) => typeFilters.includes(item.type as 'video' | 'audio' | 'image' | 'text'))
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
  const pageCount = Math.max(1, Math.ceil(visibleEntries.length / PAGE_SIZE))
  const pageEntries = useMemo(
    () => visibleEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [visibleEntries, page],
  )
  const filteredCollectionWorkspaces = useMemo(() => {
    const normalized = collectionQuery.trim().toLowerCase()
    if (!normalized) return collectionTargets
    return collectionTargets.filter((workspace) =>
      workspace.name.toLowerCase().includes(normalized),
    )
  }, [collectionTargets, collectionQuery])

  const visibleCollectionTargets = useMemo(
    () => filteredCollectionWorkspaces.slice(0, collectionPickerLimit),
    [filteredCollectionWorkspaces, collectionPickerLimit],
  )

  useEffect(() => {
    setPage(1)
  }, [selectedFilters, sortBy, query, intentFilter])

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
    pageEntries.forEach((entry) => {
      if (entry.kind === 'workspace') next.add(`ws:${entry.workspace.workspace_id}`)
      else next.add(selectionKey(entry.item.workspace_id, entry.item.item_id))
    })
    setSelectedSet(next)
  }, [pageEntries])

  const handleDeleteOne = useCallback(async (item: LibraryItem) => {
    const label = item.name || t('library.untitled')
    const ok = window.confirm(t('library.confirmDeleteItem', { label }))
    if (!ok) return
    try {
      await deleteItem(item.workspace_id, item.item_id)
      // 阶段 C2：只精确移除该 item 的 related_task_ids，不清掉同合集其它素材的任务。
      // related_task_ids 缺失时不兜底 removeByProject——后端已删任务，下一轮轮询会同步掉。
      const tids = item.related_task_ids ?? []
      if (tids.length > 0) useTaskStore.getState().removeTasks(tids)
      toast.success(t('library.deletedItem', { label }))
      load()
    } catch {
      toast.error(t('library.deleteFailed'))
    }
  }, [t, load])

  const handleDeleteWorkspace = useCallback(async (wsId: string) => {
    const ws = data?.workspaces.find((w) => w.workspace_id === wsId)
    const label = ws?.name || t('library.untitled')
    const ok = window.confirm(t('library.confirmDeleteCollection', { label }))
    if (!ok) return
    try {
      await deleteWorkspace(wsId)
      // 1-C：即时移除该 workspace 关联的所有任务
      useTaskStore.getState().removeByProject(wsId)
      toast.success(t('library.deletedCollection', { label }))
      load()
    } catch {
      toast.error(t('library.deleteCollectionFailed'))
    }
  }, [t, data, load])

  const handleBatchDelete = useCallback(async () => {
    if (selectedSet.size === 0) return
    const ok = window.confirm(t('library.confirmDeleteSelected', { count: selectedSet.size }))
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
        toast.warning(t('library.deletedSome', { removed: removedCount, failed: failedCount }))
      } else {
        toast.success(t('library.deletedAll', { removed: removedCount }))
      }
      setSelectedSet(new Set())
      load()
    } catch {
      toast.error(t('library.batchDeleteFailed'))
    } finally {
      setDeleting(false)
    }
  }, [t, selectedSet, load, itemsByWorkspace])

  const handleBatchAddToCollection = useCallback(async () => {
    if (!collectionTargetId) {
      toast.error(t('library.chooseTargetFirst'))
      return
    }
    if (selectedItemRefs.length === 0) {
      toast.error(t('library.chooseNotesFirst'))
      return
    }
    setAddingToCollection(true)
    const targetName = collectionTargets.find((ws) => ws.workspace_id === collectionTargetId)?.name || '合集'
    try {
      const res = await batchAddItemsToWorkspace(collectionTargetId, selectedItemRefs)
      if (res.added > 0) {
        toast.success(t('library.movedTo', { added: res.added, target: targetName, skipped: res.skipped ? `，${t('library.alreadyInSuffix', { count: res.skipped })}` : '' }))
        setSelectedSet(new Set())
        setSelecting(false)
      } else if (res.skipped > 0) {
        toast.info(t('library.alreadyIn', { target: targetName }))
      } else {
        toast.error(t('library.nothingMoved'))
      }
      if (res.failed > 0) {
        toast.error(`${res.failed} 项加入失败，请检查目标合集类型`)
      }
      await load()
    } catch {
      toast.error(t('library.moveFailedGeneric'))
    } finally {
      setAddingToCollection(false)
    }
  }, [t, collectionTargetId, selectedItemRefs, collectionTargets, load])

  const handleCreateCollection = useCallback(async () => {
    setCreatingWorkspace(true)
    try {
      const name = t('library.newCollection')
      await createWorkspace({ name })
      setSelectedFilters(['collection'])
      toast.success(t('library.createdCollection'))
      await load()
    } catch {
      toast.error(t('library.createCollectionFailed'))
    } finally {
      setCreatingWorkspace(false)
    }
  }, [t, load, setSelectedFilters])

  const handleRenameWorkspace = useCallback(async (workspaceId: string, name: string) => {
    try {
      await updateWorkspace(workspaceId, { name })
      toast.success(t('library.renamedTo', { name }))
      await load()
    } catch {
      toast.error(t('library.renameFailed'))
    }
  }, [t, load])

  const handleUploadWorkspaceCover = useCallback(async (workspaceId: string, file: File) => {
    try {
      await uploadWorkspaceCover(workspaceId, file)
      toast.success(t('library.coverUpdated'))
      await load()
    } catch {
      toast.error(t('library.coverUploadFailed'))
    }
  }, [t, load])

  const handleResetWorkspaceCover = useCallback(async (workspaceId: string) => {
    try {
      await resetWorkspaceCover(workspaceId)
      toast.success(t('library.coverRestored'))
      await load()
    } catch {
      toast.error('恢复自动合集封面失败，请重试')
    }
  }, [t, load])

  const handleUploadItemCover = useCallback(async (item: LibraryItem, file: File) => {
    try {
      await uploadItemCover(item.workspace_id, item.item_id, file)
      toast.success(t('library.itemCoverUpdated'))
      await load()
    } catch {
      toast.error(t('library.itemCoverUploadFailed'))
    }
  }, [t, load])

  const handleResetItemCover = useCallback(async (item: LibraryItem) => {
    try {
      await resetItemCover(item.workspace_id, item.item_id)
      toast.success(t('library.itemCoverRestored'))
      await load()
    } catch {
      toast.error('恢复自动素材封面失败，请重试')
    }
  }, [t, load])

  const handleToggleFavorite = useCallback(async (item: LibraryItem) => {
    try {
      if (item.favorite) {
        await unfavoriteItem(item.workspace_id, item.item_id)
        toast.success(t('library.unfavorited'))
      } else {
        await favoriteItem(item.workspace_id, item.item_id)
        toast.success(t('library.favorited'))
      }
      await load()
    } catch {
      toast.error(t('library.favoriteFailed'))
    }
  }, [t, load])

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

  const emptyTitle = t('library.noNotes')
  const emptyDesc = t('library.noNotesHint')

  const pageTone = 'note'
  const pageKicker = 'NOTE LIBRARY'
  const activeFilterCount = selectedFilters.includes('all') ? 0 : selectedFilters.length
  const selectedCollectionName = collectionTargets.find(
    (workspace) => workspace.workspace_id === collectionTargetId,
  )?.name

  return (
    <div className={`lib-page lib-page--${pageTone}`}>
      {/* ── Hero：只保留标题、说明、导入内容、新建合集 ── */}
      <div className="lib-page-header">
        <div>
          <div className="lib-kicker">{pageKicker} · LOCAL</div>
          <h2>
            {t('library.heroTitle')}
          </h2>
          <p>
            {t('library.heroSubtitle')}
          </p>
          <div className="lib-hero-actions">
            <button className="lib-cta lib-cta-primary" onClick={() => navigate('/')}>
              <Plus size={15} />
              {t('library.importContent')}
            </button>
            <button
              className="lib-cta lib-cta-secondary"
              onClick={handleCreateCollection}
              disabled={creatingWorkspace}
            >
              <FolderPlus size={15} />
              {creatingWorkspace ? t('library.creating') : t('library.newCollectionBtn')}
            </button>
          </div>
        </div>
      </div>

      {/* ── 紧凑工具栏：筛选和排序放入弹层 ── */}
      {!selectMode && (
        <div className="lib-toolbar">
          <div className="lib-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder={t('library.searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="lib-filter-control">
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((value) => !value)}
            >
              <Filter size={13} />
              筛选{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
            {filterOpen && (
              <div className="lib-filter-popover">
                <div>
                  <span>{t('library.contentTypeStatus')}</span>
                  <FilterChips counts={chipCounts} />
                </div>
                <div>
                  <span>{t('library.sort')}</span>
                  <SortMenu />
                </div>
              </div>
            )}
          </div>
          {hasVisibleEntries && (
            <button className="btn btn-sm" onClick={enterSelectMode}>{t('library.select')}</button>
          )}
          <ViewToggle />
        </div>
      )}

      {/* ── 内容区 ── */}
      {loading && (
        <div className="empty-state">
          <div className="spinner" />
          <div className="empty-state-desc">{t('library.loadingLibrary')}</div>
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
                {showAll && chipCounts?.all === 0 ? emptyTitle : t('library.noMatchNotes')}
              </div>
              <div className="empty-state-desc">
                {showAll && chipCounts?.all === 0 ? emptyDesc : '试试切换筛选条件或清除 chip'}
              </div>
            </div>
          ) : (
            <div className={`note-grid note-grid--cols-${cardColumns}${viewMode === 'list' ? ' is-list' : ''}`}>
              {pageEntries.map((entry) => (
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
                    onUploadCover={handleUploadWorkspaceCover}
                    onResetCover={handleResetWorkspaceCover}
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
                    onUploadCover={handleUploadItemCover}
                    onResetCover={handleResetItemCover}
                  />
                )
              ))}
            </div>
          )}
          {hasVisibleEntries && pageCount > 1 && (
            <nav className="lib-pagination" aria-label={t('library.pagination')}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={page === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                上一页
              </button>
              <span>{page} / {pageCount}</span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={page === pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                下一页
              </button>
            </nav>
          )}
        </>
      )}

      {selectMode && (
        <div className="lib-selection-dock" role="toolbar" aria-label={t('library.batchOps')}>
          <strong>已选 {selectedItemRefs.length} 项</strong>
          <button className="btn btn-sm" onClick={selectAll}>{t('library.selectAll')}</button>
          {collectionWorkspaces.length > 0 && (
            <div className="batch-collection-control">
              <button
                type="button"
                className="btn btn-sm"
                aria-expanded={collectionPickerOpen}
                onClick={() => setCollectionPickerOpen((value) => {
                  if (!value) {
                    setCollectionQuery('')
                    setCollectionPickerLimit(COLLECTION_PICKER_PAGE_SIZE)
                  }
                  return !value
                })}
              >
                <FolderInput size={13} />
                目标合集：{selectedCollectionName || t('library.pleaseSelect')}
              </button>
              {collectionPickerOpen && (
                <div className="collection-picker">
                  <input
                    className="input"
                    aria-label={t('library.searchCollection')}
                    placeholder={t('library.searchCollection')}
                    value={collectionQuery}
                    onChange={(event) => {
                      setCollectionQuery(event.target.value)
                      setCollectionPickerLimit(COLLECTION_PICKER_PAGE_SIZE)
                    }}
                  />
                  <div className="collection-picker-list">
                    {filteredCollectionWorkspaces.length === 0 ? (
                      <span>{t('library.noMatchCollections')}</span>
                    ) : visibleCollectionTargets.map((workspace) => (
                      <button
                        key={workspace.workspace_id}
                        type="button"
                        aria-pressed={workspace.workspace_id === collectionTargetId}
                        onClick={() => {
                          setCollectionTargetId(workspace.workspace_id)
                          setCollectionPickerOpen(false)
                        }}
                      >
                        {workspace.name}
                      </button>
                    ))}
                  </div>
                  {filteredCollectionWorkspaces.length > visibleCollectionTargets.length && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setCollectionPickerLimit((limit) => limit + COLLECTION_PICKER_PAGE_SIZE)}
                    >
                      加载更多（还剩 {filteredCollectionWorkspaces.length - visibleCollectionTargets.length}）
                    </button>
                  )}
                </div>
              )}
              <button
                className={`btn btn-sm${selectedItemRefs.length > 0 ? ' btn-secondary' : ''}`}
                disabled={addingToCollection || selectedItemRefs.length === 0 || !collectionTargetId}
                onClick={handleBatchAddToCollection}
              >
                {addingToCollection ? t('library.processing') : t('library.addToCollection')}
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
          <button className="btn btn-sm" onClick={clearSelection}>{t('library.done')}</button>
        </div>
      )}
    </div>
  )
}
