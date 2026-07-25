import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'

import {
  getWorkspace,
  getItemNote,
  downloadCollectionHtml,
  mergeNotes,
  listMergedNotes,
  favoriteItem,
  removeWorkspaceItem,
  unfavoriteItem,
} from '@/services/workspaces'
import type { MergedNote } from '@/services/workspaces'
import { batchDeleteItems } from '@/services/library'
import { AddMaterialModal } from '@/components/workspace/AddMaterialModal'
import { usePipelineTasks } from '@/hooks/usePipelineTasks'
import { withStatusToast } from '@/lib/statusToast'

import type { WorkspaceItem, WorkspaceRecord } from '@/types/workspace'
import { useTaskStore } from '@/store/taskStore'

import { ChatTab } from './ChatTab'
import { ExportTab } from './ExportTab'
import { FavoritesTab } from './FavoritesTab'
import { MaterialsTab } from './MaterialsTab'
import { BackgroundEditor } from './BackgroundEditor'
import { TaskboardHead } from './TaskboardHead'
import { MergeModal } from './MergeModal'
import type { TabId } from './types'
import './taskboard.css'

/**
 * Taskboard 主入口 — BiliNote 式布局：
 * 头部（名称 + 计数 + 操作按钮） + 素材网格主体 + Modal 弹层（导出/对比/更多功能）。
 */
