import { useCallback, useEffect, useState } from 'react'
import { Plus, CheckSquare, Play, Download, X, ArrowLeftRight, Trash2 } from 'lucide-react'
import { FileVideo, FileAudio, FileImage, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { useTaskStore } from '@/store/taskStore'
import { isTaskTerminal } from '@/types/task'
import type { WorkspaceItem } from '@/types/workspace'
import { startItemPipeline, batchExportItems } from '@/services/workspaces'
import { MaterialCard } from './MaterialCard'

const ADD_GROUPS = [
  { type: 'video', icon: FileVideo, label: '视频' },
  { type: 'audio', icon: FileAudio, label: '音频' },
  { type: 'image', icon: FileImage, label: '图片' },
  { type: 'text', icon: FileText, label: '文字' },
] as const

interface MaterialsTabProps {
  items: WorkspaceItem[]
  workspaceId: string
  onAddMaterial?: () => void
  onNavigateToCompare?: () => void
  /** 选中集合变化时通知父组件（用于对比页） */
  onSelectedIdsChange?: (ids: Set<string>) => void
  onToggleFavorite?: (item: WorkspaceItem) => void
  onDelete?: (item: WorkspaceItem) => void
  onDeleteSelected?: (itemIds: string[]) => void
}

/**
 * Materials tab — 素材网格 + 添加素材卡。
 * 设计稿来源：taskboard.jsx TBMaterials + legacy prototype .tb-mat-grid / .mat-add。
 */
export function MaterialsTab({
  items,
  workspaceId,
  onAddMaterial,
  onNavigateToCompare,
  onSelectedIdsChange,
  onToggleFavorite,
  onDelete,
  onDeleteSelected,
}: MaterialsTabProps) {
  const tasks = useTaskStore((s) => s.tasks)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchRunning, setBatchRunning] = useState(false)

  useEffect(() => {
    onSelectedIdsChange?.(selectedIds)
  }, [selectedIds, onSelectedIdsChange])

  /** 通过 related_task_ids 查找 processing 任务的进度 */
  const getProgress = (item: WorkspaceItem): number | undefined => {
    if (item.status !== 'processing') return undefined
    for (const tid of item.related_task_ids) {
      const t = tasks.find((tk) => tk.task_id === tid)
      if (t && !isTaskTerminal(t.status)) return t.progress
    }
    return undefined
  }

  const toggleSelect = useCallback((itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }, [])

  const toggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) setSelectedIds(new Set())
      return !prev
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((it) => it.item_id)))
  }, [items])

  // 可批量分析的图片：type=image 且有 preflight tasks 且当前不在 processing
  const batchAnalyzeItems = items.filter(
    (it) =>
      it.type === 'image' &&
      it.status !== 'processing' &&
      selectedIds.has(it.item_id),
  )

  const handleBatchAnalyze = useCallback(async () => {
    if (batchAnalyzeItems.length === 0) return
    setBatchRunning(true)
    let ok = 0
    let fail = 0
    for (const item of batchAnalyzeItems) {
      try {
        await startItemPipeline(workspaceId, item.item_id)
        ok++
      } catch {
        fail++
      }
    }
    setBatchRunning(false)
    setSelectedIds(new Set())
    setSelectMode(false)
    if (ok > 0) toast.success(`已触发 ${ok} 项分析`)
    if (fail > 0) toast.error(`${fail} 项触发失败`)
  }, [batchAnalyzeItems, workspaceId])

  const handleBatchExport = useCallback(async () => {
    if (selectedIds.size === 0) return
    setBatchRunning(true)
    try {
      await batchExportItems(workspaceId, [...selectedIds])
      toast.success('导出成功')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBatchRunning(false)
    }
  }, [selectedIds, workspaceId])

  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div style={{ color: 'var(--ink-3)', fontSize: 14, marginBottom: 16 }}>
          还没有素材
        </div>
        <button className="btn btn-primary" onClick={onAddMaterial}>
          <Plus size={14} /> 添加素材
        </button>
      </div>
    )
  }

  return (
    <>
      {/* 工具栏 */}
      <div className="tb-mat-toolbar">
        <button
          className="btn btn-ghost btn-sm"
          onClick={toggleSelectMode}
          title={selectMode ? '退出多选' : '多选模式'}
        >
          {selectMode ? <X size={14} /> : <CheckSquare size={14} />}
          <span style={{ marginLeft: 4 }}>{selectMode ? '取消' : '多选'}</span>
        </button>
        {selectMode && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={selectAll}>
              全选
            </button>
            <span className="tb-mat-sel-count">
              已选 {selectedIds.size} / {items.length}
            </span>
          </>
        )}
      </div>

      <div className="tb-mat-grid">
        {items.map((item) => (
          <MaterialCard
            key={item.item_id}
            item={item}
            workspaceId={workspaceId}
            progress={getProgress(item)}
            selected={selectMode ? selectedIds.has(item.item_id) : undefined}
            onSelect={selectMode ? toggleSelect : undefined}
            onToggleFavorite={onToggleFavorite}
            onDelete={onDelete}
          />
        ))}
        {!selectMode && (
          <div className="mat-card mat-add" onClick={onAddMaterial}>
            <div className="mat-add-inner">
              <Plus size={24} />
              <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600 }}>添加素材</div>
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 10,
                  color: 'var(--ink-3)',
                  marginTop: 4,
                  letterSpacing: '0.1em',
                }}
              >
                URL · FILE · DRAG
              </div>
              <div className="mat-add-types">
                {ADD_GROUPS.map((g) => {
                  const Icon = g.icon
                  return (
                    <span key={g.type} className="kw">
                      <Icon size={11} />
                      {g.label}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 批量操作栏 */}
      {selectMode && selectedIds.size > 0 && (
        <div className="tb-batch-bar">
          <button
            className="btn btn-primary btn-sm"
            disabled={batchAnalyzeItems.length === 0 || batchRunning}
            onClick={handleBatchAnalyze}
          >
            <Play size={13} />
            {batchRunning ? '触发中…' : `批量分析 (${batchAnalyzeItems.length})`}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={batchRunning}
            onClick={handleBatchExport}
          >
            <Download size={13} />
            批量导出
          </button>
          <button
            className="btn btn-ghost btn-sm btn-danger"
            disabled={batchRunning}
            onClick={() => onDeleteSelected?.([...selectedIds])}
          >
            <Trash2 size={13} />
            删除选中
          </button>
          {onNavigateToCompare && selectedIds.size >= 2 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={onNavigateToCompare}
            >
              <ArrowLeftRight size={13} />
              对比
            </button>
          )}
        </div>
      )}
    </>
  )
}
