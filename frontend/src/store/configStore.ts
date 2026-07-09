import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  fetchDownloadConfig,
  updateDownloadConfig,
  type DownloadConfigPayload,
  type DownloadConfigPatchPayload,
} from '@/services/download'

/** 笔记生成质量：fast=快速 / medium=平衡 / slow=精细 */
export type Quality = 'fast' | 'medium' | 'slow'

/** 笔记格式：可多选 */
export type NoteFormat =
  | 'bulleted'
  | 'mindmap'
  | 'quiz'
  | 'summary'
  | 'key_points'

/** 笔记风格 */
export type NoteStyle = 'academic' | 'minimalist' | 'creative'

/** 下载策略预设（由前端映射到下载引擎的 format selector） */
export type DownloadMode = 'balanced' | 'speed' | 'quality' | 'audio'

/** 音频转写引擎类型 */
export type TranscriberType = 'fast-whisper' | 'bcut' | 'kuaishou' | 'groq' | 'mlx-whisper'

/** Whisper 模型大小 */
export type WhisperModelSize = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3' | 'large-v3-turbo'

/** 性能档位 */
export type PerformanceTier = 'low' | 'medium' | 'high'

/** 音频转写配置 */
export interface TranscriberConfig {
  /** 转写引擎类型（fast-whisper/bcut/kuaishou/groq） */
  type: TranscriberType
  /** Whisper 模型大小（仅适用于 fast-whisper） */
  whisperModelSize: WhisperModelSize
  /** 语言偏好（ISO 639-1 代码，如 'zh', 'en'） */
  language: string
  /** 设备选择（cpu/cuda/mps） */
  device: string
  /** Groq API Key（仅适用于 groq 类型） */
  groqApiKey: string
  /** ASR 初始提示词（Faster Whisper 前置 prompt，用于引导识别）*/
  initialPrompt: string
  /** R4.8: CPU 线程数（0=自动） */
  cpuThreads: number
  /** R4.8: beam search 宽度（1=贪心，5=默认） */
  beamSize: number
  /** R4.8: Silero VAD 静默过滤（默认开） */
  vadFilter: boolean
}

/**
 * 下载器配置（M3 新增,映射后端 `DownloadConfig` 数据类,camelCase）。
 *
 * - 持久化真相源 = 后端 `.local/settings.json`;
 * - 前端 store 以最近一次 `loadDownloadConfig` / `saveDownloadConfig` 返回值为镜像;
 * - 数值字段前端不做 clamp,校验由后端(ge/le → 422)负责,详见 DESIGN_NOTES §3.4 D13。
 */
export interface DownloadConfig extends Record<string, unknown> {
  /** 下载目录(空串=回落 data/videos/ 与项目目录) */
  outputDir: string
  /** yt-dlp outtmpl 模板(空串=回落旧硬编码 %(title)s.%(ext)s) */
  filenameTemplate: string
  /** 下载专用 HTTP/SOCKS 代理(与全局 httpProxy 语义一致,独立字段便于未来解耦) */
  httpProxy: string
  /** YouTube PO Token */
  poToken: string
  /** YouTube Visitor Data */
  visitorData: string
  /** Cookie 基目录列表(绝对路径数组) */
  cookieBaseDirs: string[]
  /** yt-dlp concurrent_fragment_downloads,后端 clamp [1,8] */
  concurrencyLimit: number
  /** yt-dlp retries,后端 clamp [0,10] */
  retryCount: number
  /** yt-dlp socket_timeout(秒),后端 clamp [5,300] */
  socketTimeout: number
}

/** 截图配置 */
export interface ScreenshotConfig {
  /** 默认抽帧间隔（秒） */
  defaultInterval: number
  /** 网格拼图尺寸 [列数, 行数] */
  gridSize: [number, number]
  /** JPEG 质量（1-100） */
  jpegQuality: number
  /** 是否自动嵌入笔记中 */
  embedInNote: boolean
}

/** 用户偏好配置（全部持久化到 localStorage） */
export interface ConfigState {
  /** 默认质量 */
  defaultQuality: Quality
  /** 默认格式（多选） */
  defaultFormats: NoteFormat[]
  /** 默认风格 */
  defaultStyle: NoteStyle

  /** 是否插入截图 */
  screenshot: boolean
  /** 是否保留原始链接 */
  link: boolean
  /** 是否开启视觉理解（多模态抽帧分析） */
  video_understanding: boolean
  /** 抽帧间隔（秒） */
  video_interval: number
  /** 网格拼图尺寸 [列数, 行数] */
  grid_size: [number, number]
  /** 额外 prompt 补充说明 */
  extras: string

