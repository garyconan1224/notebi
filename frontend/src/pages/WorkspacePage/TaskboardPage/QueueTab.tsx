import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock3, ExternalLink, FileText, RefreshCw, ScrollText, Video } from 'lucide-react'
import { resolveItemRoute } from '@/lib/resolveItemRoute'
import { useTaskStore } from '@/store/taskStore'
import { isTaskTerminal, getStatusText, type TaskLogEntry, type TaskRecord } from '@/types/task'
import type { WorkspaceItem, WorkspaceRecord } from '@/types/workspace'

/** 任务在「同素材一行」聚合时的状态排序：运行中 > 排队 > 失败 > 已完成 */
function statusRank(status: string): number {
  if (status === 'FAILED') return 2
  if (isTaskTerminal(status)) return 1 // SUCCESS / CANCELLED
  if (status === 'PENDING') return 3
  return 4 // DOWNLOAD / ASR / VLM / FRAMES / SUM / RUNNING…
}

const timeOf = (value: string | undefined): number => {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Queue tab — 显示当前合集的批量子任务状态。
 * 设计稿来源：taskboard.jsx TBQueue（简化版，去掉系统检测和并行滑块）。
 */
interface QueueTabProps {
  workspaceId: string
  workspace?: WorkspaceRecord | null
}

type QueueState = 'running' | 'queued' | 'error' | 'done'

interface QueueRow {
  groupKey: string
  task: TaskRecord
  tasks: TaskRecord[]
  item?: WorkspaceItem
  title: string
  sourceUrl: string
  thumbnail: string
  state: QueueState
  progress: number
  logs: Array<TaskLogEntry & { taskType: string }>
  updatedAt: number
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeProgress(value: number | undefined): number {
  const raw = Number.isFinite(value) ? Number(value) : 0
  const pct = raw > 1 ? raw / 100 : raw
  return Math.min(1, Math.max(0, pct))
}

function payloadUrl(task: TaskRecord): string {
  const payload = (task.payload ?? {}) as Record<string, unknown>
  return pickString(payload.url) || pickString(payload.source_url)
}

function taskTitle(task: TaskRecord): string {
  const payload = (task.payload ?? {}) as Record<string, unknown>
  return pickString(payload.title)
    || pickString(payload.video_title)
    || pickString(payload.name)
    || payloadUrl(task)
    || task.task_type
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

function rowState(tasks: TaskRecord[], item?: WorkspaceItem): QueueState {
  if (item?.status === 'failed' || tasks.some((t) => t.status === 'FAILED')) return 'error'
  if (tasks.some((t) => !isTaskTerminal(t.status) && t.status !== 'PENDING')) return 'running'
  if (tasks.some((t) => t.status === 'PENDING')) return 'queued'
  if (item?.status === 'done' || tasks.some((t) => t.status === 'SUCCESS')) return 'done'
  return 'running'
}

function rowProgress(tasks: TaskRecord[], state: QueueState): number {
  if (state === 'done') return 1
  const download = tasks.find((t) => t.task_type === 'download')
  const main = tasks.find((t) => ['note', 'analyze', 'text', 'audio', 'image', 'create', 'storyboard'].includes(t.task_type))
  if (download && main) {
    return normalizeProgress(download.progress) * 0.25 + normalizeProgress(main.progress) * 0.75
  }
  const maxProgress = Math.max(0, ...tasks.map((t) => normalizeProgress(t.progress)))
  if (state === 'error') return Math.max(maxProgress, 0.05)
  if (state === 'queued') return 0
  return maxProgress
}

function formatEta(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `约 ${Math.ceil(seconds)} 秒`
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分`
  return `约 ${(seconds / 3600).toFixed(1)} 小时`
}

function estimateRemainingSeconds(rows: QueueRow[]): number | null {
  const active = rows.filter((row) => row.state === 'running' && row.progress > 0.02 && row.progress < 0.98)
  if (active.length === 0) return null
  const starts = active.map((row) => timeOf(row.task.created_at)).filter(Boolean)
  if (starts.length === 0) return null
  const oldest = Math.min(...starts)
  const avgProgress = active.reduce((sum, row) => sum + row.progress, 0) / active.length
  if (avgProgress <= 0.02) return null
  const elapsed = Math.max(1, (Date.now() - oldest) / 1000)
  return elapsed * (1 - avgProgress) / avgProgress
}

function shortTime(value: string): string {
  const ts = timeOf(value)
  if (!ts) return '--:--'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}

export function QueueTab({ workspaceId, workspace }: QueueTabProps) {
  const navigate = useNavigate()
  const [openLogKey, setOpenLogKey] = useState<string | null>(null)
  const allTasks = useTaskStore((s) => s.tasks)
  const retryTask = useTaskStore((s) => s.retryTask)
  const tasks = useMemo(
    () => allTasks.filter((t) => t.project_id === workspaceId),
    [allTasks, workspaceId],
  )

  const rows = useMemo<QueueRow[]>(() => {
    const itemById = new Map<string, WorkspaceItem>()
    const itemByTaskId = new Map<string, WorkspaceItem>()
    const itemByUrl = new Map<string, WorkspaceItem>()
    for (const item of workspace?.items ?? []) {
      itemById.set(item.item_id, item)
      itemByUrl.set(item.source_value, item)
      for (const taskId of item.related_task_ids ?? []) {
        itemByTaskId.set(taskId, item)
      }
    }

    const groups = new Map<string, TaskRecord[]>()
    for (const t of tasks) {
      const payload = (t.payload ?? {}) as Record<string, unknown>
      const payloadItemId = pickString(payload.item_id)
      const url = payloadUrl(t)
      const item = (payloadItemId && itemById.get(payloadItemId)) || itemByTaskId.get(t.task_id) || itemByUrl.get(url)
      const key = `${t.project_id}::${item?.item_id || url || t.task_id}`
      const group = groups.get(key) || []
      group.push(t)
      groups.set(key, group)
    }

    return Array.from(groups.entries()).map(([groupKey, g]) => {
      g.sort((a, b) => statusRank(b.status) - statusRank(a.status))
      const representative = g[0]
      const payload = (representative.payload ?? {}) as Record<string, unknown>
      const payloadItemId = pickString(payload.item_id)
      const sourceUrl = payloadUrl(representative)
      const item = (payloadItemId && itemById.get(payloadItemId)) || itemByTaskId.get(representative.task_id) || itemByUrl.get(sourceUrl)
      const state = rowState(g, item)
      const progress = rowProgress(g, state)
      const logs = g
        .flatMap((task) => (task.log ?? []).map((entry) => ({ ...entry, taskType: task.task_type })))
        .sort((a, b) => timeOf(a.ts) - timeOf(b.ts))
      return {
        groupKey,
        task: representative,
        tasks: g,
        item,
        title: item?.name || taskTitle(representative),
        sourceUrl: item?.source_value || sourceUrl,
        thumbnail: itemThumbnail(item),
        state,
        progress,
        logs,
        updatedAt: Math.max(...g.map((task) => timeOf(task.updated_at))),
      }
    }).sort((a, b) => {
      const rankDelta = statusRank(b.task.status) - statusRank(a.task.status)
      if (rankDelta !== 0) return rankDelta
      return b.updatedAt - a.updatedAt
    })
  }, [tasks, workspace?.items])

  const running = rows.filter((r) => r.state === 'running').length
  const queued = rows.filter((r) => r.state === 'queued').length
  const failed = rows.filter((r) => r.state === 'error').length
  const done = rows.filter((r) => r.state === 'done').length
  const overall = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.progress, 0) / rows.length * 100) : 0
  const eta = estimateRemainingSeconds(rows)

  if (rows.length === 0) {
    return (
      <div className="tb-placeholder" style={{ minHeight: 240 }}>
        暂无任务
      </div>
    )
  }

  return (
    <>
      <div className="tb-head-mini">
        <div>
          <div
            className="eyebrow"
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
            }}
          >
            BATCH QUEUE · 总状态
          </div>
          <h2
            className="display"
            style={{ fontSize: 28, margin: '4px 0 0' }}
          >
            队列 · Queue
          </h2>
        </div>
      </div>

      <div className="queue-overview">
        <div className="queue-overview-main">
          <div className="queue-overview-kicker">任务中 · {running + queued} 项仍在处理</div>
          <div className="queue-overview-title">{overall}%</div>
          <div className="queue-overview-bar" aria-label="总体进度">
            <span style={{ width: `${overall}%` }} />
          </div>
        </div>
        <div className="queue-overview-stats">
          <span><FileText size={13} /> 总计 <b>{rows.length}</b></span>
          <span><span className="queue-stat-dot" data-state="running" /> 运行 <b>{running}</b></span>
          <span><span className="queue-stat-dot" data-state="queued" /> 排队 <b>{queued}</b></span>
          <span><span className="queue-stat-dot" data-state="done" /> 完成 <b>{done}</b></span>
          <span><span className="queue-stat-dot" data-state="error" /> 失败 <b>{failed}</b></span>
          <span><Clock3 size={13} /> 剩余 <b>{formatEta(eta)}</b></span>
        </div>
      </div>

      <div className="qp-list qp-list--detailed">
        {rows.map((row) => {
          const t = row.task
          const pct = Math.round(row.progress * 100)
          const failedTask = row.tasks.find((task) => task.status === 'FAILED')
          const openLabel = row.state === 'done' ? '查看结果' : '查看进度'
          const canOpenResult = Boolean(row.item)
          const logOpen = openLogKey === row.groupKey
          const latestLogs = row.logs.slice(-24)

          const handleOpen = () => {
            if (row.item && row.state === 'done') {
              navigate(resolveItemRoute(workspaceId, row.item))
              return
            }
            navigate(`/processing/${t.task_id}`, {
              state: {
                workspaceId,
                itemId: row.item?.item_id,
                url: row.sourceUrl,
                taskType: t.task_type,
                itemType: row.item?.type,
                backPath: `/processing/batch/${workspaceId}`,
                backLabel: '返回批量任务',
              },
            })
          }

          return (
            <div key={row.groupKey} className="qp-entry" data-state={row.state}>
              <div className="qp-row qp-row--detailed" data-state={row.state}>
                <div className="qp-thumb">
                  {row.thumbnail ? (
                    <img src={row.thumbnail} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <Video size={18} />
                  )}
                </div>
                <div className="qp-t">
                  <div className="qp-title">{row.title}</div>
                  <div className="qp-sub mono">
                    {getStatusText(t.status)}{t.error ? ` · ${t.error}` : ''}{row.sourceUrl ? ` · ${row.sourceUrl}` : ''}
                  </div>
                </div>
                <div className="qp-progress-cell">
                  <div className="qp-progress-meta">
                    <span>{row.state === 'done' ? '完成' : row.state === 'error' ? '失败' : row.state === 'queued' ? '排队中' : `${pct}%`}</span>
                    <span>{shortTime(t.updated_at)}</span>
                  </div>
                  <div className="qp-bar">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="qp-acts">
                  <button
                    className="btn btn-ghost"
                    style={{ height: 30, fontSize: 12 }}
                    onClick={() => setOpenLogKey(logOpen ? null : row.groupKey)}
                  >
                    <ScrollText size={13} /> 日志
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ height: 30, fontSize: 12 }}
                    onClick={handleOpen}
                    title={canOpenResult ? openLabel : '打开处理页'}
                  >
                    <ExternalLink size={13} /> {openLabel}
                  </button>
                  {row.state === 'error' && failedTask && (
                    <button
                      className="btn btn-ghost"
                      style={{ height: 30, fontSize: 12 }}
                      onClick={() => retryTask(failedTask.task_id)}
                    >
                      <RefreshCw size={12} /> 重试
                    </button>
                  )}
                </div>
              </div>
              {logOpen && (
                <div className="qp-log">
                  <div className="qp-log-head">实时日志 · {latestLogs.length || 0} 条</div>
                  {latestLogs.length === 0 ? (
                    <div className="qp-log-empty">暂无日志，任务开始后会自动写入。</div>
                  ) : latestLogs.map((entry, index) => (
                    <div key={`${entry.ts}-${index}`} className="qp-log-line" data-level={entry.level}>
                      <span>{shortTime(entry.ts)}</span>
                      <span>{entry.taskType}</span>
                      <p>{entry.message}</p>
                    </div>
                  ))}
                  {row.state === 'error' && failedTask?.error && (
                    <div className="qp-log-line" data-level="error">
                      <span>{shortTime(failedTask.updated_at)}</span>
                      <span>error</span>
                      <p>{failedTask.error}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
