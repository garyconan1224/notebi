import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CircleAlert, FileText, Pause, Play, RefreshCw, XCircle } from 'lucide-react'
import { StatusBadge, type StatusKind } from '@/components/ui/status-badge'
import {
  cancelTaskBatch,
  getTaskBatch,
  pauseTaskBatch,
  resumeTaskBatch,
  retryFailedTaskBatch,
} from '@/services/taskBatches'
import type { BatchItem, BatchStatus, BatchTaskDetail, TaskBatch } from '@/types/taskBatch'
import './task-center.css'

const TERMINAL_BATCH_STATUSES = new Set<TaskBatch['status']>([
  'completed',
  'partial',
  'failed',
  'cancelled',
  'partial_cancelled',
])

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

const ACTION_LABELS: Record<BatchItem['action'], string> = {
  process: '处理新素材',
  skip: '跳过已有内容',
  copy: '归入已有笔记',
}

function batchStatusKind(status: BatchStatus): StatusKind {
  if (status === 'completed') return 'success'
  if (status === 'running') return 'running'
  if (status === 'queued') return 'queued'
  if (status === 'paused') return 'paused'
  return 'error'
}

function taskStatusKind(status: string): StatusKind {
  if (['SUCCESS', 'completed', 'skipped'].includes(status)) return 'success'
  if (['FAILED', 'PARTIAL', 'failed'].includes(status)) return 'error'
  if (['CANCELLED', 'cancelled'].includes(status)) return 'offline'
  if (['PENDING', 'pending'].includes(status)) return 'queued'
  return 'running'
}

function taskStatusLabel(status: string): string {
  return {
    PENDING: '等待中',
    DOWNLOAD: '下载中',
    ASR: '转录中',
    FRAMES: '画面分析中',
    ANALYZE: '整理中',
    STORE: '保存中',
    SUCCESS: '已完成',
    PARTIAL: '部分完成',
    FAILED: '失败',
    CANCELLED: '已取消',
    pending: '等待中',
    running: '处理中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    skipped: '已跳过',
  }[status] || status
}

function waitingCount(batch: TaskBatch) {
  return Math.max(0, batch.total_count - batch.completed_count - batch.failed_count - batch.cancelled_count - batch.skipped_count)
}

function batchProgress(batch: TaskBatch) {
  if (!batch.total_count) return 0
  const finished = batch.completed_count + batch.failed_count + batch.cancelled_count + batch.skipped_count
  return Math.min(100, Math.round((finished / batch.total_count) * 100))
}

function itemTaskDetail(batch: TaskBatch, item: BatchItem): BatchTaskDetail | undefined {
  const taskId = item.task_id || item.task_ids.at(-1)
  return taskId ? batch.task_details?.[taskId] : undefined
}

