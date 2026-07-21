import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Download, Loader2, MessageSquare, RotateCcw } from 'lucide-react'

import {
  type AudioResult,
  type ImageResult,
  type TextResult,
  type VideoResult,
  downloadExport,
  getAudioItemResult,
  getImageResult,
  getItemResult,
  getTextItemResult,
  getWorkspace,
} from '@/services/workspaces'
import {
  type ItemType,
  type WorkspaceItem,
  type WorkspaceRecord,
  ITEM_TYPE_TEXT,
} from '@/types/workspace'
import { ItemTagsPanel } from '@/components/workspace/ItemTagsPanel'
import { isFeatureEnabled } from '@/config/product'

import '../tokens.css'
import './overview.css'
import { resolveItemRoute } from '@/lib/resolveItemRoute'

type ItemResult = VideoResult | AudioResult | ImageResult | TextResult

type PageState =
  | { kind: 'loading' }
  | { kind: 'ready'; workspace: WorkspaceRecord; item: WorkspaceItem; result: ItemResult }
  | { kind: 'processing'; workspace: WorkspaceRecord; item: WorkspaceItem }
  | { kind: 'task_failed'; workspace: WorkspaceRecord; item: WorkspaceItem; error: string; taskId?: string }
  | { kind: 'error'; message: string }

type TimelineLine = { t_sec?: number; t_str?: string; text: string }

function noteRouteForItem(workspaceId: string, itemId: string): string {
  return `/workspaces/${workspaceId}/items/${itemId}/note`
}

function titleFromFilename(filename: unknown): string {
  const raw = typeof filename === 'string' ? filename.trim() : ''
  if (!raw) return ''
  const name = raw.split('/').pop() || raw
  return name.replace(/\.[^.]+$/, '')
}

