/**
 * 音频转写配置 API 服务（DESIGN_NOTES_SETTINGS.md §3.2 冻结契约）。
 *
 * 后端 `GET/POST /transcriber_config` 已统一返回完整 `TranscriberConfig`：
 *   { type, whisper_model_size, language, device, groq_api_key, initial_prompt }
 * POST 支持部分更新语义（缺省字段保留旧值，显式空串可清空）。
 */

import { http } from './client'
import type { WhisperModelSize, TranscriberType } from '@/store/configStore'

/** 冻结契约：后端返回体 = 前端提交体（设置页在 M2 全量对齐） */
export interface TranscriberConfigPayload extends Record<string, unknown> {
  type: TranscriberType
  whisper_model_size: WhisperModelSize
  language: string
  device: 'cpu' | 'cuda' | 'mps'
  groq_api_key: string
  /** ASR 初始提示词（Faster Whisper 前置 prompt） */
  initial_prompt: string
  /** R4.8: CPU 线程数（0=自动） */
  cpu_threads: number
  /** R4.8: beam search 宽度 */
  beam_size: number
  /** R4.8: Silero VAD 静默过滤 */
  vad_filter: boolean
}

/** 部分更新入参：字段全部可选，后端按"未提供 = 保留"语义处理 */
export type TranscriberConfigPatch = Partial<TranscriberConfigPayload>

/**
 * 获取转写器配置（全量回显）。
 */
export async function fetchTranscriberConfig(): Promise<TranscriberConfigPayload> {
  const res = await http.get<TranscriberConfigPayload>('/transcriber_config')
  return res.data
}

/**
 * 更新转写器配置。
 *
 * 兼容两种签名：
 * - 新：`updateTranscriberConfig(patch)` 传递任意字段子集；
 * - 旧：`updateTranscriberConfig(type, whisperModelSize)` 仅更新这两项。
 */
export async function updateTranscriberConfig(
  patchOrType: TranscriberConfigPatch | TranscriberType,
  whisperModelSize?: WhisperModelSize,
): Promise<TranscriberConfigPayload> {
  const payload: TranscriberConfigPatch =
    typeof patchOrType === 'string'
      ? { type: patchOrType, ...(whisperModelSize ? { whisper_model_size: whisperModelSize } : {}) }
      : patchOrType
  const res = await http.post<TranscriberConfigPayload>('/transcriber_config', payload)
  return res.data
}

/**
 * 获取可用的转写引擎列表（用于 Select 组件）。
 *
 * MLX Whisper 仅在 macOS 平台可用；其他平台返回列表中会排除该选项，
 * 同时 TranscriberPage 会对已选中 mlx-whisper 但非 Mac 的情况显示警告
 * （可作为后续补齐项，暂时仅依赖前端平台检测）。
 */
export function getAvailableTranscriberTypes() {
  const baseTypes = [
    { value: 'fast-whisper', label: 'Faster Whisper（本地）' },
    { value: 'bcut', label: '必剪（在线）' },
    { value: 'kuaishou', label: '快手（在线）' },
    { value: 'groq', label: 'Groq（在线）' },
  ]

  // 仅在 macOS 平台显示 MLX Whisper 选项
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
  if (isMac) {
    baseTypes.push({ value: 'mlx-whisper', label: 'MLX Whisper（仅macOS）' })
  }

  return baseTypes
}

/**
 * 获取 Whisper 模型大小选项
 */
export function getWhisperModelSizes() {
  return ['tiny', 'base', 'small', 'medium', 'large-v3', 'large-v3-turbo']
}

/** 单个 Whisper 模型的本地缓存状态（来自 /transcriber_config/models）。 */
export interface WhisperModelStatus {
  name: string
  cached: boolean
  /** 仓库预估总大小（MB）；0 表示未知 */
  estimated_size_mb: number
  /** 已下载完成的 blob 字节数（MB） */
  done_mb: number
  /** .incomplete 临时文件当前大小（MB）；>0 表示正在下载 */
  pending_mb: number
}

export interface WhisperModelsStatusResponse {
  /** HuggingFace hub 缓存根目录，用于在 UI 中提示用户 */
  cache_dir: string
  models: WhisperModelStatus[]
}

/**
 * 查询所有 Whisper 模型的本地缓存状态。
 *
 * 用于设置页的模型选择器上标注 "已就绪" / "待下载 N MB" / "下载中 X%"；
 * 调用方在检测到 `pending_mb > 0` 时可自行开启定时轮询（建议 3s 间隔）。
 */
export async function fetchWhisperModelsStatus(): Promise<WhisperModelsStatusResponse> {
  const res = await http.get<WhisperModelsStatusResponse>('/transcriber_config/models')
  return res.data
}

/**
 * 获取设备选项
 */
export function getDeviceOptions(engineType?: string) {
  const opts = [
    { value: 'cpu', label: 'CPU' },
    { value: 'cuda', label: 'NVIDIA CUDA' },
  ]
  // mps 仅 mlx-whisper 支持；fast-whisper (CTranslate2) 不支持 MPS
  if (engineType === 'mlx-whisper') {
    opts.push({ value: 'mps', label: 'Apple Metal (MPS)' })
  }
  return opts
}

/**
 * 获取语言选项（ISO 639-1 代码）
 */
export function getLanguageOptions() {
  return [
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'English' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' },
    { value: 'auto', label: 'Auto Detect' },
  ]
}

