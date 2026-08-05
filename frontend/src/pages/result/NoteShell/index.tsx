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
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpenCheck, Brain, Camera, Check, ChevronDown, Copy, Download, ExternalLink, FileDown, FileText, FileType, Film, History, Image, List, MessageCircle, Pause, Pencil, Play, Plus, Presentation, RefreshCw, Sparkles, Subtitles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

import { createChapterSummaries, downloadItemNoteExport, downloadOriginalMedia, downloadSoftSubMedia, downloadSubtitles, downloadTranscript, downloadTranscriptDoc, exportItemNoteObsidian, exportNoteToObsidianVault, getItemNote, putItemNote, startBurnSubtitles, updateSpeakerMap, type ItemNoteExportFormat, type TranscriptExportMode } from '@/services/workspaces'
import { fetchSettings } from '@/services/settings'
import type { VideoResultTranscriptLine } from '@/services/workspaces'
import type { ItemNote, NoteChapter } from '@/types/workspace'
import { createSummary, deleteSummary, listSummaries, renameSummary, updateSummaryContent, type ItemSummary } from '@/services/summaries'
import { retryPipelineTask } from '@/services/pipeline'
import { MarkdownToc, extractToc, slugify } from '@/components/MarkdownToc'
import { platformLabelFromUrl } from './note-shell-utils'
import { Badge } from '@/components/ui/badge'
import { SYSTEM_TAG_DIMENSIONS } from '@/constants/tagDimensions'
import { inferContentTags } from '@/lib/contentTags'
import NoteMediaCompanion, { type NoteMediaCompanionHandle } from './NoteMediaCompanion'
import MilkdownEditor from './MilkdownEditor'
import EditorToolbar from './EditorToolbar'
import { EDITOR_PREFS_STORAGE_KEY, FONT_FAMILY_VALUE, FONT_WEIGHT_VALUE, TEXT_TONE_VALUE, readEditorPrefs, type NoteEditorPrefs } from './editorPrefs'
import LNVideoPanel, { type LNVideoPanelHandle } from '@/pages/results/LearningNotesPage/LNVideoPanel'
import LNTranscriptPanel from '@/pages/results/LearningNotesPage/LNTranscriptPanel'
import NoteAudioPanel, { type NoteAudioPanelHandle } from './NoteAudioPanel'
import { NoteHistoryPanel } from './NoteHistoryPanel'
import '@/pages/results/LearningNotesPage/learning-notes.css'
import './note-shell.css'
import { NewSummaryModal } from '@/components/NewSummaryModal'
import { FloatingAskAi } from './FloatingAskAi'
import { AiArtifactPanel } from './AiArtifactPanel'
import type { NoteArtifactKind } from '@/services/noteArtifacts'
import { useTaskStore } from '@/store/taskStore'
import type { TaskRecord } from '@/types/task'
import { SourceMdModal } from './SourceMdModal'
import { NotionExportDialog } from './NotionExportDialog'
import { FeishuExportDialog } from './FeishuExportDialog'
import { ChapterEvidenceStrip } from './ChapterEvidenceStrip'
import { ChapterTimelineStrip } from './ChapterTimelineStrip'
import { NoteExportPanel, type ExportDestination, type ExportPlan } from './NoteExportPanel'
import SpeakerDiarizationRow, { type SpeakerDiarizationInfo, type SpeakerDiarizationStatus } from './SpeakerDiarizationRow'
import { withStatusToast } from '@/lib/statusToast'
import { categorizeError } from '@/lib/errorCategories'

type NoteExportBusy = ItemNoteExportFormat | 'markdown' | 'obsidian' | 'transcript_article' | 'transcript_speakers' | 'source_md'
type NoteExportSource = 'current' | 'main' | 'transcript' | 'speaker_transcript' | 'source'
type NoteExportFormatGroup = {
  label: string
  items: Array<{ icon: ReactNode; label: string; format: ItemNoteExportFormat }>
}
type OperationNoticeTone = 'loading' | 'success' | 'error' | 'info'
type OperationNotice = {
  id: number
  message: string
  tone: OperationNoticeTone
  actionLabel?: string
  onAction?: () => void
}

const SPEAKER_ROLE_OPTIONS = ['主持人', '我司领导', '客户', '讲师', '其他'] as const

/* ────────────────── helpers ────────────────── */

/** 从 note_md 提取正文 body（去掉 YAML frontmatter）。 */
function extractBody(noteMd: string): string {
  if (!noteMd.startsWith('---\n')) return noteMd
  const parts = noteMd.split('---\n')
  const rest = parts.slice(1).join('---\n')
  const idx = rest.indexOf('---\n')
  return idx >= 0 ? rest.slice(idx + 4) : noteMd
}

/**
 * 音视频的 note.md 可能只有完整转写；这类内容由转写面板展示，
 * 不应再整体交给 Milkdown，否则长音频会创建数千个编辑器节点。
 */
function extractEditableBody(noteMd: string, itemType: string): string {
  const body = extractBody(noteMd)
  if (itemType !== 'audio' && itemType !== 'video') return body

  const transcriptHeading = /^##\s+转写正文\s*$/m.exec(body)
  if (!transcriptHeading || transcriptHeading.index === undefined) return body

  const before = body.slice(0, transcriptHeading.index).trim()
  const afterTranscript = body.slice(transcriptHeading.index + transcriptHeading[0].length)
  const nextSectionIndex = afterTranscript.search(/^##\s+/m)
  const after = (nextSectionIndex >= 0
    ? afterTranscript.slice(nextSectionIndex)
    : '').trim()

  return [before, after].filter(Boolean).join('\n\n')
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
  speaker_meeting: '会议纪要（区分说话人）',
  speaker_interview: '线下采访（区分说话人）',
  speaker_customer_reception: '客户接待（区分说话人）',
  speaker_consultant_detailed: '咨询师录音版本详细总结',
  speaker_consultant_meeting_customer_voice: '咨询师录音版会议纪要/客户声音',
}
const tl = (id: string) => TEMPLATE_LABELS[id] ?? id

type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed'
const VIDEO_SPLIT_MIN = 20
const VIDEO_SPLIT_MAX = 72
// Q2：1024 窄窗双列按 55/45 紧凑布局，默认分栏取同一比例
const VIDEO_SPLIT_DEFAULT = 55
const VIDEO_SPLIT_STORAGE_KEY = 'nibi.note.videoLeftPct'

const PIP_WIDTHS = [240, 320, 440]

type AudioChapter = {
  start: number
  end: number
  title: string
  summary: string
  keywords: string[]
  source?: 'llm' | 'fallback'
}

const AUDIO_KEYWORD_STOPWORDS = new Set([
  '这个', '那个', '然后', '就是', '我们', '你们', '他们', '大家', '可以', '一个', '一些', '进行',
  '如果', '因为', '所以', '但是', '或者', '以及', '其实', '比较', '时候', '现在', '需要', '没有',
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'are', 'was', 'can',
])

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

function buildChapterSummary(text: string, max = 42): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return '暂无内容提要'
  // 优先取一个完整短句，避免关键时间点卡片直接展示整段逐字稿。
  const sentence = normalized.match(/^(.{12,}?)(?:[。！？!?；;]|$)/)?.[1]?.trim()
  return compactText(sentence || normalized, max)
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
  const firstTime = transcript[0]?.t_sec ?? 0
  const lastTime = transcript[transcript.length - 1]?.t_sec ?? firstTime
  const span = Math.max(1, lastTime - firstTime)
  const bucketCount = Math.min(12, Math.max(1, Math.ceil(span / 42)))
  const bucketSpan = span / bucketCount
  const buckets = Array.from({ length: bucketCount }, () => [] as VideoResultTranscriptLine[])

  for (const line of transcript) {
    const bucketIdx = Math.min(
      bucketCount - 1,
      Math.max(0, Math.floor((line.t_sec - firstTime) / bucketSpan)),
    )
    buckets[bucketIdx].push(line)
  }

  const groups = buckets.filter((group) => group.length > 0)
  return groups.map((group, idx) => {
    const text = group.map((line) => line.text).join(' ')
    const keywords = extractAudioKeywords(text, 4)
    const nextStart = groups[idx + 1]?.[0]?.t_sec
    return {
      start: group[0]?.t_sec ?? firstTime,
      end: nextStart ?? lastTime,
      title: keywords.length > 0 ? keywords.slice(0, 3).join(' / ') : compactText(text, 18),
      summary: buildChapterSummary(text),
      keywords,
    }
  })
}

