/**
 * NoteShell — R1.3 Markdown 编辑保存 + 总结风格面板
 *
 * 统一笔记壳：读 R0 的 GET …/note 渲染 note.md + 标签概览。
 * R1.3 新增：Markdown 编辑态（CodeMirror + debounce 自动保存）、
 * 顶栏两层下拉（总结风格▾ + 版本▾）管理总结。
 *
 * 子组件拆分：
 *   - TagChips：frontmatter.tags → 标签 chips 展示
 *   - NoteEditor：轻量 CodeMirror 编辑器（注册到 lnEditorStore，复用截图插入能力）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Bold, BookOpenCheck, Brain, Camera, Check, ChevronDown, Code2, Download, ExternalLink, FileDown, FileText, FileType, Image, Italic, List, MessageCircle, Minus, Pause, Pencil, Play, Plus, Presentation, Sparkles, Strikethrough, Subtitles, Trash2, Type, Underline, X } from 'lucide-react'
import { toast } from 'sonner'

import { downloadItemNoteExport, exportItemNoteObsidian, getItemNote, putItemNote, type ItemNoteExportFormat } from '@/services/workspaces'
import type { VideoResultTranscriptLine } from '@/services/workspaces'
import type { ItemNote } from '@/types/workspace'
import { createSummary, deleteSummary, listSummaries, renameSummary, type ItemSummary } from '@/services/summaries'
import { MarkdownToc, extractToc, slugify } from '@/components/MarkdownToc'
import { platformLabelFromUrl } from './note-shell-utils'
import { Badge } from '@/components/ui/badge'
import { SYSTEM_TAG_DIMENSIONS } from '@/constants/tagDimensions'
import { inferContentTags } from '@/lib/contentTags'
import NoteMediaCompanion, { type NoteMediaCompanionHandle } from './NoteMediaCompanion'
import MilkdownEditor from './MilkdownEditor'
import LNVideoPanel, { type LNVideoPanelHandle } from '@/pages/results/LearningNotesPage/LNVideoPanel'
import LNTranscriptPanel from '@/pages/results/LearningNotesPage/LNTranscriptPanel'
import NoteAudioPanel, { type NoteAudioPanelHandle } from './NoteAudioPanel'
import '@/pages/results/LearningNotesPage/learning-notes.css'
import './note-shell.css'
import { NewSummaryModal } from '@/components/NewSummaryModal'
import NoteChatDrawer from '@/components/NoteChatDrawer'
import { FloatingAskAi } from './FloatingAskAi'
import { useLnEditorStore } from '@/store/lnEditorStore'
import { SourceMdModal } from './SourceMdModal'
import { withStatusToast } from '@/lib/statusToast'

type NoteExportBusy = ItemNoteExportFormat | 'markdown' | 'obsidian' | 'transcript' | 'source_md'
type OperationNoticeTone = 'loading' | 'success' | 'error' | 'info'
type OperationNotice = {
  id: number
  message: string
  tone: OperationNoticeTone
  actionLabel?: string
  onAction?: () => void
}

/* ────────────────── helpers ────────────────── */

/** 从 note_md 提取正文 body（去掉 YAML frontmatter）。 */
function extractBody(noteMd: string): string {
  if (!noteMd.startsWith('---\n')) return noteMd
  const parts = noteMd.split('---\n')
  const rest = parts.slice(1).join('---\n')
  const idx = rest.indexOf('---\n')
  return idx >= 0 ? rest.slice(idx + 4) : noteMd
}

/** type → 中文标签映射。 */
const TYPE_LABEL: Record<string, string> = {
  text: '文本',
  audio: '音频',
  video: '视频',
  image: '图片',
}

/** 总结模板 ID → 中文显示名（唯一定义，顶栏+右栏共用）。 */
const TEMPLATE_LABELS: Record<string, string> = {
  concise: '简洁摘要', detailed: '详细要点', quotes: '金句提取',
  meeting: '会议纪要', xhs: '小红书风格', longform: '公众号长文',
  lecture: '教学笔记', interview: '访谈整理', shownotes: '播客 shownotes',
  oral: '口播稿', steps: '步骤教程', outline: '大纲',
  qa: '问答卡(Anki)', actions: '行动清单', tool_recommendation: '工具推荐',
  science_popularization: '知识科普', standard: '标准总结',
}
const tl = (id: string) => TEMPLATE_LABELS[id] ?? id

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'
const VIDEO_SPLIT_MIN = 20
const VIDEO_SPLIT_MAX = 72
const VIDEO_SPLIT_DEFAULT = 60
const VIDEO_SPLIT_STORAGE_KEY = 'nibi.note.videoLeftPct'
const EDITOR_PREFS_STORAGE_KEY = 'nibi.note.editorPrefs'

type NoteEditorPrefs = {
  fontFamily: 'sans' | 'serif' | 'mono'
  fontSize: number
  lineHeight: 1.6 | 1.8 | 2
  textTone: 'ink' | 'muted' | 'soft'
  fontWeight: 'regular' | 'medium' | 'bold'
}

const DEFAULT_EDITOR_PREFS: NoteEditorPrefs = {
  fontFamily: 'sans',
  fontSize: 15,
  lineHeight: 1.8,
  textTone: 'ink',
  fontWeight: 'medium',
}

const FONT_FAMILY_VALUE: Record<NoteEditorPrefs['fontFamily'], string> = {
  sans: 'var(--fb)',
  serif: 'var(--fd)',
  mono: 'var(--fm)',
}

const TEXT_TONE_VALUE: Record<NoteEditorPrefs['textTone'], string> = {
  ink: 'var(--fg2)',
  muted: 'var(--mut)',
  soft: 'var(--ink-2)',
}

const FONT_WEIGHT_VALUE: Record<NoteEditorPrefs['fontWeight'], number> = {
  regular: 400,
  medium: 500,
  bold: 700,
}

const PIP_WIDTHS = [240, 320, 440]

type AudioChapter = {
  start: number
  end: number
  title: string
  summary: string
  keywords: string[]
}

const AUDIO_KEYWORD_STOPWORDS = new Set([
  '这个', '那个', '然后', '就是', '我们', '你们', '他们', '大家', '可以', '一个', '一些', '进行',
  '如果', '因为', '所以', '但是', '或者', '以及', '其实', '比较', '时候', '现在', '需要', '没有',
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'are', 'was', 'can',
])

