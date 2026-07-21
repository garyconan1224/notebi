import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Check, CheckSquare, Copy, Download, FileText, ImageIcon, Maximize2, MinusSquare, Pause, Pencil, Play, Settings2, Square, Star, X } from 'lucide-react'

import {
  type PromptVersion,
  type VideoResult,
  type VideoResultFrame,
  addPromptVersion,
  downloadSubtitles,
  getItemResult,
  getItemNote,
  listPromptVersions,
  updateFrameTitle,
} from '@/services/workspaces'
import { PromptVersionStack } from '@/components/result/PromptVersionStack'
import {
  type PromptFormat,
  type PromptFormatsConfig,
  getPromptFormatsConfig,
  isJsonFormat,
  renderJsonForFrame,
  renderTemplate,
  savePromptFormatsConfig,
} from '@/services/promptFormats'
import { TripleTrack } from './TripleTrack'
import { nearestFrameIdx } from './helpers'
import { ItemTagsPanel } from '@/components/workspace/ItemTagsPanel'
import { SummariesTab } from '@/components/SummariesTab'
import { FramePickerModal, type FrameItem } from '@/components/FramePickerModal'
import { isFeatureEnabled } from '@/config/product'
import {
  type InlineFrame,
  type SuggestedFrame,
  listInlineFrames,
  getSuggestedFrames,
  saveInlineFrames,
} from '@/services/inlineFrames'

import './tokens.css'
import './result.css'

const ACTIVE_LIMIT = 3

interface TabDescriptor {
  key: string
  label: string
  format: PromptFormat
}

