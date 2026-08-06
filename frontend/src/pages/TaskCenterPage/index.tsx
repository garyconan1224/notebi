import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { PageHeader } from '@/components/ui/page-header'
import { StatusBadge, type StatusKind } from '@/components/ui/status-badge'
import { listPipelineTasks, deletePipelineTask } from '@/services/pipeline'
import { listTaskBatches, deleteTaskBatch } from '@/services/taskBatches'
import { getStatusText, isTaskTerminal, type TaskRecord } from '@/types/task'
import type { BatchStatus, TaskBatch } from '@/types/taskBatch'

import './task-center.css'

type View = 'batches' | 'tasks'
type BatchFilter = 'all' | 'running' | 'completed' | 'attention' | 'waiting'

const PAGE_SIZE = 12
const ACTIVE_BATCH_STATUSES = new Set<BatchStatus>(['queued', 'running'])

// Q7 / D5：终态批次才允许删除记录
const TERMINAL_BATCH_STATUSES = new Set<BatchStatus>([
  'completed',
  'partial',
  'failed',
  'cancelled',
  'partial_cancelled',
])

const SOURCE_LABELS: Record<string, string> = {
  urls: '多链接',
  local_files: '本地文件',
  bilibili_collection: 'B 站合集',
  bilibili_favorites: 'B 站收藏夹',
  bilibili_uploader: 'B 站 UP 主',
  bilibili_parts: 'B 站分 P',
  youtube_playlist: 'YouTube 播放列表',
}

const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  queued: '等待中',
  running: '处理中',
  paused: '已暂停',
  completed: '已完成',
  partial: '部分完成',
  failed: '失败',
  cancelled: '已取消',
  partial_cancelled: '部分取消',
}

const TASK_TYPE_LABELS: Record<string, string> = {
  download: '媒体下载',
  analyze: '内容分析',
  note: '生成笔记',
  summary: '生成总结',
  text: '文本处理',
  image: '图片分析',
  audio: '音频处理',
}

function batchGroup(status: BatchStatus): Exclude<BatchFilter, 'all'> {
  if (status === 'running') return 'running'
  if (status === 'completed') return 'completed'
  if (status === 'queued' || status === 'paused') return 'waiting'
  return 'attention'
}

function batchStatusKind(status: BatchStatus): StatusKind {
  if (status === 'completed') return 'success'
  if (status === 'running') return 'running'
  if (status === 'queued') return 'queued'
  if (status === 'paused') return 'paused'
  return 'error'
}

function taskStatusKind(status: string): StatusKind {
  if (status === 'SUCCESS') return 'success'
  if (status === 'FAILED' || status === 'PARTIAL') return 'error'
  if (status === 'CANCELLED') return 'offline'
  if (status === 'PENDING' || status === 'AWAITING_CONFIRM') return 'queued'
  return 'running'
}

function waitingCount(batch: TaskBatch) {
  return Math.max(
    0,
    batch.total_count
      - batch.completed_count
      - batch.failed_count
      - batch.cancelled_count
      - batch.skipped_count,
  )
}

function batchProgress(batch: TaskBatch) {
  if (!batch.total_count) return 0
  const handled = batch.completed_count
    + batch.failed_count
    + batch.cancelled_count
    + batch.skipped_count
  return Math.min(100, Math.round((handled / batch.total_count) * 100))
}

function taskTitle(task: TaskRecord) {
  const resultTitle = task.result?.video_title
  const payloadTitle = task.payload?.video_title
  const payloadUrl = task.payload?.url
  if (typeof resultTitle === 'string' && resultTitle.trim()) return resultTitle
  if (typeof payloadTitle === 'string' && payloadTitle.trim()) return payloadTitle
  if (typeof payloadUrl === 'string' && payloadUrl.trim()) return payloadUrl
  return TASK_TYPE_LABELS[task.task_type] || '处理任务'
}

function formatTime(value?: string) {
  if (!value) return '时间未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未记录'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function publicTaskStage(task: TaskRecord): string {
  const last = task.log?.at(-1)?.message?.trim()
  if (last) return last
  if (task.task_type === 'summary') return '正在准备总结材料'
  return getStatusText(task.status)
}

function completedSummaryPreview(task: TaskRecord): string {
  const summary = task.result?.summary
  if (typeof summary === 'string') {
    return summary.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 360)
  }
  if (!summary || typeof summary !== 'object') return ''
  const content = (summary as Record<string, unknown>).content_md
  if (typeof content !== 'string') return ''
  return content.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 360)
}

