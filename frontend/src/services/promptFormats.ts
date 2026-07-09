// 提示词格式模板 API 客户端 + renderTemplate 工具。
//
// 模板渲染：把 {placeholder} 替换为帧数据；未识别占位符原样保留。
// 占位符约定见 shared/prompt_format_defaults.py 顶部注释。

import { http } from './client'
import type { ImageResult, VideoResultFrame } from './workspaces'

export type PromptFormatCategory = 'image' | 'video'

export interface PromptFormat {
  id: string
  name: string
  category: PromptFormatCategory
  template: string
  description: string
  is_default: boolean
}

export interface PromptFormatsConfig {
  formats: PromptFormat[]
  active_image_ids: string[]
  active_video_ids: string[]
}

export interface PromptFormatsConfigUpdateRequest {
  formats?: PromptFormat[]
  active_image_ids?: string[]
  active_video_ids?: string[]
}

const BASE = '/prompt_formats_config'

export async function getPromptFormatsConfig(): Promise<PromptFormatsConfig> {
  const res = await http.get<PromptFormatsConfig>(BASE)
  return res.data
}

export async function savePromptFormatsConfig(
  req: PromptFormatsConfigUpdateRequest,
): Promise<PromptFormatsConfig> {
  const res = await http.post<PromptFormatsConfig>(BASE, req)
  return res.data
}

export async function resetPromptFormatsConfig(): Promise<PromptFormatsConfig> {
  const res = await http.post<PromptFormatsConfig>(`${BASE}/reset`)
  return res.data
}

// ── renderTemplate ────────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{([^{}]+)\}/g

function flattenTags(tags: Record<string, string[]> | undefined | null): string {
  if (!tags) return ''
  return Object.values(tags).flat().join(', ')
}

/** 把模板内 {placeholder} 替换为帧数据。未识别保留原样。 */
export function renderTemplate(template: string, frame: VideoResultFrame): string {
  if (!template) return ''
  return template.replace(PLACEHOLDER_RE, (orig, raw) => {
    const key = String(raw).trim()
    if (key === 'ts') return frame.ts ?? orig
    if (key === 'title') return frame.title ?? orig
    if (key === 'subtitle') return frame.subtitle ?? orig
    if (key === 'description') return frame.description ?? orig
    if (key === 'tags') return flattenTags(frame.tags) || orig
    if (key.startsWith('tags.')) {
      const sub = key.slice(5)
      const arr = frame.tags?.[sub]
      if (Array.isArray(arr) && arr.length) return arr.join(', ')
      return orig
    }
    if (key === 'prompt_mj') return frame.prompt_mj ?? orig
    if (key === 'prompt_video') return frame.prompt_video ?? orig
    return orig
  })
}

/** JSON 格式特殊渲染：dump 整帧为可读 JSON 文本。 */
export function renderJsonForFrame(frame: VideoResultFrame): string {
  return JSON.stringify(
    {
      timestamp: frame.ts,
      title: frame.title,
      description: frame.description,
      tags: frame.tags,
      prompt_mj: frame.prompt_mj,
      prompt_video: frame.prompt_video,
    },
    null,
    2,
  )
}

/** 判断一个 format 是否走 JSON 特殊渲染分支。 */
export function isJsonFormat(fmt: PromptFormat): boolean {
  return fmt.template.trim() === '' && fmt.name.toLowerCase().includes('json')
}

// ── Phase 1H: 图片结果页模板渲染 ──────────────────────────

/** 把 ImageResult 适配为 renderTemplate 可用的 VideoResultFrame 接口。 */
export function imageToFrameAdapter(img: ImageResult): VideoResultFrame {
  return {
    idx: 0,
    ts: '',
    sec: 0,
    shot_type: '',
    title: img.image.title,
    subtitle: '',
    description: img.description,
    prompt_mj: img.prompts.mj,
    prompt_sd: img.prompts.sd,
    prompt_video: '',
    tags: img.tags,
  }
}

/** JSON 格式特殊渲染：dump 图片结果为可读 JSON 文本。 */
export function renderJsonForImage(img: ImageResult): string {
  return JSON.stringify(
    {
      title: img.image.title,
      description: img.description,
      ocr_text: img.ocr_text || undefined,
      exif: img.exif,
      tags: img.tags,
      prompt_mj: img.prompts.mj,
      prompt_sd: img.prompts.sd,
    },
    null,
    2,
  )
}
