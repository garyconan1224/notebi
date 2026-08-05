import { useMemo } from 'react'

import type { NoteChapter } from '@/types/workspace'

export interface TimedFrame {
  sec: number
  url: string
}

export const CHAPTER_TIMELINE_MAX_FRAMES = 12

function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 章节对齐截帧：有章节时每章取「章节起点附近最接近」的帧（章内优先，其次最近全局帧），
 * 无章节时按时间均匀取样。与后端 summary_generator 配图候选规则一致。
 */
export function pickChapterAlignedFrames(
  frames: TimedFrame[],
  chapters: Array<Pick<NoteChapter, 'start' | 'end'>>,
  maxFrames = CHAPTER_TIMELINE_MAX_FRAMES,
): TimedFrame[] {
  const usable = frames
    .filter((frame) => Number.isFinite(frame.sec) && frame.sec >= 0 && Boolean(frame.url))
    .sort((a, b) => a.sec - b.sec)
  if (usable.length === 0 || maxFrames <= 0) return []

  if (chapters.length === 0) {
    if (usable.length <= maxFrames) return usable
    return Array.from({ length: maxFrames }, (_, index) => (
      usable[Math.round((index * (usable.length - 1)) / (maxFrames - 1))]
    ))
  }

  const picked: TimedFrame[] = []
  const seen = new Set<string>()
  const pick = (frame: TimedFrame) => {
    const key = `${frame.sec}-${frame.url}`
    if (seen.has(key) || picked.length >= maxFrames) return
    seen.add(key)
    picked.push(frame)
  }

  for (const chapter of chapters) {
    const start = Math.max(0, Number(chapter.start) || 0)
    const end = Math.max(start, Number(chapter.end) || start)
    const inside = usable.filter((frame) => frame.sec >= start && frame.sec <= end)
    if (inside.length > 0) {
      pick(inside.reduce((best, frame) =>
        Math.abs(frame.sec - start) < Math.abs(best.sec - start) ? frame : best))
    } else {
      pick(usable.reduce((best, frame) =>
        Math.abs(frame.sec - start) < Math.abs(best.sec - start) ? frame : best))
    }
  }

  if (picked.length === 0) return usable.slice(0, maxFrames)
  return picked.sort((a, b) => a.sec - b.sec)
}

interface ChapterTimelineStripProps {
  frames: TimedFrame[]
  chapters: NoteChapter[]
  duration: number
  currentTime: number
  onSeek: (sec: number) => void
}

/**
 * Q3：字幕时间轴与视频截帧融合为一条轨。
 *
 * 单条时间轨上按比例绘制章节段，并在对应时间点嵌入截帧缩略图；
 * 点击章节段/缩略图均可跳转。无章节时只展示对齐后的截帧。
 */
export function ChapterTimelineStrip({
  frames,
  chapters,
  duration,
  currentTime,
  onSeek,
}: ChapterTimelineStripProps) {
  const effectiveDuration = duration > 0 ? duration : Math.max(
    1,
    ...frames.map((frame) => frame.sec),
    ...chapters.map((chapter) => Number(chapter.end) || Number(chapter.start) || 0),
  )

  const alignedFrames = useMemo(
    () => pickChapterAlignedFrames(frames, chapters),
    [frames, chapters],
  )
  const usableChapters = chapters
    .filter((chapter) => Number.isFinite(Number(chapter.start)))
    .map((chapter) => ({
      ...chapter,
      start: Math.max(0, Number(chapter.start)),
      end: Math.max(Number(chapter.start), Number(chapter.end) || Number(chapter.start)),
    }))

  if (alignedFrames.length === 0 && usableChapters.length === 0) return null

  const pct = (sec: number) => `${Math.min(100, Math.max(0, (sec / effectiveDuration) * 100))}%`

  return (
    <div className="nibi-chapter-timeline" role="group" aria-label="章节与画面时间轴">
      <div className="nibi-chapter-timeline-track">
        {usableChapters.map((chapter) => {
          const active = currentTime >= chapter.start && currentTime <= chapter.end
          return (
            <button
              key={`${chapter.start}-${chapter.title}`}
              type="button"
              className={`nibi-chapter-timeline-seg${active ? ' is-active' : ''}`}
              style={{ left: pct(chapter.start), width: pct(chapter.end - chapter.start) }}
              title={`${chapter.title || '章节'} · ${formatTimecode(chapter.start)}`}
              aria-label={`跳到章节 ${chapter.title || formatTimecode(chapter.start)}`}
              onClick={() => onSeek(chapter.start)}
            >
              <span>{chapter.title || formatTimecode(chapter.start)}</span>
            </button>
          )
        })}
        {alignedFrames.map((frame) => (
          <button
            key={`${frame.sec}-${frame.url}`}
            type="button"
            className="nibi-chapter-timeline-frame"
            style={{ left: pct(frame.sec) }}
            onClick={() => onSeek(frame.sec)}
            title={`跳转到 ${formatTimecode(frame.sec)}`}
            aria-label={`跳转到 ${formatTimecode(frame.sec)}`}
          >
            <img src={frame.url} alt="" loading="lazy" />
            <span>{formatTimecode(frame.sec)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default ChapterTimelineStrip
