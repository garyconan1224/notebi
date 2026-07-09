import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Copy, Layers, Video } from 'lucide-react'
import { toast } from 'sonner'

import { getWorkspace } from '@/services/workspaces'
import { usePipelineTasks } from '@/hooks/usePipelineTasks'
import { useTaskStore } from '@/store/taskStore'
import { isTaskTerminal } from '@/types/task'
import type { WorkspaceItem, WorkspaceRecord } from '@/types/workspace'
import { QueueTab } from '@/pages/WorkspacePage/TaskboardPage/QueueTab'

import '@/pages/WorkspacePage/TaskboardPage/taskboard.css'
import '@/pages/result/ProcessingPage/processing.css'
import './batch-processing.css'

interface BatchProcessingState {
  workspace?: WorkspaceRecord
  taskIds?: string[]
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function itemThumbnail(item?: WorkspaceItem): string {
  if (!item) return ''
  if (item.thumbnail) return item.thumbnail
  const results = item.results ?? {}
  return [
    results.thumbnail,
    results.video_thumbnail_url,
    results.cover_thumbnail,
    results.cover_url,
    results.cover,
    results.static_url,
    results.image_path,
  ].map(pickString).find(Boolean) || ''
}

function formatTime(value: string | undefined): string {
  if (!value) return '—'
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts))
}

export default function BatchProcessingPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? null) as BatchProcessingState | null
  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(state?.workspace ?? null)
  const [loading, setLoading] = useState(!state?.workspace)
  const [error, setError] = useState<string | null>(null)

  usePipelineTasks({
    projectId: workspaceId,
    pollInterval: 3000,
    enabled: Boolean(workspaceId),
    limit: 300,
    includeLogs: true,
  })

  const tasks = useTaskStore((s) => s.tasks).filter((task) => task.project_id === workspaceId)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    setLoading(true)
    getWorkspace(workspaceId)
      .then((data) => {
        if (cancelled) return
        setWorkspace(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载批量任务失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [workspaceId])

  const itemCount = workspace?.items.length ?? 0
  const total = Math.max(itemCount, state?.taskIds?.length ?? 0, tasks.length)
  const running = tasks.filter((task) => !isTaskTerminal(task.status) && task.status !== 'PENDING').length
  const queued = tasks.filter((task) => task.status === 'PENDING').length
  const failed = tasks.filter((task) => task.status === 'FAILED').length
  const doneItems = workspace?.items.filter((item) => item.status === 'done').length ?? 0
  const avgProgress = tasks.length
    ? Math.round(tasks.reduce((sum, task) => sum + Math.min(1, Math.max(0, Number(task.progress) || 0)), 0) / tasks.length * 100)
    : doneItems > 0 && total > 0
      ? Math.round(doneItems / total * 100)
      : 0

  const sourceUrl = pickString(workspace?.source_meta?.source_url) || pickString(workspace?.source)
  const sourceType = pickString(workspace?.source_meta?.source_type) || pickString(workspace?.source_meta?.type) || 'batch'
  const latestUpdatedAt = useMemo(() => {
    const taskTimes = tasks.map((task) => Date.parse(task.updated_at || '')).filter(Number.isFinite)
    const itemTimes = (workspace?.items ?? []).map((item) => Date.parse(item.updated_at || '')).filter(Number.isFinite)
    const latest = Math.max(0, ...taskTimes, ...itemTimes)
    return latest ? new Date(latest).toISOString() : workspace?.updated_at
  }, [tasks, workspace])

  const mosaicItems = useMemo(() => (workspace?.items ?? []).slice(0, 4), [workspace?.items])
  const title = workspace?.name || '批量任务'
  const subtitle = total > 0
    ? `${total} 个子任务 · ${running + queued} 项处理中 · ${failed} 项失败`
    : '正在加载任务'

  const handleCopySource = async () => {
    try {
      await navigator.clipboard?.writeText(sourceUrl || window.location.href)
      toast.success(sourceUrl ? '已复制来源链接' : '已复制当前页面链接')
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  return (
    <div className="vm-processing-scope batch-processing-scope">
      <div className="proc-wrap">
        <div className="proc-main">
          <div className="proc-topbar">
            <button className="proc-back" onClick={() => navigate(`/workspaces/${workspaceId}`)} title="返回合集">
              <ArrowLeft size={18} />
            </button>
            <div className="proc-top-title">{title}</div>
            <div className="proc-top-actions">
              <button className="proc-top-btn" onClick={handleCopySource}>
                <Copy size={12} />
                复制链接
              </button>
              <button className="proc-top-btn primary" onClick={() => navigate(`/workspaces/${workspaceId}`)}>
                查看合集
                <ArrowRight size={12} />
              </button>
            </div>
          </div>

          <div className="proc-hero batch-proc-hero">
            <div className="batch-hero-mosaic" aria-label="批量任务封面">
              {mosaicItems.length > 0 ? (
                mosaicItems.map((item) => {
                  const thumb = itemThumbnail(item)
                  return (
                    <div key={item.item_id} className="batch-hero-tile">
                      {thumb ? (
                        <img src={thumb} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <Video size={22} />
                      )}
                    </div>
                  )
                })
              ) : (
                Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="batch-hero-tile" data-empty="true">
                    <Video size={22} />
                  </div>
                ))
              )}
            </div>

            <div className="info">
              <div className="eyebrow">BATCH PROCESSING · {workspaceId.slice(0, 8)}</div>
              <div className="title">
                <span className="title-platform">{sourceType} ·</span>
                {title}
              </div>
              <div className="src">{sourceUrl || subtitle}</div>
              <div className="stats">
                <span><strong>{total}</strong> 子任务</span>
                <span>状态 <strong>{failed > 0 ? '部分失败' : running + queued > 0 ? '处理中' : '完成'}</strong></span>
                <span>进度 <strong>{avgProgress}%</strong></span>
                <span>处理中 <strong>{running + queued}</strong></span>
                <span>失败 <strong>{failed}</strong></span>
                <span>更新 <strong>{formatTime(latestUpdatedAt)}</strong></span>
              </div>
              <div className="batch-progress-strip" aria-label="批量整体进度">
                <span style={{ width: `${avgProgress}%` }} />
              </div>
              <div className="actions">
                <button className="btn" onClick={() => navigate(`/workspaces/${workspaceId}`)}>
                  <Layers size={14} />
                  回到合集
                </button>
                <button className="btn btn-primary" onClick={() => navigate(`/workspaces/${workspaceId}`)}>
                  查看结果 <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="batch-processing-body">
            {error && <div className="modal-error">{error}</div>}
            {loading && !workspace ? (
              <div className="tb-placeholder" style={{ minHeight: 240 }}>
                正在加载批量任务…
              </div>
            ) : (
              <QueueTab workspaceId={workspaceId} workspace={workspace} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
