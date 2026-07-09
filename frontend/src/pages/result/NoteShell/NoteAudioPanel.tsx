/**
 * NoteAudioPanel — 音频播放器（Stage 2 重写）。
 *
 * 自定义 transport（仿 LNVideoPanel 模式）：事件驱动 state、
 * 装饰性波形条 + 进度 fill、±10s/倍速/音量、进度拖拽 seek。
 *
 * 设计稿 pg-audio 对齐。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Pause, PictureInPicture2, Play, Repeat, Volume2, VolumeX } from 'lucide-react'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
const WAVEFORM_BARS = 72

function formatTs(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return '00:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`
}

function formatSpeed(s: number): string {
  return s === Math.floor(s) ? `${s}.0` : String(s)
}

/* ── 常量 ── */
const FALLBACK_WAVEFORM_HEIGHTS = Array.from({ length: WAVEFORM_BARS }, (_, i) => {
  const t = i / (WAVEFORM_BARS - 1)
  return 0.3 + 0.7 * Math.abs(Math.sin(t * Math.PI * 2.4 + 0.5) * Math.cos(t * Math.PI * 1.1 + 0.3))
})

function extractWaveformPeaks(audioBuffer: AudioBuffer, bars: number): number[] {
  const channelCount = Math.min(audioBuffer.numberOfChannels, 2)
  const samplesPerBar = Math.max(1, Math.floor(audioBuffer.length / bars))
  const peaks: number[] = []

  for (let bar = 0; bar < bars; bar += 1) {
    const start = bar * samplesPerBar
    const end = Math.min(audioBuffer.length, start + samplesPerBar)
    const sampleStep = Math.max(1, Math.floor((end - start) / 160))
    let sum = 0
    let count = 0

    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = audioBuffer.getChannelData(channel)
      for (let idx = start; idx < end; idx += sampleStep) {
        const value = data[idx] ?? 0
        sum += value * value
        count += 1
      }
    }
    peaks.push(count > 0 ? Math.sqrt(sum / count) : 0)
  }

  const max = Math.max(...peaks, 0.001)
  return peaks.map((peak) => Math.max(0.16, Math.min(1, Math.pow(peak / max, 0.72))))
}

/* ── types ── */
interface NoteAudioPanelProps {
  src: string
  onTimeUpdate?: (currentTime: number) => void
  onDurationChange?: (duration: number) => void
  onTransportChange?: () => void
  isPipActive?: boolean
  onTogglePip?: () => void
}

export interface NoteAudioPanelHandle {
  seekTo: (sec: number) => void
  togglePlay: () => void
  readonly isPlaying: boolean
  readonly currentTime: number
  readonly duration: number
  /** 控制条 + 波形 JSX，父组件在 player-wrap 外渲染 */
  readonly transportNode: import('react').ReactNode
}

