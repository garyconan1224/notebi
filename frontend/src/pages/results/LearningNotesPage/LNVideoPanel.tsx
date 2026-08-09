import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  Camera,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Subtitles,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { toast } from 'sonner'
import { uploadLnScreenshot } from '@/services/lnScreenshots'
import { useLnEditorStore } from '@/store/lnEditorStore'

/** 故事板帧（sec 可能为 null = 旧版无时间戳帧，不参与预览/定位） */
export interface LNVideoPanelFrame {
  sec: number | null
  url: string
}

interface LNVideoPanelProps {
  src: string
  /** 在线平台网页链接（src 为空时降级展示，供用户去原平台观看） */
  externalUrl?: string
  title: string
  workspaceId?: string
  onTimeUpdate?: (currentTime: number) => void
  onDurationChange?: (duration: number) => void
  markers?: { sec: number }[]
  subtitle?: string
  /** 故事板帧：时间轴 hover/focus 预览最近帧 + 缩略图 seek 参考 */
  frames?: LNVideoPanelFrame[]
  /** NoteShell can render transport outside an overflow-hidden player wrapper. */
  renderTransportInline?: boolean
  /** 状态变化时通知父组件重渲染（驱动 transportNode getter 刷新） */
  onTransportChange?: () => void
  isPipActive?: boolean
  onTogglePip?: () => void
}

export interface LNVideoPanelHandle {
  seekTo: (sec: number) => void
  togglePlay: () => void
  /** 可等待的播放：返回原生 play() Promise，调用者可感知自动播放拒绝。 */
  play: () => Promise<void>
  captureScreenshot: () => void
  readonly isPlaying: boolean
  /** 控制条和时间线的 JSX（由父组件渲染在 player-wrap 外部，避免 overflow:hidden 截断） */
  transportNode: React.ReactNode
}

function formatTs(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export interface TimelineTick {
  sec: number
  label: string
  position: number
}

const TIMELINE_TICK_INTERVALS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800]

/** Generate 4–6 readable time marks, always ending at the actual media duration. */
export function buildTimelineTicks(duration: number): TimelineTick[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  const interval = TIMELINE_TICK_INTERVALS.find((candidate) => candidate >= duration / 5)
    ?? TIMELINE_TICK_INTERVALS[TIMELINE_TICK_INTERVALS.length - 1]
  const seconds = [0]
  for (let sec = interval; sec < duration; sec += interval) seconds.push(sec)
  const lastLoop = seconds[seconds.length - 1]
  // 末尾刻度处理：
  // 1) 展示标签相同时（浮点时长如 60.000363 与循环刻度 60 都是 01:00）不追加；
  // 2) 循环末刻度与真实时长位置极近（< 1/3 个刻度间隔）时，用真实时长替换它，
  //    避免 06:00(98.9%) 与 06:04(100%) 两个刻度在时间轴末端几乎重叠。
  if (formatTs(lastLoop) === formatTs(duration) || (duration - lastLoop) < interval / 3) {
    seconds[seconds.length - 1] = duration
  } else {
    seconds.push(duration)
  }
  return seconds.map((sec) => ({
    sec,
    label: formatTs(sec),
    position: Number(((sec / duration) * 100).toFixed(4)),
  }))
}

const SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2]

function formatSpeed(s: number): string {
  return Number.isInteger(s) ? `${s}.0` : String(s)
}

