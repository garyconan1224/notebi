import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { useProviderStore } from '@/store/providerStore'
import type { BatchSourceResolveResponse, SniffResult } from '@/services/workspaces'
import {
  createWorkspace as createWorkspaceSvc,
  ensureInbox,
  generateNote,
  importBatchSource,
  probeDuration,
  probeItemMedia,
  resolveBatchSource,
  savePreflight,
  sniffUrl,
  startItemPipeline,
  updateWorkspace as updateWorkspaceSvc,
} from '@/services/workspaces'
import { fetchLinkPreview } from '@/services/linkPreview'
import { batchAddItemsToWorkspace, fetchLibrary, type LibraryItem } from '@/services/library'
import { fetchTemplates, type TemplateCategory, type VideoTemplateItem } from '@/services/templates'
import type {
  AnalysisScope,
  ItemType,
  WorkspaceBackground,
  WorkspaceRecord,
} from '@/types/workspace'
import {
  MaterialSourcePanel,
  batchSourceItemKey,
  computeAutoInterval,
  libraryItemKey,
  normalizePreviewImageUrl,
} from './MaterialSourcePanel'
import { WorkspacePicker } from './WorkspacePicker'
import { NoteSettingsPanel, type NoteMediaKind, type SpeakerCountChoice } from './NoteSettingsPanel'

export interface StagedConfig {
  types: ItemType[]
  features: Partial<Record<ItemType, Record<string, boolean>>>
  tasks?: Partial<Record<ItemType, Record<string, unknown>>>
  models?: Record<string, string>
  background: Partial<WorkspaceBackground>
  workspaceIds: string[]
  urlValue?: string
  analysisScope?: AnalysisScope
  videoIntent?: 'learning'
  imageMode?: 'ocr'
}

interface AddMaterialModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceIds: string[]
  workspaceBackgrounds?: Record<string, WorkspaceBackground>
  availableWorkspaces?: WorkspaceRecord[]
  onWorkspaceIdsChange?: (workspaceIds: string[]) => void
  onCreateWorkspace?: (name: string) => Promise<WorkspaceRecord>
  onWorkspaceUpdated?: (workspace: WorkspaceRecord) => void
  sniffResult?: SniffResult | null
  urlValue?: string
  sourceText?: string
  onAdded?: () => void
  /** 本地文件：上传后的 item ID */
  localFile?: string
  /** 本地文件：原始文件名 */
  localFileName?: string
  /** 本地文件：素材类型 */
  localFileType?: ItemType
  /** 本地文件：所在 workspace ID */
  localWsId?: string
  /** 从全局弹窗选择并上传本地文件 */
  onPickLocalFile?: () => void
  localUploadPending?: boolean
}

type SourceMode = 'auto' | 'single' | 'batch'

const NOTE_TYPE_CARDS: { value: NoteMediaKind; label: string; desc: string }[] = [
  { value: 'auto', label: '自动识别', desc: '由系统判断笔记类型' },
  { value: 'video', label: '视频笔记', desc: '视频转写 + 时间戳 + 截帧' },
  { value: 'image_text', label: '图文笔记', desc: '逐图视觉理解 + 文字提取 + 按类型总结' },
  { value: 'audio', label: '音频笔记', desc: '音频转写 + 章节整理' },
  { value: 'mixed', label: '混合笔记', desc: '视频截帧 + 图文提取 + 说话人（用于既有视频又有图文的素材）' },
]

/** 7 个常用风格（主显） */
const PRIMARY_STYLES = [
  { id: 'standard', label: '标准总结' },
  { id: 'concise', label: '精简摘要' },
  { id: 'detailed', label: '详细要点' },
  { id: 'outline', label: '大纲' },
  { id: 'lecture', label: '教学笔记' },
  { id: 'steps', label: '步骤教程' },
  { id: 'quotes', label: '金句提取' },
] as const

/** 其余风格（折叠在「更多」里，不删） */
const MORE_STYLES = [
  { id: 'meeting', label: '会议纪要' },
  { id: 'interview', label: '访谈整理' },
  { id: 'shownotes', label: '播客 shownotes' },
  { id: 'oral', label: '口播稿' },
  { id: 'xhs', label: '小红书风格' },
  { id: 'longform', label: '公众号长文' },
  { id: 'qa', label: '问答卡(Anki)' },
  { id: 'actions', label: '行动清单' },
  { id: 'tool_recommendation', label: '工具推荐' },
  { id: 'science_popularization', label: '知识科普' },
] as const

/** 音频勾选区分说话人后使用的专属总结方式；底层仍复用现有模板 ID。 */
const SPEAKER_AWARE_STYLES = [
  { id: 'speaker_consultant_detailed', label: '咨询师录音版本详细总结', desc: '按议题提炼主谈人观点，保留数据、案例、金句与补充发言' },
  { id: 'speaker_consultant_meeting_customer_voice', label: '咨询师录音版会议纪要/客户声音', desc: '按会谈流程呈现双方观点、客户反馈、问答闭环和后续动作' },
  { id: 'speaker_meeting', label: '会议纪要', desc: '逐人立场、决议、负责人/截止与风险' },
  { id: 'speaker_interview', label: '线下采访', desc: 'Q&A、受访者主题观点、证据与分歧' },
  { id: 'speaker_customer_reception', label: '客户接待', desc: '痛点、需求、异议、决策链与双方承诺' },
] as const

const SPEAKER_AWARE_STYLE_IDS = new Set<string>(SPEAKER_AWARE_STYLES.map((style) => style.id))

