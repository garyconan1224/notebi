import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listTaskBatches } from '@/services/taskBatches'
import { listPipelineTasks } from '@/services/pipeline'
import type { TaskBatch } from '@/types/taskBatch'
import type { TaskRecord } from '@/types/task'

type View = 'batches' | 'tasks' | 'failures'

export default function TaskCenterPage() {
  const navigate = useNavigate()
  const [view, setView] = useState<View>('batches')
  const [batches, setBatches] = useState<TaskBatch[]>([])
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [batchStatus, setBatchStatus] = useState('')
  const [batchSource, setBatchSource] = useState('')

  useEffect(() => {
    Promise.all([listTaskBatches(), listPipelineTasks({ limit: 200 })])
      .then(([batchResult, taskResult]) => {
        setBatches(batchResult.batches)
        setTasks(Array.isArray(taskResult) ? taskResult : [])
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  const visibleBatches = useMemo(
    () => batches.filter((batch) => (
      (!keyword || batch.name.toLowerCase().includes(keyword.toLowerCase()))
      && (!batchStatus || batch.status === batchStatus)
      && (!batchSource || batch.source_type === batchSource)
    )),
    [batches, keyword, batchStatus, batchSource],
  )
  const visibleTasks = useMemo(() => {
    const source = view === 'failures' ? tasks.filter((task) => task.status === 'FAILED') : tasks
    return source.filter((task) =>
      !keyword
      || task.task_id.toLowerCase().includes(keyword.toLowerCase())
      || task.project_id.toLowerCase().includes(keyword.toLowerCase()),
    )
  }, [tasks, view, keyword])

  return (
    <main className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="eyebrow">TASK CENTER · LOCAL</div>
            <h1 className="text-3xl font-bold">任务中心</h1>
            <p className="text-sm text-muted-foreground">批量任务、单条任务和失败重试统一在这里管理。</p>
          </div>
          <Link className="btn" to="/tasks/new">新建批量任务</Link>
        </header>

        <div className="flex flex-wrap gap-2">
          {([
            ['batches', '批次'],
            ['tasks', '任务'],
            ['failures', '失败'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="btn"
              aria-pressed={view === value}
              onClick={() => setView(value)}
            >
              {label}
            </button>
          ))}
          {view === 'batches' && (
            <>
              <select
                aria-label="批次状态"
                className="rounded-md border px-3 py-2 text-sm"
                value={batchStatus}
                onChange={(event) => setBatchStatus(event.target.value)}
              >
                <option value="">全部状态</option>
                <option value="queued">排队中</option>
                <option value="running">运行中</option>
                <option value="paused">已暂停</option>
                <option value="completed">已完成</option>
                <option value="partial">部分完成</option>
                <option value="failed">失败</option>
                <option value="cancelled">已取消</option>
                <option value="partial_cancelled">部分取消</option>
              </select>
              <select
                aria-label="批次来源"
                className="rounded-md border px-3 py-2 text-sm"
                value={batchSource}
                onChange={(event) => setBatchSource(event.target.value)}
              >
                <option value="">全部来源</option>
                <option value="urls">多链接</option>
                <option value="local_files">本地文件</option>
                <option value="bilibili_collection">B 站合集</option>
                <option value="bilibili_favorites">B 站收藏夹</option>
                <option value="bilibili_uploader">B 站 UP 主</option>
                <option value="bilibili_parts">B 站分 P</option>
                <option value="youtube_playlist">YouTube 播放列表</option>
              </select>
            </>
          )}
          <input
            aria-label="搜索任务"
            className="ml-auto min-w-52 rounded-md border px-3 py-2 text-sm"
            placeholder="搜索批次、任务或合集"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>

        {loading && <div role="status">正在加载任务…</div>}
        {error && <div role="alert">加载失败：{error}</div>}
        {!loading && !error && view === 'batches' && (
          <div className="space-y-2">
            {visibleBatches.length === 0 && <div className="rounded-lg border p-8 text-center">暂无批次</div>}
            {visibleBatches.map((batch) => (
              <button
                key={batch.batch_id}
                type="button"
                className="flex w-full items-center gap-4 rounded-lg border p-4 text-left"
                onClick={() => navigate(`/tasks/batches/${batch.batch_id}`)}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{batch.name}</div>
                  <div className="text-xs text-muted-foreground">
                    合集 {batch.target_workspace_id || '新合集'} · {batch.completed_count}/{batch.total_count} 完成
                  </div>
                </div>
                <span className="rounded-full border px-2 py-1 text-xs">{batch.status}</span>
              </button>
            ))}
          </div>
        )}
        {!loading && !error && view !== 'batches' && (
          <div className="overflow-x-auto rounded-lg border">
            {visibleTasks.length === 0 ? (
              <div className="p-8 text-center">{view === 'failures' ? '没有失败任务' : '暂无任务'}</div>
            ) : (
              <table className="w-full text-sm">
                <thead><tr><th className="p-3 text-left">任务</th><th>合集</th><th>阶段</th><th>进度</th><th>操作</th></tr></thead>
                <tbody>
                  {visibleTasks.map((task) => (
                    <tr key={task.task_id} className="border-t">
                      <td className="p-3">{task.task_id}</td>
                      <td>{task.project_id}</td>
                      <td>{task.status}</td>
                      <td>{Math.round((task.progress || 0) * 100)}%</td>
                      <td>
                        <Link to={`/settings/monitor?batch_id=${encodeURIComponent(task.batch_id || '')}&task_id=${encodeURIComponent(task.task_id)}&level=ERROR`}>
                          查看日志
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