function buildPromptText(frame: VideoResultFrame, format: PromptFormat): string {
  if (isJsonFormat(format)) return renderJsonForFrame(frame)
  return renderTemplate(format.template, frame)
}

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
  const showPromptTools = isFeatureEnabled('showPromptFormat')

  // 合并 loading/result/error 到单一 state，避免在 effect 内多次 setState 触发级联渲染
  type FetchState =
    | { kind: 'loading' }
    | { kind: 'ready'; data: VideoResult }
    | { kind: 'error'; message: string }
  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'loading' })

  const [currentSec, setCurrentSec] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [promptStyle, setPromptStyle] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [favored, setFavored] = useState<Record<number, boolean>>({})

  // 提示词格式配置（异步加载；失败时 tabs 退化为内置 fallback）
  const [formatsCfg, setFormatsCfg] = useState<PromptFormatsConfig | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSelection, setPickerSelection] = useState<string[]>([])
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  const [contentTab, setContentTab] = useState<'content' | 'summary'>('content')
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // C-3: 帧多选
  const [selectedFrames, setSelectedFrames] = useState<Set<number>>(new Set())
  const lastClickedIdx = useRef<number>(-1)

  // C-4: 帧提示词 inline editor
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [selectedVersionIdx, setSelectedVersionIdx] = useState<number | null>(null)

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

  // 拉提示词格式配置；失败容忍（result 页仍可看，只是 tabs 用 fallback）
  useEffect(() => {
    if (!showPromptTools) return
    let cancelled = false
    getPromptFormatsConfig()
      .then((data) => {
        if (!cancelled) setFormatsCfg(data)
      })
      .catch(() => {
        // 静默：UI 用 fallback
      })
    return () => {
      cancelled = true
    }
  }, [showPromptTools])

  // 拉视频结果 + 提示词版本（合并为单个 effect 避免重复 cleanup）
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
    if (showPromptTools) {
      listPromptVersions(workspaceId, itemId)
        .then((data) => {
          if (!cancelled) setPromptVersions(data)
        })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [workspaceId, itemId, showPromptTools])

  const result = fetchState.kind === 'ready' ? fetchState.data : null
  const frames = useMemo(() => (result?.is_demo ? [] : result?.frames ?? []), [result])
  const transcript = useMemo(() => (result?.is_demo ? [] : result?.transcript ?? []), [result])
  const hasSpeakerTranscript = useMemo(
    () => transcript.some((line) => Boolean(String(line.speaker ?? '').trim())),
    [transcript],
  )
  const totalSec = result?.tracks_meta.total_sec ?? 0
  const showNoteMode = true

  // 加载 inline_frames + 推荐（仅学习模式）
  useEffect(() => {
    if (!showNoteMode) return
    let cancelled = false
    listInlineFrames(workspaceId, itemId)
      .then((data) => { if (!cancelled) setInlineFrames(data) })
      .catch(() => {})
    getSuggestedFrames(workspaceId, itemId)
      .then((data) => { if (!cancelled) setSuggestedFrames(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, itemId, showNoteMode])

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

  // 构造 tabs：active_image_ids 对应 format + JSON 永远附加在末尾
  const tabs = useMemo<TabDescriptor[]>(() => {
    const formats = formatsCfg?.formats ?? []
    const imageFormats = formats.filter((f) => f.category === 'image')
    if (!imageFormats.length) {
      // fallback：未拉到配置时给两个最小 tabs，避免页面空白
      return []
    }
    const idMap = new Map(imageFormats.map((f) => [f.id, f]))
    const active = formatsCfg?.active_image_ids ?? []
    const picked: PromptFormat[] = []
    for (const id of active) {
      const fmt = idMap.get(id)
      if (fmt && !isJsonFormat(fmt) && !picked.find((p) => p.id === fmt.id)) {
        picked.push(fmt)
      }
    }
    // 不足 ACTIVE_LIMIT 时补齐（非 JSON 优先按 formats 顺序）
    if (picked.length < ACTIVE_LIMIT) {
      for (const fmt of imageFormats) {
        if (picked.length >= ACTIVE_LIMIT) break
        if (isJsonFormat(fmt)) continue
        if (!picked.find((p) => p.id === fmt.id)) picked.push(fmt)
      }
    }
    const jsonFmt = imageFormats.find((f) => isJsonFormat(f))
    const built: TabDescriptor[] = picked.slice(0, ACTIVE_LIMIT).map((f) => ({
      key: f.id,
      label: f.name,
      format: f,
    }))
    if (jsonFmt) {
      built.push({ key: jsonFmt.id, label: jsonFmt.name, format: jsonFmt })
    }
    return built
  }, [formatsCfg])

  // promptStyle 没匹配上时由 activeTab fallback 选第一个 tab；
  // 不在 effect 里 setState，避免级联渲染。
  const activeTab = tabs.find((t) => t.key === promptStyle) ?? tabs[0]
  const promptText = useMemo(() => {
    if (!frame || !activeTab) return ''
    return buildPromptText(frame, activeTab.format)
  }, [frame, activeTab])

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

  const handleCopy = useCallback(() => {
    if (!promptText) return
    navigator.clipboard?.writeText(promptText).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }, [promptText])

  const handleFavorite = useCallback(() => {
    if (!frame) return
    setFavored((prev) => {
      const next = !prev[activeFrame]
      console.log('[Phase 1G] favorite frame', {
        workspaceId,
        itemId,
        idx: activeFrame,
        ts: frame.ts,
        favored: next,
      })
      toast.success(next ? `已收藏帧 ${frame.ts}` : `已取消收藏 ${frame.ts}`)
      return { ...prev, [activeFrame]: next }
    })
  }, [frame, activeFrame, workspaceId, itemId])

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

  // C-3: 批量复制选中帧提示词
  const handleBatchCopy = useCallback(() => {
    if (!selectedFrames.size) return
    const lines: string[] = []
    const sorted = [...selectedFrames].sort((a, b) => a - b)
    for (const i of sorted) {
      const f = frames[i]
      if (!f) continue
      const prompt = f.prompt_mj || f.prompt_video || ''
      lines.push(`--- Frame ${i} (${f.ts}) ${f.title} ---\n${prompt}`)
    }
    navigator.clipboard?.writeText(lines.join('\n\n')).catch(() => {})
    toast.success(`已复制 ${sorted.length} 帧提示词`)
  }, [selectedFrames, frames])

  // 一键全复制（所有帧）
  const handleCopyAll = useCallback(() => {
    if (!frames.length) return
    const lines: string[] = []
    for (const f of frames) {
      const prompt = f.prompt_mj || f.prompt_video || ''
      if (!prompt) continue
      const idx = frames.indexOf(f)
      lines.push(`--- Frame ${idx} (${f.ts}) ${f.title} ---\n${prompt}`)
    }
    navigator.clipboard?.writeText(lines.join('\n\n')).catch(() => {})
    toast.success(`已复制 ${lines.length} 帧提示词`)
  }, [frames])

  // 导出提示词脚本（.md）
  const handleExportPromptScript = useCallback(() => {
    if (!frames.length) return
    const lines = [
      `# 复刻提示词脚本`,
      `> 视频：${result?.video.title ?? '-'}`,
      `> 共 ${frames.length} 帧`,
      ``,
    ]
    for (const f of frames) {
      const prompt = f.prompt_mj || f.prompt_video || ''
      if (!prompt) continue
      const idx = frames.indexOf(f)
      lines.push(`## Frame ${idx} — ${f.ts} — ${f.title}`)
      lines.push('')
      lines.push(prompt)
      lines.push('')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prompt-script-${result?.video.title || 'video'}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('提示词脚本已导出')
  }, [frames, result?.video.title])

  /* N11: 导出功能 UI 隐藏（代码保留，见 SPEC §8.2）
  const handleExport = useCallback(async () => {
    try {
      await downloadExport(workspaceId, itemId)
      toast.success('工作包已下载')
    } catch (err) {
      toast.error('导出失败：' + (err instanceof Error ? err.message : '未知'))
    }
  }, [workspaceId, itemId])
  */

  const handleAddPromptVersion = useCallback(async (content: string) => {
    const pv = await addPromptVersion(workspaceId, itemId, content)
    setPromptVersions((prev) => [...prev, pv])
    toast.success(`已保存 v${pv.version}`)
  }, [workspaceId, itemId])

  // C-4: inline editor
  const startEdit = useCallback(() => {
    const base = selectedVersionIdx !== null && promptVersions[selectedVersionIdx]
      ? promptVersions[selectedVersionIdx].content
      : promptText
    setEditText(base)
    setEditing(true)
  }, [promptText, selectedVersionIdx, promptVersions])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setEditText('')
  }, [])

  const saveEdit = useCallback(async () => {
    const text = editText.trim()
    if (!text) return
    const label = `[帧 ${activeFrame} (${frame?.ts ?? ''})] `
    await handleAddPromptVersion(label + text)
    setEditing(false)
    setEditText('')
    setSelectedVersionIdx(null)
  }, [editText, activeFrame, frame, handleAddPromptVersion])

  // 切帧时退出编辑态
  useEffect(() => {
    if (editing) {
      setEditing(false)
      setEditText('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFrame])

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

  const openPicker = useCallback(() => {
    if (!formatsCfg) return
    setPickerSelection(
      tabs.filter((t) => !isJsonFormat(t.format)).map((t) => t.key),
    )
    setPickerOpen(true)
  }, [formatsCfg, tabs])

  const togglePickerId = useCallback((id: string) => {
    setPickerSelection((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      if (cur.length >= ACTIVE_LIMIT) {
        toast.error(`最多选 ${ACTIVE_LIMIT} 个`)
        return cur
      }
      return [...cur, id]
    })
  }, [])

  const savePicker = useCallback(async () => {
    if (!formatsCfg) return
    if (pickerSelection.length !== ACTIVE_LIMIT) {
      toast.error(`请选满 ${ACTIVE_LIMIT} 个`)
      return
    }
    try {
      const saved = await savePromptFormatsConfig({
        active_image_ids: pickerSelection,
      })
      setFormatsCfg(saved)
      setPickerOpen(false)
      toast.success('已更新提示词格式 tabs')
    } catch (err) {
      toast.error('保存失败：' + (err instanceof Error ? err.message : '未知'))
    }
  }, [formatsCfg, pickerSelection])

  const jumpFrame = useCallback(
    (delta: number) => {
      if (!frames.length) return
      const nextIdx = Math.max(0, Math.min(frames.length - 1, activeFrame + delta))
      const nf = frames[nextIdx]
      seekTo(nf.sec ?? parseTsStr(nf.ts ?? nf.timestamp ?? ''))
    },
    [frames, activeFrame, seekTo],
  )

  // v1.1 §5.4 键盘快捷键
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
        handleCopy()
      } else if (e.key === 'f' || e.key === 'F') {
        handleFavorite()
      } else if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1
        if (idx < tabs.length) setPromptStyle(tabs[idx].key)
      } else if (e.key === 'Escape' && lightboxOpen) {
        setLightboxOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [togglePlay, jumpFrame, seekTo, currentSec, setRate, handleCopy, handleFavorite, tabs, lightboxOpen])

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
            <FileText size={12} /> 统一笔记 <span style={{ fontSize: 9, opacity: 0.6 }}>beta</span>
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
                        {showNoteMode && (
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
                        )}
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
            <ArrowLeft size={13} /> {showNoteMode ? '任务中心' : '复刻库'}
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
          {showNoteMode && (
            <button
              className="btn-ghost vd-nav-btn vd-nav-btn--compact"
              onClick={() => navigate(`/workspaces/${workspaceId}/items/${itemId}/note`)}
              title="打开统一笔记（NoteShell）"
            >
              <FileText size={12} /> 统一笔记 <span className="vd-beta">beta</span>
            </button>
          )}
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
          {selectedFrames.size > 0 && showPromptTools && (
            <div className="vd-select-bar">
              <span className="mono vd-select-meta">
                已选 {selectedFrames.size} / {frames.length} 帧
              </span>
              <div className="vd-select-actions">
                <button className="vd-btn-tool" onClick={handleBatchCopy} title="复制选中帧提示词">
                  <Copy size={12} /> 复制提示词
                </button>
                <button className="vd-btn-tool" onClick={handleCopyAll} title="复制全部帧提示词">
                  <Copy size={12} /> 全复制
                </button>
                <button className="vd-btn-tool" onClick={handleExportPromptScript} title="导出提示词脚本(.md)">
                  <FileText size={12} /> 导出脚本
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

          {/* 视频播放器（学习模式保留；复刻模式以帧浏览为主） */}
          {showNoteMode && (
            isVisualOnly ? (
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
            )
          )}
        </div>

        {showNoteMode && (
          <TripleTrack
            frames={frames}
            transcript={transcript}
            activeFrame={activeFrame}
            currentSec={currentSec}
            onFrameClick={(idx) => seekTo(frames[idx].sec ?? parseTsStr(frames[idx].ts ?? ''))}
            onTranscriptClick={(l) => seekTo(l.t_sec)}
          />
        )}
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

        {/* 学习模式：补图入口 */}
        {showNoteMode && suggestedFrames.length > 0 && (
          <button
            className="btn-ghost"
            style={{ margin: '0 16px', height: 28, fontSize: 11, borderRadius: 6, border: '1px dashed var(--bdr)', color: 'var(--mut)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
            onClick={() => { setFramePickerSegmentIdx(activeFrame); setFramePickerOpen(true) }}
            title="从推荐帧中插入截图"
          >
            📷 补图
          </button>
        )}

        {showPromptTools ? (
          <>
          {/* tabs */}
          <div className="vd-tabs-bar">
            <span className="eyebrow vd-tabs-title">提示词格式</span>
            <button className="vd-tab-config" onClick={openPicker} title="选择 3 个图片类格式作为 tabs（JSON 自动附加）">
              <Settings2 size={11} /> 选择
            </button>
          </div>
          <div className="vd-tabs-row">
            {tabs.map((t) => (
              <button key={t.key} className="vd-tab-btn" data-active={contentTab === 'content' && promptStyle === t.key} onClick={() => { setContentTab('content'); setPromptStyle(t.key) }}>
                {t.label}
              </button>
            ))}
            <button className="vd-tab-btn" data-active={contentTab === 'summary'} onClick={() => setContentTab('summary')}>
              总结
            </button>
            {!tabs.length && contentTab !== 'summary' && (
              <span className="mono vd-muted">（提示词格式未加载）</span>
            )}
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
          <div className="vd-prompt-area">
            <div className="vd-prompt-head">
              <span className="eyebrow">当前提示词</span>
              {!editing && (
                <button className="vd-btn-tool" onClick={startEdit} title="编辑提示词">
                  <Pencil size={11} /> 改
                </button>
              )}
            </div>
            {editing ? (
              <div className="vd-editor-wrap">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="vd-prompt-editor"
                />
                <div className="vd-inline-actions">
                  <button className="vd-btn-tool" onClick={cancelEdit}>取消</button>
                  <button className="vd-btn-tool vd-btn-tool--danger" onClick={saveEdit}>
                    <Check size={11} /> 保存为新版本
                  </button>
                </div>
              </div>
            ) : (
              <div className="vd-prompt-text">{promptText}</div>
            )}
            <div className="vd-version-wrap">
              <PromptVersionStack
                versions={promptVersions}
                onAddVersion={handleAddPromptVersion}
                selectedIdx={selectedVersionIdx}
                onSelectVersion={setSelectedVersionIdx}
              />
            </div>
          </div>

          <div className="vd-actions">
            <button className="vd-btn-main" onClick={handleCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? '已复制！' : '一键复制提示词'}
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
          </>
        ) : (
          <div className="vd-summary-pane">
            <SummariesTab
              workspaceId={workspaceId}
              itemId={itemId}
              allowSpeakerAware={hasSpeakerTranscript}
              templateCategory="style_video_with_frames"
            />
          </div>
        )}
      </div>

      {showPromptTools && pickerOpen && formatsCfg && (
        <FormatPicker
          allFormats={formatsCfg.formats.filter((f) => f.category === 'image' && !isJsonFormat(f))}
          selection={pickerSelection}
          onToggle={togglePickerId}
          onCancel={() => setPickerOpen(false)}
          onSave={savePicker}
        />
      )}

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

interface FormatPickerProps {
  allFormats: PromptFormat[]
  selection: string[]
  onToggle: (id: string) => void
  onCancel: () => void
  onSave: () => void
}

function FormatPicker({ allFormats, selection, onToggle, onCancel, onSave }: FormatPickerProps) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 50,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--srf)',
          border: '1px solid var(--bdr)',
          borderRadius: 14,
          padding: 18,
          width: 420,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>选择 3 个图片类格式</div>
          <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 4 }}>
            JSON 永远附加在末尾，不在此处枚举。已选 {selection.length} / 3。
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {allFormats.map((f) => {
            const checked = selection.includes(f.id)
            const index = checked ? selection.indexOf(f.id) + 1 : null
            return (
              <label
                key={f.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${checked ? 'var(--err)' : 'var(--bdr)'}`,
                  cursor: 'pointer',
                  background: checked ? 'rgba(255,77,126,0.08)' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(f.id)}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {f.name}
                    {index !== null && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--err)' }}>
                        #{index}
                      </span>
                    )}
                  </div>
                  {f.description && (
                    <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 2 }}>
                      {f.description}
                    </div>
                  )}
                </div>
              </label>
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-ghost" style={{ padding: '6px 12px' }} onClick={onCancel}>
            取消
          </button>
          <button
            onClick={onSave}
            disabled={selection.length !== 3}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              cursor: selection.length === 3 ? 'pointer' : 'not-allowed',
              background: selection.length === 3 ? 'var(--fg)' : 'var(--bgalt)',
              color: selection.length === 3 ? 'var(--bg)' : 'var(--mut)',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
