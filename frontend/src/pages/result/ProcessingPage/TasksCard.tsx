import { useNavigate } from 'react-router-dom'
import { Music } from 'lucide-react'
import { useTaskStore } from '@/store/taskStore'
import { isTaskTerminal } from '@/types/task'

interface TasksCardProps {
  currentTaskId: string
}

function titleFromFilename(filename: unknown): string {
  const raw = typeof filename === 'string' ? filename.trim() : ''
  if (!raw) return ''
  const name = raw.split('/').pop() || raw
  return name.replace(/\.[^.]+$/, '')
}

function audioThumbnailFromResult(result: Record<string, unknown>, audio?: Record<string, unknown>): string {
  const projectId = typeof result.project_id === 'string' ? result.project_id.trim() : ''
  const filename = typeof audio?.filename === 'string' ? audio.filename.trim() : ''
  if (!projectId || !filename) return ''
  return `/static/workspaces/${projectId}/audio/${titleFromFilename(filename)}.jpg`
}

function dotColor(status: string): string {
  if (status === 'SUCCESS') return 'var(--accent-green)'
  if (status === 'FAILED') return 'var(--accent-pink)'
  if (status === 'PENDING') return 'var(--ink-4)'
  return 'var(--ink)'
}

export default function TasksCard({ currentTaskId }: TasksCardProps) {
  const navigate = useNavigate()
  const tasks = useTaskStore((s) => s.tasks)

  const activeTasks = tasks
    .filter((t) => !isTaskTerminal(t.status) || t.task_id === currentTaskId)
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .slice(0, 8)

  return (
    <div className="side-card">
      <h4>
        任务
        <span className="mono" style={{ fontSize: 10, opacity: 0.6, textTransform: 'none', letterSpacing: 0 }}>
          {activeTasks.length} 个活跃 · 点击切换
        </span>
      </h4>

      {activeTasks.length === 0 && (
        <div
          style={{
            padding: '20px 0',
            textAlign: 'center',
            color: 'var(--ink-4)',
            fontSize: 12,
          }}
        >
          暂无活跃任务
        </div>
      )}

      {activeTasks.map((t) => {
        const result = t.result ?? {} as Record<string, unknown>
        const payload = t.payload ?? {} as Record<string, unknown>
        const resultAudio = result.audio as Record<string, unknown> | undefined
        const title: string =
          (result.video_title as string) ||
          (resultAudio?.title as string) ||
          titleFromFilename(resultAudio?.filename) ||
          (payload.title as string) ||
          (payload.url as string) ||
          (payload.source as string) ||
          t.task_id.slice(0, 8)
        const coverUrl: string =
          (result.video_thumbnail_url as string) ||
          (result.cover_thumbnail as string) ||
          audioThumbnailFromResult(result, resultAudio) ||
          ''
        const isActive = t.task_id === currentTaskId
        const isAudio = t.task_type === 'audio'

        return (
          <div
            key={t.task_id}
            className="tasklet"
            onClick={() => navigate(`/processing/${t.task_id}`)}
            style={{
              padding: '10px 12px',
              margin: '0 -12px',
              borderRadius: 10,
              background: isActive ? 'var(--bg-sunken)' : 'transparent',
              borderLeft: isActive
                ? '2px solid var(--accent-pink)'
                : '2px solid transparent',
              borderBottom: '1px solid var(--line)',
              cursor: 'pointer',
              display: 'flex',
              gap: 10,
            }}
          >
            <div className="tl-thumb" style={{ position: 'relative' }}>
              {coverUrl ? (
                <>
                  <img
                    src={coverUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                  {isAudio && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 3,
                        right: 3,
                        width: 18,
                        height: 18,
                        borderRadius: 6,
                        background: 'rgba(0,0,0,0.65)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Music size={10} color="#fff" />
                    </div>
                  )}
                </>
              ) : (
                <div
                  style={{
                    background: 'var(--bg-sunken)',
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isAudio && <Music size={18} style={{ color: 'var(--ink-4)' }} />}
                </div>
              )}
            </div>
            <div className="tl-body" style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <div
                  className="tl-title"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 13,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {title}
                </div>
                {isActive && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 9,
                      color: 'var(--accent-pink)',
                      flexShrink: 0,
                      padding: '1px 5px',
                      border: '1px solid var(--accent-pink)',
                      borderRadius: 4,
                    }}
                  >
                    查看中
                  </span>
                )}
              </div>
              <div
                className="tl-meta"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: 'var(--ink-3)',
                  marginTop: 3,
                }}
              >
                <span
                  className="dot"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: dotColor(t.status),
                  }}
                />
                <span>{t.status.toLowerCase()}</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {Math.round((t.progress ?? 0) * 100)}%
                </span>
              </div>
              <div
                style={{
                  marginTop: 6,
                  height: 2,
                  background: 'var(--bg-sunken)',
                  borderRadius: 99,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${(t.progress ?? 0) * 100}%`,
                    background:
                      t.status === 'FAILED'
                        ? 'var(--accent-pink)'
                        : t.status === 'SUCCESS'
                          ? 'var(--accent-green)'
                          : 'var(--ink)',
                  }}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
