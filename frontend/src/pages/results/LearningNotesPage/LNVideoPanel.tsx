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
    const [hoverTime, setHoverTime] = useState<number | null>(null)
    const [hoverX, setHoverX] = useState(0)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [nativePip, setNativePip] = useState(false)
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

    const onProgressHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      const bar = progressRef.current
      if (!bar || !duration) return
      const rect = bar.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      setHoverTime(pct * duration)
      setHoverX(pct * 100)
    }, [duration])

    const onProgressLeave = useCallback(() => {
      setHoverTime(null)
    }, [])

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

    /* ── 键盘快捷键 ── */

    useEffect(() => {
      function handleKey(e: KeyboardEvent) {
        const v = videoRef.current
        if (!v) return
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
    }, [playing, speed, muted, volume, loop, progress, duration, hoverTime, hoverX, isFullscreen, pipActive, subtitlesOn, shooting, onTransportChange])

    function renderTransportNode() {
      return (
        <>
          <div className="note-controls">
            <div className="note-transport">
              <button className="note-icon-btn" onClick={togglePlay} title="播放/暂停 (Space)">
                {playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
              </button>
              <button className="note-icon-btn" onClick={() => skip(-10)} title="后退 10 秒">
                <svg viewBox="0 0 24 24"><path d="M12.5 8V4l-4.5 4 4.5 4V8a6 6 0 1 1-6 6" /><text x="12" y="16" fontSize="7" fill="currentColor" textAnchor="middle" stroke="none" fontFamily="var(--fm)" fontWeight="700">10</text></svg>
              </button>
              <button className="note-icon-btn" onClick={() => skip(10)} title="前进 10 秒">
                <svg viewBox="0 0 24 24"><path d="M11.5 8V4l4.5 4-4.5 4V8a6 6 0 1 0 6 6" /><text x="12" y="16" fontSize="7" fill="currentColor" textAnchor="middle" stroke="none" fontFamily="var(--fm)" fontWeight="700">10</text></svg>
              </button>
              <button className={`note-icon-btn${subtitlesOn ? ' is-on' : ''}`} onClick={toggleSubtitles} disabled={!subtitle} title={!subtitle ? '暂无字幕轨' : subtitlesOn ? '隐藏字幕' : '显示字幕'}>
                <Subtitles size={15} />
              </button>
              <button className={`note-icon-btn${loop ? ' is-on' : ''}`} onClick={toggleLoop} title="循环播放">
                <Repeat size={15} />
              </button>
            </div>
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
            <div className="note-timeline-head">
              <span className="note-time">{formatTs(progress * duration)} / {formatTs(duration)}</span>
              <div className="note-timeline-actions">
                <button className="note-icon-btn" onClick={handleScreenshot} disabled={shooting} title="截取当前帧">
                  <Camera size={15} />
                </button>
                <button className={`note-icon-btn${pipActive ? ' is-on' : ''}`} onClick={togglePip} disabled={!src} title={pipActive ? '退出画中画' : '画中画'}>
                  <PictureInPicture2 size={15} />
                </button>
                <button className="note-icon-btn" onClick={toggleFullscreen} title={isFullscreen ? '退出全屏' : '全屏'}>
                  {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
                </button>
              </div>
            </div>
            <div className="note-progress-wrap">
              <div
                className="note-progress"
                ref={progressRef}
                onClick={onProgressClick}
                onMouseMove={onProgressHover}
                onMouseLeave={onProgressLeave}
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
                  style={{ left: `${hoverX}%`, opacity: hoverTime != null ? 1 : 0 }}
                >
                  {hoverTime != null && formatTs(hoverTime)}
                </div>
              </div>
            </div>
          </div>
        </>
      )
    }

    useImperativeHandle(ref, () => ({
      seekTo(sec: number) {
        const v = videoRef.current
        if (!v) return
        const clamped = Math.max(0, Math.min(v.duration || 0, sec))
        v.currentTime = clamped
      },
      captureScreenshot() {
        void handleScreenshot()
      },
      togglePlay,
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
        <div className="ln-video-wrapper">
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
            <button className="note-play-overlay" onClick={togglePlay} title="播放">
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
