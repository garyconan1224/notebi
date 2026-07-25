import { useState } from 'react'
import { ArrowRight, Play, Mic, Image, FileText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTaskStore } from '@/store/taskStore'
import { usePipelineTasks } from '@/hooks/usePipelineTasks'
import { isTaskTerminal, getStatusText } from '@/types/task'
import type { TaskRecord } from '@/types/task'
import { APP_NAME } from '@/config/product'
import { EmptyState } from '@/components/ui/empty-state'

const STATE_PILL_CLASS: Record<string, string> = {
  done:      'status-pill status-done',
  running:   'status-pill status-run',
  error:     'status-pill status-error',
  cancelled: 'status-pill',
  queued:    'status-pill',
}

const STATE_STATUS_LABEL: Record<string, string> = {
  done:      '已完成',
  running:   '运行中',
  error:     '失败',
  cancelled: '已取消',
  queued:    '排队中',
}

const TYPE_LABEL: Record<string, string> = {
  video: 'VIDEO',
  audio: 'AUDIO',
  image: 'IMAGE',
  text:  'TEXT',
}

const COVER_CLASS: Record<string, string> = {
  video: 'cover-video',
  audio: 'cover-audio',
  image: 'cover-image',
  text:  'cover-text',
}

/** 阶段 C3：首页只展示顶层素材任务。
 * `summary` 是笔记内部的生成总结子任务（后端 create_summary 用 task_type="summary" 创建），
 * 不应成为一张独立素材卡；其 result.summary 是完整 ItemSummary 对象，渲染会崩溃。
 * 排除集合只列已确认的内部子任务类型，不猜测。 */
const HIDDEN_TASK_TYPES = new Set(['summary'])

function titleFromFilename(filename: unknown): string {
  const raw = typeof filename === 'string' ? filename.trim() : ''
  if (!raw) return ''
  const name = raw.split('/').pop() || raw
  return name.replace(/\.[^.]+$/, '')
}

function audioThumbFromResult(result: Record<string, unknown>, audio?: Record<string, unknown>): string {
  const projectId = typeof result.project_id === 'string' ? result.project_id.trim() : ''
  const filename = typeof audio?.filename === 'string' ? audio.filename.trim() : ''
  if (!projectId || !filename) return ''
  return `/static/workspaces/${projectId}/audio/${titleFromFilename(filename)}.jpg`
}

/** 从 result 里取摘要文本，逐级 fallback。
 * 阶段 C3：只接受字符串值，候选不是字符串就跳过——不得用 `as string` 欺骗类型系统，
 * 否则后端返回完整 ItemSummary 对象时会把对象交给 React 触发整页崩溃。
 * 不回退到 video_title：那是卡片标题，重复进摘要行会让同一文本出现两次。 */