function modelAudioChapters(chapters: NoteChapter[] | undefined): AudioChapter[] {
  if (!Array.isArray(chapters)) return []
  return chapters
    .filter((chapter) => Number.isFinite(chapter.start) && typeof chapter.summary === 'string' && chapter.summary.trim())
    .map((chapter) => ({
      start: Math.max(0, Number(chapter.start)),
      end: Math.max(Number(chapter.start), Number(chapter.end) || Number(chapter.start)),
      title: chapter.title || '未命名章节',
      summary: chapter.summary.trim(),
      keywords: Array.isArray(chapter.keywords) ? chapter.keywords.filter(Boolean) : [],
      source: chapter.source,
    }))
    .sort((left, right) => left.start - right.start)
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

function buildChatSystemPrompt(body: string): string {
  const parts = [
    '你正在协助用户理解一篇单素材笔记。回答时只能基于下方 note.md 正文和后端检索到的转录证据，不要编造素材里没有的信息。',
    '',
    '【note.md 正文】',
    body || '（暂无笔记内容）',
  ]
  parts.push('', '回答指引：结合检索到的转录证据作答；如果用户问到时间点，请引用对应转录；回答使用中文。')
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

function downloadHtmlFile(
  markdown: string,
  title: string,
  textAlign: NoteEditorPrefs['textAlign'] = 'left',
): void {
  const escaped = markdown
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${safeFilename(title)}</title><style>body{max-width:800px;margin:40px auto;padding:0 24px;font:16px/1.8 system-ui;color:#191410}pre{white-space:pre-wrap;font:inherit;text-align:${textAlign}}</style></head><body><pre>${escaped}</pre></body></html>`
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeFilename(title)}.html`
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
    transcript_txt: 'txt',
    srt: 'srt',
    vtt: 'vtt',
    ass: 'ass',
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
    transcript_txt: '转写文本',
    srt: 'SRT 字幕',
    vtt: 'VTT 字幕',
    ass: 'ASS 字幕',
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

const AUDIO_SPEAKER_COLORS = ['#4f8fd8', '#d45b86', '#3f9a73', '#d58a3e', '#8364c5', '#aa9a32']
function audioSpeakerColor(speakerId: string): string {
  let hash = 0
  for (const ch of speakerId) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return AUDIO_SPEAKER_COLORS[Math.abs(hash) % AUDIO_SPEAKER_COLORS.length]
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
  onTagSelect?: (dimension: string, value: string) => void
}

/** 把 frontmatter.tags（6 维系统标签 + custom_tags）渲染为 chips。 */
function TagChips({ tags, onTagSelect }: TagChipsProps) {
  if (!tags || typeof tags !== 'object') return null

  const systemChips = SYSTEM_TAG_DIMENSIONS
    .filter((dim) => !!tags[dim.key])
    .map((dim) => (
      <button
        key={dim.key}
        type="button"
        className="nibi-note-tag-filter"
        onClick={() => onTagSelect?.(dim.key, String(tags[dim.key]))}
        title={`按「${dim.label}」筛选合集`}
      >
        <Badge variant="secondary">
          {dim.label} · {String(tags[dim.key])}
        </Badge>
      </button>
    ))

  const customRaw = tags.custom_tags
  const customChips = Array.isArray(customRaw)
    ? customRaw.map((ct: string) => (
        <button
          key={ct}
          type="button"
          className="nibi-note-tag-filter"
          onClick={() => onTagSelect?.('custom', ct)}
          title={`按「${ct}」筛选合集`}
        >
          <Badge variant="outline">{ct}</Badge>
        </button>
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
  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({})
  const [speakerRoles, setSpeakerRoles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [askAiOpen, setAskAiOpen] = useState(false)
  const [askAiWidth, setAskAiWidth] = useState(400)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportSource, setExportSource] = useState<NoteExportSource | null>(null)
  const [exportPanelOpen, setExportPanelOpen] = useState(false)
  const [exportBusy, setExportBusy] = useState<NoteExportBusy | null>(null)
  // Q3：转写导出的「区分说话人」选项（选项而非独立内容源）
  const [transcriptWithSpeaker, setTranscriptWithSpeaker] = useState(false)
  // Q3：媒体导出进行中状态
  const [mediaExporting, setMediaExporting] = useState<string | null>(null)
  const [notionExportOpen, setNotionExportOpen] = useState(false)
  const [feishuExportOpen, setFeishuExportOpen] = useState(false)
  // Q3 / D3：Obsidian 直写同名冲突确认（目标已存在时弹框，需用户主动选择覆盖）
  const [obsidianConflict, setObsidianConflict] = useState<{
    vault_path: string
    subdir: string
    relative: string
    source_kind: 'main' | 'summary'
    summary_id?: string
  } | null>(null)
  const [immersiveOpen, setImmersiveOpen] = useState(false)
  const [sourceMdOpen, setSourceMdOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // VN4.3 AI 工具下拉
  const [aiToolsOpen, setAiToolsOpen] = useState(false)
  const [artifactTool, setArtifactTool] = useState<NoteArtifactKind | null>(null)
  const aiToolsDropRef = useRef<HTMLDivElement>(null)
  const exportDropRef = useRef<HTMLDivElement>(null)
  const exportAbortRef = useRef<AbortController | null>(null)
  const operationNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const operationNoticeSeqRef = useRef(0)
  const [operationNotice, setOperationNotice] = useState<OperationNotice | null>(null)
  // 新建总结（复用 NewSummaryModal）
  const [showNewSummaryModal, setShowNewSummaryModal] = useState(false)
  // AI 工具菜单常用模板快捷项预选值；undefined 表示用 note.summary_hint 默认模板
  const [newSummaryTemplate, setNewSummaryTemplate] = useState<string | undefined>(undefined)
  const [newSummaryMode, setNewSummaryMode] = useState<'general' | 'speaker_aware' | undefined>(undefined)
  const [creatingSummary, setCreatingSummary] = useState(false)
  const [creatingSummaryTaskId, setCreatingSummaryTaskId] = useState<string | null>(null)
  const [creatingChapters, setCreatingChapters] = useState(false)
  const [creatingChapterTaskId, setCreatingChapterTaskId] = useState<string | null>(null)
  const [retryingAutoSummary, setRetryingAutoSummary] = useState(false)
  const [retryingSpeakerAnalysis, setRetryingSpeakerAnalysis] = useState(false)
  const [editorPrefs, setEditorPrefs] = useState<NoteEditorPrefs>(readEditorPrefs)
  const pipelineTasks = useTaskStore((state) => state.tasks)
  const addPipelineTask = useTaskStore((state) => state.addTask)

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
  const immersiveTriggerRef = useRef<HTMLButtonElement>(null)
  const immersiveWasOpenRef = useRef(false)
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
  const summarySelectionEpochRef = useRef(0)
  const summaryCreationEpochRef = useRef<number | null>(null)
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

  // 按「总结模式 + template」分组，避免普通总结与区分说话人总结混在一起。
  const templateGroups = useMemo(() => {
    const map = new Map<string, ItemSummary[]>()
    for (const s of summaries) {
      const key = `${s.summary_mode ?? 'general'}::${s.template}`
      const arr = map.get(key) ?? []
      arr.push(s)
      map.set(key, arr)
    }
    // 每组内按 version 排序
    for (const arr of map.values()) arr.sort((a, b) => a.version - b.version)
    return map
  }, [summaries])

  const orderedSummaries = useMemo(() => [...summaries].sort((a, b) => (
    a.version - b.version
    || a.created_at.localeCompare(b.created_at)
    || a.summary_id.localeCompare(b.summary_id)
  )), [summaries])

  const summaryGroupLabel = useCallback((key: string) => {
    const [mode, template] = key.split('::', 2)
    return mode === 'speaker_aware' ? `区分说话人 · ${tl(template)}` : tl(template)
  }, [])

  const summaryGroupKey = useCallback((summary: ItemSummary) => (
    `${summary.summary_mode ?? 'general'}::${summary.template}`
  ), [])

  const activeTemplate = useMemo(() => {
    if (!activeSummaryId) return templateGroups.keys().next().value ?? ''
    const s = summaries.find((x) => x.summary_id === activeSummaryId)
    return s ? summaryGroupKey(s) : ''
  }, [activeSummaryId, summaries, summaryGroupKey, templateGroups])

  useEffect(() => {
    let cancelled = false
    listSummaries(workspaceId, itemId)
      .then((data) => { if (!cancelled) setSummaries(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, itemId, activeSummaryId, summariesVersion])

  useEffect(() => {
    if (!activeSummaryId) return
    const active = summaries.find((summary) => summary.summary_id === activeSummaryId)
    if (active) switchEditorBody(active.content_md)
  }, [activeSummaryId, summaries, switchEditorBody])

  useEffect(() => {
    window.localStorage.setItem(VIDEO_SPLIT_STORAGE_KEY, String(Math.round(noteLeftPct)))
  }, [noteLeftPct])

  useEffect(() => {
    window.localStorage.setItem(EDITOR_PREFS_STORAGE_KEY, JSON.stringify(editorPrefs))
  }, [editorPrefs])

  useEffect(() => {
    setSpeakerMap(note?.speaker_map ?? {})
  }, [note?.speaker_map])

  useEffect(() => {
    setSpeakerRoles(note?.speaker_roles ?? {})
  }, [note?.speaker_roles])

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

  const creatingSummaryTask = pipelineTasks.find((task) => task.task_id === creatingSummaryTaskId)
  useEffect(() => {
    if (!creatingSummaryTaskId || !creatingSummaryTask) return
    const terminal = ['SUCCESS', 'FAILED', 'PARTIAL', 'CANCELLED'].includes(creatingSummaryTask.status)
    if (!terminal) {
      const stage = creatingSummaryTask.log?.at(-1)?.message || '正在准备材料'
      showOperationNotice(
        `正在生成总结 · ${Math.round((creatingSummaryTask.progress || 0) * 100)}% · ${stage}`,
        'loading',
      )
      return
    }
    if (creatingSummaryTask.status === 'SUCCESS') {
      const raw = (creatingSummaryTask.result as Record<string, unknown>)?.summary
      const summary = raw && typeof raw === 'object' ? raw as ItemSummary : null
      showOperationNotice(summary ? `V${summary.version} 总结生成完成` : '总结生成完成', 'success')
      if (
        summary
        && typeof summary.summary_id === 'string'
        && summaryCreationEpochRef.current === summarySelectionEpochRef.current
      ) {
        setActiveSummaryId(summary.summary_id)
      }
      refreshSummaries()
    } else {
      showOperationNotice(
        creatingSummaryTask.error || (creatingSummaryTask.status === 'CANCELLED' ? '总结任务已取消' : '总结生成失败'),
        'error',
      )
    }
    setCreatingSummary(false)
    setCreatingSummaryTaskId(null)
    summaryCreationEpochRef.current = null
  }, [creatingSummaryTask, creatingSummaryTaskId, refreshSummaries, showOperationNotice])

  const creatingChapterTask = pipelineTasks.find((task) => task.task_id === creatingChapterTaskId)
  useEffect(() => {
    if (!creatingChapterTaskId || !creatingChapterTask) return
    const terminal = ['SUCCESS', 'FAILED', 'PARTIAL', 'CANCELLED'].includes(creatingChapterTask.status)
    if (!terminal) {
      const stage = creatingChapterTask.log?.at(-1)?.message || '正在整理字幕证据'
      showOperationNotice(`正在生成章节摘要 · ${Math.round((creatingChapterTask.progress || 0) * 100)}% · ${stage}`, 'loading')
      return
    }
    if (creatingChapterTask.status === 'SUCCESS') {
      const chapters = (creatingChapterTask.result as Record<string, unknown>)?.chapters
      if (Array.isArray(chapters)) {
        setNote((current) => current ? { ...current, chapters: chapters as NoteChapter[] } : current)
      }
      showOperationNotice('模型章节摘要已生成', 'success')
    } else {
      showOperationNotice(
        creatingChapterTask.error || (creatingChapterTask.status === 'CANCELLED' ? '章节摘要任务已取消' : '章节摘要生成失败'),
        'error',
      )
    }
    setCreatingChapters(false)
    setCreatingChapterTaskId(null)
  }, [creatingChapterTask, creatingChapterTaskId, showOperationNotice])

  const notePageStyle = useMemo<CSSProperties>(
    () => ({
      '--note-left-width': `${noteLeftPct}%`,
      '--note-copy-font-family': FONT_FAMILY_VALUE[editorPrefs.fontFamily],
      '--note-copy-font-size': `${editorPrefs.fontSize}px`,
      '--note-copy-line-height': String(editorPrefs.lineHeight),
      '--note-copy-color': TEXT_TONE_VALUE[editorPrefs.textTone],
      '--note-copy-font-weight': String(FONT_WEIGHT_VALUE[editorPrefs.fontWeight]),
      '--note-copy-text-align': editorPrefs.textAlign,
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

  // 点击外部关闭导出下拉
  useEffect(() => {
    if (!exportOpen) return
    const handle = (e: MouseEvent) => {
      if (exportDropRef.current && !exportDropRef.current.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [exportOpen])

  // Escape 关闭导出/AI 菜单并把焦点还给触发按钮
  useEffect(() => {
    if (!exportOpen && !aiToolsOpen) return
    const handle = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (exportOpen) {
        setExportOpen(false)
        exportDropRef.current?.querySelector('button')?.focus()
      }
      if (aiToolsOpen) {
        setAiToolsOpen(false)
        aiToolsDropRef.current?.querySelector('button')?.focus()
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [exportOpen, aiToolsOpen])

  // 图文笔记：图片索引 + 加载错误
  const [selectedImageIdx, setSelectedImageIdx] = useState(0)
  const [imageLoadError, setImageLoadError] = useState<Record<number, boolean>>({})
  const handleTimeUpdate = useCallback((t: number) => setCurrentTime(t), [])
  const handleSeek = useCallback((sec: number) => {
    // 先更新转录轴，再等待媒体元素的异步 seek/timeupdate，避免点击字幕后短暂显示旧行。
    setCurrentTime(sec)
    videoRef.current?.seekTo(sec)
    audioRef.current?.seekTo(sec)
    mediaCompanionRef.current?.seekTo(sec)
  }, [])

  // R2-D: 知识库深链接 — 读取 start_ms，等播放器 handle 就绪后只消费一次
  const [searchParams] = useSearchParams()
  const deepLinkConsumed = useRef(false)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)

  useEffect(() => {
    if (deepLinkConsumed.current) return
    if (loading || !note) return
    const startMs = searchParams.get('start_ms')
    if (!startMs) return
    const sec = parseInt(startMs, 10) / 1000
    if (!Number.isFinite(sec) || sec < 0) return

    // 依据笔记类型选择对应播放器 handle；尚未挂载则不消费，等下次渲染再试。
    const noteType = String(((note.frontmatter ?? {}) as Record<string, unknown>).type ?? '')
    const handle =
      noteType === 'audio'
        ? audioRef.current
        : noteType === 'video'
          ? videoRef.current
          : (audioRef.current ?? videoRef.current)
    if (!handle) return

    // handle 已挂载 → 消费参数。seekTo 内部会等 metadata，duration 无效时不钳制到 0。
    deepLinkConsumed.current = true
    setAutoplayBlocked(false)
    handleSeek(sec)

    // 暴露可等待的 play()；自动播放被拒绝时保留目标时间并显示“点击播放”提示。
    const playPromise = handle.play ? handle.play() : null
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => setAutoplayBlocked(true))
    }
  }, [loading, note, searchParams, handleSeek, audioDuration, videoDuration])

  const transcriptLines = useMemo<VideoResultTranscriptLine[]>(() => (
    Array.isArray(note?.transcript) ? note.transcript as VideoResultTranscriptLine[] : []
  ), [note?.transcript])
  const videoFrames = useMemo(() => note?.media?.frames ?? [], [note?.media?.frames])
  // Q2：旧版无时间戳（sec=null）的帧无法定位，统一过滤后再进故事板/时间轴/章节证据
  const timedVideoFrames = useMemo(
    () => videoFrames.filter((frame): frame is { sec: number; url: string } =>
      typeof frame.sec === 'number' && frame.sec >= 0 && Boolean(frame.url)),
    [videoFrames],
  )

  const activeTranscriptLine = useMemo(() => {
    let active: VideoResultTranscriptLine | null = null
    for (const line of transcriptLines) {
      if (line.t_sec <= currentTime + 0.35) active = line
      else break
    }
    return active
  }, [currentTime, transcriptLines])
  const generatedAudioChapters = useMemo(() => modelAudioChapters(note?.chapters), [note?.chapters])
  const fallbackAudioChapters = useMemo(() => buildAudioChapters(transcriptLines), [transcriptLines])
  const audioChapters = generatedAudioChapters.length > 0 ? generatedAudioChapters : fallbackAudioChapters
  const hasModelChapters = generatedAudioChapters.length > 0
  const videoEvidenceChapters = useMemo<NoteChapter[]>(() => {
    if (Array.isArray(note?.chapters) && note.chapters.length > 0) return note.chapters
    return fallbackAudioChapters.map((chapter) => ({
      ...chapter,
      source: 'fallback' as const,
    }))
  }, [fallbackAudioChapters, note?.chapters])
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

  const handleToggleImmersive = useCallback(() => {
    setImmersiveOpen((prev) => {
      const next = !prev
      if (next) {
        const noteType = String(((note?.frontmatter ?? {}) as Record<string, unknown>).type ?? '')
        if (noteType === 'audio' && note?.media?.audio) setIsPip(true)
      }
      return next
    })
  }, [note])

  // Q3：问 AI 回答中的【素材 N】点击后跳到当前素材的转录证据区并短暂高亮。
  const handleOpenChatSource = useCallback(() => {
    const wrap = document.querySelector<HTMLElement>('.nibi-note-transcript-wrap')
    if (!wrap) return
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' })
    wrap.classList.add('is-source-flash')
    window.setTimeout(() => wrap.classList.remove('is-source-flash'), 1600)
  }, [])

  // Q2 沉浸式：Esc 退出；退出后焦点回到触发按钮。
  const closeImmersive = useCallback(() => {
    setImmersiveOpen(false)
  }, [])

  useEffect(() => {
    if (!immersiveOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setImmersiveOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [immersiveOpen])

  useEffect(() => {
    if (immersiveOpen) {
      immersiveWasOpenRef.current = true
      return
    }
    if (immersiveWasOpenRef.current) {
      immersiveWasOpenRef.current = false
      immersiveTriggerRef.current?.focus()
    }
  }, [immersiveOpen])

  const fetchNote = useCallback(async () => {
    setLoading(true)
    setError(null)
    setVideoDuration(0)
    try {
      const data = await getItemNote(workspaceId, itemId)
      setNote(data)
      // 同步主笔记正文；AI 总结版本切换只做本地预览，不写回主笔记。
      const body = extractEditableBody(data.note_md, String(data.frontmatter?.type ?? ''))
      setEditingBody(body)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载笔记失败')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, itemId])

  useEffect(() => { fetchNote() }, [fetchNote])

  const handleRetryAutoSummary = useCallback(async () => {
    const taskId = note?.summary_retry_task_id
    if (!taskId) return
    setRetryingAutoSummary(true)
    try {
      await retryPipelineTask(taskId, { stage: 'summary' })
      toast.success('已开始仅重试摘要，转录和说话人结果不会重复处理。')
      await fetchNote()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '重试摘要失败')
    } finally {
      setRetryingAutoSummary(false)
    }
  }, [fetchNote, note?.summary_retry_task_id])

  const handleRetrySpeakerAnalysis = useCallback(async () => {
    const taskId = note?.speaker_retry_task_id
    if (!taskId) return
    setRetryingSpeakerAnalysis(true)
    try {
      await retryPipelineTask(taskId, { stage: 'diarization' })
      toast.success('已开始仅补做说话人识别，不会重复转写或生成笔记。完成后刷新本页即可查看。')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '提交说话人识别失败')
    } finally {
      setRetryingSpeakerAnalysis(false)
    }
  }, [note?.speaker_retry_task_id])

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

  const doSaveSummary = useCallback(async (summaryId: string, body: string) => {
    setSaveStatus('saving')
    try {
      const updated = await updateSummaryContent(workspaceId, itemId, summaryId, body)
      setSummaries((previous) => previous.map((summary) => (
        summary.summary_id === summaryId ? updated : summary
      )))
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
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const summaryId = activeSummaryId
      debounceRef.current = setTimeout(() => { doSaveSummary(summaryId, md) }, 1500)
      return
    }
    // 清除旧定时器，1.5s 后自动保存
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { doSave(md) }, 1500)
  }, [activeSummaryId, doSave, doSaveSummary])

  const handleSaveAiAnswer = useCallback((answer: string) => {
    const cleaned = answer.trim()
    if (!cleaned) return
    const heading = '## AI 问答补充'
    const nextBody = `${editingBody.trim()}\n\n${heading}\n\n${cleaned}`.trim()
    handleEditorChange(nextBody)
    toast.success(activeSummaryId ? '已保存到当前 AI 总结' : '已保存到当前笔记')
  }, [activeSummaryId, editingBody, handleEditorChange])

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  const handleSelectMainNote = useCallback(() => {
    if (!note) return
    summarySelectionEpochRef.current += 1
    setActiveSummaryId(undefined)
    switchEditorBody(extractEditableBody(note.note_md, String(note.frontmatter?.type ?? '')))
  }, [note, switchEditorBody])

  const handleSelectSummary = useCallback((summary: ItemSummary) => {
    summarySelectionEpochRef.current += 1
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
    () => buildChatSystemPrompt(currentBody),
    [currentBody],
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

  const handleExportCurrentHtml = useCallback(async () => {
    if (!note) return
    const title = String((note.frontmatter as Record<string, unknown>)?.title ?? 'note')
    setExportBusy('html')
    try {
      await withStatusToast(
        async () => downloadHtmlFile(currentBody, `${title}-当前显示内容`, editorPrefs.textAlign),
        {
          id: 'note-export-current-html',
          loading: '正在导出当前显示内容…',
          success: 'HTML 已开始下载',
          error: 'HTML 导出失败，请重试',
        },
      )
      setExportOpen(false)
    } catch (err) {
      console.error('当前显示内容 HTML 导出失败:', err)
    } finally {
      setExportBusy(null)
    }
  }, [currentBody, editorPrefs.textAlign, note])

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

  const handleExportTranscript = useCallback(async (mode: TranscriptExportMode) => {
    if (!formatTranscriptForPrompt(note?.transcript)) {
      toast.error('暂无可导出的转写文本')
      return
    }
    const speakerGrouped = mode === 'speaker_grouped'
    const busyKey = speakerGrouped ? 'transcript_speakers' : 'transcript_article'
    const exportTitle = String((note?.frontmatter as Record<string, unknown> | undefined)?.title ?? '当前内容')
    const label = speakerGrouped ? `${exportTitle} · 转写文本（区分说话人）` : `${exportTitle} · 转写文本`
    setExportBusy(busyKey)
    try {
      await withStatusToast(
        () => downloadTranscript(workspaceId, itemId, mode, exportTitle),
        {
          id: `note-export-transcript-${mode}`,
          loading: `正在导出${label}…`,
          success: `${label}已开始下载`,
          error: `${label}导出失败，请重试`,
        },
      )
      setExportOpen(false)
    } catch (err) {
      console.error('转写文本导出失败:', err)
    } finally {
      setExportBusy(null)
    }
  }, [itemId, note, workspaceId])

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
        activeSummaryId ? 'summary' : 'main',
        activeSummaryId || undefined,
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
  }, [activeSummaryId, workspaceId, itemId, note, showOperationNotice])

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

  const handleSelectedExportFormat = useCallback((format: ItemNoteExportFormat) => {
    if (!exportSource) return
    if (exportSource === 'current') {
      if (format === 'md') void handleExportMarkdown()
      if (format === 'html') void handleExportCurrentHtml()
      if (!['md', 'html'].includes(format)) void handleDownloadNoteExport(format)
      return
    }
    if (exportSource === 'main') {
      if (format === 'obsidian') void handleExportObsidian()
      else void handleDownloadNoteExport(format)
      return
    }
    if (exportSource === 'transcript') {
      // Q3：区分说话人是转写下的选项，不再是独立内容源
      if (format === 'transcript_txt') {
        void handleExportTranscript(transcriptWithSpeaker ? 'speaker_grouped' : 'article')
      }
      if (format === 'srt' || format === 'vtt' || format === 'ass') {
        void downloadSubtitles(workspaceId, itemId, format, transcriptWithSpeaker).then(() => {
          showOperationNotice(`${format.toUpperCase()} 字幕已开始下载`, 'success')
          setExportOpen(false)
        }).catch(() => showOperationNotice('字幕导出失败，请重试', 'error'))
      }
      return
    }
    if (exportSource === 'speaker_transcript') {
      if (format === 'transcript_txt') void handleExportTranscript('speaker_grouped')
      return
    }
    setExportOpen(false)
    setSourceMdOpen(true)
  }, [
    exportSource,
    transcriptWithSpeaker,
    handleDownloadNoteExport,
    handleExportCurrentHtml,
    handleExportMarkdown,
    handleExportObsidian,
    handleExportTranscript,
    itemId,
    showOperationNotice,
    workspaceId,
  ])

  // ── Q3 / D4：媒体导出 ──────────────────────────────────────
  const exportBaseName = useCallback(() => {
    const rawTitle = String(((note?.frontmatter ?? {}) as Record<string, unknown>).title ?? '')
    return rawTitle.replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 60) || 'media'
  }, [note])

  const handleExportOriginalMedia = useCallback(async () => {
    setMediaExporting('original')
    try {
      await downloadOriginalMedia(workspaceId, itemId, `${exportBaseName()}.mp4`)
      showOperationNotice('原视频已开始下载（原样复制，未重新编码）', 'success')
      setExportOpen(false)
    } catch {
      showOperationNotice('本地视频不存在或尚未下载完成，无法导出原视频', 'error')
    } finally {
      setMediaExporting(null)
    }
  }, [workspaceId, itemId, exportBaseName, showOperationNotice])

  const handleExportSoftSub = useCallback(async (format: 'srt' | 'vtt' | 'ass') => {
    setMediaExporting(`softsub-${format}`)
    try {
      await downloadSoftSubMedia(workspaceId, itemId, format, `${exportBaseName()}-softsub.zip`)
      showOperationNotice('视频 + 软字幕包已开始下载', 'success')
      setExportOpen(false)
    } catch {
      showOperationNotice('缺少本地视频或字幕，无法打包软字幕', 'error')
    } finally {
      setMediaExporting(null)
    }
  }, [workspaceId, itemId, exportBaseName, showOperationNotice])

  const handleStartBurn = useCallback(async (
    language: 'bilingual' | 'translation' | 'source' = 'bilingual',
  ) => {
    setMediaExporting('burn')
    try {
      // 字幕字体/字号读取 Q6 字幕槽位设置（缺省交给后端 ffmpeg 默认样式）
      let fontName = ''
      try {
        const settings = await fetchSettings()
        const capFont = settings.fonts?.cap
        if (capFont) fontName = capFont.split(',')[0].replace(/['"]/g, '').trim()
      } catch {
        // 设置不可用时用默认样式，不阻断烧录
      }
      const result = await startBurnSubtitles(workspaceId, itemId, {
        subtitle_format: 'srt',
        font_name: fontName,
        language,
      })
      showOperationNotice(`烧录任务已开始（${result.task_id}），可在任务中心查看进度`, 'success')
      setExportOpen(false)
    } catch {
      showOperationNotice('无法开始烧录：缺少本地视频/字幕或未安装 ffmpeg', 'error')
    } finally {
      setMediaExporting(null)
    }
  }, [workspaceId, itemId, showOperationNotice])

  // ── Q3 / D3：Obsidian 直写（vault 目的地来自设置）──────────
  // 先 dry_run 预检同名目标；已存在则弹冲突确认，由用户主动选择「另存为新版本」或「覆盖」。
  const handleObsidianDirectWrite = useCallback(async () => {
    setMediaExporting('obsidian-vault')
    try {
      const settings = await fetchSettings()
      if (!settings.obsidian?.direct_write) {
        showOperationNotice('Obsidian 本地直写已关闭，请到 设置 → 常规与外观 启用', 'error')
        return
      }
      const vaultPath = settings.obsidian.vault_path.trim()
      if (!vaultPath) {
        showOperationNotice('尚未配置 Obsidian vault 路径，请到 设置 → 常规与外观 配置', 'error')
        return
      }
      const common = {
        vault_path: vaultPath,
        subdir: settings.obsidian?.subdir || '',
        source_kind: activeSummaryId ? 'summary' as const : 'main' as const,
        summary_id: activeSummaryId ?? undefined,
      }
      const precheck = await exportNoteToObsidianVault(workspaceId, itemId, { ...common, dry_run: true })
      if (precheck.exists) {
        setObsidianConflict({ ...common, relative: precheck.relative })
        return
      }
      const result = await exportNoteToObsidianVault(workspaceId, itemId, { ...common, on_conflict: 'rename' })
      showOperationNotice(`已写入 Obsidian：${result.relative}`, 'success')
      setExportOpen(false)
    } catch {
      showOperationNotice('写入 Obsidian 失败：请检查 vault 路径与目录权限', 'error')
    } finally {
      setMediaExporting(null)
    }
  }, [workspaceId, itemId, activeSummaryId, showOperationNotice])

  // 冲突确认：另存为新版本（默认）或覆盖（主动选择，AlertDialog 本身即二次确认）
  const handleObsidianConflictSave = useCallback(async (overwrite: boolean) => {
    const conflict = obsidianConflict
    if (!conflict) return
    setObsidianConflict(null)
    setMediaExporting('obsidian-vault')
    try {
      const result = await exportNoteToObsidianVault(workspaceId, itemId, {
        vault_path: conflict.vault_path,
        subdir: conflict.subdir,
        on_conflict: overwrite ? 'overwrite' : 'rename',
        source_kind: conflict.source_kind,
        summary_id: conflict.summary_id,
      })
      showOperationNotice(overwrite ? `已覆盖 Obsidian：${result.relative}` : `已另存为新版本：${result.relative}`, 'success')
      setExportOpen(false)
    } catch {
      showOperationNotice('写入 Obsidian 失败：请检查 vault 路径与目录权限', 'error')
    } finally {
      setMediaExporting(null)
    }
  }, [workspaceId, itemId, obsidianConflict, showOperationNotice])

  // VN4.3 新建总结（从 AI 工具菜单触发，复用 NewSummaryModal）
  const handleCreateSummary = useCallback(async (opts: {
    template: string; background: string; providerId: string; model: string; searchWeb: boolean
    summaryMode: 'general' | 'speaker_aware'
    summaryLanguage: string; summaryLanguageCustom: string
  }) => {
    const templateName = tl(opts.template)
    summaryCreationEpochRef.current = summarySelectionEpochRef.current
    setCreatingSummary(true)
    setShowNewSummaryModal(false)
    showOperationNotice(`正在生成${templateName}…`, 'loading')
    try {
      const accepted = await createSummary(workspaceId, itemId, opts.template, opts.background, {
        provider_id: opts.providerId,
        model: opts.model,
        search_web: opts.searchWeb,
        summary_mode: opts.summaryMode,
        summary_language: opts.summaryLanguage,
        summary_language_custom: opts.summaryLanguageCustom,
      })
      setCreatingSummaryTaskId(accepted.task_id)
      const now = new Date().toISOString()
      // 极短内容可能在 HTTP 返回前已经完成；不要用本地 PENDING 快照覆盖真实终态。
      if (!useTaskStore.getState().getTask(accepted.task_id)) {
        addPipelineTask({
          task_id: accepted.task_id,
          project_id: workspaceId,
          task_type: 'summary',
          payload: { item_id: itemId, template: opts.template, title: templateName },
          status: 'PENDING',
          progress: 0,
          log: [],
          result: {},
          error: '',
          retry_of: '',
          cancel_requested: false,
          created_at: now,
          updated_at: now,
        } satisfies TaskRecord)
      }
    } catch (err: unknown) {
      summaryCreationEpochRef.current = null
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
    }
  }, [workspaceId, itemId, addPipelineTask, navigate, showOperationNotice])

  const handleCopyActiveSummary = useCallback(async () => {
    if (!activeSummaryId) return
    try {
      await navigator.clipboard.writeText(editingBody)
      toast.success('已复制总结内容')
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }, [activeSummaryId, editingBody])

  const handleRegenerateActiveSummary = useCallback(() => {
    const current = summaries.find((summary) => summary.summary_id === activeSummaryId)
    if (!current) return
    setNewSummaryTemplate(current.template)
    setNewSummaryMode(current.summary_mode ?? 'general')
    setShowNewSummaryModal(true)
  }, [activeSummaryId, summaries])

  const handleCreateChapterSummaries = useCallback(async () => {
    setCreatingChapters(true)
    showOperationNotice('正在创建章节摘要任务…', 'loading')
    try {
      const accepted = await createChapterSummaries(workspaceId, itemId)
      setCreatingChapterTaskId(accepted.task_id)
      const now = new Date().toISOString()
      if (!useTaskStore.getState().getTask(accepted.task_id)) {
        addPipelineTask({
          task_id: accepted.task_id,
          project_id: workspaceId,
          task_type: 'chapters',
          payload: { item_id: itemId, title: '模型章节摘要' },
          status: 'PENDING',
          progress: 0,
          log: [],
          result: {},
          error: '',
          retry_of: '',
          cancel_requested: false,
          created_at: now,
          updated_at: now,
        } satisfies TaskRecord)
      }
    } catch (err: unknown) {
      setCreatingChapters(false)
      const axiosData = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showOperationNotice(axiosData || (err instanceof Error ? err.message : '章节摘要生成失败'), 'error')
    }
  }, [addPipelineTask, itemId, showOperationNotice, workspaceId])

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

  // Q3 / D3：统一导出面板 → 本地执行
  const exportPanelTitle = String(((note?.frontmatter ?? {}) as Record<string, unknown>).title ?? '')
  const handleExportPlan = useCallback((plan: ExportPlan) => {
    setExportPanelOpen(false)
    const { content, format, options } = plan
    if (content === 'transcript') {
      if (format === 'srt' || format === 'vtt' || format === 'ass') {
        void downloadSubtitles(
          workspaceId,
          itemId,
          format,
          options.withSpeaker,
          options.language,
        ).then(() => {
          showOperationNotice(`${format.toUpperCase()} 字幕已开始下载`, 'success')
        }).catch(() => showOperationNotice('字幕导出失败，请重试', 'error'))
        return
      }
      const ext = format
      void downloadTranscriptDoc(
        workspaceId,
        itemId,
        {
          format: format as 'txt' | 'md' | 'docx',
          with_speaker: options.withSpeaker,
          with_timestamp: options.withTimestamp,
          language: options.language,
        },
        `${exportPanelTitle || '转写'}_转写.${ext}`,
      ).then(() => {
        showOperationNotice('转写文档已开始下载', 'success')
      }).catch(() => showOperationNotice('转写导出失败，请重试', 'error'))
      return
    }
    if (content === 'summary') {
      void handleDownloadNoteExport(format as ItemNoteExportFormat)
      return
    }
    if (format === 'original' || format === 'audio') {
      void handleExportOriginalMedia()
      return
    }
    if (format.startsWith('softsub-')) {
      void handleExportSoftSub(format.replace('softsub-', '') as 'srt' | 'vtt' | 'ass')
      return
    }
    if (format === 'burn') {
      void handleStartBurn(options.language)
      return
    }
  }, [
    workspaceId,
    itemId,
    exportPanelTitle,
    showOperationNotice,
    handleDownloadNoteExport,
    handleExportOriginalMedia,
    handleExportSoftSub,
    handleStartBurn,
  ])

  // Q3 / D3：统一导出面板 → 云目的地（沿用现有对话框 / Obsidian 直写）
  const handleExportCloud = useCallback((destination: Exclude<ExportDestination, 'local'>) => {
    setExportPanelOpen(false)
    if (destination === 'notion') setNotionExportOpen(true)
    else if (destination === 'feishu') setFeishuExportOpen(true)
    else void handleObsidianDirectWrite()
  }, [handleObsidianDirectWrite])

  // ─── loading / error ───
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12, height: '100%', padding: 24 }} role="status" aria-label="加载中">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
    )
  }
  if (error || !note) {
    const categorized = categorizeError(error)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', gap: 10, padding: 24, textAlign: 'center' }}>
        <strong style={{ color: 'var(--err)', fontWeight: 800 }}>{categorized.friendlyMessage}</strong>
        <span style={{ maxWidth: 520, color: 'var(--mut)', fontSize: 13, lineHeight: 1.6 }}>{categorized.suggestion}</span>
        {error && (
          <details style={{ maxWidth: 620, color: 'var(--mut)', fontSize: 11, textAlign: 'left' }}>
            <summary style={{ cursor: 'pointer' }}>查看原始错误</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error}</pre>
          </details>
        )}
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

  // Q2：顶栏只显示「主笔记」，修订号只出现在版本历史/下拉里
  const versionButtonLabel = activeSummary
    ? `${summaryGroupLabel(summaryGroupKey(activeSummary))} · ${activeSummary.name || `V${activeSummary.version}`}`
    : '主笔记'

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
  const speakerIds = Array.from(new Set(
    transcriptLines.map((line) => String(line.speaker || '').trim()).filter(Boolean),
  ))
  const speakerNames = speakerIds.map((id) => speakerMap[id] || id.replace(/^SPEAKER_/, 'S'))
  const handleSpeakerProfileSave = async (speakerId: string, nextName: string, nextRole: string) => {
    const trimmed = nextName.trim()
    const normalizedRole = nextRole.trim()
    if (!trimmed || trimmed === speakerId) return
    if (!SPEAKER_ROLE_OPTIONS.includes(normalizedRole as (typeof SPEAKER_ROLE_OPTIONS)[number]) && normalizedRole) return
    const currentName = speakerMap[speakerId] || ''
    const currentRole = speakerRoles[speakerId] || ''
    if (trimmed === currentName && normalizedRole === currentRole) return
    const previous = speakerMap
    const previousRoles = speakerRoles
    const updated = { ...speakerMap, [speakerId]: trimmed }
    const updatedRoles = { ...speakerRoles }
    if (normalizedRole) updatedRoles[speakerId] = normalizedRole
    else delete updatedRoles[speakerId]
    setSpeakerMap(updated)
    setSpeakerRoles(updatedRoles)
    try {
      const result = await updateSpeakerMap(workspaceId, itemId, updated, updatedRoles)
      await fetchNote()
      await refreshSummaries()
      const updatedCount = result.summary_refresh?.updated_count ?? 0
      toast.success(
        result.summary_refresh?.status === 'needs_regeneration'
          ? '身份已更新，历史总结中的名称已同步；请生成新版本以刷新角色解读'
          : result.summary_refresh?.status === 'updated'
          ? `说话人已更新，已同步刷新 ${updatedCount} 份历史总结`
          : '说话人已更新',
      )
    } catch {
      setSpeakerMap(previous)
      setSpeakerRoles(previousRoles)
      toast.error('说话人保存失败，请重试')
    }
  }
  const sourceLabel = sourceUrl ? platformLabelFromUrl(sourceUrl) : '本地素材'
  const effectiveVideoDuration = note.media?.video?.duration || videoDuration
  const effectiveAudioDuration = audioDuration
  const speakerStatsMap = new Map<string, { count: number; duration: number }>()
  transcriptLines.forEach((line, index) => {
    const speakerId = String(line.speaker || '').trim()
    if (!speakerId) return
    const nextTime = transcriptLines[index + 1]?.t_sec
    const endTime = nextTime ?? effectiveAudioDuration ?? line.t_sec
    const current = speakerStatsMap.get(speakerId) ?? { count: 0, duration: 0 }
    current.count += 1
    current.duration += Math.max(0, endTime - line.t_sec)
    speakerStatsMap.set(speakerId, current)
  })
  const totalSpeakerDuration = [...speakerStatsMap.values()].reduce((sum, stat) => sum + stat.duration, 0)
  // D1（Q2）：说话人四状态以后端 speaker_status 为准——区分「未请求」与
  // 「请求后无结果」，不再只看 speakerIds / speaker_retry_task_id。
  const speakerStatus: SpeakerDiarizationStatus = note.speaker_status
    ?? (speakerIds.length > 0 ? 'data' : 'none')
  const speakerInfos: SpeakerDiarizationInfo[] = speakerIds.map((speakerId) => {
    const stat = speakerStatsMap.get(speakerId)
    return {
      id: speakerId,
      displayName: speakerMap[speakerId] || speakerId.replace(/^SPEAKER_/, 'S'),
      role: speakerRoles[speakerId] || '',
      color: audioSpeakerColor(speakerId),
      count: stat?.count ?? 0,
      durationSec: stat?.duration ?? 0,
      percent: totalSpeakerDuration > 0 && stat
        ? Math.round((stat.duration / totalSpeakerDuration) * 100)
        : 0,
    }
  })
  const sourceMarker = sourceMarkerFromUrl(sourceUrl)
  const mediaDuration = isVideoNote ? effectiveVideoDuration : isAudioNote ? effectiveAudioDuration : 0
  const saveStatusNode = (
    <span className="nibi-note-save-actions">
      <span className={`nibi-note-save nibi-note-save--${saveStatus}`}>
        {saveStatus === 'saving' && '保存中…'}
        {saveStatus === 'saved' && `已保存 ${savedAt}`}
        {saveStatus === 'failed' && '保存失败'}
        {saveStatus === 'idle' && '自动保存'}
      </span>
      <button className="btn-ghost" onClick={() => setHistoryOpen(true)}>
        <History size={13} />版本历史
      </button>
    </span>
  )
  const noteMetaRows = [
    { label: '来源', value: sourceLabel },
    itemType ? { label: '类型', value: TYPE_LABEL[itemType] ?? itemType } : null,
    mediaDuration ? { label: '时长', value: formatTimecode(mediaDuration) } : null,
    sourceMarker ? { label: '素材 ID', value: sourceMarker } : null,
    transcriptCount > 0 ? { label: '转写', value: `${transcriptCount} 条` } : null,
    isAudioNote && speakerNames.length > 0 ? { label: '说话人', value: speakerNames.join(' / ') } : null,
    isVideoNote && timedVideoFrames.length > 0 ? { label: '关键帧', value: `${timedVideoFrames.length} 张` } : null,
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
          <TagChips
            tags={tags}
            onTagSelect={(dimension, value) => {
              const query = new URLSearchParams({
                [dimension === 'custom' ? 'tags.custom' : `tags.${dimension}`]: value,
              })
              navigate(`/workspaces?${query.toString()}`)
            }}
          />
        </div>
      )}
    </div>
  ) : null
  const documentExportItems = [
    { icon: <FileText size={15} />, label: 'Markdown', format: 'md' as const },
    { icon: <FileText size={15} />, label: 'HTML', format: 'html' as const },
    { icon: <FileDown size={15} />, label: 'PDF', format: 'pdf' as const },
    { icon: <FileType size={15} />, label: 'Word', format: 'docx' as const },
  ]
  const presentationExportItems = [
    { icon: <Image size={15} />, label: '长图', format: 'long_image' as const },
    { icon: <Presentation size={15} />, label: 'PPT', format: 'pptx' as const },
  ]
  const exportFormatGroups: NoteExportFormatGroup[] = exportSource === 'current'
    ? [
        { label: '文档与打印', items: documentExportItems },
        { label: '演示与阅读', items: presentationExportItems },
        // Q3 / D2：未选中 AI 总结时，当前内容即主笔记，导出选项含 Obsidian 包
        ...(!activeSummaryId
          ? [{ label: '知识管理', items: [{ icon: <BookOpenCheck size={15} />, label: 'Obsidian 包', format: 'obsidian' as ItemNoteExportFormat }] }]
          : []),
      ]
    : exportSource === 'main'
      ? [
          { label: '文档与打印', items: documentExportItems },
          { label: '演示与阅读', items: presentationExportItems },
          { label: '知识管理', items: [{ icon: <BookOpenCheck size={15} />, label: 'Obsidian 包', format: 'obsidian' }] },
        ]
      : exportSource === 'transcript'
        ? [{
            label: '字幕格式',
            items: [
              { icon: <FileText size={15} />, label: 'TXT 文章', format: 'transcript_txt' },
              { icon: <Subtitles size={15} />, label: 'SRT 字幕', format: 'srt' },
              { icon: <Subtitles size={15} />, label: 'VTT 字幕', format: 'vtt' },
              { icon: <Subtitles size={15} />, label: 'ASS 字幕', format: 'ass' },
            ],
          }]
        : exportSource === 'speaker_transcript'
          ? [{ label: '转写文本', items: [{ icon: <Subtitles size={15} />, label: 'TXT（按说话人归组）', format: 'transcript_txt' }] }]
          : [{ label: '原始素材', items: [{ icon: <FileText size={15} />, label: 'Markdown 源文件', format: 'md' }] }]

  // ── 提取正文 JSX（视频 / 非视频布局复用）──
  const noteContent = (
    <div className="nibi-note-editor-panel">
      <MilkdownEditor key={milkdownKey} markdown={editingBody} onMarkdownChange={handleEditorChange} onSeek={handleSeek} />
    </div>
  )

  return (
    <div
      className={`nibi-note-shell nibi-note-shell--${itemType}${askAiOpen ? ' is-ai-docked' : ''}`}
      style={{ '--note-ai-dock-offset': `${askAiWidth}px` } as CSSProperties}
    >
      {/* R2-D: 自动播放被拒绝时保留目标时间并提示点击播放 */}
      {autoplayBlocked && (
        <button
          type="button"
          data-testid="deeplink-autoplay-hint"
          onClick={() => {
            const handle = audioRef.current ?? videoRef.current
            const p = handle?.play ? handle.play() : null
            if (p && typeof p.catch === 'function') p.catch(() => {})
            setAutoplayBlocked(false)
          }}
          style={{
            display: 'block',
            width: '100%',
            padding: '8px 16px',
            border: 'none',
            borderBottom: '1px solid var(--bdr)',
            background: 'var(--acc-soft, #eef6ff)',
            color: 'var(--acc, #2563eb)',
            fontSize: 13,
            fontWeight: 500,
            textAlign: 'center',
            cursor: 'pointer',
          }}
        >
          自动播放被阻止，已停在目标时间，点击播放
        </button>
      )}
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
                <div className="nibi-note-version-group-label">主笔记</div>
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
                <div className="nibi-note-version-group-label">AI 总结</div>
                {summaries.length === 0 ? (
                  <div className="nibi-note-version-empty">暂无 AI 总结版本，可点击“新建总结”生成。</div>
                ) : (
                  orderedSummaries.map((s) => {
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
                                  <strong>{`V${s.version}`}{s.name ? ` · ${s.name}` : ''}</strong>
                                  <small>
                                    {[summaryGroupLabel(summaryGroupKey(s)), s.model_used || '默认模型', formatDateTime(s.created_at)].filter(Boolean).join(' · ')}
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
                      })
                )}
                <div className="nibi-note-version-divider" />
                <button
                  type="button"
                  className="nibi-note-version-history"
                  onClick={() => {
                    setTemplateDropOpen(false)
                    setHistoryOpen(true)
                  }}
                >
                  <History size={13} /> 查看版本历史
                </button>
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
          {activeSummaryId && (
            <>
              <button
                className="nibi-note-bar-btn nibi-note-bar-btn--label"
                type="button"
                onClick={() => void handleCopyActiveSummary()}
                title="复制当前 AI 总结内容"
              >
                <Copy size={14} />复制总结
              </button>
              <button
                className="nibi-note-bar-btn nibi-note-bar-btn--label"
                type="button"
                onClick={handleRegenerateActiveSummary}
                disabled={creatingSummary}
                title="按当前总结的模板重新生成"
              >
                <RefreshCw size={14} />重新生成总结
              </button>
            </>
          )}
          {sourceUrl && (
            <a className="nibi-note-bar-btn nibi-note-bar-btn--label" href={sourceUrl} target="_blank" rel="noreferrer" title="打开原视频">
              <ExternalLink size={14} /> 原视频
            </a>
          )}
          <div style={{ position: 'relative' }} ref={exportDropRef}>
            <button
              className="nibi-note-bar-btn nibi-note-bar-btn--label"
              onClick={() => {
                setAiToolsOpen(false)
                setExportPanelOpen(true)
              }}
              title="导出"
            >
              <Download size={14} /> 导出
            </button>
            {exportOpen && (
              <div className="nibi-note-export-menu">
                {!exportSource ? (
                  <>
                    <div className="nibi-note-export-group-label">笔记</div>
                    <button className="nibi-note-export-item" onClick={() => setExportSource('current')} disabled={!!exportBusy}>
                      <FileText size={15} />
                      <span>当前显示内容{activeSummaryId ? '（AI 总结）' : ''}</span>
                    </button>
                    {activeSummaryId && (
                      <button className="nibi-note-export-item" onClick={() => setExportSource('main')} disabled={!!exportBusy}>
                        <BookOpenCheck size={15} />
                        <span>主笔记</span>
                      </button>
                    )}
                    {note.source_md && (
                      <button className="nibi-note-export-item" onClick={() => setExportSource('source')} disabled={!!exportBusy}>
                        <FileText size={15} />
                        <span>原始素材</span>
                      </button>
                    )}
                    {(isVideoNote || isAudioNote) && (
                      <>
                        <div className="nibi-note-export-group-label">转录与字幕</div>
                        <button className="nibi-note-export-item" onClick={() => setExportSource('transcript')} disabled={!!exportBusy}>
                          <Subtitles size={15} />
                          <span>转写文本 / 字幕</span>
                        </button>
                      </>
                    )}
                    {isVideoNote && (
                      <>
                        <div className="nibi-note-export-group-label">媒体</div>
                        <button className="nibi-note-export-item" onClick={() => void handleExportOriginalMedia()} disabled={!!mediaExporting}>
                          <Download size={15} />
                          <span>{mediaExporting === 'original' ? '导出中…' : '原视频（不重新编码）'}</span>
                        </button>
                        <button className="nibi-note-export-item" onClick={() => void handleExportSoftSub('srt')} disabled={!!mediaExporting}>
                          <Subtitles size={15} />
                          <span>{mediaExporting === 'softsub-srt' ? '打包中…' : '视频 + 软字幕（SRT）'}</span>
                        </button>
                        <button className="nibi-note-export-item" onClick={() => void handleExportSoftSub('vtt')} disabled={!!mediaExporting}>
                          <Subtitles size={15} />
                          <span>{mediaExporting === 'softsub-vtt' ? '打包中…' : '视频 + 软字幕（VTT）'}</span>
                        </button>
                        <button className="nibi-note-export-item" onClick={() => void handleStartBurn()} disabled={!!mediaExporting}>
                          <Film size={15} />
                          <span>{mediaExporting === 'burn' ? '提交中…' : '烧录字幕到视频（后台任务）'}</span>
                        </button>
                      </>
                    )}
                    <div className="nibi-note-export-group-label">同步到工作区</div>
                    <button className="nibi-note-export-item" onClick={() => void handleObsidianDirectWrite()} disabled={!!mediaExporting}>
                      <BookOpenCheck size={15} />
                      <span>{mediaExporting === 'obsidian-vault' ? '写入中…' : '写入 Obsidian（本地 vault）'}</span>
                    </button>
                    <button
                      className="nibi-note-export-item"
                      onClick={() => {
                        setExportOpen(false)
                        setNotionExportOpen(true)
                      }}
                      disabled={!!exportBusy || !currentBody.trim()}
                    >
                      <BookOpenCheck size={15} />
                      <span>Notion（同步编辑器正文）</span>
                    </button>
                    <button
                      className="nibi-note-export-item"
                      onClick={() => {
                        setExportOpen(false)
                        setFeishuExportOpen(true)
                      }}
                      disabled={!!exportBusy || !currentBody.trim()}
                    >
                      <BookOpenCheck size={15} />
                      <span>飞书（同步编辑器正文）</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button className="nibi-note-export-back" onClick={() => setExportSource(null)}>
                      <ArrowLeft size={13} /> 返回内容选择
                    </button>
                    {exportSource === 'transcript' && (
                      <label className="nibi-note-export-toggle">
                        <input
                          type="checkbox"
                          checked={transcriptWithSpeaker}
                          onChange={(event) => setTranscriptWithSpeaker(event.target.checked)}
                        />
                        区分说话人
                      </label>
                    )}
                    <div className="nibi-note-export-group-label">选择格式</div>
                    {exportFormatGroups.map((group) => (
                      <div key={group.label}>
                        <div className="nibi-note-export-group-label">{group.label}</div>
                        {group.items.map((item) => (
                          <button
                            key={item.label}
                            className="nibi-note-export-item"
                            onClick={() => handleSelectedExportFormat(item.format)}
                            disabled={!!exportBusy}
                          >
                            {item.icon}
                            <span>{exportBusy === item.format ? '导出中…' : item.label}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <button
            ref={immersiveTriggerRef}
            className="nibi-note-bar-btn nibi-note-bar-btn--label nibi-note-bar-btn--accent"
            onClick={handleToggleImmersive}
            title={immersiveOpen ? '退出沉浸式笔记' : '打开沉浸式笔记'}
            aria-pressed={immersiveOpen}
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
              <div className="nibi-note-ai-menu">
                <button
                  className="nibi-note-ai-action"
                  onClick={() => {
                    setAiToolsOpen(false)
                    setAskAiOpen(true)
                  }}
                >
                  <MessageCircle size={16} />
                  <div>
                    <div className="nibi-note-ai-action-title">问 AI</div>
                    <div className="nibi-note-ai-action-desc">基于当前笔记与转写证据继续提问</div>
                  </div>
                </button>
                <div className="nibi-note-ai-quick">
                  <span className="nibi-note-ai-quick-label">生成笔记素材</span>
                  {[
                    { value: 'mind_map' as const, label: '思维导图' },
                    { value: 'action_items' as const, label: '行动项' },
                    { value: 'key_cards' as const, label: '要点卡' },
                    { value: 'flashcards' as const, label: '闪卡与测验' },
                    { value: 'glossary' as const, label: '术语表' },
                    { value: 'timeline' as const, label: '时间线' },
                    { value: 'selection_rewrite' as const, label: '选区改写' },
                  ].map((tool) => (
                    <button
                      key={tool.value}
                      className="nibi-note-ai-quick-chip"
                      onClick={() => {
                        setAiToolsOpen(false)
                        setArtifactTool(tool.value)
                      }}
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {immersiveOpen && (
        <div className="nibi-note-immersive">
          {/* Q2：固定退出入口，不可隐藏；Esc 同样可退出 */}
          <button type="button" className="nibi-note-immersive-exit" onClick={closeImmersive}>
            退出沉浸式 <kbd>Esc</kbd>
          </button>
          <div className="nibi-note-immersive-bar">
            <button className="nibi-note-bar-back" onClick={closeImmersive} title="返回工作台">
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
              <button className="nibi-note-bar-btn" onClick={closeImmersive} title="关闭">
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
                  markers={timedVideoFrames}
                  frames={timedVideoFrames}
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
            {/* Q3 融合时间轴：章节段 + 截帧同一条轨，点击跳转 */}
            {!isPip && (
              <ChapterTimelineStrip
                frames={timedVideoFrames}
                chapters={videoEvidenceChapters}
                duration={effectiveVideoDuration}
                currentTime={currentTime}
                onSeek={handleSeek}
              />
            )}
            {/* 转录 */}
            {!isPip && Array.isArray(note.transcript) && (note.transcript as VideoResultTranscriptLine[]).length > 0 ? (
              <div className="nibi-note-transcript-wrap">
                {/* D1 说话人四状态：未请求整层不渲染；失败/处理中为紧凑行；有数据默认折叠 */}
                <SpeakerDiarizationRow
                  status={speakerStatus}
                  speakers={speakerInfos}
                  retrying={retryingSpeakerAnalysis}
                  onRetry={() => void handleRetrySpeakerAnalysis()}
                  onRename={(speakerId, name, role) => void handleSpeakerProfileSave(speakerId, name, role)}
                  roleOptions={SPEAKER_ROLE_OPTIONS}
                />
                <LNTranscriptPanel
                  transcript={note.transcript as VideoResultTranscriptLine[]}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                  workspaceId={workspaceId}
                  itemId={itemId}
                  onSaved={refreshAfterTranscriptEdit}
                  translations={note.translations ?? null}
                  speakerMap={speakerMap}
                  speakerPresentation="detailed"
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
                            {summaryGroupLabel(tmpl)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                {timedVideoFrames.length > 0 && videoEvidenceChapters.length > 0 && (
                  <ChapterEvidenceStrip
                    chapters={videoEvidenceChapters}
                    frames={timedVideoFrames}
                    onSeek={handleSeek}
                    sourceLabel={hasModelChapters ? '模型章节' : '自动分段'}
                    generateLabel={hasModelChapters ? '重新生成' : '模型生成'}
                    generating={creatingChapters}
                    onGenerate={() => void handleCreateChapterSummaries()}
                  />
                )}
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
        {/* ── 音频笔记两栏布局：播放器/转录 + 总结/笔记 ── */}
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
              {!isPip && (
                <div className="nibi-audio-result-player-head">
                  <div>
                    <span className="nibi-audio-result-kicker">音频结果</span>
                    <strong>{title || '未命名音频'}</strong>
                  </div>
                  <span>{sourceLabel}{effectiveAudioDuration ? ` · ${formatTimecode(effectiveAudioDuration)}` : ''}</span>
                </div>
              )}
              <div className="nibi-audio-player-wrap">
                <NoteAudioPanel
                  ref={audioRef}
                  src={note.media!.audio!}
                  waveform={note.media?.waveform}
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
	                  <span>关键时间点{hasModelChapters ? ' · 模型摘要' : ' · 自动分段'}</span>
	                  <div>
	                    <small>{audioChapters.length} 段</small>
	                    <button
	                      type="button"
	                      className="note-audio-chapters-generate"
	                      onClick={() => void handleCreateChapterSummaries()}
	                      disabled={creatingChapters}
	                    >
	                      {creatingChapters ? '生成中…' : hasModelChapters ? '重新生成' : '模型生成'}
	                    </button>
	                  </div>
	                </div>
	                <div className="note-audio-chapter-track">
	                  {audioChapters.map((chapter, idx) => (
	                    <button
	                      key={`${chapter.start}-${chapter.title}`}
	                      className={`note-audio-chapter${idx === activeAudioChapterIdx ? ' is-active' : ''}`}
	                      onClick={() => handleSeek(chapter.start)}
	                      title={`跳转到 ${formatTimecode(chapter.start)}\n${chapter.title}\n${chapter.summary}`}
	                      aria-label={`跳转到 ${formatTimecode(chapter.start)}：${chapter.title}。${chapter.summary}`}
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
                  <div id="audio-transcript" className="nibi-note-transcript-wrap">
                    {/* D1 说话人四状态（音频与视频同构）：未请求不渲染；失败显示紧凑行 + 重试 */}
                    <SpeakerDiarizationRow
                      status={speakerStatus}
                      speakers={speakerInfos}
                      retrying={retryingSpeakerAnalysis}
                      onRetry={() => void handleRetrySpeakerAnalysis()}
                      onRename={(speakerId, name, role) => void handleSpeakerProfileSave(speakerId, name, role)}
                      roleOptions={SPEAKER_ROLE_OPTIONS}
                    />
                    <LNTranscriptPanel
                  transcript={transcriptLines}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                  workspaceId={workspaceId}
                  itemId={itemId}
                  onSaved={refreshAfterTranscriptEdit}
                  translations={note.translations ?? null}
                  speakerMap={speakerMap}
                  speakerPresentation="detailed"
                  optimizeLongTranscript
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
                    <div id="audio-summary" className="note-section" style={{ marginTop: 16 }}>
                      <h2>内容总结</h2>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                        {[...templateGroups.entries()].map(([tmpl]) => (
                          <button
                            key={tmpl}
                            className="btn-ghost"
                            onClick={() => { const first = templateGroups.get(tmpl)?.[0]; if (first) handleSelectSummary(first) }}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: tmpl === activeTemplate ? 'var(--accl)' : 'var(--bgalt)', color: tmpl === activeTemplate ? 'var(--acc)' : 'var(--mut)', fontWeight: tmpl === activeTemplate ? 600 : 400 }}
                          >
                            {summaryGroupLabel(tmpl)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                {summaries.length === 0 && (
                  <div id="audio-summary" className="note-section nibi-summary-empty" style={{ marginTop: 16 }}>
                    <h2>内容总结</h2>
                    <div className="nibi-summary-empty-card">
                      {note.summary_failure?.stage === 'summary' ? (
                        <>
                          <strong>自动总结暂未完成</strong>
                          <span>{note.summary_failure.code === 'rate_limited'
                            ? '模型服务当前繁忙，转录和说话人结果已保留。'
                            : '自动总结失败，转录和说话人结果已保留。'}</span>
                          {note.summary_retry_task_id && (
                            <button type="button" onClick={() => void handleRetryAutoSummary()} disabled={retryingAutoSummary}>
                              {retryingAutoSummary ? '正在重试…' : '仅重试摘要'}
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <strong>尚未生成总结</strong>
                          <span>转录已保留，你可以立即生成默认总结。</span>
                          <button type="button" onClick={() => setShowNewSummaryModal(true)}>
                            生成默认总结
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {/* 正文 */}
                <div id="audio-note" className="note-section" style={{ marginTop: summaries.length > 0 ? 0 : 16 }}>
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
                            {summaryGroupLabel(tmpl)}
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
            <div className="nibi-text-editor-content">
              <div className="nibi-note-editor-panel">
                <MilkdownEditor
                  key={milkdownKey}
                  markdown={editingBody}
                  onMarkdownChange={handleEditorChange}
                  onSeek={handleSeek}
                  registerCommands
                />
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
                            {summaryGroupLabel(tmpl)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                {/* 正文 */}
                <div className="note-section" style={{ marginTop: summaries.length > 0 ? 0 : 16 }}>
                  <div className="nibi-note-editor-panel">
                    <MilkdownEditor
                      key={milkdownKey}
                      markdown={editingBody}
                      onMarkdownChange={handleEditorChange}
                      onSeek={handleSeek}
                      registerCommands={false}
                    />
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
          itemIds={[itemId]}
          scopeHint="基于当前 note.md，并按问题检索完整转录证据"
          open={askAiOpen}
          onOpenChange={setAskAiOpen}
          onWidthChange={setAskAiWidth}
          onSaveAnswer={handleSaveAiAnswer}
          onOpenSource={handleOpenChatSource}
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

      {artifactTool && (
        <AiArtifactPanel
          open
          initialKind={artifactTool}
          workspaceId={workspaceId}
          itemId={itemId}
          onClose={() => setArtifactTool(null)}
        />
      )}

      {/* Q6：浮动正文格式工具栏（选中文字后出现，全页只挂一份） */}
      <EditorToolbar
        textAlign={isTextNote ? editorPrefs.textAlign : undefined}
        onTextAlignChange={
          isTextNote ? (align) => updateEditorPrefs({ textAlign: align }) : undefined
        }
        editorPrefs={editorPrefs}
        onEditorPrefsChange={updateEditorPrefs}
      />

      <NoteExportPanel
        open={exportPanelOpen}
        onOpenChange={setExportPanelOpen}
        itemId={itemId}
        title={title}
        isVideoNote={isVideoNote}
        isAudioNote={isAudioNote}
        hasSpeakerData={speakerIds.length > 0}
        translationsAvailable={Boolean(
          note.translations && Object.keys(note.translations).length > 0,
        )}
        onExport={handleExportPlan}
        onCloud={handleExportCloud}
      />

      {/* VN4.3 新建/重新生成总结弹窗（从 AI 工具菜单触发） */}
      {showNewSummaryModal && (
        <NewSummaryModal
          creating={creatingSummary}
          defaultTemplate={newSummaryTemplate ?? note.summary_hint?.default_template}
          defaultSummaryMode={newSummaryMode}
          allowSpeakerAware={isAudioNote || (isVideoNote && speakerIds.length > 0)}
          speakerAwareAvailable={speakerIds.length > 0}
          templateCategory={isAudioNote ? 'style_audio' : 'style_video_with_frames'}
          onSubmit={handleCreateSummary}
          onClose={() => {
            setShowNewSummaryModal(false)
            setNewSummaryTemplate(undefined)
            setNewSummaryMode(undefined)
          }}
        />
      )}
      <SourceMdModal
        open={sourceMdOpen}
        sourceMd={note.source_md}
        onClose={() => setSourceMdOpen(false)}
        onDownload={handleDownloadSourceMd}
        downloading={exportBusy === 'source_md'}
      />
      <NotionExportDialog
        open={notionExportOpen}
        onOpenChange={setNotionExportOpen}
        workspaceId={workspaceId}
        itemId={itemId}
        title={String((note.frontmatter as Record<string, unknown>)?.title ?? 'NoteBi 笔记')}
        markdown={currentBody}
        onSuccess={({ url }) => {
          showOperationNotice('已导出到 Notion', 'success', {
            actionLabel: '打开 Notion',
            onAction: () => window.open(url, '_blank', 'noopener,noreferrer'),
          })
        }}
      />
      <FeishuExportDialog
        open={feishuExportOpen}
        onOpenChange={setFeishuExportOpen}
        workspaceId={workspaceId}
        itemId={itemId}
        title={String((note.frontmatter as Record<string, unknown>)?.title ?? 'NoteBi 笔记')}
        markdown={currentBody}
        onSuccess={({ url }) => {
          showOperationNotice('已导出到飞书', 'success', {
            actionLabel: '打开飞书',
            onAction: () => window.open(url, '_blank', 'noopener,noreferrer'),
          })
        }}
      />
      <AlertDialog
        open={!!obsidianConflict}
        onOpenChange={(open) => { if (!open) setObsidianConflict(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Obsidian 已有同名文件</AlertDialogTitle>
            <AlertDialogDescription>
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm">{obsidianConflict?.relative}</code>{' '}
              已存在。默认会<b>另存为新版本</b>（生成 -1 后缀文件）；只有当你确认需要覆盖时，才选择<b>覆盖</b>。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleObsidianConflictSave(false)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              另存为新版本
            </AlertDialogAction>
            <AlertDialogAction onClick={() => void handleObsidianConflictSave(true)}>
              覆盖
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <NoteHistoryPanel
        open={historyOpen}
        workspaceId={workspaceId}
        itemId={itemId}
        onClose={() => setHistoryOpen(false)}
        onRestored={(updated) => {
          setNote(updated)
          switchEditorBody(extractEditableBody(
            updated.note_md,
            String(updated.frontmatter?.type ?? ''),
          ))
          setSaveStatus('saved')
          setSavedAt(formatTime(new Date()))
        }}
      />
    </div>
  )
}
