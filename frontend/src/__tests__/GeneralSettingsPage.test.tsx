import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const changeLanguage = vi.fn()
const zhT: Record<string, string> = {
  'general.title': '常规与外观',
  'general.subtitle': '界面语言和外观只影响 NoteBi 的显示，不改变总结输出语言。',
  'general.interfaceSection': '界面',
  'general.languageLabel': '界面语言',
  'general.languageHint': '菜单、按钮和提示文字',
  'general.themeLabel': '外观主题',
  'general.themeHint': '浅色、深色或跟随系统',
  'general.themePackageSection': '主题套餐',
  'general.themePackageAria': '主题套餐',
  'general.applyFontPreset': '套用该主题推荐字体',
  'general.fontSection': '字体',
  'general.langConfirm': '确定',
  'general.langCancel': '取消',
  'layout.language': '语言',
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN', changeLanguage },
    t: (key: string) => zhT[key] ?? key,
  }),
}))
vi.mock('@/components/ThemeSwitcher', () => ({
  default: () => <button type="button">主题选择器</button>,
}))
vi.mock('@/components/FontSlotEditor', () => ({
  default: () => <div>字体槽位</div>,
}))
vi.mock('@/store/appearanceStore', () => ({
  useAppearanceStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    theme: 'paper',
    saving: false,
    setTheme: vi.fn(),
    applyFontPreset: vi.fn(),
    pendingMigration: null,
    acceptMigration: vi.fn(),
    dismissMigration: vi.fn(),
  }),
}))
vi.mock('@/services/settings', () => ({
  fetchSettings: vi.fn(),
  patchSettings: vi.fn(),
}))

import GeneralSettingsPage from '@/pages/SettingPage/GeneralSettingsPage'
import { fetchSettings, patchSettings } from '@/services/settings'

const fetchSettingsMock = vi.mocked(fetchSettings)
const patchSettingsMock = vi.mocked(patchSettings)

describe('general settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchSettingsMock.mockResolvedValue({
      theme: 'paper',
      mode: 'system',
      fonts: { ui: null, cap: null, sum: null },
      uploaded_fonts: [],
      obsidian: { vault_path: '/Users/test/Vault', subdir: 'NoteBi', direct_write: true },
    })
    patchSettingsMock.mockImplementation(async (patch) => ({
      theme: 'paper',
      mode: 'system',
      fonts: { ui: null, cap: null, sum: null },
      uploaded_fonts: [],
      obsidian: {
        vault_path: patch.obsidian?.vault_path ?? '',
        subdir: patch.obsidian?.subdir ?? '',
        direct_write: patch.obsidian?.direct_write ?? false,
      },
    }))
  })

  it('keeps interface language and appearance in one settings section', () => {
    render(<GeneralSettingsPage />)

    expect(screen.getByRole('heading', { name: '常规与外观' })).toBeInTheDocument()
    expect(screen.getByText('界面语言')).toBeInTheDocument()
    expect(screen.getByText('外观主题')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '语言' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '主题选择器' })).toBeInTheDocument()
  })

  it('语言草稿在页头出现确定/取消：取消还原，确定调用 changeLanguage', () => {
    render(<GeneralSettingsPage />)
    const select = screen.getByRole('combobox', { name: '语言' })
    // 初始无页头按钮
    expect(screen.queryByRole('button', { name: '确定' })).toBeNull()

    fireEvent.change(select, { target: { value: 'en-US' } })
    expect(screen.getByRole('button', { name: '确定' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()

    // 取消：还原草稿、不切换语言
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(select).toHaveValue('zh-CN')
    expect(changeLanguage).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '确定' })).toBeNull()

    // 确定：真正切换语言
    fireEvent.change(select, { target: { value: 'en-US' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(changeLanguage).toHaveBeenCalledWith('en-US')
  })

  it('moved Obsidian destination to the export-sync page', () => {
    render(<GeneralSettingsPage />)

    expect(screen.queryByLabelText('Obsidian Vault 路径')).not.toBeInTheDocument()
    expect(screen.queryByText('保存 Obsidian 设置')).not.toBeInTheDocument()
  })
})
