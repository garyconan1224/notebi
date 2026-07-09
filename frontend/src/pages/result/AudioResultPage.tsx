import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// remarkGfm 类型与 react-markdown 不完全兼容，统一 cast 一次
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const remarkPlugins: any[] = [remarkGfm]

import { ArrowLeft, Download, FileText, Mic, Music, Pause, Pencil, Play, Wand2 } from 'lucide-react'

import { toast } from 'sonner'
import {
  type AudioResult,
  downloadSubtitles,
  getAudioItemResult,
  updateSpeakerMap,
  updateTranscriptSegment,
} from '@/services/workspaces'

import './tokens.css'
import './audio-result.css'

import { SummariesTab } from '@/components/SummariesTab'
import { MusicTab } from '@/components/result/audio/MusicTab'

/** deterministic 波形高度（从 seed 生成伪随机序列） */
function generateWaveform(length: number, height: number): number[] {
  return Array.from({ length }, (_, i) => {
    const v =
      Math.sin(i * 0.45) * 0.4 +
      Math.sin(i * 0.15 + 1.2) * 0.35 +
      Math.sin(i * 0.9 + 0.5) * 0.25
    return 10 + (v * 0.5 + 0.5) * (height - 14)
  })
}

interface WaveformProps {
  progress: number
  height?: number
  bars?: number
  onClick?: (progress: number) => void
}

