// 外观设置 API 客户端——对应 backend/app/routes/settings.py（Q6 / D6）
// 持久化契约：写入 → GET/readback → 从回读值更新 UI，不只写 localStorage。
import { http } from './client'

export type ThemeId = 'paper' | 'graphite' | 'sage' | 'midnight'
export type ThemeMode = 'light' | 'dark' | 'system'
export type FontSlotId = 'ui' | 'cap' | 'sum'

export interface UploadedFont {
  id: string
  family: string
  filename: string
  ext: string
  url: string
}

export interface AppearanceSettings {
  theme: ThemeId
  mode: ThemeMode
  fonts: Record<FontSlotId, string | null>
  uploaded_fonts: UploadedFont[]
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'paper',
  mode: 'system',
  fonts: { ui: null, cap: null, sum: null },
  uploaded_fonts: [],
}

export async function fetchSettings(): Promise<AppearanceSettings> {
  const res = await http.get<AppearanceSettings>('/settings')
  return res.data
}

export async function patchSettings(
  patch: Partial<Pick<AppearanceSettings, 'theme' | 'mode'>> & {
    fonts?: Partial<Record<FontSlotId, string | null>>
  },
): Promise<AppearanceSettings> {
  const res = await http.patch<AppearanceSettings>('/settings', patch)
  return res.data
}

export async function uploadFontFile(file: File): Promise<UploadedFont> {
  const form = new FormData()
  form.append('file', file)
  const res = await http.post<UploadedFont>('/settings/fonts', form)
  return res.data
}

export async function deleteFont(fontId: string): Promise<void> {
  await http.delete(`/settings/fonts/${fontId}`)
}
