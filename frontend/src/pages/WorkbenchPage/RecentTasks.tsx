import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, FileText, Image, Mic, Play } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { EmptyState } from '@/components/ui/empty-state'
import { usePipelineTasks } from '@/hooks/usePipelineTasks'
import { fetchLibrary, type LibraryItem } from '@/services/library'
import { useTaskStore } from '@/store/taskStore'
import { getStatusText, isTaskTerminal, type TaskRecord } from '@/types/task'
import { previewSrcForProxy } from '@/components/workspace/linkCover'

const HIDDEN_TASK_TYPES = new Set(['summary'])

const TYPE_LABEL: Record<LibraryItem['type'], string> = {
  video: 'VIDEO',
  audio: 'AUDIO',
  image: 'IMAGE',
  text: 'TEXT',
  unknown: 'AUTO',
}

const COVER_CLASS: Record<LibraryItem['type'], string> = {
  video: 'cover-video',
  audio: 'cover-audio',
  image: 'cover-image',
  text: 'cover-text',
  unknown: 'cover-unknown',
}

interface RecentTasksProps {
  /**
   * 仅保留给组件测试和旧嵌入方；产品页面不传此值，首页以 library 为事实源。
   */
  tasks?: TaskRecord[]
}

function taskTitle(task: TaskRecord): string {
  const payload = (task.payload ?? {}) as Record<string, unknown>
  const result = (task.result ?? {}) as Record<string, unknown>
  for (const value of [result.video_title, payload.video_title, payload.url]) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return getStatusText(task.status)
}