/** 风格适用范围说明（hover ? 显示），内容来自后端 summary_templates.py */
const STYLE_DESCRIPTIONS: Record<string, string> = {
  standard: '自适应教学笔记，短内容精简、长内容完整结构',
  concise: '100-200 字，适合快速浏览',
  detailed: '多级要点 + 关键词，适合深度学习',
  outline: '多级层次提纲，一眼看清结构',
  lecture: '知识点/例子/重点/延伸阅读，适合课程录音',
  steps: '前置条件→步骤→常见坑→验收标准，适合操作类内容',
  quotes: '5-10 条独立金句卡片，适合短视频/社媒',
  meeting: '议题/结论/待办(负责人·截止)/风险，适合工作录音',
  interview: 'Q&A 对话 + 嘉宾观点摘录，适合播客/采访',
  shownotes: '时间戳章节 + 嘉宾介绍 + 推荐链接，适合自媒体',
  oral: '可直接念的口语化文案，适合短视频/直播',
  xhs: '标题党+emoji+分段+话题 tag，适合转笔记',
  longform: '引言/正文(H2分节)/结尾，适合内容创作',
  qa: 'Q/A 卡片，便于记忆复习',
  actions: '目标→行动项→依赖→完成标准，适合会议/规划',
  tool_recommendation: '工具名称/功能/适用场景/对比，适合工具测评',
  science_popularization: '通俗语言讲原理+类比+常见误区，适合科普',
}

const STYLE_ORDER: Map<string, number> = new Map(
  [...PRIMARY_STYLES, ...MORE_STYLES].map((style, index) => [style.id, index]),
)

function noteTypeFromLocalFile(type?: ItemType): NoteMediaKind {
  if (type === 'audio') return 'audio'
  if (type === 'image' || type === 'text') return 'image_text'
  return 'video'
}

const BATCH_URL_RE = /https?:\/\/[^\s，。！？；：“”‘’（）【】《》]+/g

function batchUrlsFromText(input: string): string[] {
  const matches = input.match(BATCH_URL_RE) ?? []
  return Array.from(new Set(matches.map((url) => url.replace(/[).,，。；;]+$/, ''))))
}

function hasExplicitBilibiliPart(input: string): boolean {
  const urls = batchUrlsFromText(input)
  const candidates = urls.length > 0 ? urls : [input.trim()]
  return candidates.some((candidate) => {
    try {
      const url = new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`)
      if (!/bilibili\.com$/i.test(url.hostname) && !/\.bilibili\.com$/i.test(url.hostname)) return false
      if (!/\/video\/BV/i.test(url.pathname)) return false
      const page = Number(url.searchParams.get('p') || '0')
      return page > 1
    } catch {
      return false
    }
  })
}

function hasExplicitBilibiliCollection(input: string): boolean {
  const urls = batchUrlsFromText(input)
  const candidates = urls.length > 0 ? urls : [input.trim()]
  return candidates.some((candidate) => {
    try {
      const url = new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`)
      if (!/bilibili\.com$/i.test(url.hostname) && !/\.bilibili\.com$/i.test(url.hostname)) return false
      const path = url.pathname.toLowerCase()
      if (url.hostname.toLowerCase() === 'space.bilibili.com') return true
      if (path.includes('favlist') || path.includes('medialist/play')) return true
      if (path.includes('collectiondetail') || path.includes('seriesdetail')) return true
      return url.searchParams.has('fid') || url.searchParams.has('sid')
    } catch {
      return false
    }
  })
}

function looksLikeBatchSource(input: string): boolean {
  const value = input.trim()
  if (!value) return false
  if (batchUrlsFromText(value).length > 1) return true
  if (/youtube\.com\/playlist|[?&]list=|youtu\.be\/.*[?&]list=/i.test(value)) return true
  if (hasExplicitBilibiliPart(value)) return true
  if (hasExplicitBilibiliCollection(value)) return true
  return false
}



