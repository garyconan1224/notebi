// 模板 API 客户端——对应 backend/app/routes/templates.py
import { http } from './client'

export type TemplateCategory =
  | 'video'
  | 'text'
  | 'style_video_with_frames'
  | 'style_video_text_only'
  | 'style_audio'
  | 'style_image_text'
  | 'style_replica'
  | 'style_text'

export interface VideoTemplateItem {
  template_id: string
  name: string
  prompt: string
  is_builtin: boolean
  category: TemplateCategory
  created_at: string
  updated_at: string
  overridden?: boolean
  default_prompt?: string
  description?: string
  use_case?: string
}

const BASE = '/templates'

/** 按 category 取模板；不传则返回全部（向后兼容）。 */
export async function fetchTemplates(
  category?: TemplateCategory,
): Promise<VideoTemplateItem[]> {
  const params = category ? { category } : undefined
  const res = await http.get<VideoTemplateItem[]>(BASE, { params })
  return res.data
}

export async function createTemplate(body: {
  name: string
  prompt: string
  category?: TemplateCategory
}): Promise<VideoTemplateItem> {
  const res = await http.post<VideoTemplateItem>(BASE, body)
  return res.data
}

export async function updateTemplate(
  templateId: string,
  body: { name: string; prompt: string; category?: TemplateCategory },
): Promise<VideoTemplateItem> {
  const res = await http.put<VideoTemplateItem>(`${BASE}/${templateId}`, body)
  return res.data
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await http.delete(`${BASE}/${templateId}`)
}

export async function resetTemplate(templateId: string): Promise<VideoTemplateItem> {
  const res = await http.post<VideoTemplateItem>(`${BASE}/${templateId}/reset`)
  return res.data
}

export async function duplicateTemplate(
  templateId: string,
  body: { source_prompt: string },
): Promise<VideoTemplateItem> {
  const res = await http.post<VideoTemplateItem>(
    `${BASE}/${templateId}/duplicate`,
    body,
  )
  return res.data
}
