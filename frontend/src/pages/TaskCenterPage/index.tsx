import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { PageHeader } from '@/components/ui/page-header'
import { StatusBadge, type StatusKind } from '@/components/ui/status-badge'
import { listPipelineTasks } from '@/services/pipeline'
import { listTaskBatches } from '@/services/taskBatches'
import { getStatusText, type TaskRecord } from '@/types/task'
import type { BatchStatus, TaskBatch } from '@/types/taskBatch'

import './task-center.css'

type View = 'batches' | 'tasks'
type BatchFilter = 'all' | 'running' | 'completed' | 'attention' | 'waiting'

const PAGE_SIZE = 12
const ACTIVE_BATCH_STATUSES = new Set<BatchStatus>(['queued', 'running'])

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

export default function TaskCenterPage() {
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

  const hasActiveBatch = batches.some((batch) =>
    ACTIVE_BATCH_STATUSES.has(batch.status),
  )

  useEffect(() => {
    if (!hasActiveBatch || loading) return
    const timer = window.setTimeout(() => {
      void load(true)
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [hasActiveBatch, loading, load, batches])

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
              <Link className="btn btn-primary" to="/tasks/new">新建批量任务</Link>
            </>
          )}
        />

        <section className="task-stats" aria-label="任务统计">
          <article className="task-stat" data-testid="task-stat-running">
            <span>处理中</span><strong>{stats.running}</strong>
          </article>
          <article className="task-stat" data-testid="task-stat-completed">
            <span>已完成</span><strong>{stats.completed}</strong>
          </article>
          <article className="task-stat" data-testid="task-stat-attention">
            <span>需处理</span><strong>{stats.attention}</strong>
          </article>
          <article className="task-stat" data-testid="task-stat-waiting">
            <span>等待中</span><strong>{stats.waiting}</strong>
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
              <span className="sr-only">搜索任务</span>
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
                <span>来源</span>
                <select
                  className="input"
                  aria-label="来源"
                  value={batchSource}
                  onChange={(event) => setBatchSource(event.target.value)}
                >
                  <option value="">全部来源</option>
                  {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {loading && <div className="task-state" role="status">正在加载任务…</div>}
          {!loading && error && (
            <div className="task-state task-state-error" role="alert">
              <strong>任务加载失败</strong>
              <span>{error}</span>
              <button type="button" className="btn" onClick={() => void load()}>
                重试
              </button>
            </div>
          )}

          {!loading && !error && view === 'batches' && (
            <div className="task-batch-list">
              {pageItems.length === 0 && (
                <div className="task-state">没有匹配的批次</div>
              )}
              {(pageItems as TaskBatch[]).map((batch) => {
                const waiting = waitingCount(batch)
                const progress = batchProgress(batch)
                return (
                  <button
                    key={batch.batch_id}
                    type="button"
                    className="task-batch-card"
                    onClick={() => navigate(`/tasks/batches/${batch.batch_id}`)}
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
                )
              })}
            </div>
          )}

          {!loading && !error && view === 'tasks' && (
            <div className="task-item-list">
              {pageItems.length === 0 && <div className="task-state">暂无单条任务</div>}
              {(pageItems as TaskRecord[]).map((task) => (
                <article key={task.task_id} className="task-item-card">
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
                      <span>当前环节</span>
                      <strong>{publicTaskStage(task)}</strong>
                    </div>
                    <p>显示的是处理阶段与可见产出，不展示模型的内部思维过程。</p>
                    {completedSummaryPreview(task) && (
                      <div className="task-summary-preview">
                        <span>总结预览</span>
                        <p>{completedSummaryPreview(task)}{completedSummaryPreview(task).length >= 360 ? '…' : ''}</p>
                        {taskNotePath(task) && <Link to={taskNotePath(task)}>打开完整总结</Link>}
                      </div>
                    )}
                  </section>
                  <details className="task-diagnostics">
                    <summary>诊断信息</summary>
                    <dl>
                      <div><dt>任务编号</dt><dd>{task.task_id}</dd></div>
                      {task.batch_id && <div><dt>批次编号</dt><dd>{task.batch_id}</dd></div>}
                    </dl>
                    <Link
                      to={`/settings/monitor?batch_id=${encodeURIComponent(task.batch_id || '')}&task_id=${encodeURIComponent(task.task_id)}&level=ERROR`}
                    >
                      查看高级日志
                    </Link>
                  </details>
                </article>
              ))}
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