export default function TaskboardPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [bgOpen, setBgOpen] = useState(false)

  // Modal 状态：导出 / 更多功能面板
  const [exportOpen, setExportOpen] = useState(false)
  const [morePanelId, setMorePanelId] = useState<TabId | null>(null)

  // 融合状态
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergedNotes, setMergedNotes] = useState<MergedNote[]>([])


  const abortRef = useRef<AbortController | null>(null)

  usePipelineTasks({
    projectId: id,
    pollInterval: 5000,
    enabled: Boolean(id),
    limit: 300,
    includeLogs: true,
  })

  useEffect(() => {
    if (!id) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    getWorkspace(id)
      .then((data) => {
        if (!ac.signal.aborted) {
          setWorkspace(data)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!ac.signal.aborted) {
          setError(err instanceof Error ? err.message : '加载失败')
          setLoading(false)
        }
      })

    // 页面加载时拉融合笔记列表（持久展示）
    listMergedNotes(id)
      .then(setMergedNotes)
      .catch(() => {})

    return () => ac.abort()
  }, [id])

  /** 「更多」菜单点击处理 */
  const handleMenuAction = (menuId: string) => {
    const validIds: TabId[] = ['favs', 'chat', 'style']
    if (validIds.includes(menuId as TabId)) {
      setMorePanelId(menuId as TabId)
    }
  }

  /** 刷新 workspace 数据 */
  const refresh = () => {
    if (!workspace) return
    getWorkspace(workspace.workspace_id).then(setWorkspace).catch(() => {})
  }

  const handleDeleteItem = async (item: WorkspaceItem) => {
    if (!workspace) return
    const label = item.name || '未命名素材'
    if (!window.confirm(`确定删除「${label}」？`)) return
    try {
      const updated = await removeWorkspaceItem(workspace.workspace_id, item.item_id)
      setWorkspace(updated)
      // 阶段 C2：精确移除该 item 的任务，不影响同合集其它素材
      if (item.related_task_ids.length > 0) {
        useTaskStore.getState().removeTasks(item.related_task_ids)
      }
      toast.success(`已删除「${label}」`)
    } catch {
      toast.error('删除失败，请重试')
    }
  }

  const handleDeleteSelectedItems = async (itemIds: string[]) => {
    if (!workspace || itemIds.length === 0) return
    if (!window.confirm(`确定删除选中的 ${itemIds.length} 项？此操作不可撤销。`)) return
    try {
      const result = await batchDeleteItems(itemIds.map((itemId) => ({ workspace_id: workspace.workspace_id, item_id: itemId })))

      // P1 修复：只根据 removed_ids 精确移除任务，避免失败项任务被错误隐藏
      const removedSet = new Set(result.removed_ids)
      const taskIds = workspace.items
        .filter((it) => removedSet.has(it.item_id))
        .flatMap((it) => it.related_task_ids)
      if (taskIds.length > 0) {
        useTaskStore.getState().removeTasks(taskIds)
      }

      // 显示部分成功/失败结果
      if (result.failed > 0) {
        toast.warning(`已删除 ${result.removed} 项，${result.failed} 项删除失败`)
      } else {
        toast.success(`已删除 ${result.removed} 项`)
      }
      refresh()
    } catch {
      toast.error('批量删除失败，请重试')
    }
  }

  const handleToggleFavorite = async (item: WorkspaceItem) => {
    if (!workspace) return
    try {
      const updated = item.favorite
        ? await unfavoriteItem(workspace.workspace_id, item.item_id)
        : await favoriteItem(workspace.workspace_id, item.item_id)
      setWorkspace(updated)
      toast.success(item.favorite ? '已取消收藏' : '已收藏')
    } catch {
      toast.error('收藏状态更新失败，请重试')
    }
  }

  if (loading) {
    return (
      <div className="tb-wrap" role="status" aria-label="加载中">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '28px 0' }}>
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-40" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 12 }}>
            <Skeleton className="h-28 rounded-lg" />
            <Skeleton className="h-28 rounded-lg" />
            <Skeleton className="h-28 rounded-lg" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !workspace) {
    return (
      <div className="tb-wrap" style={{ textAlign: 'center', paddingTop: 120, color: 'var(--ink-3)' }}>
        {error ?? '合集不存在'}
      </div>
    )
  }

  return (
    <div className="tb-wrap">
      <TaskboardHead
        name={workspace.name}
        materialCount={workspace.items.length}
        background={workspace.background}
        items={workspace.items}
        description={workspace.background.topic || workspace.background.purpose || '合集内的笔记与素材汇总'}
        updatedAt={new Date(workspace.updated_at).toLocaleDateString('zh-CN')}
        onBack={() => navigate('/notes')}
        onEditBackground={() => setBgOpen(true)}
        onAddMaterial={() => setAddOpen(true)}
        onExport={() => setExportOpen(true)}
        onMerge={() => {
          if (workspace.items.length < 2) {
            toast.info('合集内至少需要 2 个素材才可融合')
            return
          }
          setMergeOpen(true)
        }}
        onShareMarkdown={async () => {
          if (workspace.items.length === 0) {
            toast.info('合集为空，暂无可复制的笔记')
            return
          }
          const toastId = `workspace-copy-md-${workspace.workspace_id}`
          toast.loading('正在复制合集 Markdown…', { id: toastId })
          try {
            const notes = await Promise.all(
              workspace.items.map((item) =>
                getItemNote(workspace.workspace_id, item.item_id).catch(() => null)
              )
            )
            const mdParts = notes
              .filter((n): n is NonNullable<typeof n> => n != null && n.note_md.trim().length > 0)
              .map((n) => n.note_md.trim())
            if (mdParts.length === 0) {
              toast.info('暂无笔记内容可复制', { id: toastId })
              return
            }
            await navigator.clipboard.writeText(mdParts.join('\n\n---\n\n'))
            toast.success(`已复制 ${mdParts.length} 篇笔记到剪贴板`, { id: toastId })
          } catch {
            toast.error('复制失败，请重试', { id: toastId })
          }
        }}
        onShareHtml={async () => {
          try {
            await withStatusToast(
              () => downloadCollectionHtml(workspace.workspace_id),
              {
                id: `workspace-export-html-${workspace.workspace_id}`,
                loading: '正在导出合集 HTML…',
                success: '合集 HTML 已开始下载',
                error: '合集 HTML 导出失败，请重试',
              },
            )
          } catch {
            /* withStatusToast 已提示 */
          }
        }}
        onMenuAction={handleMenuAction}
      />

      {/* ── 融合笔记置顶展示 ── */}
      {mergedNotes.length > 0 && (
        <div style={{ margin: '16px 0', border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--bg-card)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 12 }}>
            ✨ 融合笔记（{mergedNotes.length}）
          </div>
          {mergedNotes.map((mn) => (
            <details key={mn.merged_id} style={{ marginBottom: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--ink-2)', padding: '6px 0' }}>
                {mn.title}
                <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 12 }}>
                  {mn.item_ids.length} 素材 · {new Date(mn.created_at).toLocaleString('zh-CN')}
                </span>
              </summary>
              <div
                className="tb-merged-content"
                style={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.8,
                  fontSize: 13,
                  color: 'var(--ink-1)',
                  padding: '12px 0',
                  borderTop: '1px solid var(--line)',
                  marginTop: 8,
                }}
              >
                {mn.content_md}
              </div>
              <button
                className="btn btn-sm"
                style={{ marginTop: 8 }}
                onClick={async () => {
                  await navigator.clipboard.writeText(mn.content_md)
                  toast.success('已复制到剪贴板')
                }}
              >
                复制内容
              </button>
            </details>
          ))}
        </div>
      )}

      {/* 素材网格 — 默认主体 */}
      <div className="tb-body">
        <MaterialsTab
          items={workspace.items}
          workspaceId={workspace.workspace_id}
          onAddMaterial={() => setAddOpen(true)}
          onToggleFavorite={handleToggleFavorite}
          onDelete={handleDeleteItem}
          onDeleteSelected={handleDeleteSelectedItems}
        />
      </div>

      {/* ── Modal：导出 ── */}
      {exportOpen && (
        <div className="tb-modal-overlay" onClick={() => setExportOpen(false)}>
          <div className="tb-modal" onClick={(e) => e.stopPropagation()}>
            <button className="tb-modal-close" onClick={() => setExportOpen(false)}>
              <X size={18} />
            </button>
            <ExportTab items={workspace.items} workspaceId={workspace.workspace_id} />
          </div>
        </div>
      )}

      {/* ── Modal：更多功能面板（收藏/AI对话/风格报告） ── */}
      {morePanelId && (
        <div className="tb-modal-overlay" onClick={() => setMorePanelId(null)}>
          <div
            className="tb-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="tb-modal-close" onClick={() => setMorePanelId(null)}>
              <X size={18} />
            </button>
            {morePanelId === 'favs' && (
              <FavoritesTab
                favoriteIds={workspace.favorites}
                items={workspace.items}
                workspaceId={workspace.workspace_id}
              />
            )}
            {morePanelId === 'chat' && <ChatTab workspace={workspace} />}
            {morePanelId === 'style' && (
              <div className="tb-placeholder">Phase [C] 开放</div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal：融合弹框 ── */}
      {mergeOpen && (
        <MergeModal
          items={workspace.items}
          loading={mergeLoading}
          onConfirm={async (itemIds, style) => {
            setMergeLoading(true)
            try {
              await withStatusToast(
                () => mergeNotes(workspace.workspace_id, itemIds, style),
                {
                  id: `workspace-merge-${workspace.workspace_id}`,
                  loading: '正在融合笔记…',
                  success: '融合完成',
                  error: '融合失败，请重试',
                },
              )
              // 刷新融合笔记列表
              setMergeOpen(false)
              const updated = await listMergedNotes(workspace.workspace_id)
              setMergedNotes(updated)
            } catch {
              /* withStatusToast 已提示 */
            } finally {
              setMergeLoading(false)
            }
          }}
          onClose={() => setMergeOpen(false)}
        />
      )}

      {/* ── AddMaterialModal ── */}
      <AddMaterialModal
        open={addOpen}
        onOpenChange={setAddOpen}
        workspaceIds={[workspace.workspace_id]}
        workspaceBackgrounds={{ [workspace.workspace_id]: workspace.background }}
        availableWorkspaces={[workspace]}
        onAdded={refresh}
        onWorkspaceUpdated={setWorkspace}
      />

      {/* ── BackgroundEditor ── */}
      <BackgroundEditor
        open={bgOpen}
        workspaceId={workspace.workspace_id}
        initialName={workspace.name}
        initial={workspace.background}
        items={workspace.items}
        onClose={() => setBgOpen(false)}
        onSaved={(updated) => setWorkspace(updated)}
      />
    </div>
  )
}
