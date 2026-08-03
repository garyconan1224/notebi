/**
 * Q6 / D6：外观状态（主题套餐 × 明暗模式 × 三槽位字体）。
 *
 * 持久化契约：后端 GET/PATCH /settings 为事实源；本地只做即时预览，
 * 确认保存以 readback 为准（patch → 用回读值 apply）。
 */
import { create } from 'zustand'

import {
  DEFAULT_APPEARANCE,
  deleteFont,
  fetchSettings,
  patchSettings,
  uploadFontFile,
  type AppearanceSettings,
  type FontSlotId,
  type ThemeId,
  type ThemeMode,
  type UploadedFont,
} from '@/services/settings'
import {
  detectLegacyAccentMigration,
  markLegacyAccentMigrated,
  resolveMode,
  themePackage,
  type LegacyAccentMigration,
} from '@/lib/appearanceThemes'

export const SANS_FALLBACK = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', system-ui, sans-serif"
export const SERIF_FALLBACK = "'Noto Serif SC', 'Songti SC', 'SimSun', Georgia, serif"

export const FONT_SLOT_LABELS: Record<FontSlotId, string> = {
  ui: '界面字体',
  cap: '字幕字体',
  sum: '总结字体',
}

export const FONT_SLOT_SCOPE: Record<FontSlotId, string> = {
  ui: '顶栏、侧栏、按钮、标签、列表与弹窗等全部界面；不影响字幕与笔记正文',
  cap: '视频/音频结果页的字幕、转录行与说话人标签；不影响界面与编辑器',
  sum: '笔记编辑器正文、目录与 AI 产物卡正文；不影响界面与字幕',
}

const FONT_FACE_FORMAT: Record<string, string> = {
  '.woff2': 'woff2',
  '.woff': 'woff',
  '.ttf': 'truetype',
  '.otf': 'opentype',
}

function buildSlotValue(family: string | null): string | null {
  if (!family) return null
  const fallback = /serif|Songti|SimSun|Noto Serif/i.test(family) ? SERIF_FALLBACK : SANS_FALLBACK
  return `${family}, ${fallback}`
}

function injectFontFaces(fonts: UploadedFont[]) {
  if (typeof document === 'undefined') return
  // 清掉不再存在的注入
  document.querySelectorAll('style[data-user-font]').forEach((node) => {
    const id = node.getAttribute('data-user-font')
    if (!fonts.some((f) => f.id === id)) node.remove()
  })
  for (const font of fonts) {
    if (document.querySelector(`style[data-user-font="${font.id}"]`)) continue
    const format = FONT_FACE_FORMAT[font.ext] ?? 'woff2'
    const style = document.createElement('style')
    style.setAttribute('data-user-font', font.id)
    style.textContent = `@font-face { font-family: '${font.family}'; src: url('${font.url}') format('${format}'); font-display: swap; }`
    document.head.appendChild(style)
  }
}

export function applyAppearance(settings: AppearanceSettings) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.setAttribute('data-theme', settings.theme)
  const resolved = resolveMode(settings.mode)
  root.setAttribute('data-mode', resolved)
  // 兼容既有 :root.dark 样式：深色半套同时挂 .dark 类
  root.classList.toggle('dark', resolved === 'dark')
  injectFontFaces(settings.uploaded_fonts)
  const slots: FontSlotId[] = ['ui', 'cap', 'sum']
  for (const slot of slots) {
    const value = buildSlotValue(settings.fonts[slot])
    if (value) root.style.setProperty(`--font-${slot}`, value)
    else root.style.removeProperty(`--font-${slot}`)
  }
}

interface AppearanceState extends AppearanceSettings {
  ready: boolean
  saving: boolean
  pendingMigration: LegacyAccentMigration | null
  initialize: () => Promise<void>
  refresh: () => Promise<void>
  setTheme: (theme: ThemeId) => Promise<void>
  setMode: (mode: ThemeMode) => Promise<void>
  setFontSlot: (slot: FontSlotId, family: string | null) => Promise<void>
  applyFontPreset: (theme: ThemeId) => Promise<void>
  uploadFont: (slot: FontSlotId, file: File) => Promise<void>
  removeFont: (fontId: string) => Promise<void>
  acceptMigration: (theme: ThemeId) => Promise<void>
  dismissMigration: () => void
}

let mediaListenerInstalled = false
function installSystemModeListener(get: () => AppearanceState) {
  if (mediaListenerInstalled || typeof window === 'undefined' || !window.matchMedia) return
  mediaListenerInstalled = true
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    const state = get()
    if (state.mode === 'system') applyAppearance(state)
  }
  if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange)
  else query.addListener(onChange)
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  ...DEFAULT_APPEARANCE,
  ready: false,
  saving: false,
  pendingMigration: null,

  initialize: async () => {
    installSystemModeListener(get)
    const migration = detectLegacyAccentMigration()
    try {
      const settings = await fetchSettings()
      set({ ...settings, ready: true })
      applyAppearance(settings)
      // 旧强调色迁移：后端尚未记录主题选择时采用建议映射并回写
      if (migration) {
        set({ pendingMigration: migration })
      }
    } catch {
      set({ ready: true })
      applyAppearance(get())
      if (migration) set({ pendingMigration: migration })
    }
  },

  refresh: async () => {
    const settings = await fetchSettings()
    set({ ...settings })
    applyAppearance(settings)
  },

  setTheme: async (theme) => {
    // 即时预览（本地先行），保存仍以 readback 为准
    set({ theme, saving: true })
    applyAppearance(get())
    try {
      const saved = await patchSettings({ theme })
      set({ ...saved })
      applyAppearance(saved)
    } finally {
      set({ saving: false })
    }
  },

  setMode: async (mode) => {
    set({ mode, saving: true })
    applyAppearance(get())
    try {
      const saved = await patchSettings({ mode })
      set({ ...saved })
      applyAppearance(saved)
    } finally {
      set({ saving: false })
    }
  },

  setFontSlot: async (slot, family) => {
    set((state) => ({ fonts: { ...state.fonts, [slot]: family }, saving: true }))
    applyAppearance(get())
    try {
      const saved = await patchSettings({ fonts: { [slot]: family } })
      set({ ...saved })
      applyAppearance(saved)
    } finally {
      set({ saving: false })
    }
  },

  applyFontPreset: async (theme) => {
    const preset = themePackage(theme).fontPreset
    set({ fonts: { ...preset }, saving: true })
    applyAppearance(get())
    try {
      const saved = await patchSettings({ fonts: preset })
      set({ ...saved })
      applyAppearance(saved)
    } finally {
      set({ saving: false })
    }
  },

  uploadFont: async (slot, file) => {
    const uploaded = await uploadFontFile(file)
    const settings = await fetchSettings()
    set({ ...settings })
    await get().setFontSlot(slot, uploaded.family)
  },

  removeFont: async (fontId) => {
    await deleteFont(fontId)
    const settings = await fetchSettings()
    set({ ...settings })
    applyAppearance(settings)
  },

  acceptMigration: async (theme) => {
    markLegacyAccentMigrated()
    set({ pendingMigration: null })
    await get().setTheme(theme)
  },

  dismissMigration: () => {
    markLegacyAccentMigrated()
    set({ pendingMigration: null })
  },
}))