function readEditorPrefs(): NoteEditorPrefs {
  if (typeof window === 'undefined') return DEFAULT_EDITOR_PREFS
  try {
    const raw = window.localStorage.getItem(EDITOR_PREFS_STORAGE_KEY)
    if (!raw) return DEFAULT_EDITOR_PREFS
    const parsed = JSON.parse(raw) as Partial<NoteEditorPrefs>
    return {
      fontFamily: parsed.fontFamily === 'serif' || parsed.fontFamily === 'mono' ? parsed.fontFamily : 'sans',
      fontSize: typeof parsed.fontSize === 'number' ? clampNumber(parsed.fontSize, 13, 20) : DEFAULT_EDITOR_PREFS.fontSize,
      lineHeight: parsed.lineHeight === 1.6 || parsed.lineHeight === 2 ? parsed.lineHeight : 1.8,
      textTone: parsed.textTone === 'muted' || parsed.textTone === 'soft' ? parsed.textTone : 'ink',
      fontWeight: parsed.fontWeight === 'regular' || parsed.fontWeight === 'bold' ? parsed.fontWeight : 'medium',
    }
  } catch {
    return DEFAULT_EDITOR_PREFS
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 格式化 HH:mm */
function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDateTime(value: string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 秒数 → mm:ss 或 hh:mm:ss */
function formatTimecode(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return h > 0 ? `${h}:${mm}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`
}

function compactText(text: string, max = 42): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max)}...`
}

function extractAudioKeywords(text: string, max = 4): string[] {
  const scores = new Map<string, number>()
  const normalized = text
    .replace(/[，。！？、；：,.!?;:()[\]{}"'“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  for (const token of normalized.match(/[A-Za-z][A-Za-z0-9.+#-]{2,}/g) ?? []) {
    const key = token.toLowerCase()
    if (AUDIO_KEYWORD_STOPWORDS.has(key)) continue
    scores.set(token, (scores.get(token) ?? 0) + Math.min(4, token.length / 3))
  }

  const cjk = normalized.replace(/[^\u4e00-\u9fff]/g, '')
  for (let size = 4; size >= 2; size -= 1) {
    for (let idx = 0; idx <= cjk.length - size; idx += size === 2 ? 2 : 1) {
      const key = cjk.slice(idx, idx + size)
      if (AUDIO_KEYWORD_STOPWORDS.has(key)) continue
      scores.set(key, (scores.get(key) ?? 0) + size)
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .map(([keyword]) => keyword)
    .filter((keyword, idx, arr) => arr.findIndex((other) => other.includes(keyword) || keyword.includes(other)) === idx)
    .slice(0, max)
}

function buildAudioChapters(transcript: VideoResultTranscriptLine[]): AudioChapter[] {
  if (transcript.length === 0) return []
  const chapters: AudioChapter[] = []
  let group: VideoResultTranscriptLine[] = []
  let groupStart = transcript[0]?.t_sec ?? 0

  const flush = (nextStart?: number) => {
    if (group.length === 0) return
    const text = group.map((line) => line.text).join(' ')
    const keywords = extractAudioKeywords(text, 4)
    chapters.push({
      start: groupStart,
      end: nextStart ?? group[group.length - 1]?.t_sec ?? groupStart,
      title: keywords.length > 0 ? keywords.slice(0, 3).join(' / ') : compactText(text, 18),
      summary: compactText(text, 54),
      keywords,
    })
    group = []
  }

  for (const line of transcript) {
    if (group.length === 0) groupStart = line.t_sec
    const elapsed = line.t_sec - groupStart
    if (group.length > 0 && (elapsed >= 42 || group.length >= 7)) {
      flush(line.t_sec)
      groupStart = line.t_sec
    }
    group.push(line)
  }
  flush()
  return chapters.slice(0, 12)
}

function safeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 80) || 'note'
}

function formatTranscriptForPrompt(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (!Array.isArray(raw)) return ''
  return raw
    .map((seg) => {
      if (!seg || typeof seg !== 'object') return ''
      const data = seg as Record<string, unknown>
      const time = data.t_str ?? data.start ?? data.t_sec
      const text = data.edited_text ?? data.text
      if (!text) return ''
      return time !== undefined ? `[${String(time)}] ${String(text)}` : String(text)
    })
    .filter(Boolean)
    .join('\n')
}

function buildChatSystemPrompt(body: string, transcript: unknown): string {
  const parts = [
    '你正在协助用户理解一篇单素材笔记。回答时只能基于下方 note.md 正文和转录上下文，不要编造笔记里没有的信息。',
    '',
    '【note.md 正文】',
    body || '（暂无笔记内容）',
  ]
  const transcriptText = formatTranscriptForPrompt(transcript)
  if (transcriptText) {
    parts.push('', '【转录上下文】', transcriptText)
  }
  parts.push('', '回答指引：基于上述笔记作答；如果用户问到时间点，请引用对应转录；回答使用中文。')
  return parts.join('\n')
}

function downloadMarkdownFile(markdown: string, title: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFilename(title)}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function downloadTextFile(text: string, title: string, extension = 'txt'): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFilename(title)}.${extension}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function extensionForExport(format: ItemNoteExportFormat): string {
  const map: Record<ItemNoteExportFormat, string> = {
    md: 'md',
    html: 'html',
    pdf: 'pdf',
    docx: 'docx',
    long_image: 'png',
    pptx: 'pptx',
    obsidian: 'zip',
  }
  return map[format]
}

function labelForNoteExport(format: ItemNoteExportFormat): string {
  const map: Record<ItemNoteExportFormat, string> = {
    md: '完整 note.md',
    html: 'HTML',
    pdf: 'PDF',
    docx: 'Word',
    long_image: '长图',
    pptx: 'PPT',
    obsidian: 'Obsidian 包',
  }
  return map[format]
}

function sourceMarkerFromUrl(url?: string): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const bilibiliId = parsed.pathname.match(/\/video\/(BV[\w]+)/i)?.[1]
    if (bilibiliId) return bilibiliId
    const youtubeId = parsed.searchParams.get('v')
    if (youtubeId) return youtubeId
    if (parsed.hostname.includes('youtu.be')) {
      const shortId = parsed.pathname.replace(/^\//, '').split('/')[0]
      return shortId || null
    }
    return null
  } catch {
    return null
  }
}

function isCanceledExportError(error: unknown): boolean {
  const err = error as { code?: string; name?: string; message?: string }
  return err?.code === 'ERR_CANCELED'
    || err?.name === 'AbortError'
    || err?.name === 'CanceledError'
    || err?.message === 'canceled'
}

/** frontmatter.tags → 标签 chips 展示。 */
/* ────────────────── TagChips ────────────────── */

interface TagChipsProps {
  tags: Record<string, unknown>
}

/** 把 frontmatter.tags（6 维系统标签 + custom_tags）渲染为 chips。 */
function TagChips({ tags }: TagChipsProps) {
  if (!tags || typeof tags !== 'object') return null

  const systemChips = SYSTEM_TAG_DIMENSIONS
    .filter((dim) => !!tags[dim.key])
    .map((dim) => (
      <Badge key={dim.key} variant="secondary">
        {dim.label} · {String(tags[dim.key])}
      </Badge>
    ))

  const customRaw = tags.custom_tags
  const customChips = Array.isArray(customRaw)
    ? customRaw.map((ct: string) => (
        <Badge key={ct} variant="outline">{ct}</Badge>
      ))
    : []

  const all = [...systemChips, ...customChips]
  if (all.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {all}
    </div>
  )
}

function hasRenderableTags(tags: Record<string, unknown>): boolean {
  if (!tags || typeof tags !== 'object') return false
  const hasSystemTag = SYSTEM_TAG_DIMENSIONS.some((dim) => Boolean(tags[dim.key]))
  const customRaw = tags.custom_tags
  const hasCustomTag = Array.isArray(customRaw) && customRaw.some((tag) => String(tag).trim())
  return hasSystemTag || hasCustomTag
}

/* ────────────────── NoteShell ────────────────── */

export default function NoteShell({ workspaceId: propWs, itemId: propItem }: { workspaceId?: string; itemId?: string } = {}) {
  const params = useParams<{ workspaceId: string; itemId: string }>()
  const workspaceId = propWs ?? params.workspaceId ?? ''
  const itemId = propItem ?? params.itemId ?? ''
  const navigate = useNavigate()

  const [note, setNote] = useState<ItemNote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chatOpen] = useState(false)
  const [askAiOpen, setAskAiOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportBusy, setExportBusy] = useState<NoteExportBusy | null>(null)
  const [immersiveOpen, setImmersiveOpen] = useState(false)
  const [sourceMdOpen, setSourceMdOpen] = useState(false)
  // VN4.3 AI 工具下拉
  const [aiToolsOpen, setAiToolsOpen] = useState(false)
  const aiToolsDropRef = useRef<HTMLDivElement>(null)
  const exportDropRef = useRef<HTMLDivElement>(null)
  const exportAbortRef = useRef<AbortController | null>(null)
  const operationNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const operationNoticeSeqRef = useRef(0)
  const [operationNotice, setOperationNotice] = useState<OperationNotice | null>(null)
  // 新建总结（复用 NewSummaryModal）
  const [showNewSummaryModal, setShowNewSummaryModal] = useState(false)
  const [creatingSummary, setCreatingSummary] = useState(false)
  const [editorPrefsOpen, setEditorPrefsOpen] = useState(false)
  const editorPrefsRef = useRef<HTMLDivElement>(null)
  const [editorPrefs, setEditorPrefs] = useState<NoteEditorPrefs>(readEditorPrefs)

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<string>('')

  // 编辑中的 body 文本（debounce 源头）
  const [editingBody, setEditingBody] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mediaCompanionRef = useRef<NoteMediaCompanionHandle>(null)
  // 标记程序化切换正文，避免 Milkdown 重挂时触发自动保存。
  const applyingRef = useRef(false)

  // Milkdown 重挂 key：noteId 变化（自然由 workspaceId/itemId 驱动）或 seedVersion 递增时重挂
  const [seedVersion, setSeedVersion] = useState(0)
  const milkdownKey = `${workspaceId}/${itemId}-${seedVersion}`

  // 7.3: 视频笔记三列布局 — 播放器 + 转录轴联动
  const videoRef = useRef<LNVideoPanelHandle>(null)
  const notePageRef = useRef<HTMLDivElement>(null)
  const noteScrollRef = useRef<HTMLDivElement>(null)
  const immersiveScrollRef = useRef<HTMLDivElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [isPip, setIsPip] = useState(false)
  const [pipSizeIndex, setPipSizeIndex] = useState(1)
  const [pipPosition, setPipPosition] = useState<{ x: number; y: number } | null>(null)
  const [pipDragging, setPipDragging] = useState(false)
  const [pipPlaying, setPipPlaying] = useState(false)
  const [noteLeftPct, setNoteLeftPct] = useState(() => {
    if (typeof window === 'undefined') return VIDEO_SPLIT_DEFAULT
    const storedRaw = window.localStorage.getItem(VIDEO_SPLIT_STORAGE_KEY)
    if (!storedRaw) return VIDEO_SPLIT_DEFAULT
    const stored = Number(storedRaw)
    return Number.isFinite(stored) ? clampNumber(stored, VIDEO_SPLIT_MIN, VIDEO_SPLIT_MAX) : VIDEO_SPLIT_DEFAULT
  })
  const [transportNode, setTransportNode] = useState<ReactNode>(null)
  const handleTransportChange = useCallback(() => {
    setTransportNode(videoRef.current?.transportNode ?? null)
    setPipPlaying(videoRef.current?.isPlaying ?? false)
  }, [])
  const handleVideoDurationChange = useCallback((duration: number) => setVideoDuration(duration), [])

  // Stage 2: 音频笔记双栏布局 — 播放器 + 转录联动
  const audioRef = useRef<NoteAudioPanelHandle>(null)
  const [audioDuration, setAudioDuration] = useState(0)
  const [audioTransportNode, setAudioTransportNode] = useState<ReactNode>(null)
  const handleAudioTransportChange = useCallback(() => {
    setAudioTransportNode(audioRef.current?.transportNode ?? null)
    setPipPlaying(audioRef.current?.isPlaying ?? false)
  }, [])
  const handleAudioDurationChange = useCallback((d: number) => setAudioDuration(d), [])

  const [activeSummaryId, setActiveSummaryId] = useState<string | undefined>(undefined)
  // VN4.1 版本下拉 + 风格/版本两层
  const [summaries, setSummaries] = useState<ItemSummary[]>([])
  const [summariesVersion, setSummariesVersion] = useState(0)
  const [templateDropOpen, setTemplateDropOpen] = useState(false)
  const templateDropRef = useRef<HTMLDivElement>(null)
  // 改名（迁入顶栏下拉）
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const refreshSummaries = useCallback(() => setSummariesVersion((v) => v + 1), [])

  const switchEditorBody = useCallback((body: string) => {
    applyingRef.current = true
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setEditingBody(body)
    setSeedVersion((v) => v + 1)
    setSaveStatus('idle')
  }, [])

  // 按 template 分组（两层下拉用）
  const templateGroups = useMemo(() => {
    const map = new Map<string, ItemSummary[]>()
    for (const s of summaries) {
      const arr = map.get(s.template) ?? []
      arr.push(s)
      map.set(s.template, arr)
    }
    // 每组内按 version 排序
    for (const arr of map.values()) arr.sort((a, b) => a.version - b.version)
    return map
  }, [summaries])

  const activeTemplate = useMemo(() => {
    if (!activeSummaryId) return templateGroups.keys().next().value ?? ''
    const s = summaries.find((x) => x.summary_id === activeSummaryId)
    return s?.template ?? ''
  }, [activeSummaryId, summaries, templateGroups])

  useEffect(() => {
    let cancelled = false
    listSummaries(workspaceId, itemId)
      .then((data) => { if (!cancelled) setSummaries(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, itemId, activeSummaryId, summariesVersion])

  useEffect(() => {
    window.localStorage.setItem(VIDEO_SPLIT_STORAGE_KEY, String(Math.round(noteLeftPct)))
  }, [noteLeftPct])

  useEffect(() => {
    window.localStorage.setItem(EDITOR_PREFS_STORAGE_KEY, JSON.stringify(editorPrefs))
  }, [editorPrefs])

  useEffect(() => {
    return () => {
      exportAbortRef.current?.abort()
      exportAbortRef.current = null
      if (operationNoticeTimerRef.current) {
        clearTimeout(operationNoticeTimerRef.current)
        operationNoticeTimerRef.current = null
      }
    }
  }, [])

  const showOperationNotice = useCallback((
    message: string,
    tone: OperationNoticeTone,
    action?: Pick<OperationNotice, 'actionLabel' | 'onAction'>,
  ) => {
    if (operationNoticeTimerRef.current) {
      clearTimeout(operationNoticeTimerRef.current)
      operationNoticeTimerRef.current = null
    }
    const id = operationNoticeSeqRef.current + 1
    operationNoticeSeqRef.current = id
    setOperationNotice({ id, message, tone, ...action })
    if (tone !== 'loading') {
      operationNoticeTimerRef.current = setTimeout(() => {
        setOperationNotice((current) => (current?.id === id ? null : current))
        operationNoticeTimerRef.current = null
      }, 2200)
    }
  }, [])

  const notePageStyle = useMemo<CSSProperties>(
    () => ({
      '--note-left-width': `${noteLeftPct}%`,
      '--note-copy-font-family': FONT_FAMILY_VALUE[editorPrefs.fontFamily],
      '--note-copy-font-size': `${editorPrefs.fontSize}px`,
      '--note-copy-line-height': String(editorPrefs.lineHeight),
      '--note-copy-color': TEXT_TONE_VALUE[editorPrefs.textTone],
      '--note-copy-font-weight': String(FONT_WEIGHT_VALUE[editorPrefs.fontWeight]),
    } as CSSProperties),
    [noteLeftPct, editorPrefs],
  )

  const currentNoteType = String(((note?.frontmatter ?? {}) as Record<string, unknown>).type ?? '')
  const isCurrentAudioNote = currentNoteType === 'audio' && !!note?.media?.audio
  const pipWidth = PIP_WIDTHS[pipSizeIndex]

  useEffect(() => {
    if (!isPip || typeof window === 'undefined') return
    const estimatedHeight = isCurrentAudioNote ? 236 : Math.round((pipWidth * 9) / 16 + 86)
    setPipPosition((current) => {
      const next = current ?? {
        x: Math.max(12, window.innerWidth - pipWidth - 24),
        y: Math.max(12, window.innerHeight - estimatedHeight - 24),
      }
      return {
        x: clampNumber(next.x, 12, Math.max(12, window.innerWidth - pipWidth - 12)),
        y: clampNumber(next.y, 12, Math.max(12, window.innerHeight - estimatedHeight - 12)),
      }
    })
  }, [isPip, isCurrentAudioNote, pipWidth])

  useEffect(() => {
    setIsPip(false)
    setPipDragging(false)
    setPipPosition(null)
  }, [workspaceId, itemId])

  const updateNoteSplitFromClientX = useCallback((clientX: number) => {
    const el = notePageRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return
    const next = ((clientX - rect.left) / rect.width) * 100
    setNoteLeftPct(clampNumber(next, VIDEO_SPLIT_MIN, VIDEO_SPLIT_MAX))
  }, [])

  const handleNoteSplitPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const pointerId = event.pointerId
    const target = event.currentTarget
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    updateNoteSplitFromClientX(event.clientX)
    target.setPointerCapture(pointerId)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMove = (moveEvent: PointerEvent) => {
      updateNoteSplitFromClientX(moveEvent.clientX)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }, [updateNoteSplitFromClientX])

  const handleNoteSplitKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 6 : 3
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setNoteLeftPct((value) => clampNumber(value - step, VIDEO_SPLIT_MIN, VIDEO_SPLIT_MAX))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setNoteLeftPct((value) => clampNumber(value + step, VIDEO_SPLIT_MIN, VIDEO_SPLIT_MAX))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setNoteLeftPct(VIDEO_SPLIT_MIN)
    } else if (event.key === 'End') {
      event.preventDefault()
      setNoteLeftPct(VIDEO_SPLIT_MAX)
    }
  }, [])

  const togglePip = useCallback(() => {
    setIsPip((current) => !current)
  }, [])

  const closePip = useCallback(() => {
    setIsPip(false)
    setPipDragging(false)
  }, [])

  const cyclePipSize = useCallback(() => {
    setPipSizeIndex((current) => (current + 1) % PIP_WIDTHS.length)
  }, [])

  const handlePipHeaderPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (typeof window === 'undefined') return
    if ((event.target as HTMLElement).closest('button')) return
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    setPipDragging(true)

    const handleMove = (moveEvent: PointerEvent) => {
      setPipPosition({
        x: clampNumber(moveEvent.clientX - offsetX, 12, Math.max(12, window.innerWidth - rect.width - 12)),
        y: clampNumber(moveEvent.clientY - offsetY, 12, Math.max(12, window.innerHeight - rect.height - 12)),
      })
    }

    const handleUp = () => {
      setPipDragging(false)
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
  }, [])

  const handlePipScreenshot = useCallback(() => {
    videoRef.current?.captureScreenshot()
  }, [])

  const handlePipTogglePlay = useCallback(() => {
    videoRef.current?.togglePlay()
    setPipPlaying(videoRef.current?.isPlaying ?? false)
  }, [])

  const handlePipProgressClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!videoDuration) return
    const rect = event.currentTarget.getBoundingClientRect()
    const pct = clampNumber((event.clientX - rect.left) / rect.width, 0, 1)
    videoRef.current?.seekTo(pct * videoDuration)
  }, [videoDuration])

  const handleAudioPipTogglePlay = useCallback(() => {
    audioRef.current?.togglePlay()
    setPipPlaying(audioRef.current?.isPlaying ?? false)
  }, [])

  const handleAudioPipProgressClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const duration = audioRef.current?.duration || audioDuration
    if (!duration) return
    const rect = event.currentTarget.getBoundingClientRect()
    const pct = clampNumber((event.clientX - rect.left) / rect.width, 0, 1)
    audioRef.current?.seekTo(pct * duration)
  }, [audioDuration])

  // 点击外部关闭模板下拉
  useEffect(() => {
    if (!templateDropOpen) return
    const handle = (e: MouseEvent) => {
      if (templateDropRef.current && !templateDropRef.current.contains(e.target as Node)) {
        setTemplateDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [templateDropOpen])

  // 点击外部关闭 AI 工具下拉
  useEffect(() => {
    if (!aiToolsOpen) return
    const handle = (e: MouseEvent) => {
      if (aiToolsDropRef.current && !aiToolsDropRef.current.contains(e.target as Node)) {
        setAiToolsOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [aiToolsOpen])

  useEffect(() => {
    if (!editorPrefsOpen) return
    const handle = (e: MouseEvent) => {
      if (editorPrefsRef.current && !editorPrefsRef.current.contains(e.target as Node)) {
        setEditorPrefsOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [editorPrefsOpen])

  // 图文笔记：图片索引 + 加载错误
  const [selectedImageIdx, setSelectedImageIdx] = useState(0)
  const [imageLoadError, setImageLoadError] = useState<Record<number, boolean>>({})
  const handleTimeUpdate = useCallback((t: number) => setCurrentTime(t), [])
  const handleSeek = useCallback((sec: number) => {
    videoRef.current?.seekTo(sec)
    audioRef.current?.seekTo(sec)
    mediaCompanionRef.current?.seekTo(sec)
  }, [])

  const transcriptLines = useMemo<VideoResultTranscriptLine[]>(() => (
    Array.isArray(note?.transcript) ? note.transcript as VideoResultTranscriptLine[] : []
  ), [note?.transcript])
  const videoFrames = useMemo(() => note?.media?.frames ?? [], [note?.media?.frames])
  const activeFrameIdx = useMemo(() => {
    let activeIdx = -1
    for (let idx = 0; idx < videoFrames.length; idx += 1) {
      if (videoFrames[idx].sec <= currentTime + 0.5) activeIdx = idx
    }
    return activeIdx
  }, [currentTime, videoFrames])

  const activeTranscriptLine = useMemo(() => {
    let active: VideoResultTranscriptLine | null = null
    for (const line of transcriptLines) {
      if (line.t_sec <= currentTime + 0.35) active = line
      else break
    }
    return active
  }, [currentTime, transcriptLines])
  const audioChapters = useMemo(() => buildAudioChapters(transcriptLines), [transcriptLines])
  const activeAudioChapterIdx = useMemo(() => {
    let activeIdx = -1
    for (let idx = 0; idx < audioChapters.length; idx += 1) {
      if (audioChapters[idx].start <= currentTime + 0.35) activeIdx = idx
      else break
    }
    return activeIdx
  }, [audioChapters, currentTime])
  const videoSubtitle = activeTranscriptLine?.text ?? ''
  const audioSubtitle = activeTranscriptLine?.text ?? ''

  const handleOpenImmersive = useCallback(() => {
    setImmersiveOpen(true)
    const noteType = String(((note?.frontmatter ?? {}) as Record<string, unknown>).type ?? '')
    if (noteType === 'audio' && note?.media?.audio) setIsPip(true)
  }, [note])

  const fetchNote = useCallback(async () => {
    setLoading(true)
    setError(null)
    setVideoDuration(0)
    try {
      const data = await getItemNote(workspaceId, itemId)
      setNote(data)
      // 同步主笔记正文；AI 总结版本切换只做本地预览，不写回主笔记。
      const body = extractBody(data.note_md)
      setEditingBody(body)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载笔记失败')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, itemId])

  useEffect(() => { fetchNote() }, [fetchNote])

  // 字幕保存成功后轻量刷新 source.md（不 setLoading、不重置正文编辑态；字幕编辑只动 source.md/transcript）
  const refreshAfterTranscriptEdit = useCallback(async () => {
    try {
      const data = await getItemNote(workspaceId, itemId)
      setNote(data)
    } catch {
      /* 字幕已落盘，source.md 展示刷新失败不阻塞 */
    }
  }, [workspaceId, itemId])

  // ─── debounce 自动保存 ───
  const doSave = useCallback(async (body: string) => {
    setSaveStatus('saving')
    try {
      const updated = await putItemNote(workspaceId, itemId, body)
      setNote(updated)
      setSaveStatus('saved')
      setSavedAt(formatTime(new Date()))
    } catch {
      setSaveStatus('failed')
    }
  }, [workspaceId, itemId])

  const handleEditorChange = useCallback((md: string) => {
    setEditingBody(md)
    // 程序化版本切换触发的刷新不保存。
    if (applyingRef.current) {
      applyingRef.current = false
      return
    }
    if (activeSummaryId) {
      setSaveStatus('idle')
      return
    }
    // 清除旧定时器，1.5s 后自动保存
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { doSave(md) }, 1500)
  }, [activeSummaryId, doSave])

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  const handleSelectMainNote = useCallback(() => {
    if (!note) return
    setActiveSummaryId(undefined)
    switchEditorBody(extractBody(note.note_md))
  }, [note, switchEditorBody])

  const handleSelectSummary = useCallback((summary: ItemSummary) => {
    setActiveSummaryId(summary.summary_id)
    switchEditorBody(summary.content_md)
  }, [switchEditorBody])

  // 切换视图模式（记忆 localStorage）

  const currentBody = editingBody
  const showInlineToc = useMemo(() => extractToc(currentBody).length > 0, [currentBody])
  const inlineTocNode = showInlineToc ? (
    <aside className="nibi-note-inline-toc" aria-label="正文目录">
      <MarkdownToc markdown={currentBody} scrollRef={noteScrollRef} />
    </aside>
  ) : null

  useEffect(() => {
    const container = noteScrollRef.current
    if (!container) return

    const frame = window.requestAnimationFrame(() => {
      const headings = container.querySelectorAll<HTMLElement>('.note-copy h2, .note-copy h3')
      headings.forEach((heading) => {
        const text = heading.textContent?.trim()
        if (!text) return
        heading.id = slugify(text)
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [currentBody, seedVersion])

  const chatSystemPrompt = useMemo(
    () => buildChatSystemPrompt(currentBody, note?.transcript),
    [currentBody, note?.transcript],
  )

  const handleExportMarkdown = useCallback(async () => {
    if (!note) return
    const title = String((note.frontmatter as Record<string, unknown>)?.title ?? 'note')
    setExportBusy('markdown')
    try {
      await withStatusToast(
        async () => {
          downloadMarkdownFile(currentBody, `${title}-正文`)
        },
        {
          id: 'note-export-markdown',
          loading: '正在导出当前正文…',
          success: '当前正文已开始下载',
          error: '当前正文导出失败，请重试',
        },
      )
      setExportOpen(false)
    } catch (err) {
      console.error('当前正文导出失败:', err)
    } finally {
      setExportBusy(null)
    }
  }, [currentBody, note])

  const handleExportObsidian = useCallback(async () => {
    const controller = new AbortController()
    exportAbortRef.current?.abort()
    exportAbortRef.current = controller
    const cancelExport = () => {
      controller.abort()
      showOperationNotice('已取消导出 Obsidian 包', 'info')
    }
    setExportBusy('obsidian')
    showOperationNotice('正在导出 Obsidian 包…', 'loading', {
      actionLabel: '取消',
      onAction: cancelExport,
    })
    try {
      const blob = await exportItemNoteObsidian(workspaceId, itemId, controller.signal)
      const title = String((note?.frontmatter as Record<string, unknown> | undefined)?.title ?? 'note')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeFilename(title)}-obsidian.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      showOperationNotice('Obsidian 包已开始下载', 'success')
      setExportOpen(false)
    } catch (err) {
      if (isCanceledExportError(err)) {
        showOperationNotice('已取消导出 Obsidian 包', 'info')
        return
      }
      showOperationNotice('Obsidian 包导出失败，请重试', 'error')
      console.error('Obsidian 导出失败:', err)
    } finally {
      if (exportAbortRef.current === controller) exportAbortRef.current = null
      setExportBusy(null)
    }
  }, [workspaceId, itemId, note, showOperationNotice])

  const handleExportTranscript = useCallback(async () => {
    const transcriptText = formatTranscriptForPrompt(note?.transcript)
    if (!transcriptText) {
      toast.error('暂无可导出的转写文本')
      return
    }
    const title = String((note?.frontmatter as Record<string, unknown> | undefined)?.title ?? 'transcript')
    setExportBusy('transcript')
    try {
      await withStatusToast(
        async () => {
          downloadTextFile(transcriptText, `${title}-转写文本`)
        },
        {
          id: 'note-export-transcript',
          loading: '正在导出转写文本…',
          success: '转写文本已开始下载',
          error: '转写文本导出失败，请重试',
        },
      )
      setExportOpen(false)
    } catch (err) {
      console.error('转写文本导出失败:', err)
    } finally {
      setExportBusy(null)
    }
  }, [note])

  const handleDownloadNoteExport = useCallback(async (format: ItemNoteExportFormat) => {
    const title = String((note?.frontmatter as Record<string, unknown> | undefined)?.title ?? 'note')
    const label = labelForNoteExport(format)
    const controller = new AbortController()
    exportAbortRef.current?.abort()
    exportAbortRef.current = controller
    const cancelExport = () => {
      controller.abort()
      showOperationNotice(`已取消导出${label}`, 'info')
    }
    setExportBusy(format)
    showOperationNotice(`正在导出${label}…`, 'loading', {
      actionLabel: '取消',
      onAction: cancelExport,
    })
    try {
      await downloadItemNoteExport(
        workspaceId,
        itemId,
        format,
        `${safeFilename(title)}.${extensionForExport(format)}`,
        controller.signal,
      )
      showOperationNotice(`${label}已开始下载`, 'success')
      setExportOpen(false)
    } catch (err) {
      if (isCanceledExportError(err)) {
        showOperationNotice(`已取消导出${label}`, 'info')
        return
      }
      showOperationNotice(`${label} 导出失败，请稍后重试`, 'error')
      console.error('笔记导出失败:', err)
    } finally {
      if (exportAbortRef.current === controller) exportAbortRef.current = null
      setExportBusy(null)
    }
  }, [workspaceId, itemId, note, showOperationNotice])

  const handleDownloadSourceMd = useCallback(async () => {
    if (!note?.source_md) {
      toast.error('暂无原始素材 Markdown')
      return
    }
    const title = String((note.frontmatter as Record<string, unknown>)?.title ?? 'source')
    setExportBusy('source_md')
    try {
      await withStatusToast(
        async () => {
          downloadMarkdownFile(note.source_md, `${title}-原始素材`)
        },
        {
          id: 'note-export-source-md',
          loading: '正在导出原始素材 Markdown…',
          success: '原始素材 Markdown 已开始下载',
          error: '原始素材 Markdown 导出失败，请重试',
        },
      )
    } catch (err) {
      console.error('原始素材 Markdown 导出失败:', err)
    } finally {
      setExportBusy(null)
    }
  }, [note])

  // VN4.3 新建总结（从 AI 工具菜单触发，复用 NewSummaryModal）
  const handleCreateSummary = useCallback(async (opts: {
    template: string; background: string; providerId: string; model: string; searchWeb: boolean
  }) => {
    const templateName = tl(opts.template)
    setCreatingSummary(true)
    setShowNewSummaryModal(false)
    showOperationNotice(`正在生成${templateName}…`, 'loading')
    try {
      const s = await createSummary(workspaceId, itemId, opts.template, opts.background, {
        provider_id: opts.providerId,
        model: opts.model,
        search_web: opts.searchWeb,
      })
      showOperationNotice(`${templateName} v${s.version} 生成完成`, 'success')
      refreshSummaries()
    } catch (err: unknown) {
      const axiosData = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      if (axiosData && axiosData.includes('chat model')) {
        showOperationNotice('请先在设置中配置 LLM 模型', 'error', {
          actionLabel: '去设置',
          onAction: () => navigate('/settings/models'),
        })
      } else {
        const msg = err instanceof Error ? err.message : '生成失败'
        showOperationNotice(msg, 'error')
      }
    } finally {
      setCreatingSummary(false)
    }
  }, [workspaceId, itemId, refreshSummaries, navigate, showOperationNotice])

  // 删除总结（从顶栏版本下拉触发）
  const handleDeleteSummary = useCallback(async (summaryId: string) => {
    try {
      await withStatusToast(
        () => deleteSummary(workspaceId, itemId, summaryId),
        {
          id: `note-summary-delete-${summaryId}`,
          loading: '正在删除总结…',
          success: '总结已删除',
          error: '删除总结失败',
        },
      )
      if (activeSummaryId === summaryId) setActiveSummaryId(undefined)
      refreshSummaries()
    } catch (err) {
      console.error('删除总结失败:', err)
    }
  }, [workspaceId, itemId, activeSummaryId, refreshSummaries])

  // 改名（从顶栏版本下拉触发）
  const commitRename = useCallback(async () => {
    if (!renameTargetId) return
    const targetId = renameTargetId
    setRenameTargetId(null)
    try {
      await withStatusToast(
        () => renameSummary(workspaceId, itemId, targetId, renameName.trim()),
        {
          id: `note-summary-rename-${targetId}`,
          loading: '正在保存总结名称…',
          success: '总结名称已保存',
          error: '总结改名失败',
        },
      )
      refreshSummaries()
    } catch (err) {
      console.error('总结改名失败:', err)
    } finally {
      setRenameTargetId(null)
      setRenameName('')
    }
  }, [renameTargetId, renameName, workspaceId, itemId, refreshSummaries])

  const updateEditorPrefs = useCallback((patch: Partial<NoteEditorPrefs>) => {
    setEditorPrefs((current) => ({ ...current, ...patch }))
  }, [])

  const adjustEditorFontSize = useCallback((delta: number) => {
    setEditorPrefs((current) => ({
      ...current,
      fontSize: clampNumber(current.fontSize + delta, 13, 20),
    }))
  }, [])

  const handleResetEditorPrefs = useCallback(() => {
    setEditorPrefs(DEFAULT_EDITOR_PREFS)
  }, [])

  const handleWrapSelection = useCallback((before: string, after: string, label: string) => {
    const applied = useLnEditorStore.getState().wrapSelection(before, after)
    if (!applied) {
      toast.error('未找到可编辑的笔记正文')
      return
    }
    toast.success(`已插入${label}标记`)
  }, [])

  const handleApplyBold = useCallback(() => {
    handleWrapSelection('**', '**', '加粗')
  }, [handleWrapSelection])

  // ─── loading / error ───
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--mut)' }}>
        加载中…
      </div>
    )
  }
  if (error || !note) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', gap: 12 }}>
        <span style={{ color: 'var(--err)', fontWeight: 600 }}>
          {error ?? '没有可显示的笔记'}
        </span>
        <button className="btn-ghost" style={{ padding: '6px 12px' }} onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>
      </div>
    )
  }

  // ─── 数据解构 ───
  const fm = (note.frontmatter ?? {}) as Record<string, unknown>
  const title = String(fm.title ?? '')
  const sourceUrl = String(fm.source_url ?? '') || undefined
  const itemType = String(fm.type ?? 'text')
  const noteVersion = Number(fm.version ?? 1) || 1
  const noteCreatedAt = formatDateTime(String(fm.created_at ?? ''))
  const rawTags = (fm.tags ?? {}) as Record<string, unknown>
  const fallbackTags = inferContentTags([title, sourceUrl, itemType, editingBody, note.media])
  const tags = hasRenderableTags(rawTags)
    ? rawTags
    : (fallbackTags.length > 0 ? { custom_tags: fallbackTags } : {})
  const hasTags = hasRenderableTags(tags)
  const activeSummary = summaries.find((x) => x.summary_id === activeSummaryId)
  const versionButtonLabel = activeSummary
    ? `${tl(activeSummary.template)} · ${activeSummary.name || `v${activeSummary.version}`}`
    : `主笔记 v${noteVersion}`

  // 7.3: 视频笔记三列布局标志
  const isVideoNote = itemType === 'video' && !!note.media?.video?.url
  // Stage 2: 音频笔记双栏布局标志
  const isAudioNote = itemType === 'audio' && !!note.media?.audio
  // 图文笔记三列布局标志
  const isImageNote = itemType === 'image' && (note.media?.images?.length ?? 0) > 0
  // Stage 4: 文本笔记两栏布局标志（无媒体 / 播放器）
  const isTextNote = itemType === 'text'
  const images = note.media?.images ?? []
  const imageInfos = note.media?.image_infos ?? []
  const currentInfo = imageInfos[selectedImageIdx]
  const transcriptCount = transcriptLines.length
  const sourceLabel = sourceUrl ? platformLabelFromUrl(sourceUrl) : '本地素材'
  const effectiveVideoDuration = note.media?.video?.duration || videoDuration
  const effectiveAudioDuration = audioDuration
  const sourceMarker = sourceMarkerFromUrl(sourceUrl)
  const mediaDuration = isVideoNote ? effectiveVideoDuration : isAudioNote ? effectiveAudioDuration : 0
  const saveStatusNode = (
    <span className={`nibi-note-save nibi-note-save--${saveStatus}`}>
      {saveStatus === 'saving' && '保存中…'}
      {saveStatus === 'saved' && `已保存 ${savedAt}`}
      {saveStatus === 'failed' && '保存失败'}
      {saveStatus === 'idle' && '自动保存'}
    </span>
  )
  const noteMetaRows = [
    { label: '来源', value: sourceLabel },
    itemType ? { label: '类型', value: TYPE_LABEL[itemType] ?? itemType } : null,
    mediaDuration ? { label: '时长', value: formatTimecode(mediaDuration) } : null,
    sourceMarker ? { label: '素材 ID', value: sourceMarker } : null,
    transcriptCount > 0 ? { label: '转写', value: `${transcriptCount} 条` } : null,
    isVideoNote && videoFrames.length > 0 ? { label: '关键帧', value: `${videoFrames.length} 张` } : null,
    isImageNote && images.length > 0 ? { label: '图片', value: `${images.length} 张` } : null,
    summaries.length > 0 ? { label: '总结', value: `${summaries.length} 个版本` } : null,
    noteCreatedAt ? { label: '创建', value: noteCreatedAt } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row?.value))
  const noteMetaPanel = (noteMetaRows.length > 0 || hasTags) ? (
    <div className="nibi-note-meta-strip">
      <div className="nibi-note-meta-grid">
        {noteMetaRows.map((row) => (
          <span key={row.label} className="nibi-note-meta-chip">
            <strong>{row.label}</strong>
            <span>{row.value}</span>
          </span>
        ))}
      </div>
      {hasTags && (
        <div className="nibi-note-meta-tags">
          <TagChips tags={tags} />
        </div>
      )}
    </div>
  ) : null

  // ── 提取正文 JSX（视频 / 非视频布局复用）──
  const noteContent = (
    <div className="nibi-note-editor-panel">
      <MilkdownEditor key={milkdownKey} markdown={editingBody} onMarkdownChange={handleEditorChange} onSeek={handleSeek} />
    </div>
  )

  return (
    <div className={`nibi-note-shell nibi-note-shell--${itemType}`}>
      {/* ════════ 顶栏：.note-bar（设计稿 .note-bar 对齐） ════════ */}
      <div className="nibi-note-bar">
        <button className="nibi-note-bar-back" onClick={() => navigate(-1)} title="返回任务中心">
          <ArrowLeft size={15} />
          <span>返回</span>
        </button>
        <h1 className="nibi-note-bar-title">{title || '未命名笔记'}</h1>
        {isVideoNote && (
          <span className="nibi-note-bar-meta">VIDEO{effectiveVideoDuration ? ` · ${formatTimecode(effectiveVideoDuration)}` : ''}</span>
        )}
        {itemType === 'audio' && (
          <span className="nibi-note-bar-meta">AUDIO{effectiveAudioDuration ? ` · ${formatTimecode(effectiveAudioDuration)}` : ''}</span>
        )}
        {!isVideoNote && itemType !== 'audio' && (
          <span className="nibi-note-bar-meta">{(TYPE_LABEL[itemType] ?? itemType).toUpperCase()}</span>
        )}
        <div className="nibi-note-bar-tools">
          <div ref={templateDropRef} style={{ position: 'relative' }}>
            <button
              className="nibi-note-bar-btn nibi-note-bar-btn--label"
              onClick={() => setTemplateDropOpen((v) => !v)}
              title="切换主笔记 / AI 总结版本"
            >
              <List size={13} /> {versionButtonLabel}
              <ChevronDown size={11} style={{ marginLeft: 2 }} />
            </button>
            {templateDropOpen && (
              <div className="nibi-note-version-menu">
                <button
                  className={`nibi-note-version-main${!activeSummaryId ? ' is-active' : ''}`}
                  onClick={() => {
                    handleSelectMainNote()
                    setTemplateDropOpen(false)
                  }}
                >
                  <span>
                    <strong>主笔记 v{noteVersion}</strong>
                    {noteCreatedAt && <small>{noteCreatedAt}</small>}
                  </span>
                  {!activeSummaryId && <Check size={13} />}
                </button>
                <div className="nibi-note-version-divider" />
                {summaries.length === 0 ? (
                  <div className="nibi-note-version-empty">暂无 AI 总结版本，可点击“新建总结”生成。</div>
                ) : (
                  [...templateGroups.entries()].map(([tmpl, versions], gi) => (
                    <div key={tmpl}>
                      {gi > 0 && <div className="nibi-note-version-divider" />}
                      <div className="nibi-note-version-group">{tl(tmpl)}</div>
                      {versions.map((s) => {
                        const isActive = s.summary_id === activeSummaryId
                        const isRenaming = renameTargetId === s.summary_id
                        return (
                          <div key={s.summary_id} className="nibi-note-version-row">
                            {isRenaming ? (
                              <input
                                autoFocus
                                value={renameName}
                                onChange={(e) => setRenameName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitRename()
                                  if (e.key === 'Escape') {
                                    setRenameTargetId(null)
                                    setRenameName('')
                                  }
                                }}
                                onBlur={commitRename}
                              />
                            ) : (
                              <button
                                className={`nibi-note-version-choice${isActive ? ' is-active' : ''}`}
                                onClick={() => {
                                  handleSelectSummary(s)
                                  setTemplateDropOpen(false)
                                }}
                              >
                                <span>
                                  <strong>{s.name || `v${s.version}`}</strong>
                                  <small>
                                    {[s.model_used || '默认模型', formatDateTime(s.created_at)].filter(Boolean).join(' · ')}
                                  </small>
                                </span>
                                {isActive && <Check size={13} />}
                              </button>
                            )}
                            {!isRenaming && (
                              <div className="nibi-note-version-actions">
                                <button title="改名" onClick={(e) => { e.stopPropagation(); setRenameTargetId(s.summary_id); setRenameName(s.name || '') }}><Pencil size={11} /></button>
                                <button title="删除" onClick={(e) => { e.stopPropagation(); handleDeleteSummary(s.summary_id) }}><Trash2 size={11} /></button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            className="nibi-note-bar-btn nibi-note-bar-btn--label nibi-note-bar-btn--accent"
            onClick={() => setShowNewSummaryModal(true)}
            disabled={creatingSummary}
            title="新建总结"
          >
            <Plus size={14} />
            {creatingSummary ? '生成中…' : '新建总结'}
          </button>
          <div style={{ position: 'relative' }} ref={editorPrefsRef}>
            <button className="nibi-note-bar-btn nibi-note-bar-btn--label" onClick={() => setEditorPrefsOpen((value) => !value)} title="正文设置">
              <Type size={14} /> Aa 设置<ChevronDown size={11} />
            </button>
            {editorPrefsOpen && (
              <div className="nibi-note-pref-panel">
                <div className="nibi-note-pref-group">
                  <span className="nibi-note-pref-label">字体</span>
                  <div className="nibi-note-pref-segment">
                    {[
                      { key: 'sans', label: 'Sans' },
                      { key: 'serif', label: 'Serif' },
                      { key: 'mono', label: 'Mono' },
                    ].map((option) => (
                      <button
                        key={option.key}
                        className={`nibi-note-pref-chip${editorPrefs.fontFamily === option.key ? ' is-active' : ''}`}
                        onClick={() => updateEditorPrefs({ fontFamily: option.key as NoteEditorPrefs['fontFamily'] })}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="nibi-note-pref-group">
                  <span className="nibi-note-pref-label">字号</span>
                  <div className="nibi-note-pref-stepper">
                    <button className="nibi-note-pref-icon-btn" onClick={() => adjustEditorFontSize(-1)} title="减小字号">
                      <Minus size={13} />
                    </button>
                    <strong>{editorPrefs.fontSize}px</strong>
                    <button className="nibi-note-pref-icon-btn" onClick={() => adjustEditorFontSize(1)} title="增大字号">
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
                <div className="nibi-note-pref-group">
                  <span className="nibi-note-pref-label">行高</span>
                  <div className="nibi-note-pref-segment">
                    {[1.6, 1.8, 2].map((value) => (
                      <button
                        key={value}
                        className={`nibi-note-pref-chip${editorPrefs.lineHeight === value ? ' is-active' : ''}`}
                        onClick={() => updateEditorPrefs({ lineHeight: value as NoteEditorPrefs['lineHeight'] })}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="nibi-note-pref-group">
                  <span className="nibi-note-pref-label">颜色</span>
                  <div className="nibi-note-pref-swatches">
                    {[
                      { key: 'ink', color: 'var(--fg2)', label: '深' },
                      { key: 'muted', color: 'var(--mut)', label: '柔' },
                      { key: 'soft', color: 'var(--ink-2)', label: '浅' },
                    ].map((option) => (
                      <button
                        key={option.key}
                        className={`nibi-note-pref-swatch${editorPrefs.textTone === option.key ? ' is-active' : ''}`}
                        onClick={() => updateEditorPrefs({ textTone: option.key as NoteEditorPrefs['textTone'] })}
                        style={{ '--swatch-color': option.color } as CSSProperties}
                        title={option.label}
                      >
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="nibi-note-pref-group">
                  <span className="nibi-note-pref-label">字重</span>
                  <div className="nibi-note-pref-segment">
                    {[
                      { key: 'regular', label: '常规' },
                      { key: 'medium', label: '中' },
                      { key: 'bold', label: '粗' },
                    ].map((option) => (
                      <button
                        key={option.key}
                        className={`nibi-note-pref-chip${editorPrefs.fontWeight === option.key ? ' is-active' : ''}`}
                        onClick={() => updateEditorPrefs({ fontWeight: option.key as NoteEditorPrefs['fontWeight'] })}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="nibi-note-pref-group">
                  <span className="nibi-note-pref-label">选中文字</span>
                  <div className="nibi-note-format-row">
                    <button className="nibi-note-pref-icon-btn" onClick={handleApplyBold} title="加粗">
                      <Bold size={13} />
                    </button>
                    <button className="nibi-note-pref-icon-btn" onClick={() => handleWrapSelection('*', '*', '斜体')} title="斜体">
                      <Italic size={13} />
                    </button>
                    <button className="nibi-note-pref-icon-btn" onClick={() => handleWrapSelection('<u>', '</u>', '下划线')} title="下划线">
                      <Underline size={13} />
                    </button>
                    <button className="nibi-note-pref-icon-btn" onClick={() => handleWrapSelection('~~', '~~', '删除线')} title="删除线">
                      <Strikethrough size={13} />
                    </button>
                    <button className="nibi-note-pref-icon-btn" onClick={() => handleWrapSelection('`', '`', '行内代码')} title="行内代码">
                      <Code2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="nibi-note-pref-actions">
                  <button className="nibi-note-pref-ghost" onClick={handleResetEditorPrefs}>重置</button>
                </div>
              </div>
            )}
          </div>
          {sourceUrl && (
            <a className="nibi-note-bar-btn nibi-note-bar-btn--label" href={sourceUrl} target="_blank" rel="noreferrer" title="打开原视频">
              <ExternalLink size={14} /> 原视频
            </a>
          )}
          {note.source_md && (
            <button
              className="nibi-note-bar-btn nibi-note-bar-btn--label"
              onClick={() => {
                setExportOpen(false)
                setSourceMdOpen(true)
              }}
              title="查看原始素材 Markdown"
            >
              <FileText size={14} /> 原始素材
            </button>
          )}
          <div style={{ position: 'relative' }} ref={exportDropRef}>
            <button
              className="nibi-note-bar-btn nibi-note-bar-btn--label"
              onClick={() => {
                setAiToolsOpen(false)
                setExportOpen((v) => !v)
              }}
              title="导出"
            >
              <Download size={14} /> 导出<ChevronDown size={11} />
            </button>
            {exportOpen && (
              <div className="nibi-note-export-menu">
                <button className="nibi-note-export-item" onClick={handleExportMarkdown} disabled={!!exportBusy}>
                  <FileText size={15} />
                  <span>{exportBusy === 'markdown' ? '导出中…' : '当前正文.md'}</span>
                </button>
                <button className="nibi-note-export-item" onClick={handleExportObsidian} disabled={!!exportBusy}>
                  <BookOpenCheck size={15} />
                  <span>{exportBusy === 'obsidian' ? '导出中…' : 'Obsidian 包'}</span>
                </button>
                {(isVideoNote || isAudioNote) && (
                  <button className="nibi-note-export-item" onClick={handleExportTranscript} disabled={!!exportBusy}>
                    <Subtitles size={15} />
                    <span>{exportBusy === 'transcript' ? '导出中…' : '转写文本.txt'}</span>
                  </button>
                )}
                {[
                  { icon: <FileText size={15} />, label: 'HTML', format: 'html' as const },
                  { icon: <FileDown size={15} />, label: 'PDF', format: 'pdf' as const },
                  { icon: <FileType size={15} />, label: 'Word', format: 'docx' as const },
                  { icon: <Image size={15} />, label: '长图', format: 'long_image' as const },
                  { icon: <Presentation size={15} />, label: 'PPT', format: 'pptx' as const },
                ].map((item) => (
                  <button
                    key={item.label}
                    className="nibi-note-export-item"
                    onClick={() => handleDownloadNoteExport(item.format)}
                    disabled={!!exportBusy}
                  >
                    {item.icon}
                    <span>{exportBusy === item.format ? '导出中…' : item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="nibi-note-bar-btn nibi-note-bar-btn--label nibi-note-bar-btn--accent"
            onClick={handleOpenImmersive}
            title="打开沉浸式笔记"
          >
            <Sparkles size={14} /> 沉浸式
          </button>
          <div style={{ position: 'relative' }} ref={aiToolsDropRef}>
            <button
              className="nibi-note-bar-btn nibi-note-bar-btn--label nibi-note-bar-btn--accent"
              onClick={() => {
                setExportOpen(false)
                setAiToolsOpen((v) => !v)
              }}
              title="AI 工具"
            >
              <Brain size={14} /> AI 工具<ChevronDown size={11} />
            </button>
            {aiToolsOpen && (
              <div style={{ position: 'absolute', right: 0, top: 34, zIndex: 20, minWidth: 180, padding: '4px', border: '1px solid var(--bdr)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', boxShadow: 'var(--shadow-md)' }}>
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setAskAiOpen(true)
                    setAiToolsOpen(false)
                  }}
                  style={{ width: '100%', justifyContent: 'flex-start', height: 30, padding: '0 10px', fontSize: 12 }}
                >
                  <MessageCircle size={13} />
                  基于当前笔记问 AI
                </button>
                <button className="btn-ghost" disabled title="即将上线" style={{ width: '100%', justifyContent: 'flex-start', height: 30, padding: '0 10px', fontSize: 12, color: 'var(--mut)', cursor: 'not-allowed' }}>更多 AI 工具</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {immersiveOpen && (
        <div className="nibi-note-immersive">
          <div className="nibi-note-immersive-bar">
            <button className="nibi-note-bar-back" onClick={() => setImmersiveOpen(false)} title="返回工作台">
              <ArrowLeft size={15} />
              <span>工作台</span>
            </button>
            <div className="nibi-note-immersive-title">{title || '未命名笔记'}</div>
            <div className="nibi-note-bar-tools">
              {sourceUrl && (
                <a className="nibi-note-bar-btn nibi-note-bar-btn--label" href={sourceUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> 原视频
                </a>
              )}
              {note.source_md && (
                <button
                  className="nibi-note-bar-btn nibi-note-bar-btn--label"
                  onClick={() => {
                    setExportOpen(false)
                    setSourceMdOpen(true)
                  }}
                >
                  <FileText size={14} /> 原始素材
                </button>
              )}
              <button className="nibi-note-bar-btn nibi-note-bar-btn--label" onClick={() => handleDownloadNoteExport('pdf')} disabled={!!exportBusy}>
                <FileDown size={14} /> {exportBusy === 'pdf' ? '导出中…' : 'PDF'}
              </button>
              <button className="nibi-note-bar-btn" onClick={() => setImmersiveOpen(false)} title="关闭">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="nibi-note-immersive-body">
            <div className="nibi-note-immersive-scroll" ref={immersiveScrollRef}>
              <section className="nibi-note-source-banner">
                <div className="nibi-note-source-banner-copy">
                  <strong>{title || '未命名笔记'}</strong>
                  <span>
                    {sourceLabel}
                    {isVideoNote && effectiveVideoDuration ? ` · ${formatTimecode(effectiveVideoDuration)}` : ''}
                    {itemType ? ` · ${TYPE_LABEL[itemType] ?? itemType}` : ''}
                  </span>
                </div>
                {sourceUrl && (
                  <a href={sourceUrl} target="_blank" rel="noreferrer">原视频</a>
                )}
              </section>
              <article className="nibi-note-immersive-article nibi-note-immersive-article--editor">
                <h1>{title || '未命名笔记'}</h1>
                <MilkdownEditor
                  key={`immersive-${milkdownKey}`}
                  markdown={editingBody}
                  onMarkdownChange={handleEditorChange}
                  onSeek={handleSeek}
                />
                <div className="nibi-note-immersive-save">{saveStatusNode}</div>
              </article>
            </div>
            <aside className="nibi-note-immersive-toc">
              <MarkdownToc markdown={currentBody} scrollRef={immersiveScrollRef} />
            </aside>
          </div>
        </div>
      )}


      {/* ════════ 主内容区（视频笔记 = 三列 / 图文笔记 = 三列 / 其余 = 通用布局）════════ */}
      {isVideoNote ? (
        <>
        {/* ── 视频笔记两栏布局：.note-page（设计稿 pg-note 对齐） ── */}
        <div className={`nibi-note-page${isPip ? ' is-pip' : ''}`} ref={notePageRef} style={notePageStyle}>

          {/* ── 左栏（60%）：播放器 + 控制 + 转录 ── */}
          <div className="nibi-note-left vm-ln-scope">
            <div
              className={`nibi-note-player-shell${isPip ? ' is-pip' : ''}${pipDragging ? ' is-dragging' : ''}`}
              style={isPip && pipPosition ? { width: pipWidth, left: pipPosition.x, top: pipPosition.y, right: 'auto', bottom: 'auto' } : undefined}
            >
              {isPip && (
                <div className="note-pip-head" onPointerDown={handlePipHeaderPointerDown}>
                  <span className="note-pip-badge">画中画</span>
                  <div className="note-pip-head-actions">
                    <button className="note-pip-head-btn" onClick={cyclePipSize} title="切换尺寸">
                      {['小', '中', '大'][pipSizeIndex]}
                    </button>
                    <button className="note-pip-head-btn note-pip-head-btn--danger" onClick={closePip} title="关闭画中画">
                      <X size={13} />
                    </button>
                  </div>
                </div>
              )}
              <div className="nibi-note-player-wrap">
                <LNVideoPanel
                  ref={videoRef}
                  src={note.media!.video?.url?.startsWith('/static/') ? note.media!.video!.url : ''}
                  externalUrl={!note.media!.video?.url?.startsWith('/static/') ? ((note.frontmatter as Record<string, unknown>)?.source_url as string || note.media!.video?.url) : undefined}
                  title=""
                  workspaceId={workspaceId}
                  onTimeUpdate={handleTimeUpdate}
                  onDurationChange={handleVideoDurationChange}
                  markers={videoFrames}
                  renderTransportInline={false}
                  onTransportChange={handleTransportChange}
                  isPipActive={isPip}
                  onTogglePip={togglePip}
                  subtitle={isPip ? undefined : videoSubtitle}
                />
              </div>
              {isPip && (
                <div className="note-pip-simple-controls">
                  <button className="note-pip-control-btn note-pip-control-btn--play" onClick={handlePipTogglePlay} title={pipPlaying ? '暂停' : '播放'}>
                    {pipPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
                  </button>
                  <div className="note-pip-simple-progress" onClick={handlePipProgressClick} title={`${formatTimecode(currentTime)} / ${formatTimecode(videoDuration)}`}>
                    <span style={{ width: `${videoDuration ? Math.min(100, Math.max(0, (currentTime / videoDuration) * 100)) : 0}%` }} />
                  </div>
                  <button className="note-pip-control-btn" onClick={handlePipScreenshot} title="截取当前帧">
                    <Camera size={14} />
                  </button>
                </div>
              )}
            </div>
            {/* 控制条 + 时间线（在 player-wrap 外，避免 overflow:hidden 截断） */}
            {!isPip && transportNode}
            {!isPip && videoFrames.length > 0 && (
              <div className="note-chapters" aria-label="关键帧轨">
                {videoFrames.map((frame, idx) => (
                  <button
                    key={`${frame.sec}-${frame.url}`}
                    className={`note-thumb${idx === activeFrameIdx ? ' is-active' : ''}`}
                    onClick={() => handleSeek(frame.sec)}
                    title={`跳转到 ${formatTimecode(frame.sec)}`}
                  >
                    <img src={frame.url} alt="" loading="lazy" />
                    <span>{formatTimecode(frame.sec)}</span>
                  </button>
                ))}
              </div>
            )}
            {/* 转录 */}
            {!isPip && Array.isArray(note.transcript) && (note.transcript as VideoResultTranscriptLine[]).length > 0 ? (
              <div className="nibi-note-transcript-wrap">
                <LNTranscriptPanel
                  transcript={note.transcript as VideoResultTranscriptLine[]}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                  workspaceId={workspaceId}
                  itemId={itemId}
                  onSaved={refreshAfterTranscriptEdit}
                  translations={note.translations ?? null}
                  title="转录"
                  countLabel={`${transcriptCount} 条`}
                />
              </div>
            ) : !isPip ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mut)', fontSize: 12, padding: 24 }}>暂无字幕</div>
            ) : null}
          </div>

          {!isPip && (
            <div
              className="nibi-note-splitter"
              role="separator"
              aria-label="调整左右栏宽度"
              aria-orientation="vertical"
              aria-valuemin={VIDEO_SPLIT_MIN}
              aria-valuemax={VIDEO_SPLIT_MAX}
              aria-valuenow={Math.round(noteLeftPct)}
              tabIndex={0}
              onPointerDown={handleNoteSplitPointerDown}
              onKeyDown={handleNoteSplitKeyDown}
            >
              <span className="nibi-note-splitter-grip" />
            </div>
          )}

          {/* ── 右栏（40%）：标签 + 结构化笔记 ── */}
          <div className="nibi-note-right">
            <div className={`nibi-note-right-scroll${showInlineToc ? ' has-toc' : ''}`} ref={noteScrollRef}>
              <div className="note-copy">
                <div className="note-copy-head">
                  <h1>{title || '未命名笔记'}</h1>
                </div>
                {noteMetaPanel}
                {/* 总结版本切换 */}
                {summaries.length > 0 && (() => {

                  return (
                    <div className="note-section" style={{ marginTop: 16 }}>
                      <h2>内容总结</h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                        {[...templateGroups.entries()].map(([tmpl]) => (
                          <button
                            key={tmpl}
                            className="btn-ghost"
                            onClick={() => { const first = templateGroups.get(tmpl)?.[0]; if (first) handleSelectSummary(first) }}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: tmpl === activeTemplate ? 'var(--accl)' : 'var(--bgalt)', color: tmpl === activeTemplate ? 'var(--acc)' : 'var(--mut)', fontWeight: tmpl === activeTemplate ? 600 : 400 }}
                          >
                            {tl(tmpl)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                {/* 正文（MilkdownEditor 渲染 h2/h3/p/ul/blockquote → 设计稿 .note-section 自动匹配） */}
                <div className="note-section" style={{ marginTop: summaries.length > 0 ? 0 : 16 }}>
                  <div className="nibi-note-editor-panel">
                    <MilkdownEditor key={milkdownKey} markdown={editingBody} onMarkdownChange={handleEditorChange} onSeek={handleSeek} />
                  </div>
                </div>
                {/* 保存状态 */}
                <div style={{ padding: '12px 0', textAlign: 'right' }}>{saveStatusNode}</div>
              </div>
              {inlineTocNode}
            </div>
          </div>
        </div>
        </>
      ) : isAudioNote ? (
        <>
        {/* ── 音频笔记两栏布局：.note-page（设计稿 pg-audio 对齐） ── */}
        <div className={`nibi-note-page nibi-note-page--audio${isPip ? ' is-pip' : ''}`} ref={notePageRef} style={notePageStyle}>

          {/* ── 左栏：播放器 + 波形 + 控制 + 转录 ── */}
	          <div className="nibi-note-left nibi-audio-left vm-ln-scope">
            <div
              className={`nibi-audio-player-shell${isPip ? ' is-pip' : ''}${pipDragging ? ' is-dragging' : ''}`}
              style={isPip && pipPosition ? { width: pipWidth, left: pipPosition.x, top: pipPosition.y, right: 'auto', bottom: 'auto' } : undefined}
            >
              {isPip && (
                <div className="note-pip-head note-audio-pip-head" onPointerDown={handlePipHeaderPointerDown}>
                  <span className="note-pip-badge">音频小窗</span>
                  <div className="note-pip-head-actions">
                    <button className="note-pip-head-btn" onClick={handleAudioPipTogglePlay} title={pipPlaying ? '暂停' : '播放'}>
                      {pipPlaying ? <Pause size={13} /> : <Play size={13} fill="currentColor" />}
                    </button>
                    <button className="note-pip-head-btn" onClick={cyclePipSize} title="切换尺寸">
                      {['小', '中', '大'][pipSizeIndex]}
                    </button>
                    <button className="note-pip-head-btn note-pip-head-btn--danger" onClick={closePip} title="关闭音频小窗">
                      <X size={13} />
                    </button>
                  </div>
                </div>
              )}
              <div className="nibi-audio-player-wrap">
                <NoteAudioPanel
                  ref={audioRef}
                  src={note.media!.audio!}
	                  onTimeUpdate={handleTimeUpdate}
	                  onDurationChange={handleAudioDurationChange}
	                  onTransportChange={handleAudioTransportChange}
	                  isPipActive={isPip}
	                  onTogglePip={togglePip}
	                />
	              </div>
	              {/* 波形 + 时间 + 控制条（player 外，overflow 安全） */}
	              {audioTransportNode}
              {isPip && (
                <div className="note-audio-pip-caption">
                  <div className="note-pip-simple-progress" onClick={handleAudioPipProgressClick} title={`${formatTimecode(currentTime)} / ${formatTimecode(effectiveAudioDuration)}`}>
                    <span style={{ width: `${effectiveAudioDuration ? Math.min(100, Math.max(0, (currentTime / effectiveAudioDuration) * 100)) : 0}%` }} />
                  </div>
                  <div className="note-audio-pip-subtitle">
                    <span>{formatTimecode(currentTime)}</span>
                    <p>{audioSubtitle || '暂无当前字幕'}</p>
                  </div>
	                </div>
	              )}
	            </div>
	            {!isPip && audioChapters.length > 0 && (
	              <div className="note-audio-chapters" aria-label="音频章节">
	                <div className="note-audio-chapters-head">
	                  <span>关键时间点</span>
	                  <small>{audioChapters.length} 段</small>
	                </div>
	                <div className="note-audio-chapter-track">
	                  {audioChapters.map((chapter, idx) => (
	                    <button
	                      key={`${chapter.start}-${chapter.title}`}
	                      className={`note-audio-chapter${idx === activeAudioChapterIdx ? ' is-active' : ''}`}
	                      onClick={() => handleSeek(chapter.start)}
	                      title={`跳转到 ${formatTimecode(chapter.start)}`}
	                    >
	                      <span className="note-audio-chapter-time">{formatTimecode(chapter.start)}</span>
	                      <strong>{chapter.title}</strong>
	                      <small>{chapter.summary}</small>
	                    </button>
	                  ))}
	                </div>
	              </div>
	            )}
            {/* 转录 */}
            {!isPip && transcriptLines.length > 0 ? (
              <div className="nibi-note-transcript-wrap">
                <LNTranscriptPanel
                  transcript={transcriptLines}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                  workspaceId={workspaceId}
                  itemId={itemId}
                  onSaved={refreshAfterTranscriptEdit}
                  translations={note.translations ?? null}
                  title="转录文本"
                  countLabel={`${transcriptCount} 条`}
                />
              </div>
            ) : !isPip ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mut)', fontSize: 12, padding: 24 }}>暂无转录</div>
            ) : null}
          </div>

          {!isPip && (
            <div
              className="nibi-note-splitter"
              role="separator"
              aria-label="调整左右栏宽度"
              aria-orientation="vertical"
              aria-valuemin={VIDEO_SPLIT_MIN}
              aria-valuemax={VIDEO_SPLIT_MAX}
              aria-valuenow={Math.round(noteLeftPct)}
              tabIndex={0}
              onPointerDown={handleNoteSplitPointerDown}
              onKeyDown={handleNoteSplitKeyDown}
            >
              <span className="nibi-note-splitter-grip" />
            </div>
          )}

          {/* ── 右栏：标题 + 标签 + 总结 + 正文 ── */}
          <div className="nibi-note-right">
            <div className={`nibi-note-right-scroll${showInlineToc ? ' has-toc' : ''}`} ref={noteScrollRef}>
              <div className="note-copy">
                <div className="note-copy-head">
                  <h1>{title || '未命名笔记'}</h1>
                </div>
                {noteMetaPanel}
                {/* 总结版本切换 */}
                {summaries.length > 0 && (() => {

                  return (
                    <div className="note-section" style={{ marginTop: 16 }}>
                      <h2>内容总结</h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                        {[...templateGroups.entries()].map(([tmpl]) => (
                          <button
                            key={tmpl}
                            className="btn-ghost"
                            onClick={() => { const first = templateGroups.get(tmpl)?.[0]; if (first) handleSelectSummary(first) }}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: tmpl === activeTemplate ? 'var(--accl)' : 'var(--bgalt)', color: tmpl === activeTemplate ? 'var(--acc)' : 'var(--mut)', fontWeight: tmpl === activeTemplate ? 600 : 400 }}
                          >
                            {tl(tmpl)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                {/* 正文 */}
                <div className="note-section" style={{ marginTop: summaries.length > 0 ? 0 : 16 }}>
                  <div className="nibi-note-editor-panel">
                    <MilkdownEditor key={milkdownKey} markdown={editingBody} onMarkdownChange={handleEditorChange} onSeek={handleSeek} />
                  </div>
                </div>
                {/* 保存状态 */}
                <div style={{ padding: '12px 0', textAlign: 'right' }}>{saveStatusNode}</div>
              </div>
              {inlineTocNode}
            </div>
          </div>
        </div>
        </>
      ) : isImageNote ? (
        /* ── 图文笔记两栏布局（设计稿 pg-image 对齐） ── */
        <>
        <div className="nibi-note-page nibi-note-page--image" ref={notePageRef} style={notePageStyle}>

          {/* ── 左栏：画廊 + meta ── */}
          <div className="nibi-note-left nibi-image-left">
            <div className="nibi-image-gallery">
              {/* 主图 */}
              <div className="nibi-image-main">
                {imageLoadError[selectedImageIdx] ? (
                  <span style={{ color: 'var(--mut)', fontSize: 12 }}>图片加载失败</span>
                ) : (
                  <img
                    src={images[selectedImageIdx]}
                    alt={title ? `${title}（${selectedImageIdx + 1}）` : `图片 ${selectedImageIdx + 1}`}
                    onError={() => setImageLoadError((prev) => ({ ...prev, [selectedImageIdx]: true }))}
                  />
                )}
              </div>
              {/* 缩略图列表 */}
              {images.length > 1 && (
                <div className="nibi-image-thumbs">
                  {images.map((img, idx) => (
                    <button
                      key={idx}
                      className={`nibi-image-thumb${idx === selectedImageIdx ? ' is-active' : ''}`}
                      onClick={() => setSelectedImageIdx(idx)}
                    >
                      <img src={img} alt="" />
                    </button>
                  ))}
                </div>
              )}
              {/* 计数 */}
              {images.length > 1 && (
                <div className="nibi-image-counter">
                  {selectedImageIdx + 1} / {images.length}
                </div>
              )}
            </div>
            {/* meta：来源 / 创建时间 / OCR 识别文本 */}
            <div className="nibi-image-meta">
              <div className="nibi-image-meta-row">
                <span className="nibi-image-meta-label">来源</span>
                <span className="nibi-image-meta-value">{sourceLabel}</span>
              </div>
              {/* OCR 识别文本（仅当非空时显示） */}
              {currentInfo?.ocr_text && (
                <details style={{ marginTop: 2 }}>
                  <summary style={{ fontSize: 10, color: 'var(--mut)', cursor: 'pointer', userSelect: 'none', padding: '2px 0' }}>
                    识别文本
                  </summary>
                  <div style={{ fontSize: 11, color: 'var(--fg2)', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto', padding: '4px 0' }}>
                    {currentInfo.ocr_text}
                  </div>
                </details>
              )}
            </div>
          </div>

          <div
            className="nibi-note-splitter"
            role="separator"
            aria-label="调整左右栏宽度"
            aria-orientation="vertical"
            aria-valuemin={VIDEO_SPLIT_MIN}
            aria-valuemax={VIDEO_SPLIT_MAX}
            aria-valuenow={Math.round(noteLeftPct)}
            tabIndex={0}
            onPointerDown={handleNoteSplitPointerDown}
            onKeyDown={handleNoteSplitKeyDown}
          >
            <span className="nibi-note-splitter-grip" />
          </div>

          {/* ── 右栏：标题 + 标签 + 总结 + 正文 ── */}
          <div className="nibi-note-right">
            <div className={`nibi-note-right-scroll${showInlineToc ? ' has-toc' : ''}`} ref={noteScrollRef}>
              <div className="note-copy">
                <div className="note-copy-head">
                  <h1>{title || '未命名笔记'}</h1>
                </div>
                {noteMetaPanel}
                {/* 总结版本切换 */}
                {summaries.length > 0 && (() => {

                  return (
                    <div className="note-section" style={{ marginTop: 16 }}>
                      <h2>内容总结</h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                        {[...templateGroups.entries()].map(([tmpl]) => (
                          <button
                            key={tmpl}
                            className="btn-ghost"
                            onClick={() => { const first = templateGroups.get(tmpl)?.[0]; if (first) handleSelectSummary(first) }}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: tmpl === activeTemplate ? 'var(--accl)' : 'var(--bgalt)', color: tmpl === activeTemplate ? 'var(--acc)' : 'var(--mut)', fontWeight: tmpl === activeTemplate ? 600 : 400 }}
                          >
                            {tl(tmpl)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                {/* 正文 */}
                <div className="note-section" style={{ marginTop: summaries.length > 0 ? 0 : 16 }}>
                  <div className="nibi-note-editor-panel">
                    <MilkdownEditor key={milkdownKey} markdown={editingBody} onMarkdownChange={handleEditorChange} onSeek={handleSeek} />
                  </div>
                </div>
                {/* 保存状态 */}
                <div style={{ padding: '12px 0', textAlign: 'right' }}>{saveStatusNode}</div>
              </div>
              {inlineTocNode}
            </div>
          </div>
        </div>
        </>
      ) : isTextNote ? (
        /* ── 文本笔记两栏布局（设计稿 pg-text 对齐） ── */
        <>
        <div className="nibi-note-page nibi-note-page--text" ref={notePageRef} style={notePageStyle}>

          {/* ── 左栏：工具栏 + 编辑器 ── */}
          <div className="nibi-note-left nibi-text-left">
            <div className="nibi-text-toolbar">
              {/* TODO Stage 4: 核对 Milkdown 已支持的命令，对齐设计稿工具栏 */}
              <button className="btn-ghost" disabled title="加粗（Milkdown 已支持，待接入）">B</button>
              <button className="btn-ghost" disabled title="斜体（Milkdown 已支持，待接入）">I</button>
              <button className="btn-ghost" disabled title="标题（Milkdown 已支持，待接入）">H</button>
              <button className="btn-ghost" disabled title="列表（Milkdown 已支持，待接入）">•</button>
            </div>
            <div className="nibi-text-editor-content">
              <div className="nibi-note-editor-panel">
                <MilkdownEditor key={milkdownKey} markdown={editingBody} onMarkdownChange={handleEditorChange} onSeek={handleSeek} />
              </div>
            </div>
          </div>

          <div
            className="nibi-note-splitter"
            role="separator"
            aria-label="调整左右栏宽度"
            aria-orientation="vertical"
            aria-valuemin={VIDEO_SPLIT_MIN}
            aria-valuemax={VIDEO_SPLIT_MAX}
            aria-valuenow={Math.round(noteLeftPct)}
            tabIndex={0}
            onPointerDown={handleNoteSplitPointerDown}
            onKeyDown={handleNoteSplitKeyDown}
          >
            <span className="nibi-note-splitter-grip" />
          </div>

          {/* ── 右栏：标题 + 标签 + 总结 + 正文 ── */}
          <div className="nibi-note-right nibi-text-right">
            <div className={`nibi-note-right-scroll${showInlineToc ? ' has-toc' : ''}`} ref={noteScrollRef}>
              <div className="note-copy">
                <div className="note-copy-head">
                  <h1>{title || '未命名笔记'}</h1>
                </div>
                {noteMetaPanel}
                {/* 总结版本切换 */}
                {summaries.length > 0 && (() => {

                  return (
                    <div className="note-section" style={{ marginTop: 16 }}>
                      <h2>内容总结</h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                        {[...templateGroups.entries()].map(([tmpl]) => (
                          <button
                            key={tmpl}
                            className="btn-ghost"
                            onClick={() => { const first = templateGroups.get(tmpl)?.[0]; if (first) handleSelectSummary(first) }}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: tmpl === activeTemplate ? 'var(--accl)' : 'var(--bgalt)', color: tmpl === activeTemplate ? 'var(--acc)' : 'var(--mut)', fontWeight: tmpl === activeTemplate ? 600 : 400 }}
                          >
                            {tl(tmpl)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                {/* 正文 */}
                <div className="note-section" style={{ marginTop: summaries.length > 0 ? 0 : 16 }}>
                  <div className="nibi-note-editor-panel">
                    <MilkdownEditor key={milkdownKey} markdown={editingBody} onMarkdownChange={handleEditorChange} onSeek={handleSeek} />
                  </div>
                </div>
                {/* 保存状态 */}
                <div style={{ padding: '12px 0', textAlign: 'right' }}>{saveStatusNode}</div>
              </div>
              {inlineTocNode}
            </div>
          </div>
        </div>
        </>
      ) : (
        <div className="nibi-note-workbench nibi-note-workbench--generic">
          <div className="nibi-note-main-panel">
            <div className="nibi-note-panel-head">
              <span>笔记正文</span>
              {saveStatusNode}
            </div>
            <div className="nibi-note-editor-scroll">
              {noteContent}
            </div>
          </div>

          <aside className="nibi-note-aside">
            <section className="nibi-note-side-card">
              <div className="nibi-note-card-kicker">MATERIAL</div>
              <h2>{title || '未命名素材'}</h2>
              <dl>
                <div>
                  <dt>类型</dt>
                  <dd>{TYPE_LABEL[itemType] ?? itemType}</dd>
                </div>
                <div>
                  <dt>来源</dt>
                  <dd>{sourceLabel}</dd>
                </div>
                <div>
                  <dt>转写</dt>
                  <dd>{transcriptCount > 0 ? `${transcriptCount} 句` : '暂无'}</dd>
                </div>
                <div>
                  <dt>总结</dt>
                  <dd>{summaries.length > 0 ? `${summaries.length} 个版本` : '可生成'}</dd>
                </div>
              </dl>
            </section>

            {chatOpen && (
              <div style={{ height: 320, borderTop: '1px solid var(--bdr)', display: 'flex', overflow: 'hidden' }}>
                <NoteChatDrawer
                  workspaceId={workspaceId}
                  systemPrompt={chatSystemPrompt}
                  scopeHint="仅基于当前 note.md 与转录上下文回答"
                  mode="inline"
                />
              </div>
            )}
            {(itemType === 'audio' && note.media?.audio) && (
              <section className="nibi-note-side-card nibi-note-media-card">
                <div className="nibi-note-card-kicker">AUDIO SOURCE</div>
                <NoteMediaCompanion
                  ref={mediaCompanionRef}
                  media={note.media}
                  transcript={Array.isArray(note.transcript) ? note.transcript as never : []}
                  workspaceId={workspaceId}
                  itemId={itemId}
                  sourceUrl={(note.frontmatter as Record<string, unknown>)?.source_url as string || ''}
                  translations={note.translations ?? null}
                />
              </section>
            )}
          </aside>
        </div>
      )}

      {/* 问 AI 悬浮泡泡（视频/音频/文本笔记） */}
      {(isVideoNote || isAudioNote || isTextNote) && (
        <FloatingAskAi
          workspaceId={workspaceId}
          systemPrompt={chatSystemPrompt}
          scopeHint="仅基于当前 note.md 与转录上下文回答"
          open={askAiOpen}
          onOpenChange={setAskAiOpen}
          hideTrigger
        />
      )}

      {operationNotice && (
        <div
          className="nibi-note-operation-notice"
          data-tone={operationNotice.tone}
          role="status"
          aria-live="polite"
        >
          <span className="nibi-note-operation-dot" />
          <span>{operationNotice.message}</span>
          {operationNotice.onAction && (
            <button
              className="nibi-note-operation-action"
              onClick={operationNotice.onAction}
            >
              {operationNotice.actionLabel ?? '取消'}
            </button>
          )}
        </div>
      )}

      {/* VN4.3 新建/重新生成总结弹窗（从 AI 工具菜单触发） */}
      {showNewSummaryModal && (
        <NewSummaryModal
          creating={creatingSummary}
          defaultTemplate={note.summary_hint?.default_template}
          onSubmit={handleCreateSummary}
          onClose={() => setShowNewSummaryModal(false)}
        />
      )}
      <SourceMdModal
        open={sourceMdOpen}
        sourceMd={note.source_md}
        onClose={() => setSourceMdOpen(false)}
        onDownload={handleDownloadSourceMd}
        downloading={exportBusy === 'source_md'}
      />
    </div>
  )
}