function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`
}

/** 从 result 中提取摘要文本（按类型取不同字段） */
function extractSummary(itemType: ItemType, result: ItemResult): string | null {
  if (itemType === 'video') {
    const r = result as VideoResult & { summary?: string }
    // N7b: 优先用 LLM 字幕总结，回退到第一帧 description
    return r.summary || (r.frames?.[0]?.description ?? null)
  }
  if (itemType === 'audio') {
    return (result as AudioResult).summary || null
  }
  if (itemType === 'text') {
    const s = (result as TextResult).summary
    if (typeof s === 'string') return s
    if (s && typeof s === 'object') return s.abstract || null
    return null
  }
  if (itemType === 'image') {
    return (result as ImageResult).description || null
  }
  return null
}

/** 从 result 中提取转录预览文本 */
function extractTranscriptPreview(itemType: ItemType, result: ItemResult): string {
  let lines: { text: string }[] = []
  if (itemType === 'video') {
    // N7b 路径 1: transcript 可能是 string（旧数据兼容），需防御
    const raw = (result as { transcript?: unknown }).transcript
    if (Array.isArray(raw)) lines = raw as VideoResult['transcript']
    else if (typeof raw === 'string') return raw.slice(0, 500)
  } else if (itemType === 'audio') {
    const raw = (result as AudioResult).transcript
    if (Array.isArray(raw)) lines = raw
    else if (typeof raw === 'string') return raw.slice(0, 500)
  }
  if (!lines.length) return ''
  const full = lines.map((l) => l.text).join('\n')
  return full.slice(0, 500)
}

function extractAudioTimelineLines(result: AudioResult): TimelineLine[] {
  if (Array.isArray(result.transcript) && result.transcript.length > 0) {
    return result.transcript.map((seg) => ({
      t_sec: seg.t_sec ?? 0,
      t_str: seg.t_str ?? formatSec(seg.t_sec ?? 0),
      text: seg.text || '',
    }))
  }
  if (Array.isArray(result.transcript_segments) && result.transcript_segments.length > 0) {
    return result.transcript_segments.map((seg) => ({
      t_sec: seg.start ?? seg.t_sec ?? 0,
      t_str: formatSec(seg.start ?? seg.t_sec ?? 0),
      text: seg.text || '',
    }))
  }
  return []
}

/** 转录总段数 */
function extractTranscriptCount(itemType: ItemType, result: ItemResult): number {
  if (itemType === 'video') return (result as VideoResult).tracks_meta?.transcript_count ?? 0
  if (itemType === 'audio') return (result as AudioResult).tracks_meta?.transcript_count ?? 0
  if (itemType === 'text') return (result as TextResult).char_count ?? 0
  return 0
}

/** 时长（秒） */
function extractDuration(itemType: ItemType, result: ItemResult): number {
  if (itemType === 'video') return (result as VideoResult).tracks_meta?.total_sec ?? 0
  if (itemType === 'audio') return (result as AudioResult).tracks_meta?.total_sec ?? 0
  return 0
}

/** 关键帧数（仅视频） */
function extractFrameCount(result: VideoResult): number {
  return result.frames?.length ?? result.tracks_meta?.frame_count ?? 0
}

export default function ResultsOverview() {
  const { workspaceId = '', itemId = '' } = useParams<{ workspaceId: string; itemId: string }>()
  const navigate = useNavigate()
  const [pageState, setPageState] = useState<PageState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const ws = await getWorkspace(workspaceId)
        if (cancelled) return
        const item = ws.items.find((it) => it.item_id === itemId)
        if (!item) {
          setPageState({ kind: 'error', message: '素材不存在' })
          return
        }
        // R4.2: 笔记向素材访问 /overview 时自动跳转到 /note；NoteBi 下也不展示复刻分支。
        if (item.preflight?.intent === 'replica' && !isFeatureEnabled('showReplica')) {
          navigate(noteRouteForItem(workspaceId, item.item_id), { replace: true })
          return
        }
        if (item.preflight?.intent !== 'replica') {
          navigate(resolveItemRoute(workspaceId, item), { replace: true })
          return
        }

        let result: ItemResult
        switch (item.type) {
          case 'video':
            result = await getItemResult(workspaceId, itemId)
            break
          case 'audio':
            result = await getAudioItemResult(workspaceId, itemId)
            break
          case 'image':
            result = await getImageResult(workspaceId, itemId)
            break
          case 'text':
            result = await getTextItemResult(workspaceId, itemId)
            break
          default:
            setPageState({ kind: 'error', message: `不支持的类型: ${item.type}` })
            return
        }
        if (cancelled) return
        // R18.1.3: 任务已失败时显示 ErrorState，不回落 demo
        const raw = result as unknown as Record<string, unknown>
        if (raw.source === 'task_failed') {
          setPageState({
            kind: 'task_failed',
            workspace: ws,
            item,
            error: String(raw.error || '未知错误'),
            taskId: raw.task_id ? String(raw.task_id) : undefined,
          })
          return
        }
        // 素材仍在处理中且后端尚未填充真数据（返回 demo fixture）时，不渲染 demo
        // 假完成态，而是显示「分析进行中」并引导回处理页跟进度。
        if (item.status === 'processing' && raw.source === 'demo_fixture') {
          setPageState({ kind: 'processing', workspace: ws, item })
          return
        }
        setPageState({ kind: 'ready', workspace: ws, item, result })
      } catch (err: unknown) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '加载结果失败'
        setPageState({ kind: 'error', message })
      }
    }

    load()
    return () => { cancelled = true }
  }, [workspaceId, itemId])

  const handleExport = async () => {
    try {
      await downloadExport(workspaceId, itemId)
    } catch {
      // downloadExport 内部已 toast
    }
  }

  // ── Loading ──
  if (pageState.kind === 'loading') {
    return (
      <div className="vm-overview-scope" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <span className="mono" style={{ color: 'var(--ink-3)' }}>加载结果总览…</span>
      </div>
    )
  }

  // ── Processing（分析进行中，尚无真数据）──
  if (pageState.kind === 'processing') {
    const { workspace, item } = pageState
    const wid = workspace.workspace_id
    const latestTaskId = item.related_task_ids[item.related_task_ids.length - 1]
    return (
      <div className="vm-overview-scope" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent-green)' }} />
        <span style={{ fontWeight: 600 }}>分析进行中…</span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          结果尚未生成，请稍候或回到处理页查看进度
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-ghost" style={{ padding: '6px 12px' }} onClick={() => navigate(-1)}>
            <ArrowLeft size={14} /> 返回
          </button>
          {latestTaskId && (
            <button
              className="btn-ghost"
              style={{ padding: '6px 12px', border: '1px solid var(--line-strong)', borderRadius: 8 }}
              onClick={() => navigate(`/processing/${latestTaskId}`, { state: { workspaceId: wid, itemId: item.item_id } })}
            >
              查看处理进度 <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Error ──
  if (pageState.kind === 'error') {
    return (
      <div className="vm-overview-scope" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <span style={{ color: 'var(--accent-pink)', fontWeight: 600 }}>{pageState.message}</span>
        <button className="btn-ghost" style={{ padding: '6px 12px' }} onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>
      </div>
    )
  }

  // ── Task Failed ──
  if (pageState.kind === 'task_failed') {
    const { workspace, item, error, taskId } = pageState
    const wid = workspace.workspace_id
    return (
      <div className="vm-overview-scope" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="ov-nav">
          <button className="btn-ghost" onClick={() => navigate(-1)}>
            <ArrowLeft size={13} /> 任务中心
          </button>
          <span className="ov-sep" />
          <span className="ov-title">任务失败</span>
        </div>
        <div className="ov-main" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div className="ov-card" style={{ maxWidth: 480, textAlign: 'center', borderColor: 'var(--err)' }}>
            <AlertTriangle size={32} style={{ color: 'var(--accent-pink)', marginBottom: 12 }} />
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>处理失败</h2>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 16px', lineHeight: 1.6 }}>
              该素材的任务处理过程中出现错误，无法生成结果。
            </p>
            <div style={{
              background: 'var(--bg-sunken)',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 20,
              fontSize: 12,
              fontFamily: 'var(--mono)',
              color: 'var(--accent-pink)',
              textAlign: 'left',
              wordBreak: 'break-all',
            }}>
              {error}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                className="btn-ghost"
                style={{ padding: '8px 16px', border: '1px solid var(--line-strong)', borderRadius: 8 }}
                onClick={() => navigate(-1)}
              >
                <ArrowLeft size={14} /> 返回
              </button>
              <button
                className="btn-ghost"
                style={{
                  padding: '8px 16px',
                  background: 'var(--accent-pink)',
                  color: '#fff',
                  borderRadius: 8,
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                }}
                onClick={() => {
                  if (taskId) {
                    navigate(`/processing/${taskId}`, {
                      state: { workspaceId: wid, itemId: item.item_id },
                    })
                  }
                }}
              >
                <RotateCcw size={14} /> 重试
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Ready ──
  const { item, result } = pageState
  const itemType = item.type
  const title = (
    (result as VideoResult).video?.title ||
    (result as { video_title?: string }).video_title ||
    (result as AudioResult).audio?.title ||
    titleFromFilename((result as AudioResult).audio?.filename) ||
    (result as TextResult).title ||
    item.name ||
    ITEM_TYPE_TEXT[itemType]
  )
  const summary = extractSummary(itemType, result)
  const transcriptPreview = extractTranscriptPreview(itemType, result)
  const transcriptCount = extractTranscriptCount(itemType, result)
  const duration = extractDuration(itemType, result)
  const showTimeline = itemType === 'video' || itemType === 'audio'

  return (
    <div className="vm-overview-scope" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Nav bar */}
      <div className="ov-nav">
        <button className="btn-ghost" onClick={() => navigate(-1)}>
          <ArrowLeft size={13} /> 任务中心
        </button>
        <span className="ov-sep" />
        <span className="ov-title">{title}</span>
        <span className="kw mono" style={{ fontSize: 10, flexShrink: 0 }}>
          {ITEM_TYPE_TEXT[itemType].toUpperCase()}
          {duration > 0 && ` · ${formatSec(duration)}`}
        </span>
        <span
          className="ov-status-chip"
          style={{
            background: item.status === 'done' ? 'var(--okl)' : item.status === 'failed' ? 'var(--errl)' : 'var(--bg-sunken)',
            color: item.status === 'done' ? 'var(--accent-green)' : item.status === 'failed' ? 'var(--accent-pink)' : item.status === 'partial' ? 'var(--accent-2)' : 'var(--ink-3)',
          }}
        >
          <span className="dot" style={{ background: item.status === 'done' ? 'var(--accent-green)' : item.status === 'failed' ? 'var(--accent-pink)' : item.status === 'partial' ? 'var(--accent-2)' : 'var(--ink-4)' }} />
          {item.status === 'done' ? '完成' : item.status === 'processing' ? '处理中' : item.status === 'partial' ? '部分完成' : item.status === 'failed' ? '失败' : item.status}
        </span>
        {result.source === 'demo_fixture' && (
          <span className="mono" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'var(--accent-warm)', color: '#fff', fontWeight: 600 }}>DEMO</span>
        )}
      </div>

      {/* R18.1.3: demo_fixture 黄色 callout */}
      {result.source === 'demo_fixture' && (
        <div style={{
          margin: '0 20px',
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(255, 184, 76, 0.12)',
          border: '1px solid rgba(255, 184, 76, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: 'var(--ink-2)',
          flexShrink: 0,
        }}>
          <AlertTriangle size={14} style={{ color: 'var(--accent-warm)', flexShrink: 0 }} />
          <span>当前显示的是 <strong>示例数据</strong>（DEMO）。该素材的任务可能未成功完成，请返回任务中心重试。</span>
        </div>
      )}

      {/* Tags */}
      <div style={{ padding: '10px 20px 0', flexShrink: 0 }}>
        <ItemTagsPanel workspaceId={workspaceId} itemId={itemId} />
      </div>

      {/* Main content — 2 列网格 */}
      <div className="ov-main ov-grid">
        {/* ── 左主列 ──────────────────────────────── */}
        <div className="ov-col-left">
          {/* Summary card */}
          {summary && (
            <div className="ov-card">
              <div className="ov-card-head">
                <div>
                  <div className="eyebrow">OVERVIEW · {ITEM_TYPE_TEXT[itemType]}</div>
                  <h2 style={{ marginTop: 4 }}>内容摘要</h2>
                </div>
              </div>
              <div className="ov-summary-text">{summary}</div>
            </div>
          )}

          {/* Timeline card (video) — 保持原样 */}
          {showTimeline && itemType === 'video' && (result as VideoResult).frames?.length > 0 && (
            <div className="ov-card">
              <div className="ov-card-head">
                <h2>时间轴</h2>
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  前 {Math.min(10, (result as VideoResult).frames.length)} 帧
                </span>
              </div>
              <div className="ov-timeline-strip">
                {(result as VideoResult).frames.slice(0, 10).map((f, idx) => (
                  <div key={f.idx ?? `frame-${idx}`} className="ov-tl-frame">
                    <div className="ov-tl-thumb">{f.ts}</div>
                    <div className="ov-tl-ts">{f.shot_type}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline card (audio) — 任务 4 新形态 */}
          {showTimeline && itemType === 'audio' && (() => {
            const lines = extractAudioTimelineLines(result as AudioResult)
            if (lines.length === 0) return null
            const totalSec = extractDuration('audio', result) || (lines.length > 0 ? (lines[lines.length - 1].t_sec ?? 0) : 0)
            return (
              <div className="ov-card">
                <div className="ov-card-head">
                  <h2>时间轴</h2>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    时间分布 · 共 {lines.length} 段
                  </span>
                </div>
                {/* 水平 bar */}
                <div className="ov-audio-bar-wrap">
                  <div className="ov-audio-bar">
                    {lines.map((l, idx) => {
                      const pct = totalSec > 0 ? ((l.t_sec ?? 0) / totalSec) * 100 : 0
                      return (
                        <div
                          key={idx}
                          className="ov-audio-dot"
                          style={{ left: `${Math.min(pct, 100)}%` }}
                          title={`${l.t_str || formatSec(l.t_sec ?? 0)} — ${l.text?.slice(0, 40)}`}
                        />
                      )
                    })}
                  </div>
                  <div className="ov-audio-bar-labels">
                    <span>00:00</span>
                    <span>{formatSec(totalSec)}</span>
                  </div>
                </div>
                {/* 前 10 段列表 */}
                <div className="ov-audio-seg-list">
                  {lines.slice(0, 10).map((l, idx) => (
                    <div
                      key={idx}
                      className="ov-audio-seg-item"
                      onClick={() => navigate(`/workspaces/${workspaceId}/items/${itemId}/note`)}
                    >
                      <span className="ov-audio-seg-ts">{l.t_str || formatSec(l.t_sec ?? 0)}</span>
                      <span className="ov-audio-seg-text">{l.text?.slice(0, 50)}{l.text && l.text.length > 50 ? '…' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* 转录预览 — 仅非 audio 类型保留（audio 用时间轴替代） */}
          {transcriptPreview && itemType !== 'audio' && (
            <div className="ov-card">
              <div className="ov-card-head">
                <h2>转录预览</h2>
                <button
                  className="btn-ghost"
                  style={{ fontSize: 11, height: 24, padding: '0 8px' }}
                  onClick={() => pageState.kind === 'ready' && navigate(resolveItemRoute(workspaceId, pageState.item))}
                >
                  查看全部
                </button>
              </div>
              <div className="ov-transcript-preview">
                {transcriptPreview}
              </div>
            </div>
          )}
        </div>

        {/* ── 右辅列 ──────────────────────────────── */}
        <div className="ov-col-right">
          {/* Stat 卡片 */}
          <div className="ov-stat-cards">
            {duration > 0 && (
              <div className="ov-stat-mini">
                <div className="label">时长</div>
                <div className="value">{formatSec(duration)}</div>
              </div>
            )}
            {itemType === 'video' && (
              <div className="ov-stat-mini">
                <div className="label">关键帧</div>
                <div className="value">{extractFrameCount(result as VideoResult)}</div>
              </div>
            )}
            {transcriptCount > 0 && (
              <div className="ov-stat-mini">
                <div className="label">{itemType === 'text' ? '字符数' : '转录段落'}</div>
                <div className="value">{transcriptCount}</div>
              </div>
            )}
          </div>

          {/* 打开详情 — 大按钮 */}
          <button
            className="ov-detail-btn"
            onClick={() => pageState.kind === 'ready' && navigate(resolveItemRoute(workspaceId, pageState.item))}
          >
            打开详情 <ArrowRight size={14} />
          </button>

          {/* Action 小列表 */}
          <div className="ov-side-actions">
            <button
              className="ov-side-action"
              onClick={() => pageState.kind === 'ready' && navigate(resolveItemRoute(workspaceId, pageState.item))}
            >
              <BookOpen size={14} />
              <span>{ITEM_TYPE_TEXT[itemType]}详情</span>
            </button>
            <button
              className="ov-side-action"
              onClick={() => navigate(`/workspaces/${workspaceId}?tab=chat`)}
            >
              <MessageSquare size={14} />
              <span>LLM 对话</span>
            </button>
            {isFeatureEnabled('showReplica') && (
              <button className="ov-side-action" onClick={handleExport}>
                <Download size={14} />
                <span>导出工作包</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
