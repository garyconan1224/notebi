import { Film, Music, ImageIcon, FileText } from 'lucide-react'

export const TYPE_ICON: Record<string, typeof Film> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
  text: FileText,
}

export const STATE_LABEL: Record<string, string> = {
  done: 'done',
  running: 'running',
  queued: 'queued',
  error: 'error',
}

export const STATE_COLOR: Record<string, string> = {
  done: 'var(--ok)',
  running: 'var(--fg)',
  error: 'var(--err)',
  queued: 'var(--mut)',
}

export const STATE_ORDER: Record<string, number> = {
  error: 0,
  running: 1,
  queued: 2,
  done: 3,
}

export function primaryStatusToState(raw: string | null): string {
  if (!raw) return 'queued'
  const s = raw.toUpperCase()
  if (s === 'SUCCESS') return 'done'
  if (s === 'FAILED' || s === 'CANCELLED') return 'error'
  if (s === 'QUEUED') return 'queued'
  return 'running'
}

export function formatDuration(sec: number | null): string {
  if (sec == null || sec <= 0) return '--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso.slice(0, 16)
  }
}

export function extractDomain(src: string): string {
  if (!src) return ''
  try {
    const u = new URL(src)
    const host = u.hostname.replace(/^www\./, '')
    const path = u.pathname.replace(/\/$/, '')
    const seg = path.split('/').pop() || ''
    if (seg && seg.length < 24) return `${host}${path}`
    return `${host}${path.slice(0, 24)}…`
  } catch {
    const parts = src.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || src.slice(0, 40)
  }
}