function Waveform({ progress, height = 48, bars = 100, onClick }: WaveformProps) {
  const heights = useMemo(() => generateWaveform(bars, height), [bars, height])
  const containerRef = useRef<HTMLDivElement>(null)

  const handleClick = (e: React.MouseEvent) => {
    if (!onClick || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    onClick((e.clientX - rect.left) / rect.width)
  }

  return (
    <div ref={containerRef} className="ad-waveform" style={{ height }} onClick={handleClick}>
      {heights.map((h, i) => {
        const passed = i / bars < progress
        return (
          <div
            key={i}
            className={`ad-bar ${passed ? 'passed' : 'future'}`}
            style={{ height: `${h}px` }}
          />
        )
      })}
    </div>
  )
}

const SPEAKER_COLORS = [
  'hsl(210, 65%, 55%)',
  'hsl(340, 60%, 55%)',
  'hsl(160, 55%, 45%)',
  'hsl(30, 70%, 55%)',
  'hsl(270, 55%, 55%)',
  'hsl(50, 65%, 48%)',
]
function speakerColor(speakerId: string): string {
  let hash = 0
  for (const ch of speakerId) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return SPEAKER_COLORS[Math.abs(hash) % SPEAKER_COLORS.length]
}

function speakerDisplayName(speakerId: string, speakerMap: Record<string, string>): string {
  return speakerMap[speakerId] || speakerId.replace('SPEAKER_', 'S')
}

export default function AudioResultPage() {
  const { workspaceId = '', itemId = '' } = useParams<{ workspaceId: string; itemId: string }>()
  const navigate = useNavigate()

  type FetchState =
    | { kind: 'loading' }
    | { kind: 'ready'; data: AudioResult }
    | { kind: 'error'; message: string }
  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'loading' })

  const [currentSec, setCurrentSec] = useState(0)
  const [playing, setPlaying] = useState(false)
  type TabId = 'transcript' | 'music' | 'summary' | 'vocal' | 'music_transcribe' | 'prompts'
  const [activeTab, setActiveTab] = useState<TabId>('transcript')
  const [exportOpen, setExportOpen] = useState(false)
  const [exportWithSpeaker, setExportWithSpeaker] = useState(false)
  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({})
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editingSegmentIdx, setEditingSegmentIdx] = useState<number | null>(null)
  const [segmentEditText, setSegmentEditText] = useState('')
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(() =>
    localStorage.getItem('audio-demo-banner-dismissed') === 'true'
  )

  const handleExportSubtitles = async (format: 'srt' | 'vtt' | 'ass') => {
    setExportOpen(false)
    try {
      await downloadSubtitles(workspaceId, itemId, format, exportWithSpeaker)
    } catch (err: unknown) {
      toast.error('字幕导出失败：' + (err instanceof Error ? err.message : '未知错误'))
    }
  }

  const handleDownloadAudio = useCallback(() => {
    if (fetchState.kind !== 'ready') return
    const url = fetchState.data.audio.url
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = fetchState.data.audio.filename || fetchState.data.audio.title || 'audio'
    a.click()
  }, [fetchState])

  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    let cancelled = false
    getAudioItemResult(workspaceId, itemId)
      .then((data) => {
        if (!cancelled) setFetchState({ kind: 'ready', data })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '加载音频结果失败'
        setFetchState({ kind: 'error', message })
      })
    return () => { cancelled = true }
  }, [workspaceId, itemId])

  const result = fetchState.kind === 'ready' ? fetchState.data : null

  // 按数据条件过滤可用 tabs
  const visibleTabs = useMemo(() => {
    const all: { id: TabId; label: string; icon: typeof FileText }[] = [
      { id: 'transcript', label: '转录', icon: FileText },
      { id: 'summary', label: '总结', icon: FileText },
    ]
    if (result?.music_segments?.length || result?.music_mode) {
      all.push({ id: 'music', label: '音乐分析', icon: Music })
    }
    if (result?.vocal_url || result?.vocal_path) {
      all.push({ id: 'vocal', label: '人声分离', icon: Mic })
    }
    if (result?.music_transcription) {
      all.push({ id: 'music_transcribe', label: '音乐转写', icon: Music })
    }
    if (result?.prompt_output) {
      all.push({ id: 'prompts', label: '提示词', icon: Wand2 })
    }
    return all
  }, [result])

  // activeTab fallback: 当前 tab 被过滤掉时切到第一个可见 tab
  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.id === activeTab)) {
      setActiveTab(visibleTabs[0].id)
    }
  }, [visibleTabs, activeTab])

  // A3: music_mode → 默认切到音乐分析 tab
  useEffect(() => {
    if (result?.music_mode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab('music')
    }
  }, [result?.music_mode])

  // A2: initialize speaker_map from result
  useEffect(() => {
    if (result?.speaker_map) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSpeakerMap(result.speaker_map)
    }
  }, [result?.speaker_map])

  const transcriptSegments = useMemo(() => {
    // Prefer transcript_segments (has speaker + start/end from whisper)
    const segs = result?.transcript_segments
    if (Array.isArray(segs) && segs.length > 0) {
      return segs.map((seg) => ({
        t_sec: seg.start ?? seg.t_sec ?? 0,
        t_str: formatSec(seg.start ?? seg.t_sec ?? 0),
        text: seg.text || '',
        edited_text: seg.edited_text ?? undefined,
        start: seg.start,
        end: seg.end,
        speaker: seg.speaker,
      }))
    }
    // Fallback to transcript (display format or string)
    const raw = result?.transcript
    if (Array.isArray(raw)) return raw.map(l => ({ ...l, edited_text: undefined, start: undefined as number | undefined, end: undefined as number | undefined, speaker: undefined as string | undefined }))
    if (typeof raw === 'string' && raw.length > 0) {
      return [{ t_sec: 0, t_str: '00:00', text: raw, edited_text: undefined, start: undefined as number | undefined, end: undefined as number | undefined, speaker: undefined as string | undefined }]
    }
    return []
  }, [result])

  const speakerStats = useMemo(() => {
    const map = new Map<string, { count: number; durationSec: number }>()
    for (const seg of transcriptSegments) {
      if (!seg.speaker) continue
      const prev = map.get(seg.speaker) || { count: 0, durationSec: 0 }
      const dur = (seg.end || seg.t_sec || 0) - (seg.start || seg.t_sec || 0)
      map.set(seg.speaker, { count: prev.count + 1, durationSec: prev.durationSec + Math.max(0, dur) })
    }
    return map
  }, [transcriptSegments])

  const hasSpeakers = speakerStats.size > 0

  const totalSec = result?.tracks_meta?.total_sec ?? result?.audio?.duration_sec ?? 0
  const progress = totalSec > 0 ? Math.min(1, currentSec / totalSec) : 0

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) setCurrentSec(audioRef.current.currentTime)
  }, [])

  const handlePlayPause = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) el.play().catch(() => {})
    else el.pause()
  }, [])

  const handleSeek = useCallback((sec: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = sec
      setCurrentSec(sec)
    }
  }, [])

  const handleWaveformClick = useCallback(
    (p: number) => handleSeek(p * totalSec),
    [handleSeek, totalSec],
  )

  const handleSpeakerRename = useCallback(async (speakerId: string, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === speakerId) {
      setEditingSpeaker(null)
      return
    }
    const updated = { ...speakerMap, [speakerId]: trimmed }
    setSpeakerMap(updated) // optimistic
    setEditingSpeaker(null)
    try {
      await updateSpeakerMap(workspaceId, itemId, updated)
      toast.success('说话人标签已保存')
    } catch {
      setSpeakerMap(speakerMap) // rollback
      toast.error('保存失败，请重试')
    }
  }, [speakerMap, workspaceId, itemId])

  const handleSegmentEditSave = useCallback(async (idx: number) => {
    const trimmed = segmentEditText.trim()
    const original = transcriptSegments[idx]?.text || ''
    if (trimmed === original || (trimmed === '' && !transcriptSegments[idx]?.edited_text)) {
      setEditingSegmentIdx(null)
      return
    }
    try {
      await updateTranscriptSegment(workspaceId, itemId, idx, trimmed)
      // Update local state
      const segs = [...transcriptSegments]
      segs[idx] = { ...segs[idx], edited_text: trimmed || undefined }
      setFetchState((prev) => {
        if (prev.kind !== 'ready') return prev
        const results = { ...prev.data }
        const ts = [...(results.transcript_segments || [])]
        ts[idx] = { ...ts[idx], edited_text: trimmed || undefined }
        results.transcript_segments = ts
        return { kind: 'ready', data: results }
      })
      toast.success('字幕已保存')
    } catch {
      toast.error('保存失败，请重试')
    }
    setEditingSegmentIdx(null)
  }, [segmentEditText, transcriptSegments, workspaceId, itemId])

  const handleSegmentEditCancel = useCallback(() => {
    setEditingSegmentIdx(null)
    setSegmentEditText('')
  }, [])

  const handleSegmentRestore = useCallback(async (idx: number) => {
    try {
      await updateTranscriptSegment(workspaceId, itemId, idx, '')
      setFetchState((prev) => {
        if (prev.kind !== 'ready') return prev
        const results = { ...prev.data }
        const ts = [...(results.transcript_segments || [])]
        ts[idx] = { ...ts[idx], edited_text: undefined }
        results.transcript_segments = ts
        return { kind: 'ready', data: results }
      })
      toast.success('已恢复原文')
    } catch {
      toast.error('恢复失败，请重试')
    }
  }, [workspaceId, itemId])

  const activeLineIdx = useMemo(() => {
    if (!transcriptSegments.length) return -1
    let best = 0
    for (let i = 0; i < transcriptSegments.length; i++) {
      if (transcriptSegments[i].t_sec <= currentSec) best = i
      else break
    }
    return best
  }, [transcriptSegments, currentSec])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.code === 'Space') {
        e.preventDefault()
        handlePlayPause()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handlePlayPause])

  if (fetchState.kind === 'loading') {
    return (
      <div className="vm-audio-scope" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <span className="mono" style={{ color: 'var(--mut)' }}>加载音频结果…</span>
      </div>
    )
  }
  if (fetchState.kind === 'error' || !result) {
    return (
      <div className="vm-audio-scope" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <span style={{ color: 'var(--err)', fontWeight: 600 }}>
          {fetchState.kind === 'error' ? fetchState.message : '没有可显示的音频结果'}
        </span>
        <button className="btn-ghost" style={{ padding: '6px 12px' }} onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>
      </div>
    )
  }

  return (
    <div className="vm-audio-scope" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Nav bar */}
      <div className="vd-nav" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--bdr)', flexShrink: 0, background: 'var(--srf)' }}>
        <button className="btn-ghost" onClick={() => navigate(`/workspaces/${workspaceId}/items/${itemId}/overview`)} style={{ height: 28, padding: '0 10px', fontSize: 12 }}>
          <ArrowLeft size={13} /> 返回总览
        </button>
        <span className="vd-sep" />
        <span className="vd-title">{result.audio?.title || result.audio?.filename || '音频'}</span>
        <span className="kw mono" style={{ fontSize: 10, flexShrink: 0 }}>AUDIO · {result.audio?.duration_str || formatSec(totalSec)}</span>
        <button
          className="btn-ghost"
          style={{ height: 24, padding: '0 8px', fontSize: 11, gap: 4, marginLeft: 6, borderRadius: 4, border: '1px solid var(--border)' }}
          onClick={() => navigate(`/workspaces/${workspaceId}/items/${itemId}/note`)}
          title="打开统一笔记（NoteShell）"
        >
          <FileText size={12} /> 统一笔记 <span style={{ fontSize: 9, opacity: 0.6 }}>beta</span>
        </button>
        {result.source === 'demo_fixture' && (
          <span className="mono" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'var(--wrn)', color: '#fff', fontWeight: 600 }} title="demo fixture">DEMO</span>
        )}
        <div style={{ marginLeft: 'auto' }} />
        {result.audio.url && (
          <button className="btn-ghost" style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={handleDownloadAudio} title="导出音频">
            <Download size={13} /> 音频
          </button>
        )}
        <div style={{ position: 'relative' }}>
          <button className="btn-ghost" style={{ height: 28, padding: '0 10px', fontSize: 12 }} onClick={() => setExportOpen(!exportOpen)} title="导出字幕">
            <Download size={13} /> 字幕
          </button>
          {exportOpen && (
            <div className="vd-dropdown-menu" style={{ position: 'absolute', right: 0, top: 36, zIndex: 50, background: 'var(--srf)', border: '1px solid var(--bdr)', borderRadius: 8, padding: '4px 0', minWidth: 160, boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}>
              {/* 带说话人标注开关 */}
              {hasSpeakers && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--bdr)' }}>
                  <input
                    type="checkbox"
                    checked={exportWithSpeaker}
                    onChange={(e) => setExportWithSpeaker(e.target.checked)}
                    style={{ accentColor: 'var(--err)' }}
                  />
                  带说话人标注
                </label>
              )}
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

      {/* Demo 提示条 */}
      {result.source === 'demo_fixture' && !demoBannerDismissed && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 20px', background: 'color-mix(in srgb, var(--wrn) 8%, transparent)',
          borderBottom: '1px solid color-mix(in srgb, var(--wrn) 25%, transparent)',
          fontSize: 12, color: 'var(--fg2)', flexShrink: 0,
        }}>
          <span>当前为示例数据（任务未完成 / 未上传）。完成上传或处理后将自动显示真实结果。</span>
          <button
            className="btn-ghost"
            style={{ padding: '2px 6px', fontSize: 11, flexShrink: 0 }}
            onClick={() => { setDemoBannerDismissed(true); localStorage.setItem('audio-demo-banner-dismissed', 'true') }}
          >
            知道了
          </button>
        </div>
      )}

      {/* Waveform player */}
      <div className="ad-player-area">
        <div className="ad-player-row">
          <button className="ad-play-btn" onClick={handlePlayPause}>
            {playing ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
          </button>
          <Waveform progress={progress} height={48} bars={100} onClick={handleWaveformClick} />
          <div className="mono" style={{ fontSize: 12, color: 'var(--mut)', flexShrink: 0, minWidth: 80, textAlign: 'right' }}>
            {formatSec(currentSec)} / {result.audio?.duration_str || formatSec(totalSec)}
          </div>
        </div>
        <audio
          ref={audioRef}
          src={result.audio?.url || undefined}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          style={{ display: 'none' }}
        />
      </div>

      {/* A3: 音乐模式信息 banner */}
      {result.music_mode && (
        <div
          className="ad-info-banner"
          style={{
            background: 'var(--accent-warm-muted)',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Music size={16} style={{ color: 'var(--wrn)' }} />
          <span>已自动切换为音乐分析模式（未检测到足够人声）</span>
        </div>
      )}

      {/* Tab nav */}
      <div className="ad-tabs">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              className="ad-tab"
              data-active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={14} /> {tab.label}
            </button>
          )
        })}
      </div>

      {/* Content area */}
      <div className="ad-content" data-tab={activeTab}>
        {activeTab === 'transcript' && (
          <>
            {/* Speaker chip bar — A-2: click chip to rename */}
            {hasSpeakers && (
              <div className="ad-speaker-chips">
                {Array.from(speakerStats.entries()).map(([spkId]) => {
                  const displayName = speakerDisplayName(spkId, speakerMap)
                  const isEditing = editingSpeaker === spkId
                  return isEditing ? (
                    <input
                      key={spkId}
                      className="ad-speaker-chip-input"
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSpeakerRename(spkId, editValue)
                        if (e.key === 'Escape') setEditingSpeaker(null)
                      }}
                      onBlur={() => handleSpeakerRename(spkId, editValue)}
                      placeholder={displayName}
                    />
                  ) : (
                    <button
                      key={spkId}
                      className="ad-speaker-chip"
                      style={{ '--chip-color': speakerColor(spkId) } as React.CSSProperties}
                      onClick={() => { setEditingSpeaker(spkId); setEditValue(speakerMap[spkId] || '') }}
                      title="点击重命名"
                    >
                      <span className="ad-speaker-chip-dot" />
                      {displayName}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="ad-transcript-scroll">
              {transcriptSegments.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: 'var(--mut)' }}>
                  <FileText size={32} style={{ opacity: 0.3 }} />
                  <span style={{ fontSize: 13 }}>等待真实数据</span>
                  <span style={{ fontSize: 11 }}>转录结果将在分析完成后显示</span>
                </div>
              ) : (
                transcriptSegments.map((line, idx) => {
                  const displayText = line.edited_text ?? line.text
                  const isEdited = line.edited_text != null
                  const isEditing = editingSegmentIdx === idx
                  return (
                    <div
                      key={idx}
                      className="ad-tr-row"
                      data-active={idx === activeLineIdx}
                      data-edited={isEdited || undefined}
                      onClick={() => !isEditing && handleSeek(line.t_sec)}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setEditingSegmentIdx(idx)
                        setSegmentEditText(displayText)
                      }}
                    >
                      <span className="ad-tr-time">{line.t_str}</span>
                      <div
                        className="ad-tr-avatar"
                        style={{ background: line.speaker ? speakerColor(line.speaker) : 'var(--mut)' }}
                      >
                        {line.speaker
                          ? speakerDisplayName(line.speaker, speakerMap).charAt(0)
                          : String(idx + 1).slice(-1)}
                      </div>
                      <span className="ad-tr-text">
                        {line.speaker && hasSpeakers && (
                          <span className="ad-speaker-label" style={{ color: speakerColor(line.speaker), fontWeight: 600, fontSize: 11, marginRight: 6 }}>
                            {speakerDisplayName(line.speaker, speakerMap)}
                          </span>
                        )}
                        {isEditing ? (
                          <input
                            className="ad-tr-edit-input"
                            autoFocus
                            value={segmentEditText}
                            onChange={(e) => setSegmentEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSegmentEditSave(idx)
                              if (e.key === 'Escape') handleSegmentEditCancel()
                            }}
                            onBlur={() => handleSegmentEditSave(idx)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <>
                            {displayText}
                            {isEdited && (
                              <button
                                className="btn-ghost ad-tr-restore"
                                style={{ padding: '1px 4px', marginLeft: 6, fontSize: 10, opacity: 0.6 }}
                                onClick={(e) => { e.stopPropagation(); handleSegmentRestore(idx) }}
                                title="恢复原文"
                              >
                                恢复
                              </button>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                  )
                })
              )}
            </div>

            {/* Speaker summary sidebar */}
            <div className="ad-speaker-side">
              {hasSpeakers ? (
                <>
                  <div className="eyebrow" style={{ marginBottom: 14 }}>说话人</div>
                  {Array.from(speakerStats.entries()).map(([spkId, stats]) => {
                    const totalDur = Array.from(speakerStats.values()).reduce((a, b) => a + b.durationSec, 0)
                    const pct = totalDur > 0 ? (stats.durationSec / totalDur) * 100 : 0
                    const displayName = speakerDisplayName(spkId, speakerMap)
                    const isEditing = editingSpeaker === spkId
                    return (
                      <div key={spkId} className="ad-speaker-card">
                        <div className="ad-speaker-row">
                          <div className="ad-speaker-avatar" style={{ background: speakerColor(spkId) }}>
                            {displayName.charAt(0)}
                          </div>
                          {isEditing ? (
                            <input
                              className="ad-speaker-edit-input"
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSpeakerRename(spkId, editValue)
                                if (e.key === 'Escape') setEditingSpeaker(null)
                              }}
                              onBlur={() => handleSpeakerRename(spkId, editValue)}
                            />
                          ) : (
                            <>
                              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{displayName}</span>
                              <button
                                className="btn-ghost"
                                style={{ padding: '2px 6px', opacity: 0.5 }}
                                onClick={() => { setEditingSpeaker(spkId); setEditValue(speakerMap[spkId] || '') }}
                                title="重命名"
                              >
                                <Pencil size={12} />
                              </button>
                            </>
                          )}
                        </div>
                        <div className="ad-speaker-bar">
                          <div className="ad-speaker-bar-fill" style={{ width: `${pct}%`, background: speakerColor(spkId) }} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 4 }}>
                          {stats.count} 段 · {formatSec(stats.durationSec)}
                        </div>
                      </div>
                    )
                  })}
                  <hr style={{ border: 'none', borderTop: '1px solid var(--bdr)', margin: '16px 0' }} />
                </>
              ) : (
                <div className="eyebrow" style={{ marginBottom: 14 }}>转录统计</div>
              )}
              <div style={{ fontSize: 13, color: 'var(--fg2)', lineHeight: 1.8 }}>
                <div>转录行数：<strong>{transcriptSegments.length}</strong></div>
                <div>总时长：<strong>{result.audio?.duration_str || formatSec(totalSec)}</strong></div>
                {hasSpeakers && <div>说话人数：<strong>{speakerStats.size}</strong></div>}
              </div>
              {!hasSpeakers && (
                <div style={{ marginTop: 12, fontSize: 11, color: 'var(--mut)' }}>
                  提示：勾选「说话人音色区分」后可自动识别说话人
                </div>
              )}

              {/* 音频元信息卡（A-5） */}
              <hr style={{ border: 'none', borderTop: '1px solid var(--bdr)', margin: '16px 0' }} />
              <div className="eyebrow" style={{ marginBottom: 10 }}>音频信息</div>
              <div style={{ fontSize: 12, color: 'var(--mut)', lineHeight: 2 }}>
                <div>时长：<strong style={{ color: 'var(--fg2)' }}>{result.audio?.duration_str || formatSec(totalSec)}</strong></div>
                <div>来源：<span style={{ color: 'var(--fg2)' }}>{result.audio?.url ? '外部链接' : '本地文件'}</span></div>
                {result.audio?.filename && <div>文件名：<span style={{ color: 'var(--fg2)' }}>{result.audio.filename}</span></div>}
                {result.audio?.url && (
                  <div style={{ wordBreak: 'break-all' }}>
                    URL：<a href={result.audio.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--err)', fontSize: 11 }}>{result.audio.url.slice(0, 60)}{result.audio.url.length > 60 ? '…' : ''}</a>
                  </div>
                )}
              </div>

              {result.summary && (
                <div style={{ marginTop: 20 }}>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>摘要预览</div>
                  <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--mut)' }}>
                    {result.summary.slice(0, 200)}{result.summary.length > 200 ? '…' : ''}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'summary' && (
          <SummariesTab workspaceId={workspaceId} itemId={itemId} />
        )}

        {activeTab === 'vocal' && (
          <div className="ad-summary-scroll">
            {result.vocal_url ? (
              <>
                <div className="eyebrow" style={{ marginBottom: 8 }}>人声音频</div>
                <audio controls src={result.vocal_url} style={{ width: '100%', marginTop: 8 }} />
                {result.vocal_path && (
                  <div style={{ marginTop: 12, fontSize: 12, color: 'var(--mut)' }}>
                    文件：{result.vocal_path}
                  </div>
                )}
              </>
            ) : (
              <span className="mono" style={{ fontSize: 12, color: 'var(--mut)' }}>
                未勾选「输出人声音频」或后端能力开发中
              </span>
            )}
          </div>
        )}

        {activeTab === 'music' && (
          <div className="ad-summary-scroll">
            <MusicTab
              segments={result.music_segments || []}
              onSeek={handleSeek}
              workspaceId={workspaceId}
              itemId={itemId}
            />
          </div>
        )}

        {activeTab === 'music_transcribe' && (
          <div className="ad-summary-scroll">
            {result.music_transcription ? (
              <>
                <div className="eyebrow" style={{ marginBottom: 8 }}>音乐转写</div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--fg2)' }}>
                  <ReactMarkdown remarkPlugins={remarkPlugins}>
                    {result.music_transcription}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <span className="mono" style={{ fontSize: 12, color: 'var(--mut)' }}>
                未勾选「音乐转写」或后端能力开发中
              </span>
            )}
          </div>
        )}

        {activeTab === 'prompts' && (
          <div className="ad-summary-scroll">
            {result.prompt_output ? (
              <>
                <div className="eyebrow" style={{ marginBottom: 8 }}>提示词输出</div>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--fg2)' }}>
                  <ReactMarkdown remarkPlugins={remarkPlugins}>
                    {result.prompt_output}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <span className="mono" style={{ fontSize: 12, color: 'var(--mut)' }}>
                未勾选「提示词输出」或后端能力开发中
              </span>
            )}
          </div>
        )}
      </div>

    </div>
  )
}

function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`
}
