import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Copy, Music, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'

import { useTaskStore } from '@/store/taskStore'
import { useTaskSse } from '@/hooks/useTaskSse'
import { isTaskTerminal, getStatusText } from '@/types/task'
import { getPipelineTask } from '@/services/pipeline'
import { categorizeError } from '@/lib/errorCategories'
import { platformPrefixFromUrl } from '@/lib/platformPrefix'
import { inferContentTags } from '@/lib/contentTags'
import MusicModeConfirmModal from '@/components/workspace/MusicModeConfirmModal'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { StepProgress } from './StepProgress'
import { useGlobalEta } from '@/hooks/useGlobalEta'
import { LiveLog } from './LiveLog'
import NoteShell from '../NoteShell'

import './processing.css'

interface LocationState {
  workspaceId?: string
  itemId?: string
  url?: string
  taskType?: string
  itemType?: string
  backPath?: string
  backLabel?: string
}

const STUCK_MS = 10 * 60 * 1000

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

function normalizeResultItemType(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : ''
    if (!value || value === 'auto') continue
    if (value === 'image_text') return 'image'
    if (['video', 'image', 'audio', 'text'].includes(value)) return value
  }
  return 'video'
}

function buildResultPath(
  workspaceId: string | undefined,
  itemId: string | undefined,
  intent: string,
  itemType: string,
): string {
  if (!workspaceId || !itemId) return ''
  if (intent !== 'replica') return `/workspaces/${workspaceId}/items/${itemId}/note`
  const detail: Record<string, string> = {
    video: 'video_detail',
    image: 'image_result',
    audio: 'audio_detail',
    text: 'text_result',
  }
  return `/workspaces/${workspaceId}/items/${itemId}/${detail[itemType] ?? 'overview'}`
}

