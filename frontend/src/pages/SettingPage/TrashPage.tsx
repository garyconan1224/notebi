import { useCallback, useEffect, useState } from 'react'
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
  const { t } = useTranslation('settings')
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
      setError(err instanceof Error ? err.message : t('trash.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleRestore = async (wsId: string) => {
    setBusyId(wsId)
    try {
      await restoreWorkspace(wsId)
      setItems((prev) => prev.filter((w) => w.workspace_id !== wsId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('trash.restoreFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const handlePermanentDelete = async (wsId: string, name: string) => {
    if (!window.confirm(t('trash.confirmDelete', { name }))) {
      return
    }
    setBusyId(wsId)
    try {
      await permanentlyDeleteWorkspace(wsId)
      setItems((prev) => prev.filter((w) => w.workspace_id !== wsId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('trash.deleteFailed'))
    } finally {
      setBusyId(null)
    }
  }

  const handleEmptyTrash = async () => {
    if (items.length === 0) return
    if (!window.confirm(t('trash.confirmEmpty', { count: items.length }))) {
      return
    }
    setBusyId('__all__')
    try {
      await emptyWorkspaceTrash()
      setItems([])
    } catch (err) {
      setError(err instanceof Error ? err.message : t('trash.emptyFailed'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">{t('trash.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('trash.subtitle')}
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleEmptyTrash}
          disabled={items.length === 0 || busyId === '__all__'}
        >
          <Trash2 className="size-4" />
          {t('trash.emptyTrash')}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-2" role="status" aria-label={t('trash.loadingAria')}>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-12 text-center">
          <Trash2 className="mx-auto mb-3 size-8 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">{t('trash.empty')}</p>
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
                  {t('trash.itemMeta', {
                    count: ws.items.length,
                    date: new Date(ws.updated_at).toLocaleString(),
                  })}
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
                  {t('trash.restore')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handlePermanentDelete(ws.workspace_id, ws.name)}
                  disabled={busyId !== null}
                >
                  <Trash2 className="size-4" />
                  {t('trash.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
