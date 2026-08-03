import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LEGACY_ACCENT_STORAGE_KEY,
  ACCENT_MIGRATED_KEY,
  detectLegacyAccentMigration,
  markLegacyAccentMigrated,
  resolveMode,
  themePackage,
} from '@/lib/appearanceThemes'
import { applyAppearance } from '@/store/appearanceStore'
import { DEFAULT_APPEARANCE, type AppearanceSettings } from '@/services/settings'

function settings(patch: Partial<AppearanceSettings>): AppearanceSettings {
  return { ...DEFAULT_APPEARANCE, fonts: { ui: null, cap: null, sum: null }, ...patch }
}

describe('Q6 外观系统', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-mode')
    document.documentElement.removeAttribute('data-accent')
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('style')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('applyAppearance 写入 data-theme / data-mode，深色同时挂 .dark', () => {
    applyAppearance(settings({ theme: 'sage', mode: 'light' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'sage')
    expect(document.documentElement).toHaveAttribute('data-mode', 'light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    applyAppearance(settings({ theme: 'midnight', mode: 'dark' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'midnight')
    expect(document.documentElement).toHaveAttribute('data-mode', 'dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('system 模式跟随 prefers-color-scheme', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() }))
    expect(resolveMode('system')).toBe('dark')
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }))
    expect(resolveMode('system')).toBe('light')
    // 固定模式不受系统影响
    expect(resolveMode('light')).toBe('light')
    expect(resolveMode('dark')).toBe('dark')
  })

  it('字体槽位写入 CSS 变量，null 时移除（回退默认链）', () => {
    applyAppearance(settings({ fonts: { ui: null, cap: "'Noto Serif SC', serif", sum: null } }))
    expect(document.documentElement.style.getPropertyValue('--font-cap')).toContain('Noto Serif SC')
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toBe('')
  })

  it('旧 data-accent 值迁移到完整主题（terra→paper、lavender→midnight、sage→sage）', () => {
    window.localStorage.setItem(LEGACY_ACCENT_STORAGE_KEY, 'terra')
    expect(detectLegacyAccentMigration()).toEqual({ legacyAccent: 'terra', suggestedTheme: 'paper' })

    window.localStorage.setItem(LEGACY_ACCENT_STORAGE_KEY, 'lavender')
    expect(detectLegacyAccentMigration()?.suggestedTheme).toBe('midnight')

    window.localStorage.setItem(LEGACY_ACCENT_STORAGE_KEY, 'sage')
    expect(detectLegacyAccentMigration()?.suggestedTheme).toBe('sage')
  })

  it('标记迁移完成后不再提示', () => {
    window.localStorage.setItem(LEGACY_ACCENT_STORAGE_KEY, 'terra')
    markLegacyAccentMigrated()
    expect(window.localStorage.getItem(ACCENT_MIGRATED_KEY)).toBe('1')
    expect(detectLegacyAccentMigration()).toBeNull()
  })

  it('四套主题包元数据齐备且各带推荐字体预设', () => {
    for (const id of ['paper', 'graphite', 'sage', 'midnight'] as const) {
      const pkg = themePackage(id)
      expect(pkg.id).toBe(id)
      expect(pkg.swatches.bg).toBeTruthy()
      expect(pkg.swatches.srf).toBeTruthy()
      expect(pkg.swatches.acc).toBeTruthy()
      expect(['light', 'dark']).toContain(pkg.preferredMode)
      expect(Object.keys(pkg.fontPreset)).toEqual(['ui', 'cap', 'sum'])
    }
  })
})
