import { useCallback, useEffect, useState } from 'react'
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  emptyWorkspaceTrash,
  listWorkspaces,
  permanentlyDeleteWorkspace,
  restoreWorkspace,
} from '@/services/workspaces'
import type { WorkspaceRecord } from '@/types/workspace'

/**
 * 设置 → 任务垃圾桶（N1.6）。
 *
 * 列出软删除的任务，每条提供「恢复 / 彻底删除」；顶部提供「清空垃圾桶」。
 * 极简版：不做批量勾选 / 过滤 / 排序——后续 N3 设置页重组再增强。
 */
export default function TrashPage() {
  const [items, setItems] = useState<WorkspaceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listWorkspaces({ trashedOnly: true })
      setItems(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleRestore = async (wsId: string) => {
    setBusyId(wsId)
    try {
      await restoreWorkspace(wsId)
      setItems((prev) => prev.filter((w) => w.workspace_id !== wsId))
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复失败')
    } finally {
      setBusyId(null)
    }
  }

  const handlePermanentDelete = async (wsId: string, name: string) => {
    if (!window.confirm(`彻底删除「${name}」？\n此操作将删除任务记录和所有上传的素材文件，无法恢复。`)) {
      return
    }
    setBusyId(wsId)
    try {
      await permanentlyDeleteWorkspace(wsId)
      setItems((prev) => prev.filter((w) => w.workspace_id !== wsId))
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusyId(null)
    }
  }

  const handleEmptyTrash = async () => {
    if (items.length === 0) return
    if (!window.confirm(`确认清空垃圾桶？将彻底删除 ${items.length} 个任务及其所有上传素材，无法恢复。`)) {
      return
    }
    setBusyId('__all__')
    try {
      await emptyWorkspaceTrash()
      setItems([])
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">任务垃圾桶</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            已软删除的任务保留在此处，可恢复或彻底删除。彻底删除将连带清理上传的素材文件。
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleEmptyTrash}
          disabled={items.length === 0 || busyId === '__all__'}
        >
          <Trash2 className="size-4" />
          清空垃圾桶
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-12 text-center">
          <Trash2 className="mx-auto mb-3 size-8 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">垃圾桶是空的</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((ws) => (
            <li
              key={ws.workspace_id}
              className="flex items-center justify-between gap-4 rounded-md border border-border bg-background p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-medium">{ws.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {ws.items.length} 个素材 · 更新于{' '}
                  {new Date(ws.updated_at).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestore(ws.workspace_id)}
                  disabled={busyId !== null}
                >
                  <RotateCcw className="size-4" />
                  恢复
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handlePermanentDelete(ws.workspace_id, ws.name)}
                  disabled={busyId !== null}
                >
                  <Trash2 className="size-4" />
                  彻底删除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
