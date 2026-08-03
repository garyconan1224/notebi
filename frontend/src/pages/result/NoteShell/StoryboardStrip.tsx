/**
 * StoryboardStrip — Q2 轻量故事板（独立于 VLM）。
 *
 * - 最多 12 帧（后端按时间均分抽帧，非画面理解产物）；
 * - 无可用帧时整条不渲染（不显示空骨架），seek 仍走时间轴热区；
 * - sec<=0 的旧版无时间戳帧无法定位，不参与故事板；
 * - 离当前播放时间最近的帧高亮，点击跳帧。
 */

export interface StoryboardFrame {
  sec: number | null
  url: string
}

interface StoryboardStripProps {
  frames: StoryboardFrame[]
  currentTime: number
  onSeek: (sec: number) => void
}

export const STORYBOARD_MAX_FRAMES = 12

function formatTimecode(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function nearestFrameIndex(frames: Array<{ sec: number }>, currentTime: number): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < frames.length; i++) {
    const dist = Math.abs(frames[i].sec - currentTime)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

export default function StoryboardStrip({ frames, currentTime, onSeek }: StoryboardStripProps) {
  // sec 为 null 的旧版帧无时间戳、无法定位，不参与故事板
  const usable = frames
    .filter((frame): frame is StoryboardFrame & { sec: number } =>
      typeof frame.sec === 'number' && frame.sec >= 0 && Boolean(frame.url))
    .slice(0, STORYBOARD_MAX_FRAMES)

  if (usable.length === 0) return null

  const activeIdx = nearestFrameIndex(usable, currentTime)

  return (
    <div className="nibi-storyboard" role="group" aria-label="故事板缩略图">
      {usable.map((frame, idx) => (
        <button
          key={`${frame.sec}-${frame.url}`}
          type="button"
          className={`nibi-storyboard-frame${idx === activeIdx ? ' is-active' : ''}`}
          onClick={() => onSeek(frame.sec)}
          title={`跳转到 ${formatTimecode(frame.sec)}`}
          aria-label={`跳转到 ${formatTimecode(frame.sec)}`}
        >
          <img src={frame.url} alt="" loading="lazy" />
          <span>{formatTimecode(frame.sec)}</span>
        </button>
      ))}
    </div>
  )
}
