import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ThemeSwitcher from '@/components/ThemeSwitcher'

const setModeMock = vi.fn()

vi.mock('@/store/appearanceStore', () => ({
  useAppearanceStore: vi.fn((selector) => {
    const state = {
      mode: 'light',
      saving: false,
      setMode: setModeMock,
    }
    return selector ? selector(state) : state
  }),
}))

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    setModeMock.mockReset()
    setModeMock.mockResolvedValue(undefined)
  })

  it('非 compact：渲染三段式 radiogroup', () => {
    render(<ThemeSwitcher />)
    expect(screen.getByRole('radiogroup', { name: '明暗模式' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /浅色/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /深色/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /跟随系统/ })).toBeTruthy()
  })

  it('compact：只渲染图标按钮，点击弹出选项菜单并可切换', async () => {
    render(<ThemeSwitcher compact />)
    // 折叠态不渲染三段式
    expect(screen.queryByRole('radiogroup', { name: '明暗模式' })).toBeNull()
    const trigger = screen.getByRole('button', { name: '明暗模式' })
    expect(trigger).toBeTruthy()

    fireEvent.pointerDown(trigger)
    const dark = await screen.findByRole('menuitem', { name: /深色/ })
    expect(screen.getByRole('menuitem', { name: /浅色/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /跟随系统/ })).toBeTruthy()

    fireEvent.click(dark)
    expect(setModeMock).toHaveBeenCalledWith('dark')
  })
})