const NoteAudioPanel = forwardRef<NoteAudioPanelHandle, NoteAudioPanelProps>(
  ({ src, onTimeUpdate, onDurationChange, onTransportChange, isPipActive, onTogglePip }, ref) => {
    const audioRef = useRef<HTMLAudioElement>(null)
    const progressRef = useRef<HTMLDivElement>(null)
    const volumeSliderRef = useRef<HTMLDivElement>(null)

    const [playing, setPlaying] = useState(false)
    const [duration, setDuration] = useState(0)
    const [progress, setProgress] = useState(0)
    const [muted, setMuted] = useState(false)
    const [volume, setVolume] = useState(1)
    const [speed, setSpeed] = useState(1)
    const [loop, setLoop] = useState(false)
    const [waveformHeights, setWaveformHeights] = useState(FALLBACK_WAVEFORM_HEIGHTS)

    /* ── audio 原生事件驱动 state ── */
    const handlePlay = useCallback(() => setPlaying(true), [])
    const handlePause = useCallback(() => setPlaying(false), [])
    const handleEnded = useCallback(() => {
      setPlaying(false)
      if (!loop) setProgress(0)
    }, [loop])
    const handleLoadedMetadata = useCallback(() => {
      const a = audioRef.current
      if (!a) return
      const nextDuration = a.duration || 0
      setDuration(nextDuration)
      onDurationChange?.(nextDuration)
    }, [onDurationChange])
    const handleTimeUpdate = useCallback(() => {
      const a = audioRef.current
      if (!a || !a.duration) return
      setProgress(a.currentTime / a.duration)
      onTimeUpdate?.(a.currentTime)
    }, [onTimeUpdate])
    const handleVolumeChange = useCallback(() => {
      const a = audioRef.current
      if (!a) return
      setVolume(a.volume)
      setMuted(a.muted)
    }, [])
    const handleRateChange = useCallback(() => {
      const a = audioRef.current
      if (a) setSpeed(a.playbackRate)
    }, [])

    useEffect(() => {
      let cancelled = false

      async function loadWaveform() {
        setWaveformHeights(FALLBACK_WAVEFORM_HEIGHTS)
        if (!src || typeof window === 'undefined') return

        const cacheKey = `nibi:audio-waveform:${WAVEFORM_BARS}:${src}`
        try {
          const cached = window.sessionStorage.getItem(cacheKey)
          if (cached) {
            const parsed = JSON.parse(cached) as number[]
            if (Array.isArray(parsed) && parsed.length === WAVEFORM_BARS && !cancelled) {
              setWaveformHeights(parsed)
              return
            }
          }

          const AudioContextCtor = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          if (!AudioContextCtor) return

          const response = await fetch(src, { cache: 'force-cache' })
          if (!response.ok) throw new Error('audio fetch failed')

          const arrayBuffer = await response.arrayBuffer()
          const context = new AudioContextCtor()
          try {
            const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0))
            const peaks = extractWaveformPeaks(audioBuffer, WAVEFORM_BARS)
            if (!cancelled) {
              setWaveformHeights(peaks)
              window.sessionStorage.setItem(cacheKey, JSON.stringify(peaks))
            }
          } finally {
            void context.close()
          }
        } catch {
          if (!cancelled) setWaveformHeights(FALLBACK_WAVEFORM_HEIGHTS)
        }
      }

      void loadWaveform()
      return () => { cancelled = true }
    }, [src])

    useEffect(() => { onTransportChange?.() }, [playing, progress, duration, muted, volume, speed, loop, waveformHeights, isPipActive, onTransportChange])

    /* ── 交互控制 ── */
    const togglePlay = useCallback(() => {
      const a = audioRef.current
      if (!a) return
      if (a.paused) {
        void a.play()
      } else {
        a.pause()
      }
    }, [])

    const skip = useCallback((sec: number) => {
      const a = audioRef.current
      if (!a) return
      a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + sec))
    }, [])

    const cycleSpeed = useCallback(() => {
      const a = audioRef.current
      if (!a) return
      const idx = SPEEDS.indexOf(speed as (typeof SPEEDS)[number])
      const next = SPEEDS[(idx + 1) % SPEEDS.length]
      a.playbackRate = next
    }, [speed])

    const toggleMute = useCallback(() => {
      const a = audioRef.current
      if (a) a.muted = !a.muted
    }, [])

    const toggleLoop = useCallback(() => {
      const a = audioRef.current
      if (a) a.loop = !a.loop
      setLoop((v) => !v)
    }, [])

    /* ── 音量条拖拽 ── */
    const onVolumeMouseDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      const slider = volumeSliderRef.current
      if (!slider) return
      const a = audioRef.current
      if (!a) return
      const update = (clientX: number) => {
        const rect = slider.getBoundingClientRect()
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
        a.volume = pct
        a.muted = false
      }
      update(e.clientX)
      const handleMove = (ev: PointerEvent) => update(ev.clientX)
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }
      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
    }, [])

    /* ── 进度条交互 ── */
    const seekToClientX = useCallback((clientX: number) => {
      const el = progressRef.current
      const a = audioRef.current
      if (!el || !a || !a.duration) return
      const rect = el.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      a.currentTime = pct * a.duration
    }, [])

    const onProgressClick = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      seekToClientX(e.clientX)
    }, [seekToClientX])

    const onProgressPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const pointerId = e.pointerId
      const target = e.currentTarget
      seekToClientX(e.clientX)
      target.setPointerCapture(pointerId)
      const handleMove = (ev: PointerEvent) => seekToClientX(ev.clientX)
      const cleanup = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', cleanup)
        window.removeEventListener('pointercancel', cleanup)
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      }
      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', cleanup)
      window.addEventListener('pointercancel', cleanup)
    }, [seekToClientX])

    /* ── 键盘快捷键 ── */
    useEffect(() => {
      function handleKey(e: KeyboardEvent) {
        const a = audioRef.current
        if (!a) return
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
        if (e.code === 'Space') {
          e.preventDefault()
          if (a.paused) {
            void a.play()
          } else {
            a.pause()
          }
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault()
          a.currentTime = Math.max(0, a.currentTime - 10)
        } else if (e.code === 'ArrowRight') {
          e.preventDefault()
          a.currentTime = Math.min(a.duration || 0, a.currentTime + 10)
        }
      }
      window.addEventListener('keydown', handleKey)
      return () => window.removeEventListener('keydown', handleKey)
    }, [])

    const transportJsx = (
      <>
        {/* 波形 + 进度 */}
        <div className="note-audio-waveform" style={{ '--audio-progress': `${progress * 100}%` } as React.CSSProperties}>
          <div
            className="note-audio-progress"
            ref={progressRef}
            onClick={onProgressClick}
            onPointerDown={onProgressPointerDown}
          >
            <div className="note-audio-bars note-audio-bars--bg">
              {waveformHeights.map((h, i) => (
                <span key={i} style={{ '--bar-h': `${h * 100}%` } as React.CSSProperties} />
              ))}
            </div>
            <div className="note-audio-bars note-audio-bars--fill">
              {waveformHeights.map((h, i) => (
                <span key={i} style={{ '--bar-h': `${h * 100}%` } as React.CSSProperties} />
              ))}
            </div>
          </div>
        </div>
        {/* 时间 */}
        <div className="note-audio-time">
          <span>{formatTs(progress * duration)}</span>
          <span className="note-audio-time-sep">/</span>
          <span>{formatTs(duration)}</span>
        </div>
        {/* 控制条 */}
        <div className="note-audio-controls">
          <button className="note-audio-ctrl" onClick={() => skip(-10)} title="后退 10 秒">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M12.5 8V4l-4.5 4 4.5 4V8a6 6 0 1 1-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <text x="12" y="16" fontSize="6.5" fill="currentColor" textAnchor="middle" stroke="none" fontFamily="var(--fm)" fontWeight="700">10</text>
            </svg>
          </button>
          <button className="note-audio-play" onClick={togglePlay} title={playing ? '暂停' : '播放'}>
            {playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
          </button>
          <button className="note-audio-ctrl" onClick={() => skip(10)} title="前进 10 秒">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d="M11.5 8V4l4.5 4-4.5 4V8a6 6 0 1 0 6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <text x="12" y="16" fontSize="6.5" fill="currentColor" textAnchor="middle" stroke="none" fontFamily="var(--fm)" fontWeight="700">10</text>
            </svg>
          </button>
          <button className={`note-audio-ctrl${loop ? ' is-on' : ''}`} onClick={toggleLoop} title="循环播放">
            <Repeat size={14} />
          </button>
          {onTogglePip && (
            <button
              className={`note-audio-ctrl${isPipActive ? ' is-on' : ''}`}
              onClick={onTogglePip}
              title={isPipActive ? '退出后台播放' : '后台播放'}
            >
              <PictureInPicture2 size={14} />
            </button>
          )}
          <button className="note-audio-speed" onClick={cycleSpeed} title="切换倍速">
            {formatSpeed(speed)}x
          </button>
          <div className="note-audio-volume">
            <button className="note-audio-ctrl" onClick={toggleMute} title={muted ? '取消静音' : '静音'}>
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <div
              className="note-audio-volume-slider"
              ref={volumeSliderRef}
              onPointerDown={onVolumeMouseDown}
            >
              <div className="note-audio-volume-fill" style={{ width: `${(muted ? 0 : volume) * 100}%` }} />
            </div>
          </div>
        </div>
      </>
    )

    /* ── expose handle ── */
    useImperativeHandle(ref, () => ({
      seekTo(sec: number) {
        const a = audioRef.current
        if (!a) return
        a.currentTime = Math.max(0, Math.min(a.duration || 0, sec))
      },
      togglePlay,
      get isPlaying() {
        return playing
      },
      get currentTime() {
        return audioRef.current?.currentTime ?? progress * duration
      },
      get duration() {
        return duration
      },
      get transportNode() {
        return transportJsx
      },
    }), [duration, playing, progress, togglePlay, transportJsx])

    if (!src) {
      return (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--mut)', fontSize: 13 }}>
          暂无可用音频源
        </div>
      )
    }

    return (
      <div className="note-audio-panel">
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onVolumeChange={handleVolumeChange}
          onRateChange={handleRateChange}
        />
        {/* 迷你播放按钮（暂停态显示） */}
        {!playing && duration > 0 && (
          <button className="note-audio-big-play" onClick={togglePlay} title="播放">
            <Play size={20} fill="currentColor" />
          </button>
        )}
      </div>
    )
  },
)

export default NoteAudioPanel