  /** 网络代理服务器地址，例如 "http://127.0.0.1:7890"，用于访问海外站点（全局设置） */
  httpProxy: string
  /** 双模型：文本处理模型 provider_id（脚本/摘要/总结） */
  textProviderId: string
  /** 双模型：文本处理模型 ID（脚本/摘要/总结） */
  textModelId: string
  /** 双模型：视觉处理模型 provider_id（视觉分析/抽帧描述，如 Qwen-VL） */
  visionProviderId: string
  /** 双模型：视觉处理模型 ID（视觉分析/抽帧描述，如 Qwen-VL） */
  visionModelId: string
  /** RAG 嵌入模型 provider_id */
  embeddingProviderId: string
  /** RAG 嵌入模型 ID */
  embeddingModelId: string
  /** RAG 重排模型 provider_id */
  rerankProviderId: string
  /** RAG 重排模型 ID */
  rerankModelId: string

  /** 音频转写配置 */
  transcriber: TranscriberConfig
  /** 截图配置 */
  screenshotSettings: ScreenshotConfig
  /** 性能档位 */
  performanceTier: PerformanceTier

  /** 下载策略预设（均衡/优先速度/优先画质/仅提取音频） */
  downloadMode: DownloadMode
  /** YouTube PO Token（可选，用于突破限流） */
  poToken: string
  /** YouTube Visitor Data（可选，用于突破限流） */
  visitorData: string
  /** Cookie 基目录（多行，每行一个绝对路径；为空则使用默认目录） */
  cookieBaseDirs: string

  /** Tavily 联网搜索 API Key */
  tavilyApiKey: string
  /** 总结弹窗上次选择的 provider_id（记忆用） */
  summaryProviderId: string
  /** 总结弹窗上次选择的 model（记忆用） */
  summaryModelId: string

  /** 下载器配置(M3 新增,后端持久化镜像) */
  downloadConfig: DownloadConfig

  /** 操作 */
  setConfig: (patch: Partial<Omit<ConfigState, ConfigStateActionKey>>) => void
  /** 将所有字段重置为初始默认值 */
  resetConfig: () => void

  // ── 下载器配置专属操作(M3) ────────────────────────────────────────
  /** 本地浅合并 downloadConfig(仅前端状态,不触网) */
  setDownloadConfig: (patch: Partial<DownloadConfig>) => void
  /** 从后端拉取下载器配置,回写到 store,返回最新快照 */
  loadDownloadConfig: () => Promise<DownloadConfig>
  /**
   * 把 patch 下发到后端,成功后以后端返回体为真相源回写 store。
   * 后端拒绝(如越界 422)时,store 保持原状,caller 捕获 error 用于 UI 回显。
   */
  saveDownloadConfig: (patch: Partial<DownloadConfig>) => Promise<DownloadConfig>
}

/** ConfigState 中所有"操作"型成员的 key 集合(用于 setConfig 参数 Omit) */
type ConfigStateActionKey =
  | 'setConfig'
  | 'resetConfig'
  | 'setDownloadConfig'
  | 'loadDownloadConfig'
  | 'saveDownloadConfig'

/**
 * DownloadConfig 默认值(字段与后端 `shared.settings_store.DownloadConfig` 对齐)。
 *
 * 注意:filenameTemplate 默认 `%(title)s-%(id)s.%(ext)s` 与后端一致;
 * 这与 yt-dlp 内置 `_build_attempts` 的旧硬编码 `%(title)s.%(ext)s` 不同——
 * M3 之前无持久化,yt-dlp 使用旧硬编码;落库默认后新链路用含 id 的模板避免同名覆盖。
 */
const DEFAULT_DOWNLOAD_CONFIG: DownloadConfig = {
  outputDir: '',
  filenameTemplate: '%(title)s-%(id)s.%(ext)s',
  httpProxy: '',
  poToken: '',
  visitorData: '',
  cookieBaseDirs: [],
  concurrencyLimit: 2,
  retryCount: 3,
  socketTimeout: 30,
}

