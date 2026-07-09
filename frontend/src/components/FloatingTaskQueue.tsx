import { useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { RotateCcw, X } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import { usePipelineTasks } from '@/hooks/usePipelineTasks'
import { deletePipelineTask } from '@/services/pipeline'
import { PROCESSING_STAGES, isTaskTerminal, type TaskRecord } from '@/types/task'
import { categorizeError } from '@/lib/errorCategories'
import { toast } from 'sonner'
import './FloatingTaskQueue.css'

/* ── helpers ── */

type DisplayState = 'running' | 'queued' | 'error'

interface QueueRow {
  id: string
  groupKey: string
  title: string
  state: DisplayState
  status: string
  progress: number
  stage: string
  stageFull?: string
  workspaceId: string
  itemId?: string
  failedTaskIds: string[]
}

function displayState(status: string): DisplayState {
  if (status === 'FAILED') return 'error'
  if (status === 'PENDING') return 'queued'
  return 'running'
}

function getStageLabel(status: string, errorMsg?: string): string {
  if (status === 'FAILED') {
    if (errorMsg) {
      // F3.2: 复用 errorCategories 框架，展示友好分类文案（如「API 配额耗尽或请求限流」），
      // 而非原始错误截断；完整原文走行内 title tooltip（见 QueueRow.stageFull）。
      return categorizeError(errorMsg).friendlyMessage
    }
    return '失败'
  }
  const stage = PROCESSING_STAGES.find((s) => s.id === status)
  if (stage) return stage.name
  if (status === 'PENDING') return '等待槽位'
  return status
}

function getTaskTitle(task: TaskRecord): string {
  const payload = (task.payload ?? {}) as Record<string, unknown>
  const result = (task.result ?? {}) as Record<string, unknown>

  const rTitle = result?.title as string | undefined
  if (rTitle?.trim()) return rTitle.trim()

  // R3.12 C1: note task result 存的是 video_title（非 title），优先取
  const rvTitle = result?.video_title as string | undefined
  if (rvTitle?.trim()) return rvTitle.trim()

  // analyze 任务 payload 带 video_title（download 阶段 yt-dlp 抽取），优先用它保证
  // download→analyze 切换后标题不退化成 task_id hash
  const vTitle = payload?.video_title as string | undefined
  if (vTitle?.trim()) return vTitle.trim()

  const pTitle = payload?.title as string | undefined
  if (pTitle?.trim()) return pTitle.trim()

  // download 用 url，analyze 用 source_url，两者都兜住
  const url = ((payload?.url as string) || (payload?.source_url as string) || '') || undefined
  if (url?.trim()) {
    try {
      const segment = new URL(url.trim()).pathname.split('/').filter(Boolean).pop() || url
      return segment.length > 40 ? segment.slice(0, 37) + '...' : segment
    } catch {
      return url.trim().length > 40 ? url.trim().slice(0, 37) + '...' : url.trim()
    }
  }

  return task.task_id.slice(0, 8)
}

const timeOf = (value: string | undefined): number => {
  const ts = Date.parse(value || '')
  return Number.isFinite(ts) ? ts : 0
}

const dotColor = (s: DisplayState): string =>
  s === 'running' ? 'var(--accent-green)'
    : s === 'queued' ? 'var(--ink-4)'
    : 'var(--accent-pink)'

/* ── component ── */

export function FloatingTaskQueue() {
  usePipelineTasks({ pollInterval: 5000 })
  const navigate = useNavigate()
  const location = useLocation()
  const tasks = useTaskStore((s) => s.tasks)
  const storeCurrentTaskId = useTaskStore((s) => s.currentTaskId)
  const setCurrentTask = useTaskStore((s) => s.setCurrentTask)
  const cancelTask = useTaskStore((s) => s.cancelTask)
  const retryTask = useTaskStore((s) => s.retryTask)
  const removeTask = useTaskStore((s) => s.removeTask)
  const [open, setOpen] = useState(false)

  /* current task id from URL path /processing/:taskId */
  const routeTaskId = useMemo(() => {
    const m = location.pathname.match(/^\/processing\/(?!batch\/)([^/]+)/)
    return m ? m[1] : null
  }, [location.pathname])

  const currentTaskId = routeTaskId ?? storeCurrentTaskId

  const rows: QueueRow[] = useMemo(() => {
    // 先按 project_id + url 把「全部」task 分组（含已 SUCCESS 的 download），
    // 这样同一素材的 download + analyze 始终在一组：下载完成后该行不会脱组消失、
    // 也不会换 React key 重建成「新任务」，而是连续推进到分析阶段。
    const groups = new Map<string, TaskRecord[]>()
    for (const task of tasks) {
      const payload = (task.payload ?? {}) as Record<string, unknown>
      const url = (payload?.url as string) || (payload?.source_url as string) || ''
      const key = `${task.project_id}::${url || task.task_id}`
      const group = groups.get(key) || []
      group.push(task)
      groups.set(key, group)
    }

    // 仅保留「整组未完成」的素材：组内任一 task 非终态，或有 FAILED。
    // 全部 SUCCESS 的素材视为已完成，从活跃队列隐去。
    const activeGroups = Array.from(groups.entries()).filter(([, group]) =>
      group.some((t) => !isTaskTerminal(t.status) || t.status === 'FAILED'),
    )

    // 每组取代表 task：运行态 > PENDING > FAILED > 终态(SUCCESS/CANCELLED)
    const rankOf = (s: string): number =>
      s === 'FAILED' ? 2 : s === 'PENDING' ? 3 : isTaskTerminal(s) ? 1 : 4

    const representativeTasks = activeGroups.map(([groupKey, group]) => {
      // 按 status 优先级排序，取优先级最高的（运行中的 analyze 会盖过已完成的 download）
      group.sort((a, b) => rankOf(b.status) - rankOf(a.status))
      const representative = group[0]

      // 计算进度：根据实际存在的任务类型动态分配权重
      const downloadTask = group.find((t) => t.task_type === 'download')
      const analyzeTask = group.find((t) => t.task_type === 'analyze')
      const downloadProgress = downloadTask ? (downloadTask.progress ?? 0) : 0
      const analyzeProgress = analyzeTask ? (analyzeTask.progress ?? 0) : 0

      // 动态权重：如果只有一个任务类型，权重为 100%
      let weightedProgress: number
      if (downloadTask && analyzeTask) {
        weightedProgress = downloadProgress * 0.3 + analyzeProgress * 0.7
      } else if (downloadTask) {
        weightedProgress = downloadProgress
      } else if (analyzeTask) {
        weightedProgress = analyzeProgress
      } else {
        weightedProgress = representative.progress ?? 0
      }

      return {
        groupKey,
        task: representative,
        progress: weightedProgress,
        failedTaskIds: group.filter((t) => t.status === 'FAILED').map((t) => t.task_id),
      }
    })

    // 按更新时间排序；批量导入时每个视频都应显示为独立子任务。
    return representativeTasks
      .sort((a, b) => timeOf(b.task.updated_at) - timeOf(a.task.updated_at))
      .map(({ groupKey, task: t, progress, failedTaskIds }) => {
        const state = displayState(t.status)
        const displayProgress = Math.round(progress * 100)
        const payload = (t.payload ?? {}) as Record<string, unknown>
        return {
          id: t.task_id,
          groupKey,
          title: getTaskTitle(t),
          state,
          status: t.status,
          progress: state === 'error' ? Math.max(displayProgress, 1) : displayProgress,
          stage: getStageLabel(t.status, t.error || undefined),
          stageFull: t.error || undefined,
          workspaceId: t.project_id,
          itemId: payload?.item_id as string | undefined,
          failedTaskIds,
        }
      })
  }, [tasks])

  const running = rows.filter((r) => r.state === 'running').length
  const queued = rows.filter((r) => r.state === 'queued').length
  const errored = rows.filter((r) => r.state === 'error').length
  const total = rows.length

  const avgPct = total
    ? Math.round(rows.reduce((a, r) => a + (r.progress || 0), 0) / total)
    : 0

  const primaryWorkspaceId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (!row.workspaceId || row.workspaceId === 'default_project') continue
      counts.set(row.workspaceId, (counts.get(row.workspaceId) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  }, [rows])

  const handleSelectTask = (row: QueueRow) => {
    setCurrentTask(row.id)
    navigate(`/processing/${row.id}`, {
      state: {
        workspaceId: row.workspaceId,
        itemId: row.itemId,
      },
    })
    setOpen(false)
  }

  const handleCancelOrHide = async (row: QueueRow) => {
    if (row.status === 'FAILED') {
      const taskIds = row.failedTaskIds.length > 0 ? row.failedTaskIds : [row.id]
      for (const taskId of taskIds) {
        removeTask(taskId)
      }
      const results = await Promise.allSettled(taskIds.map((taskId) => deletePipelineTask(taskId)))
      const failedDeletes = results.filter((result) => result.status === 'rejected')
      if (failedDeletes.length > 0) {
        console.error('[FloatingTaskQueue] delete failed tasks failed:', failedDeletes)
        toast.error('清除历史任务失败，请稍后再试')
      }
      return
    }
    void cancelTask(row.id)
  }

  const retryErrored = (erroredRows: QueueRow[]) => {
    for (const row of erroredRows) {
      void retryTask(row.id)
    }
  }

  const cancelActive = (activeRows: QueueRow[]) => {
    for (const row of activeRows) {
      void cancelTask(row.id)
    }
  }

  if (total === 0) return null

  const activeRows = rows.filter((r) => r.status !== 'FAILED')
  const erroredRows = rows.filter((r) => r.status === 'FAILED')

  return (
    <>
      {/* ───── Collapsed FAB ───── */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', right: 24, bottom: 24, zIndex: 38,
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px 10px 12px',
            background: 'var(--ink)', color: 'var(--bg)',
            borderRadius: 99, border: 'none', cursor: 'pointer',
            boxShadow: 'var(--shadow-lg)',
            fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 500,
            transition: 'transform 160ms ease, box-shadow 160ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'none' }}
        >
          {/* mini progress ring */}
          <svg width="22" height="22" viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8.5" stroke="rgba(255,255,255,0.18)" strokeWidth="2" fill="none" />
            <circle
              cx="11" cy="11" r="8.5"
              stroke="var(--accent-green)" strokeWidth="2" fill="none"
              strokeDasharray={`${(avgPct / 100) * 53.4} 53.4`}
              strokeLinecap="round"
              transform="rotate(-90 11 11)"
            />
            <text
              x="11" y="14" textAnchor="middle" fontSize="7"
              fontFamily="var(--mono)" fill="var(--bg)" fontWeight="700"
            >
              {avgPct}
            </text>
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start', lineHeight: 1.1 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--bg)' }}>
              任务 · {running + queued + errored} 项进行中
            </span>
            <span style={{ fontSize: 10, opacity: 0.65 }}>
              {running > 0 && <>● {running} 处理</>}
              {queued > 0 && <>{running > 0 ? ' · ' : ''}○ {queued} 等待</>}
              {errored > 0 && (
                <>{(running || queued) ? ' · ' : ''}<span style={{ color: 'var(--accent-pink)' }}>✗ {errored} 失败</span></>
              )}
            </span>
          </div>
        </button>
      )}

      {/* ───── Expanded panel ───── */}
      {open && (
        <div
          style={{
            position: 'fixed', right: 24, bottom: 24, zIndex: 38,
            width: 380, maxHeight: '70vh',
            background: 'var(--bg-elev)', border: '1px solid var(--line)',
            borderRadius: 16, boxShadow: 'var(--shadow-lg)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            animation: 'ks-menu-in 200ms cubic-bezier(0.2,0.8,0.2,1)',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 14px', borderBottom: '1px solid var(--line)',
              background: 'var(--bg-sunken)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="eyebrow">任务 · 近期活跃</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                {running}/{total} 处理中 · 平均 {avgPct}%
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn btn-ghost"
                aria-label="关闭浮动任务队列"
                onClick={() => setOpen(false)}
                style={{ width: 24, height: 24, padding: 0, display: 'grid', placeItems: 'center' }}
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Aggregate bar */}
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>聚合进度</span>
              <div style={{ flex: 1, height: 3, background: 'var(--bg-sunken)', borderRadius: 99, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${avgPct}%`,
                    background: 'linear-gradient(90deg, var(--accent-pink), var(--accent-2), var(--accent-green))',
                    transition: 'width 400ms ease',
                  }}
                />
              </div>
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink)' }}>{avgPct}%</span>
            </div>
          </div>

          {/* Rows */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {rows.map((r) => {
              const isActive = currentTaskId === r.id
              return (
                <div
                  key={r.groupKey}
                  onClick={() => handleSelectTask(r)}
                  style={{
                    padding: '10px 14px',
                    borderLeft: isActive ? '2px solid var(--accent-pink)' : '2px solid transparent',
                    background: isActive ? 'var(--bg-sunken)' : 'transparent',
                    borderBottom: '1px solid var(--line)',
                    cursor: 'pointer',
                    transition: 'background 140ms ease',
                    display: 'flex', flexDirection: 'column', gap: 5,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'var(--bg-sunken)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {/* row layer 1: dot + title + pill + progress */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 7, height: 7, borderRadius: 99,
                        background: dotColor(r.state), flexShrink: 0,
                        animation: r.state === 'running' ? 'proc-blink 1.6s infinite' : 'none',
                      }}
                    />
                    <span
                      style={{
                        flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        color: r.state === 'error' ? 'var(--accent-pink)' : 'var(--ink)',
                      }}
                    >
                      {r.title}
                    </span>
                    {isActive && (
                      <span
                        className="mono"
                        style={{
                          fontSize: 9, color: 'var(--accent-pink)', flexShrink: 0,
                          padding: '1px 5px', border: '1px solid var(--accent-pink)', borderRadius: 4,
                        }}
                      >
                        查看中
                      </span>
                    )}
                    <span className="mono" style={{ fontSize: 10, color: dotColor(r.state), flexShrink: 0 }}>
                      {r.state === 'error' ? 'FAIL' : `${r.progress}%`}
                    </span>
                  </div>

                  {/* row layer 2: thin progress bar + stage */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 2, background: 'var(--bg-sunken)', borderRadius: 99, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${r.progress}%`,
                          background: dotColor(r.state),
                          transition: 'width 400ms ease',
                        }}
                      />
                    </div>
                    <span className="mono" title={r.stageFull} style={{ fontSize: 9.5, color: 'var(--ink-4)' }}>
                      {r.stage}
                    </span>
                    {r.state === 'error' && (
                      <button
                        className="btn btn-ghost"
                        aria-label={`重试 ${r.title}`}
                        style={{ height: 20, padding: '0 7px', fontSize: 10, gap: 4 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          void retryTask(r.id)
                        }}
                      >
                        <RotateCcw size={10} />重试
                      </button>
                    )}
                    <button
                      className="btn btn-ghost"
                      aria-label={r.status === 'FAILED' ? `清除失败任务 ${r.title}` : `取消任务 ${r.title}`}
                      style={{ height: 20, padding: '0 7px', fontSize: 10, color: 'var(--ink-3)' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleCancelOrHide(r)
                      }}
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex', gap: 6, padding: '10px 14px',
              borderTop: '1px solid var(--line)',
              background: 'var(--bg-sunken)',
            }}
          >
            <button
              className="btn"
              style={{ flex: 1, height: 30, fontSize: 12 }}
              onClick={() => {
                navigate(primaryWorkspaceId ? `/processing/batch/${primaryWorkspaceId}` : '/workspaces')
                setOpen(false)
              }}
            >
              查看全部
            </button>
            <button
              className="btn"
              style={{ flex: 1, height: 30, fontSize: 12 }}
              disabled={activeRows.length === 0}
              onClick={() => cancelActive(activeRows)}
            >
              暂停全部
            </button>
            <button
              className="btn"
              style={{ flex: 1, height: 30, fontSize: 12 }}
              disabled={erroredRows.length === 0}
              onClick={() => retryErrored(erroredRows)}
            >
              <RotateCcw size={11} />重试 {erroredRows.length} 项
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default FloatingTaskQueue