export default function BatchDetailPage() {
  const { batchId = '' } = useParams()
  const [batch, setBatch] = useState<TaskBatch | null>(null)
  const [error, setError] = useState('')
  const batchStatus = batch?.status

  const run = async (action: (id: string) => Promise<TaskBatch>) => {
    try {
      setError('')
      setBatch(await action(batchId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    }
  }

  useEffect(() => {
    getTaskBatch(batchId).then(setBatch).catch((reason) => setError(String(reason)))
  }, [batchId])

  useEffect(() => {
    if (!batchStatus || TERMINAL_BATCH_STATUSES.has(batchStatus)) return
    const timer = window.setInterval(() => {
      getTaskBatch(batchId).then(setBatch).catch(() => {
        // 保留上一次可用结果；下一轮继续刷新，避免瞬时网络错误清空详情页。
      })
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [batchId, batchStatus])

  const progress = useMemo(() => batch ? batchProgress(batch) : 0, [batch])

  if (!batch && error) return <main className="task-center-page" role="alert">{error}</main>
  if (!batch) return <main className="task-center-page" role="status">正在加载批次…</main>

  const terminal = TERMINAL_BATCH_STATUSES.has(batch.status)

  return (
    <main className="task-center-page task-batch-detail-page">
      <div className="task-center-shell space-y-5">
        <header className="task-detail-header">
          <Link className="task-back-link" to="/tasks"><ArrowLeft size={15} /> 返回任务中心</Link>
          <div className="task-detail-heading">
            <div>
              <span className="tag">批量任务</span>
              <h1>{batch.name}</h1>
              <p>每条素材的当前环节、可见处理记录和已生成内容都在这里；不会展示模型的私有推理。</p>
            </div>
            <StatusBadge status={batchStatusKind(batch.status)}>{BATCH_STATUS_LABELS[batch.status]}</StatusBadge>
          </div>
        </header>

        {error && <div className="task-inline-error" role="alert"><CircleAlert size={16} />{error}</div>}

        <section className="task-detail-progress" aria-label="批次总进度">
          <div className="task-progress-row">
            <strong>{progress}%</strong>
            <div className="task-progress" role="progressbar" aria-label={`${batch.name}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <span>{batch.completed_count + batch.failed_count + batch.cancelled_count + batch.skipped_count} / {batch.total_count} 已处理</span>
          </div>
          <div className="task-detail-stats">
            <div><span>已完成</span><strong>{batch.completed_count}</strong></div>
            <div><span>失败</span><strong>{batch.failed_count}</strong></div>
            <div><span>等待</span><strong>{waitingCount(batch)}</strong></div>
            <div><span>已跳过</span><strong>{batch.skipped_count}</strong></div>
          </div>
        </section>

        <div className="task-detail-actions">
          {!terminal && batch.status === 'paused' && <button className="btn btn-primary" type="button" onClick={() => void run(resumeTaskBatch)}><Play size={15} />恢复</button>}
          {!terminal && batch.status !== 'paused' && <button className="btn" type="button" onClick={() => void run(pauseTaskBatch)}><Pause size={15} />暂停</button>}
          {!terminal && (
            <button className="btn" type="button" onClick={() => {
              if (window.confirm('确认取消这个批次？已经完成的笔记会保留。')) void run(cancelTaskBatch)
            }}><XCircle size={15} />取消</button>
          )}
          {batch.failed_count > 0 && <button className="btn" type="button" onClick={() => void run(retryFailedTaskBatch)}><RefreshCw size={15} />重试失败项</button>}
          <Link className="btn btn-ghost" to={`/settings/monitor?batch_id=${encodeURIComponent(batch.batch_id)}`}>查看监控</Link>
        </div>

        <section className="task-detail-list" aria-label="批次素材详情">
          {batch.items.map((item, index) => {
            const detail = itemTaskDetail(batch, item)
            const detailStatus = detail?.status || item.status
            const notePath = detail?.workspace_id && detail?.item_id
              ? `/workspaces/${detail.workspace_id}/items/${detail.item_id}/note`
              : ''
            const itemProgress = Math.round((detail?.progress || 0) * 100)
            const reason = detail?.error || item.error
            return (
              <article key={item.batch_item_id} className="task-detail-item">
                <div className="task-detail-item-heading">
                  <div>
                    <span className="task-item-number">{index + 1}</span>
                    <h2>{item.source_title || item.source_url || '未命名素材'}</h2>
                    <p>{ACTION_LABELS[item.action]} · 第 {item.attempt_no} 次尝试</p>
                  </div>
                  <StatusBadge status={taskStatusKind(detailStatus)}>{taskStatusLabel(detailStatus)}</StatusBadge>
                </div>

                {detail && !['SUCCESS', 'FAILED', 'PARTIAL', 'CANCELLED'].includes(detail.status) && (
                  <div className="task-progress-row task-detail-item-progress">
                    <strong>{itemProgress}%</strong>
                    <div className="task-progress" role="progressbar" aria-label={`${item.source_title || item.source_url}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={itemProgress}>
                      <span style={{ width: `${itemProgress}%` }} />
                    </div>
                  </div>
                )}

                <div className="task-detail-stage"><span>当前环节</span><strong>{detail?.stage || taskStatusLabel(detailStatus)}</strong></div>
                {detail?.summary_preview && (
                  <section className="task-detail-output" aria-label="总结产出">
                    <div><span>已生成总结</span>{notePath && <Link to={notePath}><FileText size={14} />打开笔记</Link>}</div>
                    <p>{detail.summary_preview}</p>
                  </section>
                )}
                {reason && <div className="task-detail-failure"><CircleAlert size={15} /><span>{reason}</span></div>}
                {detail?.visible_events.length ? (
                  <details className="task-detail-events">
                    <summary>查看可见处理记录（{detail.visible_events.length}）</summary>
                    <ol>{detail.visible_events.map((event, eventIndex) => <li key={`${eventIndex}-${event}`}>{event}</li>)}</ol>
                  </details>
                ) : item.task_ids.length > 0 && (
                  <Link className="task-detail-monitor-link" to={`/settings/monitor?batch_id=${encodeURIComponent(batch.batch_id)}&task_id=${encodeURIComponent(item.task_id || item.task_ids.at(-1) || '')}`}>查看该项监控</Link>
                )}
                {item.task_ids.length > 0 && (
                  <details className="task-detail-events">
                    <summary>任务编号与尝试记录</summary>
                    <ol>{item.task_ids.map((taskId) => <li key={taskId}>{taskId}</li>)}</ol>
                  </details>
                )}
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
