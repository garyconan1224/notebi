// Q6：四套完整主题包元数据 + 旧强调色迁移映射
import type { FontSlotId, ThemeId, ThemeMode } from '@/services/settings'

export interface ThemePackageMeta {
  id: ThemeId
  name: string
  desc: string
  /** 卡片三色样条：bg / srf / acc */
  swatches: { bg: string; srf: string; acc: string }
  /** 该主题的默认明暗半套（切主题且模式=跟随系统时的倾向） */
  preferredMode: 'light' | 'dark'
  /** 每主题推荐字体预设（非强制，可一键套用） */
  fontPreset: Record<FontSlotId, string | null>
}

export const THEME_PACKAGES: ThemePackageMeta[] = [
  {
    id: 'paper',
    name: 'Paper Editorial',
    desc: '暖白纸感编辑部，长文阅读与笔记编辑首选',
    swatches: { bg: 'oklch(97.5% 0.006 85)', srf: 'oklch(100% 0 0)', acc: 'oklch(52% 0.205 42)' },
    preferredMode: 'light',
    fontPreset: { ui: null, cap: null, sum: "'Noto Serif SC', 'Songti SC', Georgia, serif" },
  },
  {
    id: 'graphite',
    name: 'Graphite Focus',
    desc: '冷中性近黑专注台，诊断、日志与长时段处理',
    swatches: { bg: 'oklch(15% 0.005 250)', srf: 'oklch(20% 0.006 250)', acc: 'oklch(68% 0.15 70)' },
    preferredMode: 'dark',
    fontPreset: { ui: "'Inter', system-ui, sans-serif", cap: "'Inter', system-ui, sans-serif", sum: "'Inter', system-ui, sans-serif" },
  },
  {
    id: 'sage',
    name: 'Sage Study',
    desc: '微绿纸张的安静长读主题，学习与课程笔记',
    swatches: { bg: 'oklch(97% 0.008 145)', srf: 'oklch(99.5% 0.005 140)', acc: 'oklch(46% 0.13 152)' },
    preferredMode: 'light',
    fontPreset: { ui: null, cap: null, sum: "'Noto Serif SC', 'Songti SC', Georgia, serif" },
  },
  {
    id: 'midnight',
    name: 'Midnight Studio',
    desc: '深靛蓝黑夜作台，视频/音频结果页与夜间工作',
    swatches: { bg: 'oklch(14% 0.022 255)', srf: 'oklch(19% 0.024 255)', acc: 'oklch(68% 0.18 38)' },
    preferredMode: 'dark',
    fontPreset: { ui: "'Inter', system-ui, sans-serif", cap: "'Inter', system-ui, sans-serif", sum: "'Inter', system-ui, sans-serif" },
  },
]

export function themePackage(id: ThemeId): ThemePackageMeta {
  return THEME_PACKAGES.find((t) => t.id === id) ?? THEME_PACKAGES[0]
}

/**
 * 旧 data-accent 值 → 完整主题迁移（D6）：
 * amber→paper、sage→sage、terra→paper、lavender→midnight。
 * 迁移只给默认映射；设置页首次进入会提示可改选更接近的完整主题。
 */
export const LEGACY_ACCENT_TO_THEME: Record<string, ThemeId> = {
  amber: 'paper',
  sage: 'sage',
  terra: 'paper',
  lavender: 'midnight',
}

export const LEGACY_ACCENT_STORAGE_KEY = 'nibi.accent-theme'
/** 迁移完成标记：写入后不再提示旧强调色升级 */
export const ACCENT_MIGRATED_KEY = 'nibi.accent-migrated'

export interface LegacyAccentMigration {
  legacyAccent: string
  suggestedTheme: ThemeId
}

/** 读取尚未迁移的旧强调色；已迁移或无旧值返回 null */
export function detectLegacyAccentMigration(): LegacyAccentMigration | null {
  if (typeof window === 'undefined') return null
  if (window.localStorage.getItem(ACCENT_MIGRATED_KEY)) return null
  const legacy = window.localStorage.getItem(LEGACY_ACCENT_STORAGE_KEY)
  if (!legacy) return null
  const suggestedTheme = LEGACY_ACCENT_TO_THEME[legacy]
  if (!suggestedTheme) return null
  return { legacyAccent: legacy, suggestedTheme }
}

export function markLegacyAccentMigrated() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ACCENT_MIGRATED_KEY, '1')
}

/** 模式解析：system 跟随 matchMedia */
export function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}
