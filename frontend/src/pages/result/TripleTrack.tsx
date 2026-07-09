import { useEffect, useMemo, useRef } from 'react'
import type { VideoResultFrame, VideoResultTranscriptLine } from '@/services/workspaces'
// helpers.ts 暴露 nearestFrameIdx，避免本文件同时导出组件 + 工具函数（react-refresh 限制）

/**
 * 三轨时间轴（v1.1 §5.3）：
 *   轨道 1 镜头缩略图 / 轨道 2 字幕文本 / 轨道 3 提示词区间
 *
 * 受控组件：active 帧索引 + currentSec 由父组件传入，
 *   轨道内部只负责 auto-scroll 到 active，并把点击事件抛给父组件。
 */

const TRACK_COLORS = ['var(--acc)', 'var(--wrn)', 'var(--ok)', 'var(--fg2)', 'var(--mut)']

export interface TripleTrackProps {
  frames: VideoResultFrame[]
  transcript: VideoResultTranscriptLine[]
  activeFrame: number
  currentSec: number
  onFrameClick: (idx: number) => void
  onTranscriptClick: (line: VideoResultTranscriptLine) => void
}

function activeTranscriptIdx(
  transcript: VideoResultTranscriptLine[],
  currentSec: number,
): number {
  let best = 0
  for (let i = 0; i < transcript.length; i++) {
    if (transcript[i].t_sec <= currentSec) best = i
  }
  return best
}

export function TripleTrack({
  frames,
  transcript,
  activeFrame,
  currentSec,
  onFrameClick,
  onTranscriptClick,
}: TripleTrackProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const promptZoneRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  const trIdx = useMemo(() => activeTranscriptIdx(transcript, currentSec), [transcript, currentSec])

  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const child = el.children[activeFrame] as HTMLElement | undefined
    if (child) {
      el.scrollLeft = Math.max(0, child.offsetLeft - el.clientWidth / 2 + child.offsetWidth / 2)
    }
  }, [activeFrame])

  useEffect(() => {
    const el = promptZoneRef.current
    if (!el) return
    const child = el.children[activeFrame] as HTMLElement | undefined
    if (child) {
      el.scrollLeft = Math.max(0, child.offsetLeft - el.clientWidth / 2 + child.offsetWidth / 2)
    }
  }, [activeFrame])

  useEffect(() => {
    const el = transcriptRef.current
    if (!el) return
    const active = el.querySelector<HTMLElement>('[data-active="true"]')
    if (active) {
      el.scrollTop = Math.max(
        0,
        active.offsetTop - el.clientHeight / 2 + active.clientHeight / 2,
      )
    }
  }, [trIdx])

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0 20px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* ── 轨道 1 缩略图 ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
          <span className="eyebrow">轨道 1 · 镜头缩略图</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
            {frames.length} 帧 · 点击跳转
          </span>
        </div>
        <div
          ref={stripRef}
          style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 6 }}
        >
          {frames.map((f, i) => {
            const active = i === activeFrame
            return (
              <div
                key={f.idx}
                onClick={() => onFrameClick(i)}
                style={{
                  flexShrink: 0,
                  width: 96,
                  borderRadius: 8,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: `2px solid ${active ? 'var(--accent-pink)' : 'transparent'}`,
                  background: 'var(--bg-sunken)',
                  transform: active ? 'translateY(-2px)' : 'none',
                  transition: 'border-color 140ms, transform 140ms',
                }}
              >
                {f.image_path ? (
                  <img
                    src={f.image_path}
                    alt={f.title || f.ts}
                    style={{
                      width: '100%',
                      aspectRatio: '16/9',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '16/9',
                      background: `linear-gradient(135deg, ${
                        TRACK_COLORS[i % TRACK_COLORS.length]
                      }33, ${TRACK_COLORS[(i + 2) % TRACK_COLORS.length]}66)`,
                      display: 'grid',
                      placeItems: 'center',
                      color: 'rgba(255,255,255,0.85)',
                      fontFamily: 'var(--mono)',
                      fontSize: 11,
                    }}
                  >
                    {f.ts}
                  </div>
                )}
                <div className="mono" style={{ fontSize: 9, color: 'var(--ink-4)', padding: '3px 5px 0' }}>
                  {f.ts}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    padding: '1px 5px 5px',
                    fontWeight: active ? 600 : 400,
                    color: active ? 'var(--accent-pink)' : 'var(--ink-2)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {f.title}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 轨道 2 字幕 ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
          <span className="eyebrow">轨道 2 · 字幕文本</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
            点击行跳转 · 自动高亮
          </span>
        </div>
        <div
          ref={transcriptRef}
          style={{
            maxHeight: 185,
            overflowY: 'auto',
            background: 'var(--bg-elev)',
            border: '1px solid var(--line)',
            borderRadius: 14,
            padding: 4,
          }}
        >
          {transcript.map((l, i) => (
            <div
              key={`${l.t_sec}-${i}`}
              className="tr-line"
              data-active={i === trIdx}
              onClick={() => onTranscriptClick(l)}
            >
              <span className="ts">{l.t_str}</span>
              <span className="txt">{l.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 轨道 3 提示词区间 ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
          <span className="eyebrow">轨道 3 · 提示词区间</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
            点击切换到对应帧
          </span>
        </div>
        <div
          ref={promptZoneRef}
          style={{
            display: 'flex',
            gap: 5,
            background: 'var(--bg-elev)',
            border: '1px solid var(--line)',
            borderRadius: 14,
            padding: 8,
            overflowX: 'auto',
          }}
        >
          {frames.map((f, i) => {
            const on = i === activeFrame
            const col = TRACK_COLORS[i % TRACK_COLORS.length]
            const tagFlat = Object.values(f.tags ?? {}).flat().slice(0, 2)
            return (
              <div
                key={f.idx}
                onClick={() => onFrameClick(i)}
                style={{
                  flexShrink: 0,
                  width: 118,
                  padding: '9px 10px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: on ? col : 'var(--bg-sunken)',
                  border: `1.5px solid ${on ? col : 'transparent'}`,
                  transition: 'all 160ms ease',
                }}
              >
                <div
                  className="mono"
                  style={{
                    fontSize: 9,
                    marginBottom: 4,
                    color: on ? 'rgba(255,255,255,0.7)' : 'var(--ink-4)',
                  }}
                >
                  {f.ts}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    lineHeight: 1.45,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    color: on ? '#fff' : 'var(--ink-3)',
                  }}
                >
                  {(f.prompt_mj ?? '').substring(0, 65)}{f.prompt_mj && f.prompt_mj.length > 0 ? '…' : ''}
                </div>
                <div style={{ display: 'flex', gap: 3, marginTop: 6, flexWrap: 'wrap' }}>
                  {tagFlat.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: on ? 'rgba(255,255,255,0.22)' : 'var(--bg-elev)',
                        color: on ? '#fff' : 'var(--ink-3)',
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