/** 初始默认值（setConfig/resetConfig 共用同一份） */
const DEFAULT_CONFIG: Omit<ConfigState, ConfigStateActionKey> = {
  defaultQuality: 'medium',
  defaultFormats: ['bulleted', 'summary'],
  defaultStyle: 'academic',

  screenshot: false,
  link: false,
  video_understanding: false,
  video_interval: 30,
  grid_size: [2, 2],
  extras: '',

  // 全局代理 & 双模型 provider/model 记忆（首次加载为空，用户使用后自动填充并持久化）
  httpProxy: '',
  textProviderId: '',
  textModelId: '',
  visionProviderId: '',
  visionModelId: '',
  embeddingProviderId: '',
  embeddingModelId: '',
  rerankProviderId: '',
  rerankModelId: '',

  // 音频转写配置（本地 Faster Whisper 为默认，medium 模型，中文）
  transcriber: {
    type: 'fast-whisper',
    whisperModelSize: 'medium',
    language: 'zh',
    device: 'cpu',
    groqApiKey: '',
    initialPrompt: '',
    cpuThreads: 0,
    beamSize: 5,
    vadFilter: true,
  },

  // 截图配置（默认 6 秒间隔，3x3 网格，85% 质量，嵌入笔记）
  screenshotSettings: {
    defaultInterval: 6,
    gridSize: [3, 3],
    jpegQuality: 85,
    embedInNote: true,
  },

  // 性能档位（默认中配）
  performanceTier: 'medium',

  // 下载偏好（默认均衡；高级字段留空，仅在用户显式填写后生效）
  downloadMode: 'balanced',
  poToken: '',
  visitorData: '',
  cookieBaseDirs: '',

  // Tavily 联网搜索 + 总结弹窗模型记忆
  tavilyApiKey: '',
  summaryProviderId: '',
  summaryModelId: '',

  // M3:下载器配置镜像(真相源=后端),持久化提供首屏快照,loadDownloadConfig 按需刷新
  downloadConfig: DEFAULT_DOWNLOAD_CONFIG,
}

/** wire(snake_case) → store(camelCase) 映射。 */
function fromWire(p: DownloadConfigPayload): DownloadConfig {
  return {
    outputDir: p.output_dir,
    filenameTemplate: p.filename_template,
    httpProxy: p.http_proxy,
    poToken: p.po_token,
    visitorData: p.visitor_data,
    cookieBaseDirs: Array.isArray(p.cookie_base_dirs) ? [...p.cookie_base_dirs] : [],
    concurrencyLimit: p.concurrency_limit,
    retryCount: p.retry_count,
    socketTimeout: p.socket_timeout,
  }
}

/** 只转换 patch 中出现的字段,未提供的键 omit(对齐后端"未提供=保留"语义)。 */
function toWirePatch(patch: Partial<DownloadConfig>): DownloadConfigPatchPayload {
  const out: DownloadConfigPatchPayload = {}
  if (patch.outputDir !== undefined) out.output_dir = patch.outputDir
  if (patch.filenameTemplate !== undefined) out.filename_template = patch.filenameTemplate
  if (patch.httpProxy !== undefined) out.http_proxy = patch.httpProxy
  if (patch.poToken !== undefined) out.po_token = patch.poToken
  if (patch.visitorData !== undefined) out.visitor_data = patch.visitorData
  if (patch.cookieBaseDirs !== undefined) out.cookie_base_dirs = [...patch.cookieBaseDirs]
  if (patch.concurrencyLimit !== undefined) out.concurrency_limit = patch.concurrencyLimit
  if (patch.retryCount !== undefined) out.retry_count = patch.retryCount
  if (patch.socketTimeout !== undefined) out.socket_timeout = patch.socketTimeout
  return out
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      ...DEFAULT_CONFIG,

      setConfig: (patch) => set((state) => ({ ...state, ...patch })),
      resetConfig: () => set((state) => ({ ...state, ...DEFAULT_CONFIG })),

      setDownloadConfig: (patch) =>
        set((state) => ({
          ...state,
          downloadConfig: { ...state.downloadConfig, ...patch },
        })),

      loadDownloadConfig: async () => {
        const wire = await fetchDownloadConfig()
        const next = fromWire(wire)
        set((state) => ({ ...state, downloadConfig: next }))
        return next
      },

      saveDownloadConfig: async (patch) => {
        // 后端拒绝(422 等)时 http.post 会抛错,此处不做 try/catch:
        // store 保持原状,调用方负责 toast/错误回显,满足"保留本地 draft"语义。
        const wire = await updateDownloadConfig(toWirePatch(patch))
        const next = fromWire(wire)
        set((state) => ({ ...state, downloadConfig: next }))
        return next
      },
    }),
    {
      name: 'config-storage',
      version: 1,
      migrate: (persisted: unknown, fromVersion: number) => {
        // v0 → v1：字段 videoModelId 改名为 visionModelId（命名修正）
        if (fromVersion < 1 && persisted && typeof persisted === 'object') {
          const obj = persisted as Record<string, unknown>
          if ('videoModelId' in obj && !('visionModelId' in obj)) {
            obj.visionModelId = obj.videoModelId
            delete obj.videoModelId
          }
        }
        return persisted as ConfigState
      },
    },
  ),
)