function descFromResult(result: Record<string, unknown>): string {
  for (const value of [result.note_summary, result.summary, result.description]) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

interface NoteCard {
  id: string
  title: string
  summary: string
  src: string              // 来源平台/URL 标签
  type: string             // video | audio | image | text
  state: string
  thumb: string
  progress: number         // 0~1
  lastAction: string
  metaLabels: string[]     // 元信息行
}

function taskToNoteCard(t: TaskRecord): NoteCard {
  const payload = (t.payload ?? {}) as Record<string, unknown>
  const result = (t.result ?? {}) as Record<string, unknown>

  // 状态
  let state = 'queued'
  if (t.status === 'SUCCESS') state = 'done'
  else if (t.status === 'FAILED') state = 'error'
  else if (t.status === 'CANCELLED') state = 'cancelled'
  else if (isTaskTerminal(t.status)) state = 'done'
  else state = 'running'

  // 标题
  const url = payload.url as string | undefined
  const videoTitle = (result.video_title || payload.video_title) as string | undefined
  const title = videoTitle?.trim()
    ? videoTitle
    : url
      ? (url.length > 50 ? url.slice(0, 47) + '...' : url)
      : getStatusText(t.status)

  // 摘要
  const summary = descFromResult(result)

  // 来源标签
  const rawSource = (result.source_name || result.platform || payload.platform || APP_NAME) as string
  const src = rawSource.trim().toLowerCase() === 'nibi' ? APP_NAME : rawSource

  // 封面
  const resultAudio = result.audio as Record<string, unknown> | undefined
  const thumb = (result.video_thumbnail_url
    || result.cover_thumbnail
    || audioThumbFromResult(result, resultAudio)
    || '') as string

  // 类型
  const noteKind = result.note_kind as string | undefined
  const type =
    noteKind === 'image_text' ? 'image'
    : t.task_type === 'audio' ? 'audio'
    : t.task_type === 'image' ? 'image'
    : t.task_type === 'text'  ? 'text'
    : 'video'

  // 进度
  const progress = typeof t.progress === 'number' ? t.progress : 0

  // 上一次动作
  const lastAction = (result.last_action
    || result.last_stage
    || (state === 'running' ? getStatusText(t.status) : '')
    || '') as string

  // 元信息
  const metaLabels: string[] = []
  if (src) metaLabels.push(src)
  if (result.duration) metaLabels.push(String(result.duration))
  if (result.frame_count) metaLabels.push(`${result.frame_count} 帧`)
  if (result.segment_count) metaLabels.push(`${result.segment_count} 段`)
  if (!metaLabels.length) {
    metaLabels.push(t.task_type, type)
  }

  return { id: t.task_id, title, summary, src, type, state, thumb, progress, lastAction, metaLabels }
}

interface RecentTasksProps {
  tasks?: TaskRecord[]
}

export function RecentTasks({ tasks: tasksProp }: RecentTasksProps) {
  const navigate = useNavigate()
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set())
  usePipelineTasks({ pollInterval: 5000 })
  const storeTasks = useTaskStore((s) => s.tasks)
  const tasks = tasksProp ?? storeTasks
  // 过滤无意义卡：标题落到 getStatusText（无 video_title 也无 url），且无封面、无摘要
  const meaningful = tasks.filter((t) => {
    if (HIDDEN_TASK_TYPES.has(t.task_type)) return false
    const payload = (t.payload ?? {}) as Record<string, unknown>
    const result = (t.result ?? {}) as Record<string, unknown>
    const hasTitle = !!(result.video_title || payload.video_title || payload.url)
    const hasCover = !!(result.video_thumbnail_url || result.cover_thumbnail || result.audio)
    const hasSummary = !!(result.note_summary || result.summary || result.description || result.video_title)
    return hasTitle || hasCover || hasSummary
  })
  const cards = meaningful.slice(0, 8).map(taskToNoteCard)
  const totalCount = tasks.length

  // 封面 icon
  function coverIcon(type: string) {
    const cls = 'cover-icon'
    switch (type) {
      case 'video': return <div className={cls}><Play fill="currentColor" /></div>
      case 'audio': return <div className={cls}><Mic /></div>
      case 'image': return <div className={cls}><Image /></div>
      case 'text':  return <div className={cls}><FileText /></div>
      default:      return <div className={cls}><Play fill="currentColor" /></div>
    }
  }

  // 模拟波形 (audio)
  function audioWave() {
    return (
      <div className="audio-wave">
        {Array.from({ length: 7 }, (_, i) => <i key={i} />)}
      </div>
    )
  }

  // 模拟图片堆叠 (image)
  function imageCluster() {
    return (
      <div className="image-cluster">
        {Array.from({ length: 4 }, (_, i) => <span key={i} />)}
      </div>
    )
  }

  // 模拟文档线条 (text)
  function docLines() {
    return (
      <div className="doc-lines">
        {Array.from({ length: 4 }, (_, i) => <i key={i} />)}
      </div>
    )
  }

  if (cards.length === 0) {
    return (
      <section style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 32px 80px' }}>
        <EmptyState title="暂无任务" description="在上方粘贴链接或拖入文件开始解析" />
      </section>
    )
  }

  return (
    <section style={{ maxWidth: 1040, margin: '0 auto', padding: '24px 32px 80px' }}>
      <div className="sec-h">
        <h2 className="sec-title">最近任务</h2>
        <button className="sec-link" onClick={() => navigate('/notes')}>
          全部 · {totalCount} <ArrowRight size={13} />
        </button>
      </div>

      <div className="note-grid">
        {cards.map((card) => {
          const hasThumb = !!card.thumb && card.type !== 'audio' && !failedThumbs.has(card.id)
          const coverTypeClass = hasThumb ? '' : COVER_CLASS[card.type] || 'cover-video'
          const pillClass = STATE_PILL_CLASS[card.state] || 'status-pill'
          const statusLabel = STATE_STATUS_LABEL[card.state] || card.state
          const typeLabel = TYPE_LABEL[card.type] || 'VIDEO'
          const progressPct = Math.round(Math.min(card.progress, 1) * 100)

          return (
            <article
              key={card.id}
              className="note-card"
              data-kind={card.type}
              onClick={() => navigate(`/processing/${card.id}`)}
            >
              <div className={`note-cover ${coverTypeClass}`}>
                {hasThumb ? (
                  <img
                    src={card.thumb}
                    alt={card.title}
                    referrerPolicy="no-referrer"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                      setFailedThumbs((prev) => {
                        const next = new Set(prev)
                        next.add(card.id)
                        return next
                      })
                    }}
                  />
                ) : null}
                <span className="media-chip">{typeLabel}</span>
                <span className={pillClass}>{statusLabel}</span>
                {!hasThumb && (
                  <>
                    {card.type === 'audio' ? audioWave() : null}
                    {card.type === 'image' ? imageCluster() : null}
                    {card.type === 'text' ? docLines() : null}
                    {(card.type === 'video' || !card.type) ? coverIcon(card.type) : null}
                  </>
                )}
              </div>

              <div className="note-card-body">
                <div className="note-title-row">
                  <span className="note-type-dot" />
                  <h3>{card.title}</h3>
                </div>

                {card.summary && (
                  <p className="note-summary">{card.summary}</p>
                )}

                <div className="note-meta-row">
                  {card.metaLabels.map((label, i) => (
                    <span key={i}>{label}</span>
                  ))}
                </div>

                {card.state === 'running' && progressPct < 100 && (
                  <div className="note-progress-mini">
                    <span style={{ width: `${progressPct}%` }} />
                  </div>
                )}

                <div className="note-card-actions">
                  <span>
                    {card.lastAction || (card.state === 'done' ? '已完成' : '')}
                  </span>
                  <button
                    className="note-open"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/processing/${card.id}`)
                    }}
                  >
                    {card.state === 'running' ? '查看' : '打开'}
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