const LNVideoPanel = forwardRef<LNVideoPanelHandle, LNVideoPanelProps>(
  ({
    src,
    externalUrl,
    title,
    workspaceId,
    onTimeUpdate,
    onDurationChange,
    markers = [],
    subtitle,
    frames = [],
    renderTransportInline = true,
    onTransportChange,
    isPipActive,
    onTogglePip,
  }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const progressRef = useRef<HTMLDivElement>(null)
    const volumeSliderRef = useRef<HTMLDivElement>(null)
    const volumeDragRef = useRef(false)

    const [shooting, setShooting] = useState(false)
    const [playing, setPlaying] = useState(false)
    const [speed, setSpeed] = useState(1)
    const [muted, setMuted] = useState(false)
    const [volume, setVolumeState] = useState(1)
    const [loop, setLoop] = useState(false)
    const [progress, setProgress] = useState(0)
    const [duration, setDuration] = useState(0)
    // 时间码可编辑：点击当前时间可输入 mm:ss 跳转
    const [timeEditing, setTimeEditing] = useState(false)
    const [timeInput, setTimeInput] = useState('')
    const [hoverTime, setHoverTime] = useState<number | null>(null)
    const [hoverX, setHoverX] = useState(0)
    // 预览窗 fixed 定位坐标（跟随鼠标，超出左栏/右栏仍置顶显示）
    const [previewPos, setPreviewPos] = useState<{ x: number; y: number } | null>(null)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [nativePip, setNativePip] = useState(false)
    // 无预生成帧时，hover 时间轴用视频实时截帧做预览缩略图（data URL）
    const [livePreview, setLivePreview] = useState<string | null>(null)
    const livePreviewReqRef = useRef(0)
    const livePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // 离屏截帧 video：独立于主播放器 seek，避免 hover 预览打断播放/滚动字幕
    const captureVideoRef = useRef<HTMLVideoElement | null>(null)
    const [subtitlesOn, setSubtitlesOn] = useState(true)
    const pipActive = typeof onTogglePip === 'function' ? !!isPipActive : nativePip

    const insertAtCursor = useLnEditorStore((s) => s.insertAtCursor)

    const getFullscreenTarget = useCallback((): Element | null => {
      const v = videoRef.current
      return v?.closest('.nibi-note-player-wrap') ?? v?.closest('.ln-video-wrapper') ?? panelRef.current
    }, [])

    /* ── video 原生事件驱动 state 同步 ── */

    const handlePlay = useCallback(() => setPlaying(true), [])
    const handlePause = useCallback(() => setPlaying(false), [])
    const handleLoadedMetadata = useCallback(() => {
      const v = videoRef.current
      if (!v) return
      const nextDuration = v.duration || 0
      setDuration(nextDuration)
      onDurationChange?.(nextDuration)
    }, [onDurationChange])
    const handleTimeUpdate = useCallback(() => {
      const v = videoRef.current
      if (!v) return
      setProgress(v.duration ? v.currentTime / v.duration : 0)
      onTimeUpdate?.(v.currentTime)
    }, [onTimeUpdate])
    const handleRateChange = useCallback(() => {
      const v = videoRef.current
      if (v) setSpeed(v.playbackRate)
    }, [])
    const handleVolumeChange = useCallback(() => {
      const v = videoRef.current
      if (v) {
        setVolumeState(v.volume)
        setMuted(v.muted)
      }
    }, [])
    const handleEnded = useCallback(() => {
      setPlaying(false)
    }, [])

    /* ── 全屏监听 ── */

    useEffect(() => {
      const onFsChange = () => {
        const fullscreenTarget = getFullscreenTarget()
        setIsFullscreen(!!fullscreenTarget && document.fullscreenElement === fullscreenTarget)
      }
      document.addEventListener('fullscreenchange', onFsChange)
      return () => document.removeEventListener('fullscreenchange', onFsChange)
    }, [getFullscreenTarget])

    /* ── 画中画监听 ── */

    useEffect(() => {
      if (typeof onTogglePip === 'function') return
      const v = videoRef.current
      if (!v) return
      const onEnter = () => setNativePip(true)
      const onLeave = () => setNativePip(false)
      v.addEventListener('enterpictureinpicture', onEnter)
      v.addEventListener('leavepictureinpicture', onLeave)
      return () => {
        v.removeEventListener('enterpictureinpicture', onEnter)
        v.removeEventListener('leavepictureinpicture', onLeave)
      }
    }, [src, onTogglePip])

    /* ── 交互控制 ── */

    const togglePlay = useCallback(() => {
      const v = videoRef.current
      if (!v) return
      if (v.paused) {
        void v.play()
      } else {
        v.pause()
      }
    }, [])

    const cycleSpeed = useCallback(() => {
      const v = videoRef.current
      if (!v) return
      const idx = SPEED_OPTIONS.indexOf(v.playbackRate)
      const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length]
      v.playbackRate = next
    }, [])

    const skip = useCallback((n: number) => {
      const v = videoRef.current
      if (!v) return
      v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + n))
    }, [])

    const toggleMute = useCallback(() => {
      const v = videoRef.current
      if (!v) return
      v.muted = !v.muted
    }, [])

    const toggleLoop = useCallback(() => {
      const v = videoRef.current
      if (!v) return
      v.loop = !v.loop
      setLoop(v.loop)
    }, [])

    const toggleFullscreen = useCallback(() => {
      const fullscreenTarget = getFullscreenTarget()
      if (!fullscreenTarget) return
      if (document.fullscreenElement === fullscreenTarget) {
        document.exitFullscreen()
      } else {
        fullscreenTarget.requestFullscreen()
      }
    }, [getFullscreenTarget])

    const togglePip = useCallback(async () => {
      if (onTogglePip) {
        onTogglePip()
        return
      }
      const v = videoRef.current
      if (!v) return
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture()
        } else {
          await v.requestPictureInPicture()
        }
      } catch {
        /* 浏览器不支持或被拒绝时静默忽略 */
      }
    }, [onTogglePip])

    const toggleSubtitles = useCallback(() => {
      setSubtitlesOn((on) => !on)
    }, [])

    /* ── 进度条交互 ── */

    const onProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      const v = videoRef.current
      const bar = progressRef.current
      if (!v || !bar || !v.duration) return
      const rect = bar.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      v.currentTime = pct * v.duration
    }, [])

    /* ── 无预生成帧时的实时截帧预览（hover 时间轴缩略图）──
       有故事板帧的素材始终走最近帧（不实时截帧，避免 hover 卡顿）；
       只有完全没有帧的素材（历史遗留/配图关闭）才用离屏 video 截帧兜底。 */
    const hasAnyFrame = useCallback(() => {
      for (const frame of frames) {
        if (typeof frame.sec === 'number' && frame.url) return true
      }
      return false
    }, [frames])

    const captureLivePreview = useCallback((time: number, token: number) => {
      // 用离屏 video 截帧，不碰主播放器 currentTime——否则 hover 预览会
      // 打断播放、让进度条/字幕闪动（seek → 恢复的副作用）。
      let v = captureVideoRef.current
      if (!v) {
        v = document.createElement('video')
        v.preload = 'auto'
        v.muted = true
        v.src = src
        captureVideoRef.current = v
      }
      if (v.readyState < 2) return
      const onSeeked = () => {
        v?.removeEventListener('seeked', onSeeked)
        // 已有更新的截帧请求，丢弃这次过期结果
        if (token !== livePreviewReqRef.current) return
        try {
          const canvas = document.createElement('canvas')
          canvas.width = v?.videoWidth || 0
          canvas.height = v?.videoHeight || 0
          const ctx = canvas.getContext('2d')
          if (ctx && v) {
            ctx.drawImage(v, 0, 0)
            setLivePreview(canvas.toDataURL('image/jpeg', 0.72))
          }
        } catch {
          setLivePreview(null)
        }
      }
      v.addEventListener('seeked', onSeeked, { once: true })
      v.currentTime = Math.max(0, Math.min(v.duration || time, time))
    }, [src])

    const onProgressHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      const bar = progressRef.current
      if (!bar || !duration) return
      const rect = bar.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const time = pct * duration
      setHoverTime(time)
      setHoverX(pct * 100)
      // 预览窗 fixed 定位，完全跟随鼠标坐标（不 clamp），超出左栏/右栏仍置顶
      setPreviewPos({ x: e.clientX, y: e.clientY })
      // 有帧素材始终用预生成帧；只有无帧素材才触发实时截帧兜底
      if (hasAnyFrame()) {
        if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current)
        livePreviewReqRef.current += 1
        setLivePreview(null)
        return
      }
      if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current)
      livePreviewTimerRef.current = setTimeout(() => {
        livePreviewReqRef.current += 1
        captureLivePreview(time, livePreviewReqRef.current)
      }, 180)
    }, [duration, hasAnyFrame, captureLivePreview])

    const onProgressLeave = useCallback(() => {
      setHoverTime(null)
      setPreviewPos(null)
      setLivePreview(null)
      if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current)
    }, [])

    /* ── 画面点击播放/暂停（Q2：子控件不得冒泡触发） ── */

    const handleSurfaceClick = useCallback(() => {
      togglePlay()
    }, [togglePlay])

    const handleSurfaceKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        togglePlay()
      }
    }, [togglePlay])

    /* ── 时间轴 slider：键盘 seek（←/→ 步进 5s）与 hover 预览 ── */

    const seekToTime = useCallback((sec: number) => {
      const v = videoRef.current
      if (!v) return
      const upper = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Number.MAX_SAFE_INTEGER
      v.currentTime = Math.max(0, Math.min(upper, sec))
    }, [])

    const seekBy = useCallback((delta: number) => {
      const v = videoRef.current
      if (!v) return
      const upper = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Number.MAX_SAFE_INTEGER
      v.currentTime = Math.max(0, Math.min(upper, v.currentTime + delta))
    }, [])

    // ── 时间码可编辑跳转：点击当前时间 → 输入 mm:ss → 回车/失焦生效 ──

    const startTimeEdit = useCallback(() => {
      const v = videoRef.current
      setTimeInput(formatTs(v?.currentTime ?? 0))
      setTimeEditing(true)
    }, [])

    const commitTimeEdit = useCallback(() => {
      setTimeEditing(false)
      const raw = timeInput.trim()
      if (!raw) return
      // 支持 m:ss / mm:ss / 纯秒数
      const match = raw.match(/^(?:(\d+):)?(\d{1,2})(?::(\d{1,2}))?$/)
      if (!match) return
      let sec: number
      if (match[3] != null) {
        // h:mm:ss 或 mm:ss
        sec = Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3])
      } else if (match[1] != null) {
        sec = Number(match[1]) * 60 + Number(match[2])
      } else {
        sec = Number(match[2])
      }
      seekToTime(Number.isFinite(sec) ? sec : 0)
    }, [timeInput, seekToTime])

    const cancelTimeEdit = useCallback(() => {
      setTimeEditing(false)
    }, [])

    const handleSliderKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.code === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        seekBy(-5)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        seekBy(5)
      } else if (e.code === 'Home') {
        e.preventDefault()
        seekBy(Number.NEGATIVE_INFINITY)
      } else if (e.code === 'End' && duration > 0) {
        e.preventDefault()
        seekBy(Number.POSITIVE_INFINITY)
      }
    }, [seekBy, duration])

    const handleSliderFocus = useCallback(() => {
      const v = videoRef.current
      if (!v || !duration) return
      setHoverTime(v.currentTime)
      setHoverX(duration > 0 ? (v.currentTime / duration) * 100 : 0)
    }, [duration])

    const handleSliderBlur = useCallback(() => {
      setHoverTime(null)
    }, [])

    /** hover/focus 预览：最近故事板帧 + 时间码 */
    const previewFrame = (() => {
      if (hoverTime == null) return null
      let best: LNVideoPanelFrame | null = null
      let bestDist = Number.POSITIVE_INFINITY
      for (const frame of frames) {
        if (typeof frame.sec !== 'number' || !frame.url) continue
        const dist = Math.abs(frame.sec - hoverTime)
        if (dist < bestDist) {
          bestDist = dist
          best = frame
        }
      }
      return best
    })()

    /* ── 音量滑杆交互（拖拽 + 点击） ── */

    const applyVolumeFromEvent = useCallback((e: MouseEvent) => {
      const v = videoRef.current
      const slider = volumeSliderRef.current
      if (!v || !slider) return
      const rect = slider.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      v.volume = pct
      if (pct > 0 && v.muted) v.muted = false
    }, [])

    const onVolumeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      volumeDragRef.current = true
      applyVolumeFromEvent(e.nativeEvent)
      const onMove = (ev: MouseEvent) => {
        if (volumeDragRef.current) applyVolumeFromEvent(ev)
      }
      const onUp = () => {
        volumeDragRef.current = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }, [applyVolumeFromEvent])

    /* ── 截图 ── */

    const handleScreenshot = useCallback(async () => {
      const video = videoRef.current
      if (!video) return
      if (video.readyState < 2) {
        toast.error('视频未加载完成')
        return
      }
      if (!workspaceId) {
        toast.error('缺少合集 ID')
        return
      }

      setShooting(true)
      try {
        if (!video.paused) video.pause()

        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          toast.error('截图失败：浏览器不支持 canvas')
          return
        }
        ctx.drawImage(video, 0, 0)

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => b ? resolve(b) : reject(new Error('toBlob failed')),
            'image/png',
          )
        })

        const ts = video.currentTime
        const { url } = await uploadLnScreenshot(workspaceId, blob, ts)

        const tsStr = formatTs(ts)
        const md = `\n![截图@${tsStr}](${url})\n`
        const inserted = insertAtCursor(md)

        if (inserted) {
          toast.success(`已插入笔记 @ ${tsStr}`)
        } else {
          toast.error('未找到笔记编辑器（请先切到 MD 视图）')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '截图失败'
        toast.error(msg)
      } finally {
        setShooting(false)
      }
    }, [workspaceId, insertAtCursor])

    /* ── 卸载清理：清除 hover 截帧防抖定时器 ── */

    useEffect(() => {
      return () => {
        if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current)
        livePreviewReqRef.current += 1
      }
    }, [])

    /* ── 键盘快捷键 ── */

    useEffect(() => {
      function handleKey(e: KeyboardEvent) {
        const v = videoRef.current
        if (!v) return
        // 画面/时间轴 slider 自己处理过的按键不再全局重复触发
        if (e.defaultPrevented) return
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return

        if (e.code === 'Space') {
          e.preventDefault()
          if (v.paused) {
            void v.play()
          } else {
            v.pause()
          }
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault()
          v.currentTime = Math.max(0, v.currentTime - 10)
        } else if (e.code === 'ArrowRight') {
          e.preventDefault()
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 10)
        }
      }
      window.addEventListener('keydown', handleKey)
      return () => window.removeEventListener('keydown', handleKey)
    }, [])

    /* ── 通知父组件状态变化（驱动 transportNode getter 刷新） ── */
    useEffect(() => {
      onTransportChange?.()
    }, [playing, speed, muted, volume, loop, progress, duration, hoverTime, hoverX, isFullscreen, pipActive, subtitlesOn, shooting, timeEditing, timeInput, onTransportChange])

    /**
     * Q2 控制带：transport + 当前时间/进度合并为一条 44–52px 的 `.note-ctl-band`，
     * 低频按钮（±10s / 循环 / 截图 / 画中画 / 全屏）收进「…」popover。
     * 时间轴热区为 role="slider"，←/→ 步进 5s，hover/focus 预览最近故事板帧。
     */
    function renderTransportNode() {
      const currentSec = progress * duration
      return (
        <>
          <div className="note-ctl-band">
            <button className="note-icon-btn" onClick={togglePlay} title="播放/暂停 (Space)" aria-label={playing ? '暂停' : '播放'}>
              {playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
            </button>
            <button className={`note-icon-btn${subtitlesOn ? ' is-on' : ''}`} onClick={toggleSubtitles} disabled={!subtitle} title={!subtitle ? '暂无字幕轨' : subtitlesOn ? '隐藏字幕' : '显示字幕'} aria-pressed={subtitlesOn && !!subtitle}>
              <Subtitles size={15} />
            </button>
            <button className="note-icon-btn" onClick={() => skip(-10)} title="后退 10 秒">
              <svg viewBox="0 0 24 24" width="15" height="15"><path d="M12.5 8V4l-4.5 4 4.5 4V8a6 6 0 1 1-6 6" /><text x="12" y="16" fontSize="7" fill="currentColor" textAnchor="middle" stroke="none" fontFamily="var(--fm)" fontWeight="700">10</text></svg>
            </button>
            <button className="note-icon-btn" onClick={() => skip(10)} title="前进 10 秒">
              <svg viewBox="0 0 24 24" width="15" height="15"><path d="M11.5 8V4l4.5 4-4.5 4V8a6 6 0 1 0 6 6" /><text x="12" y="16" fontSize="7" fill="currentColor" textAnchor="middle" stroke="none" fontFamily="var(--fm)" fontWeight="700">10</text></svg>
            </button>
            <button className={`note-icon-btn${loop ? ' is-on' : ''}`} onClick={toggleLoop} title="循环播放" aria-pressed={loop}>
              <Repeat size={15} />
            </button>
            <button className="note-icon-btn" onClick={() => void handleScreenshot()} disabled={shooting} title="截取当前帧">
              <Camera size={15} />
            </button>
            <button className={`note-icon-btn${pipActive ? ' is-on' : ''}`} onClick={() => void togglePip()} disabled={!src} title={pipActive ? '退出画中画' : '画中画'} aria-pressed={pipActive}>
              <PictureInPicture2 size={15} />
            </button>
            <button className={`note-icon-btn${isFullscreen ? ' is-on' : ''}`} onClick={toggleFullscreen} title={isFullscreen ? '退出全屏' : '全屏'} aria-pressed={isFullscreen}>
              {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
            </button>
            <span className="note-ctl-time">
              {timeEditing ? (
                <input
                  className="note-time-input"
                  value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTimeEdit()
                    if (e.key === 'Escape') cancelTimeEdit()
                    e.stopPropagation()
                  }}
                  onBlur={commitTimeEdit}
                  autoFocus
                  aria-label="跳转到时间"
                />
              ) : (
                <button
                  type="button"
                  className="note-time-btn"
                  onClick={startTimeEdit}
                  title="点击输入时间跳转（如 1:30）"
                >
                  {formatTs(currentSec)}
                </button>
              )}
              {' / '}{formatTs(duration)}
            </span>
            <span className="note-ctl-spacer" />
            <button className="note-speed" onClick={cycleSpeed} title="切换倍速">
              {formatSpeed(speed)}x
            </button>
            <div className="note-audio">
              <button className="note-icon-btn" onClick={toggleMute} title={muted ? '取消静音' : '静音'}>
                {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
              <div
                className="note-volume-slider"
                ref={volumeSliderRef}
                onMouseDown={onVolumeMouseDown}
              >
                <div className="note-volume-fill" style={{ width: `${(muted ? 0 : volume) * 100}%` }} />
              </div>
            </div>
          </div>
          <div className="note-timeline">
            <div className="note-progress-wrap">
              <div
                className="note-progress"
                role="slider"
                tabIndex={0}
                aria-label="播放进度"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(currentSec)}
                aria-valuetext={`${formatTs(currentSec)} / ${formatTs(duration)}`}
                ref={progressRef}
                onClick={onProgressClick}
                onMouseMove={onProgressHover}
                onMouseLeave={onProgressLeave}
                onKeyDown={handleSliderKeyDown}
                onFocus={handleSliderFocus}
                onBlur={handleSliderBlur}
              >
                <span className="note-progress-fill" style={{ width: `${progress * 100}%` }} />
                {duration > 0 && markers.map((marker, idx) => (
                  <span
                    key={`${marker.sec}-${idx}`}
                    className="note-progress-marker"
                    style={{ left: `${Math.max(0, Math.min(100, (marker.sec / duration) * 100))}%` }}
                  />
                ))}
                <div
                  className="note-progress-hover"
                  style={{ left: `${hoverX}%`, opacity: hoverTime != null && !previewPos ? 1 : 0 }}
                >
                  {hoverTime != null && !previewPos && formatTs(hoverTime)}
                </div>
                {hoverTime != null && previewPos && (
                  <div
                    className="note-timeline-preview"
                    style={{ left: previewPos.x, top: previewPos.y }}
                  >
                    {previewFrame ? <img src={previewFrame.url} alt="" /> : livePreview ? <img src={livePreview} alt="" /> : null}
                    <span>{formatTs(hoverTime)}</span>
                  </div>
                )}
              </div>
              {duration > 0 && (
                <div className="note-progress-ticks" aria-hidden="true">
                  {buildTimelineTicks(duration).map((tick, index, ticks) => (
                    <span
                      key={tick.sec}
                      className="note-progress-tick"
                      data-edge={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : undefined}
                      style={{ left: `${tick.position}%` }}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )
    }

    useImperativeHandle(ref, () => ({
      seekTo(sec: number) {
        const v = videoRef.current
        if (!v) return
        const applySeek = () => {
          const dur = v.duration
          // duration 非有限值或为 0 时不能钳制到 0：直接设置目标时间，
          // 浏览器会在元数据就绪后从该位置播放。
          v.currentTime = Number.isFinite(dur) && dur > 0 ? Math.max(0, Math.min(dur, sec)) : Math.max(0, sec)
        }
        if (Number.isFinite(v.duration) && v.duration > 0) {
          applySeek()
          return
        }
        // 元数据未就绪：等 loadedmetadata 后再 seek，绝不提前钳制到 0。
        const onMeta = () => {
          v.removeEventListener('loadedmetadata', onMeta)
          applySeek()
        }
        v.addEventListener('loadedmetadata', onMeta)
      },
      captureScreenshot() {
        void handleScreenshot()
      },
      togglePlay,
      play() {
        const v = videoRef.current
        if (!v) return Promise.resolve()
        return v.play()
      },
      get isPlaying() {
        return playing
      },
      get transportNode() {
        return renderTransportNode()
      },
    }))

    /* ── 无 src 降级 ── */

    if (!src) {
      return (
        <div className="ln-video-panel">
          <div className="ln-video-placeholder">
            {externalUrl ? (
              <>
                <p>该视频为在线链接，暂不支持内嵌播放</p>
                <a className="ln-video-extlink" href={externalUrl} target="_blank" rel="noreferrer">
                  ↗ 在原平台打开观看
                </a>
                <p className="ln-video-hint">下载到本地后即可在此直接播放</p>
              </>
            ) : (
              <>
                <p>暂无可用视频源</p>
                <p className="ln-video-hint">视频可能尚未下载完成</p>
              </>
            )}
          </div>
        </div>
      )
    }

    /* ── 主渲染 ── */

    return (
      <div className="ln-video-panel" ref={panelRef}>
        {/* Q2：画面单击切换播放/暂停；role=button 可键盘操作。
            子控件（overlay、字幕层之外的控制带/时间轴等）在 wrapper 外部或
            自带 stopPropagation，不会冒泡二次触发。 */}
        <div
          className="ln-video-wrapper"
          role="button"
          tabIndex={0}
          aria-label={playing ? '暂停视频' : '播放视频'}
          onClick={handleSurfaceClick}
          onKeyDown={handleSurfaceKeyDown}
        >
          <video
            ref={videoRef}
            src={src}
            preload="metadata"
            onPlay={handlePlay}
            onPause={handlePause}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onRateChange={handleRateChange}
            onVolumeChange={handleVolumeChange}
            onEnded={handleEnded}
          />
          {!playing && (
            <button
              className="note-play-overlay"
              onClick={(e) => {
                e.stopPropagation()
                togglePlay()
              }}
              title="播放"
            >
              <Play size={24} fill="currentColor" />
            </button>
          )}
          {subtitlesOn && subtitle && <div className="note-subtitle">{subtitle}</div>}
        </div>
        {renderTransportInline && renderTransportNode()}
        {/* 遗产标题（非 NoteShell 时可能需要，保留） */}
        {title && <div className="ln-video-title">{title}</div>}
      </div>
    )
  },
)

export default LNVideoPanel
