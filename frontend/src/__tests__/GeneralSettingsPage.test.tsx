import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/LangSwitcher', () => ({
  LangSwitcher: () => <button type="button">界面语言选择器</button>,
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
    expect(screen.getByRole('button', { name: '界面语言选择器' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '主题选择器' })).toBeInTheDocument()
  })

  it('moved Obsidian destination to the export-sync page', () => {
    render(<GeneralSettingsPage />)

    expect(screen.queryByLabelText('Obsidian Vault 路径')).not.toBeInTheDocument()
    expect(screen.queryByText('保存 Obsidian 设置')).not.toBeInTheDocument()
  })
})
