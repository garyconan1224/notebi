import type { NoteChapter } from '@/types/workspace'

export type EvidenceFrame = { sec: number; url: string }

function formatTimecode(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  const remainder = whole % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

/**
 * Keep a short, chronological evidence strip for a chapter instead of copying
 * every extracted frame into the note. If no frame falls inside the chapter,
 * the closest frame still gives the reader a usable visual anchor.
 */
export function selectChapterEvidenceFrames(
  frames: EvidenceFrame[],
  chapter: Pick<NoteChapter, 'start' | 'end'>,
  maxFrames = 4,
): EvidenceFrame[] {
  const candidates = frames.filter((frame) => frame.sec >= chapter.start && frame.sec <= chapter.end)
  if (candidates.length === 0) {
    const closest = frames.reduce<EvidenceFrame | null>((best, frame) => {
      if (!best) return frame
      return Math.abs(frame.sec - chapter.start) < Math.abs(best.sec - chapter.start) ? frame : best
    }, null)
    return closest ? [closest] : []
  }
  if (candidates.length <= maxFrames) return candidates

  return Array.from({ length: maxFrames }, (_, index) => (
    candidates[Math.round((index * (candidates.length - 1)) / (maxFrames - 1))]
  ))
}

export function ChapterEvidenceStrip({
  chapters,
  frames,
  onSeek,
  sourceLabel,
  generateLabel,
  generating,
  onGenerate,
}: {
  chapters: NoteChapter[]
  frames: EvidenceFrame[]
  onSeek: (seconds: number) => void
  sourceLabel: string
  generateLabel?: string
  generating?: boolean
  onGenerate?: () => void
}) {
  const evidence = chapters
    .map((chapter) => ({ chapter, frames: selectChapterEvidenceFrames(frames, chapter) }))
    .filter((entry) => entry.frames.length > 0)

  if (evidence.length === 0) return null

  return (
    <section className="note-chapter-evidence" aria-label="章节画面证据">
      <header className="note-chapter-evidence-head">
        <div>
          <strong>章节画面证据</strong>
          <span>{sourceLabel} · 按时间范围抽取连续画面</span>
        </div>
        <div className="note-chapter-evidence-actions">
          <small>{evidence.length} 段</small>
          {onGenerate && generateLabel && (
            <button type="button" onClick={onGenerate} disabled={generating}>
              {generating ? '生成中…' : generateLabel}
            </button>
          )}
        </div>
      </header>
      <div className="note-chapter-evidence-list">
        {evidence.map(({ chapter, frames: chapterFrames }) => (
          <article key={`${chapter.start}-${chapter.title}`} className="note-chapter-evidence-card">
            <div className="note-chapter-evidence-copy">
              <time>{formatTimecode(chapter.start)}–{formatTimecode(chapter.end)}</time>
              <strong>{chapter.title}</strong>
              <p>{chapter.summary}</p>
            </div>
            <div className="note-chapter-evidence-frames" aria-label={`${chapter.title} 的画面证据`}>
              {chapterFrames.map((frame) => (
                <button
                  key={`${frame.sec}-${frame.url}`}
                  type="button"
                  onClick={() => onSeek(frame.sec)}
                  aria-label={`跳转到 ${formatTimecode(frame.sec)}，查看${chapter.title}的画面证据`}
                  title={`跳转到 ${formatTimecode(frame.sec)}`}
                >
                  <img src={frame.url} alt={`${formatTimecode(frame.sec)} 的画面`} loading="lazy" />
                  <span>{formatTimecode(frame.sec)}</span>
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
