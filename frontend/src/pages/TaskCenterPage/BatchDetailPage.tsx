import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  cancelTaskBatch,
  getTaskBatch,
  pauseTaskBatch,
  resumeTaskBatch,
  retryFailedTaskBatch,
} from '@/services/taskBatches'
import type { TaskBatch } from '@/types/taskBatch'

const TERMINAL_BATCH_STATUSES = new Set<TaskBatch['status']>([
  'completed',
  'partial',
  'failed',
  'cancelled',
  'partial_cancelled',
])

export default function BatchDetailPage() {
  const { batchId = '' } = useParams()
  const [batch, setBatch] = useState<TaskBatch | null>(null)
  const [error, setError] = useState('')

  const run = async (action: (id: string) => Promise<TaskBatch>) => {
    try {
      setBatch(await action(batchId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    }
  }

  useEffect(() => {
    getTaskBatch(batchId).then(setBatch).catch((reason) => setError(String(reason)))
  }, [batchId])

  useEffect(() => {
    if (!batch || TERMINAL_BATCH_STATUSES.has(batch.status)) return
    const timer = window.setInterval(() => {
      getTaskBatch(batchId).then(setBatch).catch(() => {
        // 保留上一次可用结果；下一轮继续刷新，避免瞬时网络错误清空详情页。
      })
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [batchId, batch?.status])

  if (error) return <main className="p-6" role="alert">{error}</main>
  if (!batch) return <main className="p-6" role="status">正在加载批次…</main>

  return (
    <main className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header>
          <Link to="/tasks">← 返回任务中心</Link>
          <h1 className="mt-2 text-3xl font-bold">{batch.name}</h1>
          <p className="text-sm text-muted-foreground">
            {batch.completed_count}/{batch.total_count} 完成 · {batch.failed_count} 失败 · {batch.status}
          </p>
        </header>
        <div className="flex flex-wrap gap-2">
          {batch.status === 'paused'
            ? <button className="btn" onClick={() => void run(resumeTaskBatch)}>恢复</button>
            : <button className="btn" onClick={() => void run(pauseTaskBatch)}>暂停</button>}
          <button
            className="btn"
            onClick={() => {
              if (window.confirm('确认取消这个批次？已完成内容会保留。')) void run(cancelTaskBatch)
            }}
          >
            取消
          </button>
          <button className="btn" onClick={() => void run(retryFailedTaskBatch)}>重试失败项</button>
          <Link className="btn" to={`/settings/monitor?batch_id=${encodeURIComponent(batch.batch_id)}`}>查看日志</Link>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead><tr><th className="p-3 text-left">素材</th><th>动作</th><th>状态</th><th>尝试</th><th>任务</th></tr></thead>
            <tbody>
              {batch.items.map((item) => (
                <tr key={item.batch_item_id} className="border-t">
                  <td className="max-w-md truncate p-3">{item.source_title || item.source_url}</td>
                  <td>{item.action}</td><td>{item.status}</td><td>{item.attempt_no}</td>
                  <td>{item.task_ids.map((id) => <div key={id}>{id}</div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
