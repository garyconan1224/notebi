/**
 * NoteShell 公共工具函数（从 index.tsx 拆出，修 react-refresh/only-export-components lint）。
 *
 * - platformLabelFromUrl：从 URL 域名派生平台显示名
 * - renderNoteTimestampChildren：把 ReactMarkdown children 里的时间戳渲染为可点击 chip
 */
import { cloneElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { TS_RE, parseTs } from '@/pages/results/LearningNotesPage/HtmlView'

/* ────────────────── platformLabelFromUrl ────────────────── */

/** 从 source_url 域名派生视频平台显示名。 */
export function platformLabelFromUrl(url: string): string {
  const host = url.replace(/^https?:\/\//, '').split('/')[0].toLowerCase()
  if (host.includes('bilibili')) return 'Bilibili'
  if (host.includes('youtube') || host.includes('youtu.be')) return 'YouTube'
  if (host.includes('douyin')) return '抖音'
  if (host.includes('xiaohongshu') || host.includes('xhslink')) return '小红书'
  return '网页'
}

/* ────────────────── renderNoteTimestampChildren ────────────────── */

/** 把 ReactMarkdown children 里的 [mm:ss] / [mm:ss~mm:ss] 渲染为可点击跳转 chip。 */
export function renderNoteTimestampChildren(
  children: ReactNode,
  onSeek: (sec: number) => void,
): ReactNode {
  if (typeof children === 'string') {
    return replaceNoteTimestampString(children, onSeek)
  }
  if (Array.isArray(children)) {
    return children.map((child, idx) => (
      <span key={`ts-child-${idx}`}>
        {renderNoteTimestampChildren(child, onSeek)}
      </span>
    ))
  }
  if (isValidElement(children)) {
    if (children.type === 'code' || children.type === 'pre') return children
    const el = children as ReactElement<{ children?: ReactNode }>
    const nextChildren = renderNoteTimestampChildren(el.props.children, onSeek)
    if (nextChildren === el.props.children) return children
    return cloneElement(el, undefined, nextChildren)
  }
  return children
}

function replaceNoteTimestampString(text: string, onSeek: (sec: number) => void): ReactNode {
  const parts: ReactNode[] = []
  let lastIdx = 0
  let match: RegExpExecArray | null

  TS_RE.lastIndex = 0
  while ((match = TS_RE.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index))
    }

    const ts = match[1]
    const sec = parseTs(ts)
    const display = match[0]

    parts.push(
      <button
        key={`note-ts-${match.index}`}
        type="button"
        className="ln-ts-chip"
        onClick={(event) => {
          event.preventDefault()
          onSeek(sec)
        }}
        title={match[2] ? `跳转到 ${ts}（区间 ${ts} ~ ${match[2]}）` : `跳转到 ${ts}`}
      >
        {display}
      </button>,
    )
    lastIdx = match.index + match[0].length
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx))
  }

  return parts.length > 0 ? parts : text
}