function taskSummary(task: TaskRecord): string {
  const result = (task.result ?? {}) as Record<string, unknown>
  for (const value of [result.note_summary, result.summary, result.description]) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function taskType(task: TaskRecord): LibraryItem['type'] {
  if (task.task_type === 'audio') return 'audio'
  if (task.task_type === 'image') return 'image'
  if (task.task_type === 'text') return 'text'
  return 'video'
}

function taskThumbnail(task: TaskRecord): string | null {
  const result = (task.result ?? {}) as Record<string, unknown>
  for (const value of [result.video_thumbnail_url, result.cover_thumbnail]) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function legacyItems(tasks: TaskRecord[]): LibraryItem[] {
  return tasks
    .filter((task) => !HIDDEN_TASK_TYPES.has(task.task_type))
    .filter((task) => {
      const title = taskTitle(task)
      return title !== getStatusText(task.status) || Boolean(taskSummary(task) || taskThumbnail(task))
    })
    .map((task) => ({
      item_id: task.task_id,
      workspace_id: task.project_id,
      workspace_name: '',
      workspace_kind: 'note',
      type: taskType(task),
      source: 'url',
      source_value: '',
      name: taskTitle(task),
      status: isTaskTerminal(task.status)
        ? task.status === 'FAILED'
          ? 'failed'
          : 'done'
        : 'processing',
      created_at: task.created_at,
      updated_at: task.updated_at,
      duration_seconds: null,
      thumbnail: taskThumbnail(task),
      description: taskSummary(task),
      results_summary: {
        has_summary: Boolean(taskSummary(task)),
        has_transcript: false,
      },
      primary_task_status: task.status,
      related_task_ids: [task.task_id],
    }))
}

/** 首页按笔记内容聚合；合集只是归类视图，不能让同一笔记占多个最近位。 */
function uniqueNoteViews(items: LibraryItem[]): LibraryItem[] {
  const newestFirst = [...items].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  )
  const seen = new Set<string>()
  return newestFirst.filter((item) => {
    const key = item.content_id || `${item.workspace_id}:${item.item_id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function CoverFallback({ type }: { type: LibraryItem['type'] }) {
  if (type === 'audio') {
    return (
      <div className="audio-wave" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
      </div>
    )
  }
  if (type === 'image') {
    return (
      <div className="image-cluster" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
      </div>
    )
  }
  if (type === 'text') {
    return (
      <div className="doc-lines" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <i key={index} />)}
      </div>
    )
  }
  return <div className="cover-icon" aria-hidden="true"><Play fill="currentColor" /></div>
}

function ActivityIcon({ type }: { type: LibraryItem['type'] }) {
  if (type === 'audio') return <Mic size={15} />
  if (type === 'image') return <Image size={15} />
  if (type === 'text') return <FileText size={15} />
  return <Play size={15} />
}

export function RecentTasks({ tasks: tasksProp }: RecentTasksProps) {
  const navigate = useNavigate()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(tasksProp == null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set())

  usePipelineTasks({ pollInterval: 5000 })
  const storeTasks = useTaskStore((state) => state.tasks)
  const tasks = tasksProp ?? storeTasks

  const terminalSignature = tasks
    .filter((task) => !HIDDEN_TASK_TYPES.has(task.task_type) && isTaskTerminal(task.status))
    .map((task) => `${task.task_id}:${task.updated_at}`)
    .sort()
    .join('|')

  useEffect(() => {
    if (tasksProp) {
      setItems(legacyItems(tasksProp))
      setLoading(false)
      setLoadFailed(false)
      return
    }

    let cancelled = false
    setLoading(true)
    fetchLibrary(false)
      .then((response) => {
        if (cancelled) return
        setItems(response.items)
        setLoadFailed(false)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tasksProp, terminalSignature])

  const noteItems = useMemo(
    () => uniqueNoteViews(items),
    [items],
  )

  const recentItems = useMemo(() => noteItems.slice(0, 8), [noteItems])

  const activeTasks = tasks
    .filter((task) => !HIDDEN_TASK_TYPES.has(task.task_type) && !isTaskTerminal(task.status))
    .slice(0, 3)

  const openItem = (item: LibraryItem) => {
    if (tasksProp) {
      navigate(`/processing/${item.item_id}`)
      return
    }
    navigate(`/workspaces/${item.workspace_id}/items/${item.item_id}/note`)
  }

  return (
    <section className="wb-recent" style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 32px 80px' }}>
      {activeTasks.length > 0 && (
        <div className="wb-activity" aria-label="正在处理">
          <div className="sec-h">
            <h2 className="sec-title">正在处理</h2>
            <button className="sec-link" onClick={() => navigate('/tasks')}>
              任务中心 <ArrowRight size={13} />
            </button>
          </div>
          <div className="wb-activity-list">
            {activeTasks.map((task) => {
              const progress = Math.round(Math.min(task.progress ?? 0, 1) * 100)
              const type = taskType(task)
              return (
                <button
                  className="wb-activity-row"
                  key={task.task_id}
                  onClick={() => navigate(`/processing/${task.task_id}`)}
                  type="button"
                >
                  <span className="wb-activity-icon"><ActivityIcon type={type} /></span>
                  <span className="wb-activity-copy">
                    <strong>{taskTitle(task)}</strong>
                    <small>{getStatusText(task.status)}</small>
                  </span>
                  <span className="wb-activity-progress" aria-label={`进度 ${progress}%`}>
                    <i style={{ width: `${progress}%` }} />
                  </span>
                  <span className="wb-activity-percent">{progress}%</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="sec-h">
        <h2 className="sec-title">最近笔记</h2>
        <button className="sec-link" onClick={() => navigate('/notes')}>
          全部 · {noteItems.length} <ArrowRight size={13} />
        </button>
      </div>

      {loading && <div className="wb-recent-state" role="status">正在读取本地笔记…</div>}
      {!loading && loadFailed && (
        <EmptyState title="笔记暂时无法读取" description="请确认 NoteBi 后端已启动后重试" />
      )}
      {!loading && !loadFailed && recentItems.length === 0 && (
        <EmptyState title="暂无笔记" description="在上方粘贴链接或拖入文件开始整理" />
      )}

      {!loading && !loadFailed && recentItems.length > 0 && (
        <div className="note-grid">
          {recentItems.map((item) => {
            const hasThumb = Boolean(item.thumbnail) && !failedThumbs.has(item.item_id)
            return (
              <article
                className="note-card"
                data-kind={item.type}
                data-testid="recent-note-card"
                key={`${item.workspace_id}:${item.item_id}`}
                onClick={() => openItem(item)}
              >
                <div className={`note-cover ${hasThumb ? '' : COVER_CLASS[item.type]}`}>
                  {hasThumb && (
                    <img
                      alt=""
                      onError={() =>
                        setFailedThumbs((previous) => new Set(previous).add(item.item_id))
                      }
                      referrerPolicy="no-referrer"
                      src={previewSrcForProxy(item.thumbnail)}
                    />
                  )}
                  <span className="media-chip">{TYPE_LABEL[item.type]}</span>
                  <span className={`status-pill ${item.status === 'done' ? 'status-done' : ''}`}>
                    {item.status === 'done' ? '可阅读' : item.status === 'failed' ? '需处理' : '整理中'}
                  </span>
                  {!hasThumb && <CoverFallback type={item.type} />}
                </div>
                <div className="note-card-body">
                  <div className="note-title-row">
                    <span className="note-type-dot" />
                    <h3>{item.name}</h3>
                  </div>
                  {item.description && <p className="note-summary">{item.description}</p>}
                  <div className="note-meta-row">
                    <span>{item.workspace_name || '本地笔记'}</span>
                    {item.duration_seconds != null && <span>{Math.round(item.duration_seconds)} 秒</span>}
                  </div>
                  <div className="note-card-actions">
                    <span>{new Date(item.updated_at).toLocaleDateString('zh-CN')}</span>
                    <button
                      className="note-open"
                      onClick={(event) => {
                        event.stopPropagation()
                        openItem(item)
                      }}
                      type="button"
                    >
                      打开
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