export default function ProcessingPage() {
  const { taskId = '' } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null

  const task = useTaskStore((s) => s.getTask(taskId))
  const allTasks = useTaskStore((s) => s.tasks)
  const addTask = useTaskStore((s) => s.addTask)
  const updateTask = useTaskStore((s) => s.updateTask)
  const cancelTask = useTaskStore((s) => s.cancelTask)
  const retryTask = useTaskStore((s) => s.retryTask)

  const taskPayload = (task?.payload ?? {}) as Record<string, unknown>
  const taskResult = (task?.result ?? {}) as Record<string, unknown>
  const workspaceId =
    state?.workspaceId ??
    (taskPayload.workspace_id as string | undefined) ??
    (taskResult.workspace_id as string | undefined)
  const itemId =
    state?.itemId ??
    (taskPayload.item_id as string | undefined) ??
    (taskResult.item_id as string | undefined)

  const isActive = task ? !isTaskTerminal(task.status) : false
  useTaskSse(taskId, isActive)

  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    getPipelineTask(taskId)
      .then((fresh) => {
        if (cancelled) return
        if (useTaskStore.getState().getTask(fresh.task_id)) {
          updateTask(fresh.task_id, fresh)
        } else {
          addTask(fresh)
        }
      })
      .catch(() => {
        // 详情补拉失败时保留本地 store，避免打断正在看的页面。
      })
    return () => { cancelled = true }
  }, [taskId, addTask, updateTask])

  // X.5 任务链跟随：download 成功后会派生一个独立的 analyze 任务（见后端
  // _on_download_success）。若用户停在 download 的处理页，下载完成时这里会显示
  // 「下载成功」假完成态，点「查看结果」却进到空结果页。此处在 download SUCCESS 后
  // 自动跳到同素材的 analyze 任务，让处理页连续跟到分析阶段。
  useEffect(() => {
    if (task?.task_type !== 'download' || task.status !== 'SUCCESS') return
    const url = ((task.payload ?? {}) as Record<string, unknown>).url as string | undefined
    if (!url?.trim()) return
    const analyze = allTasks.find(
      (t) =>
        t.task_type === 'analyze' &&
        t.project_id === task.project_id &&
        (((t.payload ?? {}) as Record<string, unknown>).source_url as string) === url,
    )
    if (analyze && analyze.task_id !== taskId) {
      navigate(`/processing/${analyze.task_id}`, {
        replace: true,
        state: { ...state, workspaceId, itemId, taskType: state?.taskType, itemType: state?.itemType },
      })
    }
  }, [task, allTasks, taskId, navigate, workspaceId, itemId, state])

  const progress = task?.progress ?? 0
  const status = task?.status ?? 'PENDING'
  const logs = task?.log ?? []
  const isFailed = status === 'FAILED'
  const isCancelled = status === 'CANCELLED'
  const isSuccess = status === 'SUCCESS'

  // A3: 音乐模式确认弹窗
  const [dismissedMusicModalTaskId, setDismissedMusicModalTaskId] = useState<string | null>(null)
  const showMusicModal = status === 'AWAITING_CONFIRM' && dismissedMusicModalTaskId !== taskId

  // R18.1.3: 任务失败弹窗
  const [showFailModal, setShowFailModal] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const prevStatusRef = useRef(status)
  useEffect(() => {
    // 状态刚变为 FAILED 时自动弹窗
    if (status === 'FAILED' && prevStatusRef.current !== 'FAILED') {
      setShowFailModal(true)
    }
    prevStatusRef.current = status
  }, [status])

  const handleMusicConfirmed = () => {
    setDismissedMusicModalTaskId(taskId)
    toast.success('已切换为音乐分析模式，任务继续执行')
  }

  const handleMusicCancelled = () => {
    setDismissedMusicModalTaskId(taskId)
    if (taskId) cancelTask(taskId)
    toast.info('任务已取消，可在素材设置中手动勾选「音乐分析」后重跑')
  }

  // F3.5: 任务卡住检测（非终结态 > 10 分钟无 updated_at 变化 → 警告）
  const lastActivityRef = useRef<number | null>(null)
  const stuckToastedRef = useRef(false)

  useEffect(() => {
    if (!task?.updated_at) return
    const currentActivity = lastActivityRef.current ?? 0
    lastActivityRef.current = Math.max(
      currentActivity,
      new Date(task.updated_at).getTime(),
    )
    // 有新活动时重置 toast 标记，以便下次卡住能再次提醒
    stuckToastedRef.current = false
  }, [task?.updated_at])

  useEffect(() => {
    if (!isActive) return
    if (lastActivityRef.current == null) {
      lastActivityRef.current = Date.now()
    }
    const timer = setInterval(() => {
      const lastActivity = lastActivityRef.current ?? Date.now()
      if (Date.now() - lastActivity > STUCK_MS && !stuckToastedRef.current) {
        toast.warning('任务已超过 10 分钟无进度更新，可能已卡住。建议取消后重试。')
        stuckToastedRef.current = true
      }
    }, 30_000)
    return () => clearInterval(timer)
  }, [isActive])

  const handleCancel = () => {
    if (taskId) cancelTask(taskId)
  }

  const handleRetry = () => {
    retryTask(taskId)
  }

  const categorized = categorizeError(task?.error)

  const result = taskResult
  const payload = taskPayload
  const taskType: string = task?.task_type ?? ''
  const isAudioTask = taskType === 'audio'
  // #19: source_type × note_kind 用于动态步骤序列
  const sourceType: string = (payload.source_type as string) ?? ''
  const _kindHint = (payload.kind_hint as string) || ''
  const _mediaKind = (payload.note_media_kind as string) || ''
  const noteKind: string =
    (result.note_kind as string) ||
    (_kindHint && _kindHint !== 'auto' ? _kindHint : '') ||
    (_mediaKind && _mediaKind !== 'auto' ? _mediaKind : '') ||
    (isAudioTask ? 'audio' : '')
  const isImageNote = noteKind === 'image' || noteKind === 'image_text'
  // R13.2/R18.1 标题/封面/时长来源优先级：result（直接来源）→ payload（从 download 继承）→ fallback
  const resultAudio = result.audio as Record<string, unknown> | undefined
  const url =
    (task?.payload?.url as string) ??
    (payload.source as string) ??
    (payload.source_url as string) ??
    (result.source as string) ??
    state?.url ??
    ''
  const platform = platformPrefixFromUrl(url)
  const safeHostname = (() => {
    if (!url) return '任务'
    try { return new URL(url).hostname } catch { return '任务' }
  })()
  const title: string =
    (result.video_title as string) ||
    (resultAudio?.title as string) ||
    titleFromFilename(resultAudio?.filename) ||
    (payload.video_title as string) ||
    (task?.payload?.title as string) ||
    safeHostname
  const contentTags = inferContentTags([title, url, sourceType, noteKind, payload, result])
  // 图文笔记封面：cover_thumbnail（PROBE 后已有 static URL）→ image_infos[0].static_url
  // 注意：result.images[0] 是本地文件路径，不能直接进 img src，不使用
  const resultImageInfos = (result.image_infos as Array<{ static_url?: string }>) ?? []
  const coverUrl: string =
    (result.video_thumbnail_url as string) ||
    (result.cover_thumbnail as string) ||
    (isImageNote ? resultImageInfos[0]?.static_url || '' : '') ||
    audioThumbnailFromResult(result, resultAudio) ||
    (payload.video_thumbnail_url as string) ||
    ''
  const durationSec: number =
    Number(
      (result.video_duration as number) ||
      (result.duration_sec as number) ||
      (resultAudio?.duration_sec as number) ||
      (payload.video_duration as number),
    ) || 0
  const fmtDuration = (sec: number) => {
    if (!sec) return ''
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  const durationLabel = fmtDuration(durationSec)
  const framesCount: number = Number(result.frames_count as number) || 0
  // 图文笔记图片数量：优先用 image_count（后端 PROBE 后已写入），兜底 images.length
  const imageCount: number = isImageNote
    ? (Number(result.image_count as number) || ((result.images as string[])?.length ?? 0))
    : 0
  const asrSegments: number = Number(result.asr_segments as number) || 0
  // 全局 ETA：所有活跃任务的剩余时间之和，每秒递减
  const etaSec = useGlobalEta()
  const resultIntent = state?.taskType ?? ((payload.intent as string) === 'replica' ? 'replica' : 'note')
  const resultItemType = normalizeResultItemType(
    state?.itemType,
    payload.item_type,
    result.item_type,
    noteKind,
    sourceType,
  )
  const resultPath = buildResultPath(workspaceId, itemId, resultIntent, resultItemType)

  const handleViewResult = () => {
    if (!isSuccess) return
    if (resultPath) {
      navigate(resultPath)
    } else {
      // 兜底：跳转到资料库，用户可从那里找到结果。
      navigate('/library')
    }
  }

  const handleBack = () => {
    navigate(state?.backPath || '/library')
  }

  const autoOpenRef = useRef('')
  useEffect(() => {
    const shouldAutoOpen = resultIntent === 'replica' || resultItemType === 'audio'
    if (!isSuccess || !shouldAutoOpen || !resultPath) return
    const key = `${taskId}:${resultPath}`
    if (autoOpenRef.current === key) return
    const timer = window.setTimeout(() => {
      autoOpenRef.current = key
      navigate(resultPath, { replace: true })
    }, 650)
    return () => window.clearTimeout(timer)
  }, [isSuccess, resultIntent, resultItemType, resultPath, navigate, taskId])

  const handleCopySource = async () => {
    const text = url || window.location.href
    try {
      await navigator.clipboard?.writeText(text)
      toast.success(url ? '已复制来源链接' : '已复制当前页面链接')
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  // 处理↔结果原地融合：note 任务完成 → 同一任务页内直接渲染结果（不跳页）
  if (isSuccess && resultIntent === 'note' && resultItemType !== 'audio' && workspaceId && itemId) {
    return <NoteShell workspaceId={workspaceId} itemId={itemId} />
  }

  return (
    <div className="vm-processing-scope">
      <div className="proc-wrap">
        <div className="proc-main">
          <div className="proc-topbar">
            <button className="proc-back" onClick={handleBack} title={state?.backLabel || '返回资料库'}>
              <ArrowLeft size={18} />
            </button>
            <div className="proc-top-title">{title}</div>
            <div className="proc-top-actions">
              <button className="proc-top-btn" onClick={handleCopySource}>
                <Copy size={12} />
                复制链接
              </button>
              <button className="proc-top-btn primary" onClick={handleViewResult} disabled={!isSuccess}>
                查看结果
                <ArrowRight size={12} />
              </button>
            </div>
          </div>

          {/* Hero */}
          <div className="proc-hero">
            <div className="thumb">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={title}
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    // 封面加载失败（B 站 CDN 防盗链等）静默隐藏，露出黑底
                    (e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                isAudioTask && (
                  <div className="thumb-placeholder">
                    <Music size={32} className="thumb-placeholder-icon" />
                  </div>
                )
              )}
              {!isFailed && !isCancelled && (
                <div className="live">● LIVE</div>
              )}
              {isAudioTask && coverUrl && (
                <>
                  <div className="thumb-audio-mask" />
                  <div className="thumb-audio-badge">
                    <Music size={12} />
                    <span>AUDIO</span>
                  </div>
                </>
              )}
            </div>
            <div className="info">
              <div className="eyebrow">{isAudioTask ? 'AUDIO' : 'PROCESSING'} · {taskId.slice(0, 8)}</div>
              <div className="title">
                {platform && <span className="title-platform">{platform} ·</span>}
                {title}
              </div>
              <div className="src">{url}</div>
              <div className="stats">
                {durationLabel && (
                  <span>
                    <strong>{durationLabel}</strong> 时长
                  </span>
                )}
                {isImageNote && imageCount > 0 && (
                  <span>
                    <strong>{imageCount}</strong> 张图
                  </span>
                )}
                {!isImageNote && framesCount > 0 && !isAudioTask && (
                  <span>
                    <strong>{framesCount}</strong> 帧
                  </span>
                )}
                {asrSegments > 0 && !isImageNote && (
                  <span>
                    <strong>{asrSegments}</strong> 句转录
                  </span>
                )}
                <span>
                  状态 <strong>{getStatusText(status)}</strong>
                </span>
                <span>
                  进度 <strong>{Math.round(progress * 100)}%</strong>
                </span>
                {etaSec > 0 && (
                  <span>
                    剩余 <strong>{etaSec}s</strong>
                  </span>
                )}
              </div>
              {contentTags.length > 0 && (
                <div className="proc-tags" aria-label="内容标签">
                  {contentTags.map((tag) => (
                    <span key={tag} className="proc-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="actions">
                {!isSuccess && (
                  <button className="btn" onClick={handleCancel}>
                    <X size={14} />
                    取消
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={handleViewResult}
                  disabled={!isSuccess}
                >
                  查看结果 <ArrowRight size={14} />
                </button>
                {isSuccess && (
                  <span className="chip chip-success proc-result-arming">
                    <span className="chip-dot" />
                    完成 ✓ · {resultIntent === 'replica' ? '正在打开复刻结果…' : '正在打开结果…'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Failed state — inline indicator */}
          {isFailed && (
            <div className="proc-error">
              <AlertTriangle size={28} className="proc-error-icon" />
              <h3>任务失败</h3>
              <p className="proc-error-message">
                {categorized.friendlyMessage}
              </p>
              <div className="proc-error-actions">
                <button className="btn" onClick={() => setShowFailModal(true)}>
                  查看详情
                </button>
                <button className="btn btn-primary" onClick={handleRetry}>
                  <RotateCcw size={14} />
                  重试
                </button>
              </div>
            </div>
          )}

          {/* Cancelled state */}
          {isCancelled && (
            <div className="proc-error">
              <h3>任务已取消</h3>
              <p>你可以重新提交此任务</p>
              <button className="btn btn-primary" onClick={handleRetry}>
                <RotateCcw size={14} />
                重新提交
              </button>
            </div>
          )}

          {/* AWAITING_CONFIRM: 等待用户确认音乐模式 */}
          {status === 'AWAITING_CONFIRM' && (
            <div className="proc-confirm">
              <div className="proc-confirm-title">
                等待确认
              </div>
              <p>
                检测到该内容可能是音乐，需要你确认后继续分析。请在弹窗中操作。
              </p>
            </div>
          )}

          {/* Step progress (running / success) */}
          {!isFailed && !isCancelled && status !== 'AWAITING_CONFIRM' && (
            <>
              {/* VN3: 简洁处理中 — 5 步进度 + 预计剩余 + 友好提示 */}
              <div className="proc-body">
                <div className="proc-body-title">
                  {isSuccess ? '生成完成 ✓' : '正在生成笔记'}
                  {etaSec > 0 && !isSuccess && (
                    <span className="proc-body-title-meta">
                      · 预计还需 {etaSec}s
                    </span>
                  )}
                </div>
                <StepProgress
                  currentStatus={status}
                  progress={progress}
                  sourceType={sourceType as 'local' | 'link'}
                  noteKind={noteKind as 'video' | 'audio' | 'image' | 'image_text' | 'text'}
                />
                <div className="proc-body-hint">
                  {isSuccess
                    ? '笔记已生成完毕，正在打开…'
                    : '正在为你处理内容，完成后会自动进入结果页。'}
                </div>
              </div>

              {/* 高级详情折叠块：LiveLog / 下载速度 / 资源指标 */}
              <div className="proc-advanced">
                <button
                  onClick={() => setShowAdvanced(prev => !prev)}
                  className="proc-advanced-toggle"
                >
                  {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showAdvanced ? '收起详情' : '高级详情'}
                </button>
                {showAdvanced && (
                  <div className="proc-advanced-panel">
                    <LiveLog logs={logs} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

      </div>

      {/* A3: VAD 无人声 → 音乐模式确认弹窗 */}
      <MusicModeConfirmModal
        open={showMusicModal}
        onOpenChange={(open) => {
          setDismissedMusicModalTaskId(open ? null : taskId)
        }}
        taskId={taskId}
        speechRatio={(task?.result?.speech_ratio as number) ?? 0}
        totalDuration={(task?.result?.total_duration as number) ?? 0}
        onConfirmed={handleMusicConfirmed}
        onCancelled={handleMusicCancelled}
      />

      {/* R18.1.3: 任务失败详情弹窗 */}
      <Dialog open={showFailModal} onOpenChange={setShowFailModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-destructive" />
              任务失败
            </DialogTitle>
            <DialogDescription>
              {categorized.friendlyMessage}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{categorized.suggestion}</p>
            {task?.error && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground font-mono">
                  查看原始错误信息
                </summary>
                <pre className="mt-2 p-3 rounded-md bg-muted text-muted-foreground whitespace-pre-wrap break-all text-[11px]">
                  {task.error}
                </pre>
              </details>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFailModal(false)}>
              关闭
            </Button>
            <Button onClick={() => { setShowFailModal(false); handleRetry() }}>
              <RotateCcw size={14} className="mr-1" />
              重试
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