export function AddMaterialModal({
  open,
  onOpenChange,
  workspaceIds,
  availableWorkspaces,
  onWorkspaceIdsChange,
  onCreateWorkspace,
  onWorkspaceUpdated,
  sniffResult,
  urlValue,
  sourceText,
  onAdded,
  localFile,
  localFileName,
  localFileType,
  localWsId,
  onPickLocalFile,
  localUploadPending,
}: AddMaterialModalProps) {
  const isLocalFile = !!localFile
  const navigate = useNavigate()
  const { providers, providerModels, fetchProviders } = useProviderStore()
  const [internalUrl, setInternalUrl] = useState('')
  const [internalSniff, setInternalSniff] = useState<SniffResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selectedNoteType, setSelectedNoteType] = useState<NoteMediaKind>('auto')
  const [embedFrames, setEmbedFrames] = useState(false) // R4.7: 默认关，检测到视觉模型后自动开
  const [selectedVisionModel, setSelectedVisionModel] = useState('') // 空=用系统默认
  const [frameInterval, setFrameInterval] = useState(5)
  const [captureMode, setCaptureMode] = useState<'auto' | 'manual'>('auto')
  const [videoDuration, setVideoDuration] = useState(0) // 探测到的视频时长（秒），0=未知
  const [coverUrl, setCoverUrl] = useState('') // sniff 没给封面时，用 link-preview 补的封面
  const [linkTitle, setLinkTitle] = useState('') // sniff 没给标题时，用 link-preview 补的标题
  const [linkDesc, setLinkDesc] = useState('') // link-preview 的简介（B站含 UP主/播放量等）
  const [localCover, setLocalCover] = useState('') // 本地文件：后端 cv2 探测的首帧封面 static URL
  const [error, setError] = useState<string | null>(null)
  const [sniffFailed, setSniffFailed] = useState(false)
  const [diarizeOn, setDiarizeOn] = useState(false)
  const [speakerCount, setSpeakerCount] = useState<SpeakerCountChoice>('auto')
  const [userNotes, setUserNotes] = useState('')
  const [noteStyle, setNoteStyle] = useState('standard')
  const [sourceMode, setSourceMode] = useState<SourceMode>('auto')
  const [styleTemplates, setStyleTemplates] = useState<VideoTemplateItem[]>([])
  const [batchResult, setBatchResult] = useState<BatchSourceResolveResponse | null>(null)
  const [batchSelectedKeys, setBatchSelectedKeys] = useState<Set<string>>(new Set())
  const [batchResolving, setBatchResolving] = useState(false)
  const [batchImporting, setBatchImporting] = useState(false)
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [workspaceQuery, setWorkspaceQuery] = useState('')
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null)
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('')
  const [workspaceNameOverrides, setWorkspaceNameOverrides] = useState<Record<string, string>>({})
  const [advancedOpen, setAdvancedOpen] = useState(false) // 「高级设置」折叠
  const [existingPanelOpen, setExistingPanelOpen] = useState(false)
  const [existingLoading, setExistingLoading] = useState(false)
  const [existingAdding, setExistingAdding] = useState(false)
  const [existingItems, setExistingItems] = useState<LibraryItem[]>([])
  const [existingSelectedIds, setExistingSelectedIds] = useState<Set<string>>(new Set())
  const [existingQuery, setExistingQuery] = useState('')
  const sniffTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const autoBatchResolveKeyRef = useRef('')

  // R4.7: 收集所有可用视觉模型（provider 有 vision 能力 + 模型有 vision 标签）
  const visionModels = providers
    .filter(p => p.enabled && p.capabilities?.includes('vision'))
    .flatMap(p => (providerModels[p.id] ?? [])
      .filter(m => !m.capabilities || m.capabilities.includes('vision'))
      .map(m => ({ providerId: p.id, providerName: p.name, modelId: m.id, modelName: m.name }))
    )
  const hasVisionModel = visionModels.length > 0

  const workspaceLookup = useMemo(
    () => new Map((availableWorkspaces ?? []).map((ws) => [ws.workspace_id, ws])),
    [availableWorkspaces],
  )
  const getWorkspaceLabel = useCallback((workspaceId: string, fallback = '当前合集') => {
    return workspaceNameOverrides[workspaceId] ?? workspaceLookup.get(workspaceId)?.name ?? fallback
  }, [workspaceLookup, workspaceNameOverrides])
  const targetWorkspaceId = workspaceIds[0] ?? ''
  const targetExistingItemIds = useMemo(
    () => new Set(workspaceLookup.get(targetWorkspaceId)?.items.map((item) => item.item_id) ?? []),
    [targetWorkspaceId, workspaceLookup],
  )
  const dialogDescription = '输入素材链接并生成笔记'
  const selectableWorkspaces = useMemo(
    () => availableWorkspaces ?? [],
    [availableWorkspaces],
  )
  const filteredWorkspaces = useMemo(() => {
    const q = workspaceQuery.trim().toLowerCase()
    if (!q) return selectableWorkspaces
    return selectableWorkspaces.filter((ws) => ws.name.toLowerCase().includes(q))
  }, [selectableWorkspaces, workspaceQuery])

  const filteredExistingItems = useMemo(() => {
    const q = existingQuery.trim().toLowerCase()
    const list = q
      ? existingItems.filter((item) => {
        const haystack = [item.name, item.source_value, item.workspace_name, item.description ?? ''].join(' ').toLowerCase()
        return haystack.includes(q)
      })
      : existingItems
    return list.slice(0, 60)
  }, [existingItems, existingQuery])

  useEffect(() => {
    let cancelled = false
    const category: TemplateCategory = selectedNoteType === 'audio'
      ? 'style_audio'
      : selectedNoteType === 'image_text'
        ? 'style_image_text'
        : 'style_video_with_frames'
    fetchTemplates(category)
      .then((items) => {
        if (!cancelled) setStyleTemplates(items)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedNoteType])

  const styleOptions = useMemo(() => {
    if (styleTemplates.length === 0) {
      return [...PRIMARY_STYLES, ...MORE_STYLES].map((style) => ({
        id: style.id,
        label: style.label,
        desc: STYLE_DESCRIPTIONS[style.id] ?? '',
      }))
    }
    return [...styleTemplates]
      .filter((item) => !item.speaker_aware_only)
      .sort((a, b) => {
        const ai = STYLE_ORDER.get(a.template_id) ?? 1000
        const bi = STYLE_ORDER.get(b.template_id) ?? 1000
        return ai - bi || a.name.localeCompare(b.name, 'zh-Hans-CN')
      })
      .map((item) => ({
        id: item.template_id,
        label: item.name,
        desc: item.description || item.use_case || STYLE_DESCRIPTIONS[item.template_id] || '',
      }))
  }, [styleTemplates])

  const primaryStyleOptions = styleOptions.slice(0, 7)
  const moreStyleOptions = styleOptions.slice(7)

  const selectedExistingRefs = useMemo(
    () => existingItems
      .filter((item) => existingSelectedIds.has(libraryItemKey(item)))
      .map((item) => ({ workspace_id: item.workspace_id, item_id: item.item_id })),
    [existingItems, existingSelectedIds],
  )

  // 首次打开弹窗时：拉最新 providers；有视觉模型则默认开配图
  useEffect(() => {
    if (open) {
      fetchProviders()
    }
  }, [open, fetchProviders])

  // providers 加载完成后，若用户还没手动改过开关，自动设置默认值
  const userToggledRef = useRef(false)
  useEffect(() => {
    if (!userToggledRef.current) {
      setEmbedFrames(hasVisionModel)
    }
  }, [hasVisionModel])

  // 本地文件不参与链接识别：屏蔽 url/sniff，避免残留的 sniffResult 误显示「已识别视频」卡片、
  // 也避免链接探测 useEffect 把 probeItemMedia 探到的本地时长清零覆盖。
  const effectiveUrl = isLocalFile ? '' : (urlValue ?? internalUrl).trim()
  const batchSourceText = isLocalFile ? '' : (sourceText ?? urlValue ?? internalUrl).trim()
  const isPastedMultiUrlSource = batchUrlsFromText(batchSourceText).length > 1
  const detectedBatchSource = looksLikeBatchSource(batchSourceText)
  const isBatchMode = !isLocalFile && (
    sourceMode === 'batch'
    || (sourceMode === 'auto' && (detectedBatchSource || Boolean(batchResult)))
  )
  const canResolveBatchSource = !isLocalFile && isBatchMode && Boolean(batchSourceText)
  const showBatchSourcePanel = !isLocalFile && (isBatchMode || Boolean(batchResult))
  const shouldBlockSingleSubmit = !isLocalFile && isBatchMode
  const selectedBatchItems = useMemo(() => {
    if (!batchResult) return []
    return batchResult.items.filter((item, index) => batchSelectedKeys.has(batchSourceItemKey(item, index)))
  }, [batchResult, batchSelectedKeys])
  const isBatchSubmitReady = isBatchMode && Boolean(batchResult)
  const primaryActionDisabled = isBatchMode
    ? (!canResolveBatchSource || batchResolving || batchImporting || (isBatchSubmitReady && selectedBatchItems.length === 0))
    : ((!isLocalFile && !effectiveUrl) || submitting)
  const primaryActionLabel = isBatchMode
    ? batchResolving
      ? '解析中…'
      : batchImporting
        ? '提交中…'
        : batchResult
          ? `提交批量 (${selectedBatchItems.length})`
          : '解析批量来源'
    : submitting
      ? '处理中…'
      : '开始生成'
  const effectiveSniff = isLocalFile ? null : (sniffResult ?? internalSniff)
  // 稳定原始值供 link-preview effect 依赖（避免 effectiveSniff 对象身份抖动）
  const sniffThumbnail = effectiveSniff?.thumbnail ?? null
  const sniffTitle = effectiveSniff?.title ?? null
  const previewThumbUrl = normalizePreviewImageUrl(sniffThumbnail || coverUrl)
  const workspaceSummary = workspaceIds[0] ? getWorkspaceLabel(workspaceIds[0], '当前合集') : ''
  const sourceSummary = isLocalFile
    ? (localFileName || '本地文件')
    : (effectiveSniff?.title || linkTitle)
      ? `${effectiveSniff?.platform ?? '未知平台'} · ${effectiveSniff?.title || linkTitle}`
      : effectiveUrl
        ? '网络链接'
        : '输入素材链接'
  const autoResolvedNoteType: NoteMediaKind =
    isLocalFile
      ? noteTypeFromLocalFile(localFileType)
      : effectiveSniff?.primary_type === 'video'
        ? 'video'
        : effectiveSniff?.primary_type === 'audio'
          ? 'audio'
          : effectiveSniff?.primary_type === 'image' || effectiveSniff?.primary_type === 'text'
            ? 'image_text'
            : 'auto'
  const showVideoNoteSettings =
    selectedNoteType === 'video' || selectedNoteType === 'mixed' || (selectedNoteType === 'auto' && autoResolvedNoteType === 'video')
  const showAudioNoteSettings =
    selectedNoteType === 'audio' || (selectedNoteType === 'auto' && autoResolvedNoteType === 'audio')
  const showImageTextNoteSettings =
    selectedNoteType === 'image_text' || selectedNoteType === 'mixed' || (selectedNoteType === 'auto' && autoResolvedNoteType === 'image_text')
  const showFrameAnalysisSettings = showVideoNoteSettings
  const showSpeakerSettings = showVideoNoteSettings || showAudioNoteSettings
  const advancedSummaryParts = [
    ...(showImageTextNoteSettings ? ['图文理解'] : []),
    '补充说明',
  ]
  const advancedSummary = advancedSummaryParts.join(' · ')

  const speakerAwareMedia = (showAudioNoteSettings || showVideoNoteSettings) && diarizeOn
  const selectedSpeakerCount = speakerCount === 'auto' ? undefined : Number(speakerCount)
  const visiblePrimaryStyleOptions = speakerAwareMedia ? SPEAKER_AWARE_STYLES : primaryStyleOptions
  const visibleMoreStyleOptions = speakerAwareMedia
    ? []
    : moreStyleOptions

  const handleDiarizeChange = (enabled: boolean) => {
    setDiarizeOn(enabled)
    if (showAudioNoteSettings || showVideoNoteSettings) {
      if (enabled) setNoteStyle(SPEAKER_AWARE_STYLES[0].id)
      else if (SPEAKER_AWARE_STYLE_IDS.has(noteStyle)) setNoteStyle('standard')
    }
  }

  const doSniff = useCallback(async (url: string) => {
    try {
      setSniffFailed(false)
      setInternalSniff(await sniffUrl(url))
    } catch {
      setInternalSniff(null)
      setSniffFailed(true)
    }
  }, [])

  const switchSourceMode = useCallback((mode: Exclude<SourceMode, 'auto'>) => {
    setSourceMode(mode)
    setError(null)
    if (mode === 'single') {
      setBatchResult(null)
      setBatchSelectedKeys(new Set())
      setBatchResolving(false)
      autoBatchResolveKeyRef.current = ''
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setInternalUrl('')
    setInternalSniff(null)
    setSniffFailed(false)
    setDiarizeOn(false)
    setUserNotes('')
    setNoteStyle('standard')
    setSourceMode('auto')
    setSelectedNoteType('auto')
    setCaptureMode('auto')
    setFrameInterval(5)
    setSelectedVisionModel('')
    setAdvancedOpen(false)
    setWorkspaceQuery('')
    setWorkspacePickerOpen(false)
    setError(null)
    setSubmitting(false)
    setRenamingWorkspaceId(null)
    setWorkspaceNameDraft('')
    setExistingPanelOpen(false)
    setExistingItems([])
    setExistingSelectedIds(new Set())
    setExistingQuery('')
    setExistingAdding(false)
    setBatchResult(null)
    setBatchSelectedKeys(new Set())
    setBatchResolving(false)
    setBatchImporting(false)
    autoBatchResolveKeyRef.current = ''
    setLinkDesc('')
    setCoverUrl('')
    setLinkTitle('')
    userToggledRef.current = false
    // 每次重开恢复到当前 provider 能力下的默认值，避免上次展开/切换残留到这次弹框。
    setEmbedFrames(hasVisionModel)
  }, [open, urlValue, sourceText])

  useEffect(() => {
    if (!open || !urlValue?.trim()) return
    void doSniff(urlValue.trim())
  }, [open, urlValue, doSniff])

  useEffect(() => {
    if (!open || urlValue || !internalUrl.trim()) return
    clearTimeout(sniffTimer.current)
    sniffTimer.current = setTimeout(() => {
      void doSniff(internalUrl.trim())
    }, 500)
    return () => clearTimeout(sniffTimer.current)
  }, [open, internalUrl, urlValue, doSniff])

  // 识别为视频后，轻量探测时长（供「取画面」算预估帧数）；非视频/拿不到 → 0
  useEffect(() => {
    if (isLocalFile) return // 本地文件时长由下方 probeItemMedia useEffect 负责，不在此清零
    if (!open || !effectiveUrl || effectiveSniff?.primary_type !== 'video') {
      setVideoDuration(0)
      return
    }
    let cancelled = false
    probeDuration(effectiveUrl)
      .then((r) => { if (!cancelled) setVideoDuration(r.duration_sec || 0) })
      .catch(() => { if (!cancelled) setVideoDuration(0) })
    return () => { cancelled = true }
  }, [open, effectiveUrl, effectiveSniff?.primary_type, isLocalFile])

  // 本地文件：上传后用后端 cv2 探测时长 + 首帧封面（支持 flv 等 HTML5 video 播不了的格式）
  useEffect(() => {
    if (!open || !isLocalFile || !localFile || !localWsId) return
    let cancelled = false
    setVideoDuration(0)
    setLocalCover('')
    probeItemMedia(localWsId, localFile)
      .then((r) => {
        if (cancelled) return
        setVideoDuration(r.duration_sec || 0)
        setLocalCover(r.cover_url || '')
      })
      .catch(() => { /* 探测失败降级，不阻塞添加 */ })
    return () => { cancelled = true }
  }, [open, isLocalFile, localFile, localWsId])

  // URL 变化时才清空补抓的封面/标题/简介（避免 effectiveSniff 对象身份抖动反复重置）
  useEffect(() => {
    setCoverUrl('')
    setLinkTitle('')
    setLinkDesc('')
  }, [effectiveUrl])

  // sniff 对已知平台（B站等）只做 O(1) 类型判断、不返回封面/标题 → 用 link-preview 补
  // 依赖用稳定原始值（effectiveUrl + 缺失标志），不放入 effectiveSniff 对象，否则父组件每次 sniff
  // 重渲染会重置 state、cancel 掉异步结果 → 封面/标题永远填不上。
  useEffect(() => {
    if (!open || !effectiveUrl) return
    // sniff 已返回封面+标题（非已知平台场景）→ 不需要 link-preview 补
    if (sniffThumbnail && sniffTitle) return
    let cancelled = false
    fetchLinkPreview(effectiveUrl)
      .then((p) => {
        if (cancelled) return
        if (p.image_url && !sniffThumbnail) {
          // B站封面是协议相对 URL（//i1.hdslb.com/...），补 https 否则 localhost(http) 下加载失败
          setCoverUrl(normalizePreviewImageUrl(p.image_url))
        }
        if (p.title && !sniffTitle) setLinkTitle(p.title)
        if (p.description) setLinkDesc(p.description)
      })
      .catch(() => { /* link-preview 已内部兜底，忽略 */ })
    return () => { cancelled = true }
  }, [open, effectiveUrl, sniffThumbnail, sniffTitle])

  const selectWorkspace = useCallback((workspaceId: string) => {
    if (!onWorkspaceIdsChange) return
    const next = workspaceIds[0] === workspaceId ? [] : [workspaceId]
    onWorkspaceIdsChange(next)
    setWorkspacePickerOpen(false)
  }, [onWorkspaceIdsChange, workspaceIds])

  const clearWorkspace = useCallback(() => {
    onWorkspaceIdsChange?.([])
    setWorkspacePickerOpen(false)
  }, [onWorkspaceIdsChange])

  const handleCreateWorkspace = useCallback(async () => {
    if (creatingWorkspace) return
    setCreatingWorkspace(true)
    setError(null)
    try {
      if (onCreateWorkspace) {
        const created = await onCreateWorkspace(workspaceQuery)
        onWorkspaceIdsChange?.([created.workspace_id])
      } else {
        // 降级：直接用 createWorkspace 创建（TaskboardPage 场景）
        const name = workspaceQuery.trim() || '新笔记合集'
        const created = await createWorkspaceSvc({ name })
        onWorkspaceIdsChange?.([created.workspace_id])
        toast.success(`合集「${name}」已创建`)
      }
      setWorkspaceQuery('')
      setWorkspacePickerOpen(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建合集失败'
      setError(msg)
      toast.error(msg)
    } finally {
      setCreatingWorkspace(false)
    }
  }, [creatingWorkspace, onCreateWorkspace, onWorkspaceIdsChange, workspaceQuery])

  const handleSaveWorkspaceRename = useCallback(async () => {
    const workspaceId = renamingWorkspaceId
    const nextName = workspaceNameDraft.trim()
    if (!workspaceId) return
    if (!nextName) {
      setRenamingWorkspaceId(null)
      setWorkspaceNameDraft('')
      return
    }
    try {
      const updated = await updateWorkspaceSvc(workspaceId, { name: nextName })
      setWorkspaceNameOverrides((prev) => ({ ...prev, [workspaceId]: updated.name }))
      onWorkspaceUpdated?.(updated)
      setRenamingWorkspaceId(null)
      setWorkspaceNameDraft('')
      toast.success(`合集已重命名为「${updated.name}」`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '重命名合集失败'
      setError(msg)
      toast.error(msg)
    }
  }, [onWorkspaceUpdated, renamingWorkspaceId, workspaceNameDraft])

  const loadExistingMaterials = useCallback(async () => {
    if (!targetWorkspaceId) {
      toast.info('请先选择一个合集')
      return
    }
    setExistingPanelOpen(true)
    setExistingLoading(true)
    setError(null)
    try {
      const library = await fetchLibrary(false)
      const candidates = library.items.filter((item) => (
        item.status === 'done'
        && item.workspace_id !== targetWorkspaceId
        && !targetExistingItemIds.has(item.item_id)
      ))
      setExistingItems(candidates)
      setExistingSelectedIds(new Set())
    } catch (err) {
      const msg = err instanceof Error ? err.message : '读取已分析内容失败'
      setError(msg)
      toast.error(msg)
    } finally {
      setExistingLoading(false)
    }
  }, [targetExistingItemIds, targetWorkspaceId])

  const toggleExistingItem = useCallback((itemKey: string) => {
    setExistingSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemKey)) next.delete(itemKey)
      else next.add(itemKey)
      return next
    })
  }, [])

  const handleAddExistingMaterials = useCallback(async () => {
    if (!targetWorkspaceId) {
      toast.info('请先选择一个合集')
      return
    }
    if (selectedExistingRefs.length === 0) {
      toast.info('请先选择要加入的内容')
      return
    }
    const toastId = `workspace-add-existing-${targetWorkspaceId}`
    setExistingAdding(true)
    toast.loading('正在加入已分析内容…', { id: toastId })
    try {
      const result = await batchAddItemsToWorkspace(targetWorkspaceId, selectedExistingRefs)
      toast.success(`已加入 ${result.added} 项内容${result.skipped ? `，跳过 ${result.skipped} 项` : ''}`, { id: toastId })
      onAdded?.()
      setExistingSelectedIds(new Set())
      setExistingPanelOpen(false)
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '加入内容失败'
      toast.error(msg, { id: toastId })
    } finally {
      setExistingAdding(false)
    }
  }, [onAdded, onOpenChange, selectedExistingRefs, targetWorkspaceId])

  const handleResolveBatchSource = useCallback(async (sourceOverride?: string, silent = false) => {
    const source = (sourceOverride ?? batchSourceText).trim()
    if (!source) {
      setError('请先输入批量来源链接')
      return
    }
    setBatchResolving(true)
    setError(null)
    try {
      const result = await resolveBatchSource(source)
      setBatchResult(result)
      setBatchSelectedKeys(new Set(result.items.map((item, index) => batchSourceItemKey(item, index))))
      if (!silent) toast.success('批量来源已解析', { description: `${result.items.length} 条内容` })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '批量来源解析失败'
      setError(msg)
      if (!silent) toast.error(msg)
    } finally {
      setBatchResolving(false)
    }
  }, [batchSourceText])

  useEffect(() => {
    if (!open || !canResolveBatchSource || batchResult || batchResolving || batchImporting) return
    if (!detectedBatchSource && sourceMode !== 'batch') return
    const source = batchSourceText.trim()
    if (!source || autoBatchResolveKeyRef.current === source) return
    const timer = window.setTimeout(() => {
      autoBatchResolveKeyRef.current = source
      void handleResolveBatchSource(source, true)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [
    open,
    canResolveBatchSource,
    batchResult,
    batchResolving,
    batchImporting,
    detectedBatchSource,
    sourceMode,
    batchSourceText,
    handleResolveBatchSource,
  ])

  const handleImportBatchSource = async () => {
    if (!batchResult || batchResult.items.length === 0) return
    if (selectedBatchItems.length === 0) {
      setError('请至少选择 1 条要导入的视频')
      return
    }
    setBatchImporting(true)
    setError(null)
    try {
      const resolvedNoteKind = selectedNoteType === 'auto' ? 'video' : selectedNoteType === 'mixed' ? 'mixed' : selectedNoteType
      const effInterval = captureMode === 'auto' ? computeAutoInterval(videoDuration) : frameInterval
      const effVisionModel = selectedVisionModel === '__default__' ? '' : selectedVisionModel
      const result = await importBatchSource({
        workspace_name: batchResult.title || '批量导入合集',
        kind: 'note',
        source_type: batchResult.source_type,
        source_url: batchResult.source_url,
        items: selectedBatchItems,
        start: true,
        embed_frames: resolvedNoteKind === 'video' ? embedFrames : false,
        image_mode: 'vision',
        frame_interval: effInterval,
        vision_model: effVisionModel,
        intent: 'note',
        note_media_kind: resolvedNoteKind,
        summary_template: noteStyle,
        diarize: diarizeOn,
        ...(selectedSpeakerCount ? { speaker_count: selectedSpeakerCount } : {}),
        ...(speakerAwareMedia ? { summary_mode: 'speaker_aware' as const } : {}),
        user_notes: userNotes,
      })
      toast.success('批量合集已创建', { description: `${result.items_added} 条内容已加入任务队列` })
      onWorkspaceUpdated?.(result.workspace)
      onAdded?.()
      onOpenChange(false)
      navigate(`/processing/batch/${result.workspace.workspace_id}`, {
        state: {
          workspace: result.workspace,
          taskIds: result.tasks.map((task) => task.task_id),
        },
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '批量导入失败'
      setError(msg)
      toast.error(msg)
    } finally {
      setBatchImporting(false)
    }
  }

  const handleGenerateNote = async () => {
    if (isLocalFile) {
      // 本地文件：savePreflight + startItemPipeline，绕开 generateNote 的 URL 校验
      if (!localFile) return
      setSubmitting(true)
      setError(null)
      try {
        const wsId = localWsId || workspaceIds[0]
        if (!wsId) { setError('未找到合集'); return }
        const resolvedNoteType = selectedNoteType === 'auto' ? autoResolvedNoteType : selectedNoteType
        const videoTask = resolvedNoteType === 'video' || resolvedNoteType === 'mixed'
        const effInterval = videoTask
          ? (captureMode === 'auto' ? computeAutoInterval(videoDuration) : frameInterval)
          : undefined
        const videoModelId = selectedVisionModel === '__default__' || !selectedVisionModel ? undefined : selectedVisionModel
        await savePreflight(wsId, localFile, {
          intent: 'learning',
          background_overrides: {
            // 后端 /start 从 background_overrides 读 frame_interval_sec
            ...(effInterval != null ? { frame_interval_sec: effInterval } : {}),
          },
          models: {
            ...(videoModelId ? { vision: videoModelId } : {}),
          },
          tasks: {
            // 后端 /start 从 tasks.summary 读 embed_frames → payload.preflight.embed_frames
            summary: {
              embed_frames: videoTask ? embedFrames : false,
              summary_template: noteStyle,
              diarize: resolvedNoteType === 'mixed' ? true : diarizeOn,
              ...(((resolvedNoteType === 'audio' || resolvedNoteType === 'video') && diarizeOn && selectedSpeakerCount)
                ? { speaker_count: selectedSpeakerCount }
                : {}),
              ...((resolvedNoteType === 'audio' || resolvedNoteType === 'video') && diarizeOn ? { summary_mode: 'speaker_aware' as const } : {}),
            },
            // 混合笔记：标记 note_media_kind
            ...(resolvedNoteType === 'mixed' ? { note_media_kind: 'mixed' } : {}),
          },
        })
        const { task_id } = await startItemPipeline(wsId, localFile)
        toast.success('任务已创建', { description: localFileName || '本地文件' })
        onAdded?.()
        onOpenChange(false)
        navigate(`/processing/${task_id}`, {
          state: {
            url: localFileName || '',
            workspaceId: wsId,
            itemId: localFile,
            taskType: 'note',
            itemType: localFileType ?? (resolvedNoteType === 'audio' ? 'audio' : resolvedNoteType === 'image_text' ? 'image' : 'video'),
          },
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : '提交失败'
        setError(msg)
        toast.error(msg)
      } finally {
        setSubmitting(false)
      }
      return
    }

    // 链接提交：维持原有 generateNote 路径
    if (!effectiveUrl) {
      setError('请先输入素材链接')
      return
    }
    if (shouldBlockSingleSubmit || isPastedMultiUrlSource) {
      setError('检测到批量来源，请先解析批量来源并导入为合集')
      return
    }
    setSubmitting(true)
    setError(null)

    try {
      let wsId = workspaceIds[0]
      if (!wsId) {
        const ws = await ensureInbox()
        wsId = ws.workspace_id
      }

      // SniffResult 暂无 duration 字段，智能档兜底默认 10 秒
      const effInterval =
        captureMode === 'auto' ? computeAutoInterval(videoDuration) : frameInterval
      const effVisionModel = selectedVisionModel === '__default__' ? '' : selectedVisionModel
      const result = await generateNote(
        wsId, effectiveUrl, effectiveSniff?.title ?? undefined,
        embedFrames, 'vision', effInterval, effVisionModel,
        'note', selectedNoteType,
        { diarize: selectedNoteType === 'mixed' ? true : diarizeOn, ...(speakerAwareMedia && selectedSpeakerCount ? { speaker_count: selectedSpeakerCount } : {}), summary_template: noteStyle, ...(speakerAwareMedia ? { summary_mode: 'speaker_aware' as const } : {}), user_notes: userNotes, ...(selectedNoteType === 'mixed' ? { note_media_kind: 'mixed' } : {}) },
      )
      toast.success('笔记生成中', { description: `${result.item_type} · ${effectiveUrl}` })

      onAdded?.()
      onOpenChange(false)
      navigate(`/processing/${result.task_id}`, {
        state: { url: effectiveUrl, workspaceId: wsId, taskType: 'note', itemId: result.item_id, itemType: result.item_type },
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '任务创建失败'
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`remix-modal-content${isBatchMode ? ' remix-modal-content--batch' : ''}`}
        overlayClassName="remix-modal-backdrop"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">添加素材</DialogTitle>
        <DialogDescription className="sr-only">
          {dialogDescription}
        </DialogDescription>

        <div className="m-head">
          <div>
            <div className="eyebrow">ADD MATERIAL · 添加素材</div>
            <h3 className="display" style={{ fontSize: 28, margin: '4px 0 0' }}>
              添加素材
            </h3>
            <p className="modal-subtitle">{[workspaceSummary, sourceSummary].filter(Boolean).join(' · ')}</p>
          </div>
          <DialogClose className="btn btn-ghost modal-close">
            <X size={16} />
          </DialogClose>
        </div>

        <div className="m-body">
          {error && <div className="modal-error">{error}</div>}

          <MaterialSourcePanel
            isLocalFile={isLocalFile}
            localCover={localCover}
            localFileType={localFileType}
            localFileName={localFileName}
            videoDuration={videoDuration}
            isBatchMode={isBatchMode}
            onSwitchSourceMode={switchSourceMode}
            urlValue={urlValue}
            internalUrl={internalUrl}
            onInternalUrlChange={(value) => {
              setInternalUrl(value)
              setError(null)
              setInternalSniff(null)
              setBatchResult(null)
              setBatchSelectedKeys(new Set())
              autoBatchResolveKeyRef.current = ''
            }}
            onPickLocalFile={onPickLocalFile}
            localUploadPending={localUploadPending}
            showBatchSourcePanel={showBatchSourcePanel}
            canResolveBatchSource={canResolveBatchSource}
            batchResolving={batchResolving}
            batchImporting={batchImporting}
            batchResult={batchResult}
            batchSelectedKeys={batchSelectedKeys}
            onBatchSelectedKeysChange={setBatchSelectedKeys}
            selectedBatchItemsCount={selectedBatchItems.length}
            onResolveBatchSource={() => void handleResolveBatchSource()}
            onImportBatchSource={handleImportBatchSource}
            targetWorkspaceId={targetWorkspaceId}
            existingPanelOpen={existingPanelOpen}
            onToggleExistingPanel={() => {
              if (existingPanelOpen) {
                setExistingPanelOpen(false)
                return
              }
              void loadExistingMaterials()
            }}
            existingQuery={existingQuery}
            onExistingQueryChange={setExistingQuery}
            existingLoading={existingLoading}
            filteredExistingItems={filteredExistingItems}
            existingSelectedIds={existingSelectedIds}
            onToggleExistingItem={toggleExistingItem}
            selectedExistingRefsCount={selectedExistingRefs.length}
            existingAdding={existingAdding}
            onAddExistingMaterials={() => void handleAddExistingMaterials()}
            effectiveSniff={effectiveSniff}
            sniffFailed={sniffFailed}
            effectiveUrl={effectiveUrl}
            previewThumbUrl={previewThumbUrl}
            linkTitle={linkTitle}
            linkDesc={linkDesc}
          />

          <WorkspacePicker
            workspaceIds={workspaceIds}
            availableWorkspaces={availableWorkspaces}
            workspacePickerOpen={workspacePickerOpen}
            onWorkspacePickerOpenChange={setWorkspacePickerOpen}
            workspaceQuery={workspaceQuery}
            onWorkspaceQueryChange={setWorkspaceQuery}
            filteredWorkspaces={filteredWorkspaces}
            renamingWorkspaceId={renamingWorkspaceId}
            workspaceNameDraft={workspaceNameDraft}
            onWorkspaceNameDraftChange={setWorkspaceNameDraft}
            onRenameStart={(wsId, label) => {
              setRenamingWorkspaceId(wsId)
              setWorkspaceNameDraft(label)
            }}
            onRenameSave={() => void handleSaveWorkspaceRename()}
            onRenameCancel={() => {
              setRenamingWorkspaceId(null)
              setWorkspaceNameDraft('')
            }}
            creatingWorkspace={creatingWorkspace}
            getWorkspaceLabel={getWorkspaceLabel}
            onSelectWorkspace={selectWorkspace}
            onClearWorkspace={clearWorkspace}
            onCreateWorkspace={handleCreateWorkspace}
            onWorkspaceIdsChange={onWorkspaceIdsChange}
            hasOnCreateWorkspace={!!onCreateWorkspace}
          />

          <NoteSettingsPanel
            selectedNoteType={selectedNoteType}
            onSelectedNoteTypeChange={setSelectedNoteType}
            noteTypeCards={NOTE_TYPE_CARDS}
            noteStyle={noteStyle}
            onNoteStyleChange={setNoteStyle}
            speakerAwareMedia={speakerAwareMedia}
            visiblePrimaryStyleOptions={visiblePrimaryStyleOptions}
            visibleMoreStyleOptions={visibleMoreStyleOptions}
            showSpeakerSettings={showSpeakerSettings}
            diarizeOn={diarizeOn}
            onDiarizeChange={handleDiarizeChange}
            speakerCount={speakerCount}
            onSpeakerCountChange={setSpeakerCount}
            showFrameAnalysisSettings={showFrameAnalysisSettings}
            embedFrames={embedFrames}
            onEmbedFramesChange={setEmbedFrames}
            onUserToggled={() => { userToggledRef.current = true }}
            visionModels={visionModels}
            hasVisionModel={hasVisionModel}
            selectedVisionModel={selectedVisionModel}
            onSelectedVisionModelChange={setSelectedVisionModel}
            captureMode={captureMode}
            onCaptureModeChange={setCaptureMode}
            frameInterval={frameInterval}
            onFrameIntervalChange={setFrameInterval}
            videoDuration={videoDuration}
            advancedOpen={advancedOpen}
            onAdvancedOpenChange={setAdvancedOpen}
            advancedSummary={advancedSummary}
            userNotes={userNotes}
            onUserNotesChange={setUserNotes}
          />
        </div>

        <div className="m-foot">
          <span className="mono modal-foot-status">
            <span className="chip-dot" style={{ marginRight: 6 }} />
            笔记
            {selectedNoteType !== 'auto'
              ? ` · ${NOTE_TYPE_CARDS.find(c => c.value === selectedNoteType)?.label ?? ''}`
              : ''}
          </span>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (isBatchMode) {
                  if (batchResult) void handleImportBatchSource()
                  else void handleResolveBatchSource()
                  return
                }
                void handleGenerateNote()
              }}
              disabled={primaryActionDisabled}
              title={isBatchMode ? (batchResult ? '提交批量任务' : '解析批量来源') : '开始生成'}
            >
              <Wand2 size={14} />
              {primaryActionLabel}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
