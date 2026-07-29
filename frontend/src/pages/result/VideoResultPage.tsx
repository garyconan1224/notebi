import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Check, CheckSquare, Copy, Download, FileText, ImageIcon, Maximize2, MinusSquare, Pause, Pencil, Play, Square, Star, X } from 'lucide-react'

import {
  type VideoResult,
  type VideoResultFrame,
  downloadSubtitles,
  getItemResult,
  getItemNote,
  updateFrameTitle,
} from '@/services/workspaces'
import { TripleTrack } from './TripleTrack'
import { nearestFrameIdx } from './helpers'
import { ItemTagsPanel } from '@/components/workspace/ItemTagsPanel'
import { SummariesTab } from '@/components/SummariesTab'
import { FramePickerModal, type FrameItem } from '@/components/FramePickerModal'
import {
  type InlineFrame,
  type SuggestedFrame,
  listInlineFrames,
  getSuggestedFrames,
  saveInlineFrames,
} from '@/services/inlineFrames'

import './tokens.css'
import './result.css'

function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`
}

/** 解析 'MM:SS' / 'HH:MM:SS' / 纯数字字符串为秒数 */
function parseTsStr(ts: string | number): number {
  if (typeof ts === 'number') return ts
  if (!ts) return 0
  const parts = ts.trim().split(':')
  try {
    if (parts.length === 1) return parseFloat(parts[0]) || 0
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1])
    if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
  } catch { /* ignore */ }
  return 0
}

export default function VideoResultPage() {
  const { workspaceId = '', itemId = '' } = useParams<{ workspaceId: string; itemId: string }>()
  const navigate = useNavigate()

  // 合并 loading/result/error 到单一 state，避免在 effect 内多次 setState 触发级联渲染
  type FetchState =
    | { kind: 'loading' }
    | { kind: 'ready'; data: VideoResult }
    | { kind: 'error'; message: string }
  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'loading' })

  const [currentSec, setCurrentSec] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [favored, setFavored] = useState<Record<number, boolean>>({})
  const [exportOpen, setExportOpen] = useState(false)
  const [contentTab, setContentTab] = useState<'content' | 'summary'>('content')
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // C-3: 帧多选
  const [selectedFrames, setSelectedFrames] = useState<Set<number>>(new Set())
  const lastClickedIdx = useRef<number>(-1)

  // C-5: 帧标题改名
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleEditValue, setTitleEditValue] = useState('')
  const [frameTitles, setFrameTitles] = useState<Record<number, string>>({})

  // 学习模式补图
  const [inlineFrames, setInlineFrames] = useState<InlineFrame[]>([])
  const [suggestedFrames, setSuggestedFrames] = useState<SuggestedFrame[]>([])
  const [framePickerOpen, setFramePickerOpen] = useState(false)
  const [framePickerSegmentIdx, setFramePickerSegmentIdx] = useState(0)

  const handleExportSubtitles = async (format: 'srt' | 'vtt' | 'ass') => {
    setExportOpen(false)
    try {
      await downloadSubtitles(workspaceId, itemId, format)
    } catch (err: unknown) {
      toast.error('字幕导出失败：' + (err instanceof Error ? err.message : '未知错误'))
    }
  }

  const handleDownloadVideo = useCallback(() => {
    if (fetchState.kind !== 'ready') return
    const url = fetchState.data.video.url
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = fetchState.data.video.title || 'video'
    a.click()
  }, [fetchState])

  const videoRef = useRef<HTMLVideoElement>(null)
  const activeThumbRef = useRef<HTMLButtonElement>(null)

  // 拉视频结果
  useEffect(() => {
    let cancelled = false
    getItemResult(workspaceId, itemId)
      .then((data) => {
        if (cancelled) return
        if (data.is_demo || !data.frames || data.frames.length === 0) {
          getItemNote(workspaceId, itemId)
            .then((note) => {
              if (cancelled) return
              if (note && note.note_md && note.note_md.trim().length > 0) {
                navigate(`/workspaces/${workspaceId}/items/${itemId}/note`, { replace: true })
              } else {
                setFetchState({ kind: 'ready', data })
              }
            })
            .catch(() => {
              if (!cancelled) setFetchState({ kind: 'ready', data })
            })
        } else {
          setFetchState({ kind: 'ready', data })
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '加载视频结果失败'
        setFetchState({ kind: 'error', message })
      })
    return () => { cancelled = true }
  }, [itemId, navigate, workspaceId])

  const result = fetchState.kind === 'ready' ? fetchState.data : null
  const frames = useMemo(() => (result?.is_demo ? [] : result?.frames ?? []), [result])
  const transcript = useMemo(() => (result?.is_demo ? [] : result?.transcript ?? []), [result])
  const hasSpeakerTranscript = useMemo(
    () => transcript.some((line) => Boolean(String(line.speaker ?? '').trim())),
    [transcript],
  )
  const totalSec = result?.tracks_meta.total_sec ?? 0

  // R2-C: 知识库深链接 — 读取 start_ms 并只消费一次
  const [searchParams] = useSearchParams()
  const deepLinkConsumed = useRef(false)
  const [autoPlayBlocked, setAutoPlayBlocked] = useState(false)

  useEffect(() => {
    if (deepLinkConsumed.current) return
    if (fetchState.kind !== 'ready') return
    const startMs = searchParams.get('start_ms')
    if (!startMs) return
    const sec = parseInt(startMs, 10) / 1000
    if (isNaN(sec) || sec < 0) return
    deepLinkConsumed.current = true
    // Wait for video element to be available
    const trySeek = (attempts = 0) => {
      const v = videoRef.current
      if (v) {
        v.currentTime = sec
        setCurrentSec(sec)
        v.play().catch(() => {
          setAutoPlayBlocked(true)
        })
      } else if (attempts < 10) {
        requestAnimationFrame(() => trySeek(attempts + 1))
      }
    }
    requestAnimationFrame(() => trySeek())
  }, [fetchState.kind, searchParams])

  // 加载 inline_frames + 推荐
  useEffect(() => {
    let cancelled = false
    listInlineFrames(workspaceId, itemId)
      .then((data) => { if (!cancelled) setInlineFrames(data) })
      .catch(() => {})
    getSuggestedFrames(workspaceId, itemId)
      .then((data) => { if (!cancelled) setSuggestedFrames(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, itemId])

  // inline_frames 保存（防抖 500ms）
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedSave = useCallback(
    (frames: InlineFrame[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveInlineFrames(workspaceId, itemId, frames).catch(() => {
          toast.error('保存插图失败')
        })
      }, 500)
    },
    [workspaceId, itemId],
  )

  const handleInsertFrame = useCallback(
    (frame: FrameItem) => {
      const newFrame: InlineFrame = {
        segment_idx: framePickerSegmentIdx,
        frame_timestamp: frame.timestamp,
        frame_path: frame.image_path,
        source: 'user',
        created_at: new Date().toISOString(),
      }
      const next = [...inlineFrames, newFrame]
      setInlineFrames(next)
      debouncedSave(next)
      setFramePickerOpen(false)
      toast.success('已插入帧')
    },
    [inlineFrames, framePickerSegmentIdx, debouncedSave],
  )

  const handleDeleteInlineFrame = useCallback(
    (segmentIdx: number) => {
      const next = inlineFrames.filter((f) => f.segment_idx !== segmentIdx)
      setInlineFrames(next)
      debouncedSave(next)
      toast.success('已删除插图')
    },
    [inlineFrames, debouncedSave],
  )

  // currentSec → activeFrame 派生（避免在 effect 里 setState 产生级联渲染）
  const activeFrame = useMemo(() => {
    if (!frames.length) return 0
    return nearestFrameIdx(frames, currentSec)
  }, [frames, currentSec])

  const frame: VideoResultFrame | null = frames[activeFrame] ?? null

  // activeFrame 变化时让当前缩略图居中
  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [activeFrame])

  // 视频 timeupdate → currentSec → 自动找最近帧
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => setCurrentSec(v.currentTime)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [result])

  // 没有真实 video 元素可播放时，由 setInterval 推动 currentSec（demo fallback）
  const hasVideoSource = !!result?.video.url
  useEffect(() => {
    if (hasVideoSource) return
    if (!playing) return
    if (!frames.length) return
    const id = window.setInterval(() => {
      setCurrentSec((s) => {
        const next = s + 1
        if (next >= totalSec) {
          setPlaying(false)
          return totalSec
        }
        return next
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [hasVideoSource, playing, frames.length, totalSec])

  // 跳到指定秒
  const seekTo = useCallback(
    (sec: number) => {
      const clamped = Math.max(0, Math.min(totalSec, sec))
      const v = videoRef.current
      if (v && hasVideoSource) {
        v.currentTime = clamped
      }
      setCurrentSec(clamped)
    },
    [hasVideoSource, totalSec],
  )

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (v && hasVideoSource) {
      if (v.paused) v.play().catch(() => {})
      else v.pause()
      return
    }
    setPlaying((p) => !p)
  }, [hasVideoSource])

  const setRate = useCallback(
    (delta: number) => {
      const v = videoRef.current
      if (!v) return
      const next = delta > 0 ? Math.min(4, v.playbackRate * 2) : Math.max(0.25, v.playbackRate / 2)
      v.playbackRate = next
      toast.info(`播放速度 ×${next}`)
    },
    [],
  )

  // 复制当前帧描述
  const handleCopyDescription = useCallback(() => {
    if (!frame?.description) return
    navigator.clipboard?.writeText(frame.description).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }, [frame?.description])

  const handleFavorite = useCallback(() => {
    if (!frame) return
    setFavored((prev) => {
      const next = !prev[activeFrame]
      toast.success(next ? `已收藏帧 ${frame.ts}` : `已取消收藏 ${frame.ts}`)
      return { ...prev, [activeFrame]: next }
    })
  }, [frame, activeFrame])

  // C-3: 帧多选 toggle（支持 Shift 连选）
  const handleFrameSelect = useCallback(
    (idx: number, e: React.MouseEvent) => {
      setSelectedFrames((prev) => {
        const next = new Set(prev)
        if (e.shiftKey && lastClickedIdx.current >= 0) {
          const lo = Math.min(lastClickedIdx.current, idx)
          const hi = Math.max(lastClickedIdx.current, idx)
          for (let i = lo; i <= hi; i++) next.add(i)
        } else {
          if (next.has(idx)) next.delete(idx)
          else next.add(idx)
        }
        lastClickedIdx.current = idx
        return next
      })
    },
    [],
  )

  const selectAllFrames = useCallback(() => {
    setSelectedFrames(new Set(frames.map((_, i) => i)))
    lastClickedIdx.current = frames.length - 1
  }, [frames])

  const clearSelectedFrames = useCallback(() => {
    setSelectedFrames(new Set())
    lastClickedIdx.current = -1
  }, [])

  // C-3: 批量复制选中帧描述
  const handleBatchCopyDescriptions = useCallback(() => {
    if (!selectedFrames.size) return
    const lines: string[] = []
    const sorted = [...selectedFrames].sort((a, b) => a - b)
    for (const i of sorted) {
      const f = frames[i]
      if (!f) continue
      lines.push(`--- Frame ${i} (${f.ts}) ${f.title} ---\n${f.description || '（无描述）'}`)
    }
    navigator.clipboard?.writeText(lines.join('\n\n')).catch(() => {})
    toast.success(`已复制 ${sorted.length} 帧描述`)
  }, [selectedFrames, frames])

  // C-5: 帧标题改名
  const displayTitle = frameTitles[activeFrame] ?? frame?.title ?? ''

  const startTitleEdit = useCallback(() => {
    setTitleEditValue(displayTitle)
    setTitleEditing(true)
  }, [displayTitle])

  const saveTitleEdit = useCallback(async () => {
    const val = titleEditValue.trim()
    if (!val || !frame) return
    try {
      await updateFrameTitle(workspaceId, itemId, activeFrame, val)
      setFrameTitles((prev) => ({ ...prev, [activeFrame]: val }))
      toast.success('帧标题已更新')
    } catch {
      toast.error('保存失败')
    }
    setTitleEditing(false)
  }, [titleEditValue, activeFrame, frame, workspaceId, itemId])

  const cancelTitleEdit = useCallback(() => {
    setTitleEditing(false)
    setTitleEditValue('')
  }, [])

  const jumpFrame = useCallback(
    (delta: number) => {
      if (!frames.length) return
      const nextIdx = Math.max(0, Math.min(frames.length - 1, activeFrame + delta))
      const nf = frames[nextIdx]
      seekTo(nf.sec ?? parseTsStr(nf.ts ?? nf.timestamp ?? ''))
    },
    [frames, activeFrame, seekTo],
  )

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        if (e.shiftKey) jumpFrame(-1)
        else seekTo(currentSec - 5)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        if (e.shiftKey) jumpFrame(1)
        else seekTo(currentSec + 5)
      } else if (e.key === '[') {
        setRate(-1)
      } else if (e.key === ']') {
        setRate(1)
      } else if (e.key === 'c' || e.key === 'C') {
        handleCopyDescription()
      } else if (e.key === 'f' || e.key === 'F') {
        handleFavorite()
      } else if (e.key === 'Escape' && lightboxOpen) {
        setLightboxOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [togglePlay, jumpFrame, seekTo, currentSec, setRate, handleCopyDescription, handleFavorite, lightboxOpen])

  if (fetchState.kind === 'loading') {
    return (
      <div className="nibi-video-result-scope" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <span className="mono" style={{ color: 'var(--mut)' }}>加载视频结果…</span>
      </div>
    )
  }
  if (fetchState.kind === 'error' || !result) {
    return (
      <div
        className="nibi-video-result-scope"
        style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}
      >
        <span style={{ color: 'var(--err)', fontWeight: 600 }}>
          {fetchState.kind === 'error' ? fetchState.message : '没有可显示的视频结果'}
        </span>
        <button className="btn-ghost" style={{ padding: '6px 12px' }} onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>
      </div>
    )
  }

  // N7b 路径 1：字幕直接总结模式（无帧，展示 summary + transcript）
  const isSubtitlePath = result.summary_path === 'subtitle'
  const isVisualOnly = result.summary_path === 'visual_only'
  if (isSubtitlePath) {
    return (
      <div className="nibi-video-result-scope vd-subtitle-layout">
        {/* Nav bar */}
        <div className="vd-nav">
          <button className="btn-ghost" onClick={() => navigate(-1)} style={{ height: 28, padding: '0 10px', fontSize: 12 }}>
            <ArrowLeft size={13} /> 任务中心
          </button>
          <span className="vd-sep" />
          <span className="vd-title">{result.video.title || '视频'}</span>
          <span className="kw mono" style={{ fontSize: 10, flexShrink: 0 }}>
            VIDEO · 字幕总结模式
          </span>
          <span className="kw" style={{ fontSize: 10, background: 'var(--ok)', color: '#fff', padding: '2px 8px', borderRadius: 6 }}>
            {result.detected_template ? `自动识别：${result.detected_template}` : (result.video_template || '其它')}
          </span>
          <button
            className="btn-ghost"
            style={{ height: 24, padding: '0 8px', fontSize: 11, gap: 4, marginLeft: 6, borderRadius: 4, border: '1px solid var(--border)' }}
            onClick={() => navigate(`/workspaces/${workspaceId}/items/${itemId}/note`)}
            title="打开统一笔记（NoteShell）"
          >
            <FileText size={12} /> 统一笔记
          </button>
          <div style={{ marginLeft: 'auto' }} />
          {result.video.url && (
            <button className="btn-ghost" style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={handleDownloadVideo} title="导出视频">
              <Download size={13} /> 视频
            </button>
          )}
          <div style={{ position: 'relative' }}>
            <button className="btn-ghost" style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => setExportOpen(!exportOpen)} title="导出字幕">
              <Download size={13} /> 字幕
            </button>
            {exportOpen && (
              <div className="vd-dropdown-menu" style={{ position: 'absolute', right: 0, top: 36, zIndex: 50, background: 'var(--srf)', border: '1px solid var(--bdr)', borderRadius: 8, padding: '4px 0', minWidth: 140, boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}>
                {(['srt', 'vtt', 'ass'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    className="btn-ghost"
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 14px', fontSize: 12, borderRadius: 0 }}
                    onClick={() => handleExportSubtitles(fmt)}
                  >
                    .{fmt} 字幕
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tags */}
        <div style={{ padding: '10px 20px 0', flexShrink: 0 }}>
          <ItemTagsPanel workspaceId={workspaceId} itemId={itemId} />
        </div>

        {/* 内容/总结 tab 切换 */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--bdr)', padding: '0 20px', flexShrink: 0 }}>
          <button
            className="vd-tab-btn"
            data-active={contentTab === 'content'}
            onClick={() => setContentTab('content')}
          >
            内容
          </button>
          <button
            className="vd-tab-btn"
            data-active={contentTab === 'summary'}
            onClick={() => setContentTab('summary')}
          >
            总结
          </button>
        </div>

        {/* Main content */}
        <div className="vd-subtitle-content">
          {contentTab === 'summary' ? (
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <SummariesTab
                workspaceId={workspaceId}
                itemId={itemId}
                allowSpeakerAware={hasSpeakerTranscript}
                templateCategory="style_video_with_frames"
              />
            </div>
          ) : (
          <>
          {/* Summary card */}
          {result.summary && (
            <div className="vd-card">
              <div className="vd-card-head">
                <h2>内容摘要</h2>
                <span style={{ fontSize: 11, color: 'var(--mut)' }}>
                  {result.detected_template ? `自动识别：${result.detected_template}` : (result.video_template || '其它')} · {transcript.length} 段转录
                </span>
              </div>
              <div className="vd-summary-text">{result.summary}</div>
            </div>
          )}

          {/* Transcript card */}
          {transcript.length > 0 && (
            <div className="vd-card">
              <div className="vd-card-head">
                <h2>转录内容</h2>
                <span style={{ fontSize: 11, color: 'var(--mut)' }}>
                  {transcript.length} 段
                </span>
              </div>
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                {transcript.map((line, idx) => {
                  const insertedFrame = inlineFrames.find((f) => f.segment_idx === idx)
                  return (
                    <div key={idx}>
                      <div className="vd-transcript-line">
                        <span className="vd-transcript-ts">{line.t_str}</span>
                        <span className="vd-transcript-text">{line.text}</span>
                        <button
                          className="vd-insert-frame-btn"
                          title="插入关键帧截图"
                          onClick={() => {
                            setFramePickerSegmentIdx(idx)
                            setFramePickerOpen(true)
                          }}
                        >
                          📷
                        </button>
                      </div>
                      {insertedFrame && (
                        <div className="vd-inline-frame">
                          <img
                            src={insertedFrame.frame_path}
                            alt=""
                            className="vd-inline-frame-img"
                          />
                          <span className="vd-inline-frame-ts">
                            {formatSec(insertedFrame.frame_timestamp)}
                          </span>
                          <button
                            className="vd-inline-frame-del"
                            onClick={() => handleDeleteInlineFrame(idx)}
                            title="删除插图"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!result.summary && transcript.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--mut)' }}>
              暂无摘要和转录内容
            </div>
          )}
          </>
          )}
        </div>

        {/* 帧选择器弹窗 */}
        {framePickerOpen && (
          <FramePickerModal
            frames={frames.map((f) => ({
              timestamp: f.sec ?? parseTsStr(f.ts ?? f.timestamp ?? ''),
              image_path: f.image_path || '',
              scene_description: f.description || '',
            }))}
            suggested={suggestedFrames}
            currentSegmentIdx={framePickerSegmentIdx}
            onSelect={handleInsertFrame}
            onClose={() => setFramePickerOpen(false)}
          />
        )}
      </div>
    )
  }

  // 路径 2/3：帧分析模式（需要 frames）
  if (!frame) {
    return (
      <div
        className="nibi-video-result-scope"
        style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}
      >
        <span style={{ color: 'var(--err)', fontWeight: 600 }}>没有可显示的视频结果</span>
        <button className="btn-ghost" style={{ padding: '6px 12px' }} onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>
      </div>
    )
  }

  const progress = totalSec > 0 ? Math.min(1, currentSec / totalSec) : 0

  return (
    <div className="nibi-video-result-scope vd-layout">
      {/* ════════ 左：播放器 + 三轨 ════════ */}
      <div className="vd-left">
        {/* 顶部导航 */}
        <div className="vd-nav">
          <button className="btn-ghost vd-nav-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={13} /> 任务中心
          </button>
          <span className="vd-sep" />
          <span className="vd-title">{result.video.title}</span>
          <span className="kw mono vd-chip">
            VIDEO · {result.video.duration_str || formatSec(totalSec)} · {frames.length} 帧
          </span>
          {result.source === 'demo_fixture' && (
            <span className="mono vd-chip vd-chip--demo" title="results 尚未填充，正在使用 demo fixture">
              DEMO
            </span>
          )}
          <button
            className="btn-ghost vd-nav-btn vd-nav-btn--compact"
            onClick={() => navigate(`/workspaces/${workspaceId}/items/${itemId}/note`)}
            title="打开统一笔记（NoteShell）"
          >
            <FileText size={12} /> 统一笔记
          </button>
          <div className="vd-nav-spacer" />
          {result.video.url && (
            <button className="btn-ghost vd-nav-btn vd-nav-btn--compact" onClick={handleDownloadVideo} title="导出视频">
              <Download size={12} /> 视频
            </button>
          )}
          <div className="vd-dropdown-wrap">
            <button className="btn-ghost vd-nav-btn" onClick={() => !isVisualOnly && setExportOpen(!exportOpen)} title={isVisualOnly ? "仅画面分析模式无字幕数据" : "导出字幕"} disabled={isVisualOnly}>
              <Download size={13} /> 字幕
            </button>
            {exportOpen && (
              <div className="vd-dropdown-menu">
                {(['srt', 'vtt', 'ass'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    className="btn-ghost vd-dropdown-item"
                    onClick={() => handleExportSubtitles(fmt)}
                  >
                    .{fmt} 字幕
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 标签展示 */}
        <div className="vd-tags-strip">
          <ItemTagsPanel workspaceId={workspaceId} itemId={itemId} />
        </div>

        {/* ══ 主帧大图 + 缩略图轨道 ══ */}
        <div className="vd-main-frame-area">
          {/* 主帧大图 */}
          <div className="vd-main-frame" onClick={() => frame.image_path && setLightboxOpen(true)}>
            {frame.image_path ? (
              <img src={frame.image_path} alt={frame.title} />
            ) : (
              <div className="vd-main-frame-fallback">
                <ImageIcon size={32} className="vd-frame-fallback-icon" />
                {frame.title}
              </div>
            )}
            <div className="vd-main-frame-info">
              <span className="mono">{frame.ts} · {frame.shot_type}</span>
              <span className="vd-main-frame-title">{frame.title}</span>
            </div>
            {frame.image_path && (
              <div className="vd-main-frame-expand">
                <Maximize2 size={14} />
              </div>
            )}
          </div>

          {/* C-3: 帧多选工具栏 */}
          {selectedFrames.size > 0 && (
            <div className="vd-select-bar">
              <span className="mono vd-select-meta">
                已选 {selectedFrames.size} / {frames.length} 帧
              </span>
              <div className="vd-select-actions">
                <button className="vd-btn-tool" onClick={handleBatchCopyDescriptions} title="复制选中帧描述">
                  <Copy size={12} /> 复制描述
                </button>
                <button className="vd-btn-tool" onClick={selectAllFrames} title="全选">
                  <CheckSquare size={12} /> 全选
                </button>
                <button className="vd-btn-tool" onClick={clearSelectedFrames} title="清空选择">
                  <MinusSquare size={12} /> 清空
                </button>
              </div>
            </div>
          )}

          {/* 缩略图轨道 */}
          <div className="vd-thumb-track">
            {frames.map((f, i) => (
              <button
                key={i}
                ref={i === activeFrame ? activeThumbRef : undefined}
                className="vd-thumb"
                data-active={i === activeFrame}
                data-selected={selectedFrames.has(i)}
                onClick={(e) => {
                  if (e.shiftKey || e.metaKey || e.ctrlKey) {
                    handleFrameSelect(i, e)
                  } else {
                    seekTo(f.sec ?? parseTsStr(f.ts ?? f.timestamp ?? ''))
                  }
                }}
                title={f.title}
              >
                {f.image_path ? (
                  <img src={f.image_path} alt={f.title} loading="lazy" />
                ) : (
                  <div className="vd-thumb-fallback">{f.title?.slice(0, 4)}</div>
                )}
                <span
                  className="vd-thumb-check"
                  onClick={(e) => { e.stopPropagation(); handleFrameSelect(i, e) }}
                >
                  {selectedFrames.has(i) ? <CheckSquare size={14} /> : <Square size={14} />}
                </span>
              </button>
            ))}
          </div>

          {/* 视频播放器 */}
          {isVisualOnly ? (
            <div className="vd-player-mini-wrap vd-player-mini-wrap--empty">
              <span className="mono vd-muted">仅画面分析模式 · 不含视频播放</span>
            </div>
          ) : (
            <div className="vd-player-mini-wrap">
              <div className="vd-player-mini" onClick={togglePlay}>
                {hasVideoSource ? (
                  <video ref={videoRef} src={result.video.url} preload="metadata" />
                ) : (
                  <div className="vd-player-empty">
                    {frame.title}
                  </div>
                )}
                <div className="vd-play-btn-mini">
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </div>
                {autoPlayBlocked && !playing && (
                  <div className="vd-autoplay-hint" onClick={() => { togglePlay(); setAutoPlayBlocked(false) }}>
                    点击播放
                  </div>
                )}
                <div className="vd-progress-mini">
                  <div className="vd-progress-mini-fill" style={{ width: `${progress * 100}%` }} />
                </div>
              </div>
              <div className="vd-controls-mini">
                <span className="mono vd-timecode">
                  {formatSec(currentSec)} / {formatSec(totalSec)}
                </span>
              </div>
            </div>
          )}
        </div>

        <TripleTrack
          frames={frames}
          transcript={transcript}
          activeFrame={activeFrame}
          currentSec={currentSec}
          onFrameClick={(idx) => seekTo(frames[idx].sec ?? parseTsStr(frames[idx].ts ?? ''))}
          onTranscriptClick={(l) => seekTo(l.t_sec)}
        />
      </div>

      {/* ════════ 右：当前帧浮动面板 ════════ */}
      <div className="vd-right">
        {/* 帧预览：有 image_path 时显示实际帧图，否则 gradient + title */}
        <div className="vd-frame-preview">
          {frame.image_path ? (
            <img src={frame.image_path} alt={frame.title} />
          ) : (
            <div className="vd-frame-preview-fallback">
              {frame.title}
            </div>
          )}
          <div className="vd-frame-badge mono">{frame.ts} · {frame.shot_type}</div>
          {favored[activeFrame] && (
            <div className="vd-frame-star">
              <Star size={16} fill="var(--wrn)" color="var(--wrn)" />
            </div>
          )}
        </div>

        <div className="vd-frame-info">
          {titleEditing ? (
            <div className="vd-title-edit-row">
              <input
                value={titleEditValue}
                onChange={(e) => setTitleEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveTitleEdit(); if (e.key === 'Escape') cancelTitleEdit() }}
                autoFocus
                className="vd-title-edit-input"
              />
              <button className="vd-btn-tool vd-btn-tool--danger" onClick={saveTitleEdit}>
                <Check size={11} />
              </button>
              <button className="vd-btn-tool" onClick={cancelTitleEdit}>
                <X size={11} />
              </button>
            </div>
          ) : (
            <div className="vd-fi-title vd-fi-title--editable" onClick={startTitleEdit} title="点击改名">
              {displayTitle} <Pencil size={11} className="vd-inline-pencil" />
            </div>
          )}
          <div className="vd-fi-sub">{frame.subtitle}</div>
          <div className="vd-fi-tags">
            {Object.values(frame.tags ?? {}).flat().slice(0, 6).map((t) => (
              <span key={t} className="kw vd-tag">{t}</span>
            ))}
          </div>
        </div>

        {/* 补图入口 */}
        {suggestedFrames.length > 0 && (
          <button
            className="btn-ghost"
            style={{ margin: '0 16px', height: 28, fontSize: 11, borderRadius: 6, border: '1px dashed var(--bdr)', color: 'var(--mut)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
            onClick={() => { setFramePickerSegmentIdx(activeFrame); setFramePickerOpen(true) }}
            title="从推荐帧中插入截图"
          >
            📷 补图
          </button>
        )}

        {/* tabs：内容 / 总结 */}
        <div className="vd-tabs-bar">
          <span className="eyebrow vd-tabs-title">帧分析</span>
        </div>
        <div className="vd-tabs-row">
          <button className="vd-tab-btn" data-active={contentTab === 'content'} onClick={() => setContentTab('content')}>
            内容
          </button>
          <button className="vd-tab-btn" data-active={contentTab === 'summary'} onClick={() => setContentTab('summary')}>
            总结
          </button>
        </div>

        {contentTab === 'summary' ? (
          <div className="vd-summary-pane">
            <SummariesTab
              workspaceId={workspaceId}
              itemId={itemId}
              allowSpeakerAware={hasSpeakerTranscript}
              templateCategory="style_video_with_frames"
            />
          </div>
        ) : (
          <>
          {/* 画面描述 */}
          <div className="vd-prompt-area">
            <div className="vd-prompt-head">
              <span className="eyebrow">画面描述</span>
            </div>
            <div className="vd-prompt-text">{frame.description || '（暂无描述）'}</div>
          </div>

          <div className="vd-actions">
            <button className="vd-btn-main" onClick={handleCopyDescription}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? '已复制！' : '复制描述'}
            </button>
            <button className="vd-btn-sub" data-favored={!!favored[activeFrame]} onClick={handleFavorite}>
              <Star size={14} fill={favored[activeFrame] ? 'var(--wrn)' : 'none'} color={favored[activeFrame] ? 'var(--wrn)' : 'currentColor'} />
              {favored[activeFrame] ? '已收藏此帧 ★' : '收藏此帧'}
            </button>

            <div className="vd-frame-nav">
              <span className="mono vd-frame-nav-meta">
                帧 {activeFrame + 1} / {frames.length} · {frame.shot_type}
              </span>
              <div className="vd-frame-nav-actions">
                <button className="vd-frame-nav-btn" onClick={() => jumpFrame(-1)} title="上一帧 (Shift+←)">‹</button>
                <button className="vd-frame-nav-btn" onClick={() => jumpFrame(1)} title="下一帧 (Shift+→)">›</button>
              </div>
            </div>
          </div>
          </>
        )}
      </div>

      {/* 帧选择器弹窗（与字幕路径共用） */}
      {framePickerOpen && (
        <FramePickerModal
          frames={frames.map((f) => ({
            timestamp: f.sec ?? parseTsStr(f.ts ?? f.timestamp ?? ''),
            image_path: f.image_path || '',
            scene_description: f.description || '',
          }))}
          suggested={suggestedFrames}
          currentSegmentIdx={framePickerSegmentIdx}
          onSelect={handleInsertFrame}
          onClose={() => setFramePickerOpen(false)}
        />
      )}

      {/* 主帧 Lightbox */}
      {lightboxOpen && frame.image_path && (
        <div className="vd-lightbox" onClick={() => setLightboxOpen(false)}>
          <button className="vd-lightbox-close" onClick={() => setLightboxOpen(false)}>
            <X size={20} />
          </button>
          <img
            className="vd-lightbox-img"
            src={frame.image_path}
            alt={frame.title}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="vd-lightbox-info">
            {frame.ts} · {frame.shot_type} · {frame.title}
          </div>
        </div>
      )}
    </div>
  )
}
