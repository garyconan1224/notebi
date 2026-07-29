import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/LangSwitcher', () => ({
  LangSwitcher: () => <button type="button">界面语言选择器</button>,
}))
vi.mock('@/components/ThemeSwitcher', () => ({
  default: () => <button type="button">主题选择器</button>,
}))

import GeneralSettingsPage from '@/pages/SettingPage/GeneralSettingsPage'

describe('general settings', () => {
  it('keeps interface language and appearance in one settings section', () => {
    render(<GeneralSettingsPage />)

    expect(screen.getByRole('heading', { name: '常规与外观' })).toBeInTheDocument()
    expect(screen.getByText('界面语言')).toBeInTheDocument()
    expect(screen.getByText('外观主题')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '界面语言选择器' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '主题选择器' })).toBeInTheDocument()
  })
})