function taskNotePath(task: TaskRecord): string {
  const payload = task.payload ?? {}
  const result = task.result ?? {}
  const workspaceId = payload.workspace_id ?? result.workspace_id
  const itemId = payload.item_id ?? result.item_id
  return typeof workspaceId === 'string' && typeof itemId === 'string'
    ? `/workspaces/${workspaceId}/items/${itemId}/note`
    : ''
}

/** 成功（含部分完成）且有产出路径的任务直接进结果页，其余进处理详情。 */
function taskTargetPath(task: TaskRecord): string {
  if (task.status === 'SUCCESS' || task.status === 'PARTIAL') {
    const notePath = taskNotePath(task)
    if (notePath) return notePath
  }
  return `/processing/${task.task_id}`
}

export default function TaskCenterPage() {
  const { t } = useTranslation('pages')

  const navigate = useNavigate()
  const [view, setView] = useState<View>('batches')
  const [batches, setBatches] = useState<TaskBatch[]>([])
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [batchFilter, setBatchFilter] = useState<BatchFilter>('all')
  const [batchSource, setBatchSource] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [page, setPage] = useState(1)
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [deletingBatchIds, setDeletingBatchIds] = useState<ReadonlySet<string>>(() => new Set())

  const load = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    else setLoading(true)
    try {
      const [batchResult, taskResult] = await Promise.all([
        listTaskBatches(),
        listPipelineTasks({ limit: 200 }),
      ])
      setBatches(batchResult.batches)
      setTasks(Array.isArray(taskResult) ? taskResult : [])
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleDeleteTask = useCallback(async (task: TaskRecord) => {
    if (!window.confirm('只删除任务记录，不删除笔记和媒体。确认删除？')) return
    setDeletingIds((previous) => new Set(previous).add(task.task_id))
    try {
      await deletePipelineTask(task.task_id)
      toast.success('已删除任务记录')
      await load()
    } catch {
      toast.error('删除失败，请稍后重试')
    } finally {
      setDeletingIds((previous) => {
        const next = new Set(previous)
        next.delete(task.task_id)
        return next
      })
    }
  }, [load])

  // Q7 / D5：删除终态批次记录。只删批次记录本身，不删子任务/笔记/素材/媒体/导出。
  const handleDeleteBatch = useCallback(async (batch: TaskBatch) => {
    const confirmed = window.confirm(
      '只删除这条终态批次记录本身；不会删除子任务、笔记、素材、媒体文件或导出产物。确认删除？',
    )
    if (!confirmed) return
    setDeletingBatchIds((previous) => new Set(previous).add(batch.batch_id))
    try {
      await deleteTaskBatch(batch.batch_id)
      toast.success('已删除批次记录')
      await load()
    } catch {
      toast.error('删除失败：运行中的批次不能删除，请稍后重试')
    } finally {
      setDeletingBatchIds((previous) => {
        const next = new Set(previous)
        next.delete(batch.batch_id)
        return next
      })
    }
  }, [load])

  const hasActiveBatch = batches.some((batch) =>
    ACTIVE_BATCH_STATUSES.has(batch.status),
  )
  const hasActiveTask = tasks.some((task) => !['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(task.status))

  useEffect(() => {
    if ((!hasActiveBatch && !hasActiveTask) || loading) return
    const timer = window.setTimeout(() => {
      void load(true)
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [hasActiveBatch, hasActiveTask, loading, load, batches, tasks])

  useEffect(() => {
    setPage(1)
  }, [view, keyword, batchFilter, batchSource])

  const stats = useMemo(() => ({
    running: batches.filter((batch) => batchGroup(batch.status) === 'running').length,
    completed: batches.filter((batch) => batchGroup(batch.status) === 'completed').length,
    attention: batches.filter((batch) => batchGroup(batch.status) === 'attention').length,
    waiting: batches.filter((batch) => batchGroup(batch.status) === 'waiting').length,
  }), [batches])

  const visibleBatches = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    return batches.filter((batch) => (
      (!normalizedKeyword || batch.name.toLowerCase().includes(normalizedKeyword))
      && (batchFilter === 'all' || batchGroup(batch.status) === batchFilter)
      && (!batchSource || batch.source_type === batchSource)
    ))
  }, [batches, keyword, batchFilter, batchSource])

  const visibleTasks = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    return tasks.filter((task) => (
      !normalizedKeyword
      || taskTitle(task).toLowerCase().includes(normalizedKeyword)
      || task.task_id.toLowerCase().includes(normalizedKeyword)
    ))
  }, [tasks, keyword])

  const activeItems = view === 'batches' ? visibleBatches : visibleTasks
  const pageCount = Math.max(1, Math.ceil(activeItems.length / PAGE_SIZE))
  const pageItems = activeItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const filterOptions: Array<[BatchFilter, string, number]> = [
    ['all', '全部', batches.length],
    ['running', '处理中', stats.running],
    ['completed', '已完成', stats.completed],
    ['attention', '需处理', stats.attention],
    ['waiting', '等待中', stats.waiting],
  ]

  return (
    <main className="task-center-page">
      <div className="task-center-shell">
        <PageHeader
          eyebrow="TASK CENTER · LOCAL"
          title="任务中心"
          description="批量任务是默认视图；运行过程、失败项与诊断入口保持透明。"
          actions={(
            <>
              <button
                type="button"
                className="btn"
                disabled={refreshing}
                onClick={() => void load(true)}
              >
                {refreshing ? '刷新中…' : '刷新'}
              </button>
              <Link className="btn btn-primary" to="/tasks/new">{t('tasks.newBatch')}</Link>
            </>
          )}
        />

        <section className="task-stats" aria-label="任务统计">
          <article className="task-stat" data-testid="task-stat-running">
            <span>{t('tasks.processing')}</span><strong>{stats.running}</strong>
          </article>
          <article className="task-stat" data-testid="task-stat-completed">
            <span>{t('tasks.completed')}</span><strong>{stats.completed}</strong>
          </article>
          <article className="task-stat" data-testid="task-stat-attention">
            <span>{t('tasks.attention')}</span><strong>{stats.attention}</strong>
          </article>
          <article className="task-stat" data-testid="task-stat-waiting">
            <span>{t('tasks.waiting')}</span><strong>{stats.waiting}</strong>
          </article>
        </section>

        <section className="task-center-content">
          <div className="task-view-tabs" aria-label="任务视图">
            <button
              type="button"
              aria-pressed={view === 'batches'}
              onClick={() => setView('batches')}
            >
              批量任务
            </button>
            <button
              type="button"
              aria-pressed={view === 'tasks'}
              onClick={() => setView('tasks')}
            >
              单条任务
            </button>
          </div>

          <div className="task-filter-bar">
            {view === 'batches' && (
              <div className="task-base-filters" aria-label="批次状态">
                {filterOptions.map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={batchFilter === value}
                    onClick={() => setBatchFilter(value)}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>
            )}
            <label className="task-search">
              <span className="sr-only">{t('tasks.search')}</span>
              <input
                className="input"
                placeholder={view === 'batches' ? '搜索批次' : '搜索任务'}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </label>
            {view === 'batches' && (
              <button
                type="button"
                className="btn btn-ghost"
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced((value) => !value)}
              >
                高级筛选
              </button>
            )}
          </div>

          {view === 'batches' && showAdvanced && (
            <div className="task-advanced-filters">
              <label>
                <span>{t('tasks.source')}</span>
                <select
                  className="input"
                  aria-label="来源"
                  value={batchSource}
                  onChange={(event) => setBatchSource(event.target.value)}
                >
                  <option value="">{t('tasks.allSources')}</option>
                  {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {loading && <div className="task-state" role="status">{t('tasks.loading')}</div>}
          {!loading && error && (
            <div className="task-state task-state-error" role="alert">
              <strong>{t('tasks.loadFailed')}</strong>
              <span>{error}</span>
              <button type="button" className="btn" onClick={() => void load()}>
                重试
              </button>
            </div>
          )}

          {!loading && !error && view === 'batches' && (
            <div className="task-batch-list">
              {pageItems.length === 0 && (
                <div className="task-state">{t('tasks.noBatch')}</div>
              )}
              {(pageItems as TaskBatch[]).map((batch) => {
                const waiting = waitingCount(batch)
                const progress = batchProgress(batch)
                const terminal = TERMINAL_BATCH_STATUSES.has(batch.status)
                const deletingBatch = deletingBatchIds.has(batch.batch_id)
                return (
                  <article key={batch.batch_id} className="task-batch-card task-batch-card--article">
                    <button
                      type="button"
                      className="task-batch-card-link"
                      onClick={() => navigate(`/tasks/batches/${batch.batch_id}`)}
                      aria-label={`打开批次 ${batch.name}`}
                    >
                      <div className="task-batch-heading">
                        <div>
                          <span className="tag">{SOURCE_LABELS[batch.source_type] || '其他来源'}</span>
                          <h2>{batch.name}</h2>
                        </div>
                        <StatusBadge status={batchStatusKind(batch.status)}>
                          {BATCH_STATUS_LABELS[batch.status]}
                        </StatusBadge>
                      </div>
                      <div className="task-progress-row">
                        <strong>{progress}%</strong>
                        <div
                          className="task-progress"
                          role="progressbar"
                          aria-label={`${batch.name}进度`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progress}
                        >
                          <span style={{ width: `${progress}%` }} />
                        </div>
                        <span>{batch.total_count} 项</span>
                      </div>
                      <div className="task-batch-meta">
                        <span className="task-count-success">{batch.completed_count} 成功</span>
                        <span className="task-count-error">{batch.failed_count} 失败</span>
                        <span>{waiting} 等待</span>
                        {batch.skipped_count > 0 && <span>{batch.skipped_count} 跳过</span>}
                        <time>{formatTime(batch.created_at)}</time>
                      </div>
                    </button>
                    {terminal && (
                      <button
                        type="button"
                        className="task-batch-delete"
                        disabled={deletingBatch}
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleDeleteBatch(batch)
                        }}
                      >
                        {deletingBatch ? '删除中…' : '删除记录'}
                      </button>
                    )}
                  </article>
                )
              })}
            </div>
          )}

          {!loading && !error && view === 'tasks' && (
            <div className="task-item-list">
              {pageItems.length === 0 && <div className="task-state">{t('tasks.noTask')}</div>}
              {(pageItems as TaskRecord[]).map((task) => {
                const deleting = deletingIds.has(task.task_id)
                return (
                  <article key={task.task_id} className="task-item-card">
                    <Link
                      className="task-item-card-link"
                      to={taskTargetPath(task)}
                      aria-label={`打开${taskTitle(task)}`}
                    />
                    <div className="task-item-main">
                      <div>
                        <span className="tag">{TASK_TYPE_LABELS[task.task_type] || '处理任务'}</span>
                        <h2>{taskTitle(task)}</h2>
                      </div>
                      <StatusBadge status={taskStatusKind(task.status)}>
                        {getStatusText(task.status)}
                      </StatusBadge>
                    </div>
                    <div className="task-progress-row">
                      <strong>{Math.round((task.progress || 0) * 100)}%</strong>
                      <div
                        className="task-progress"
                        role="progressbar"
                        aria-label={`${taskTitle(task)}进度`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round((task.progress || 0) * 100)}
                      >
                        <span style={{ width: `${Math.round((task.progress || 0) * 100)}%` }} />
                      </div>
                    </div>
                    <section className="task-public-progress" aria-label={`${taskTitle(task)}处理说明`}>
                      <div>
                        <span>{t('tasks.currentStep')}</span>
                        <strong>{publicTaskStage(task)}</strong>
                      </div>
                      <p>{t('tasks.stepHint')}</p>
                      {completedSummaryPreview(task) && (
                        <div className="task-summary-preview">
                          <span>{t('tasks.summaryPreview')}</span>
                          <p>{completedSummaryPreview(task)}{completedSummaryPreview(task).length >= 360 ? '…' : ''}</p>
                          {taskNotePath(task) && <Link to={taskNotePath(task)}>{t('tasks.openSummary')}</Link>}
                        </div>
                      )}
                    </section>
                    <details className="task-diagnostics">
                      <summary>{t('tasks.diagnostics')}</summary>
                      <dl>
                        <div><dt>{t('tasks.taskId')}</dt><dd>{task.task_id}</dd></div>
                        {task.batch_id && <div><dt>{t('tasks.batchId')}</dt><dd>{task.batch_id}</dd></div>}
                      </dl>
                      <Link
                        to={`/settings/monitor?batch_id=${encodeURIComponent(task.batch_id || '')}&task_id=${encodeURIComponent(task.task_id)}&level=ERROR`}
                      >
                        查看高级日志
                      </Link>
                    </details>
                    {isTaskTerminal(task.status) && (
                      <div className="task-item-actions">
                        <button
                          type="button"
                          className="btn-ghost task-delete-btn"
                          disabled={deleting}
                          onClick={() => void handleDeleteTask(task)}
                        >
                          {deleting ? '删除中…' : '删除记录'}
                        </button>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}

          {!loading && !error && activeItems.length > PAGE_SIZE && (
            <nav className="task-pagination" aria-label="任务分页">
              <button
                type="button"
                className="btn"
                disabled={page === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                上一页
              </button>
              <span>{page} / {pageCount}</span>
              <button
                type="button"
                className="btn"
                disabled={page === pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                下一页
              </button>
            </nav>
          )}
        </section>
      </div>
    </main>
  )
}
