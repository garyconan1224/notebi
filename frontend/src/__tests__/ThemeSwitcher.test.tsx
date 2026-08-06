import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ThemeSwitcher from '@/components/ThemeSwitcher'

const mocks = vi.hoisted(() => {
  const state = { mode: 'light' }
  const setModeMock = vi.fn(async (next: string) => {
    state.mode = next
  })
  return { state, setModeMock }
})

vi.mock('@/store/appearanceStore', () => ({
  useAppearanceStore: vi.fn((selector) => {
    const storeState = {
      mode: mocks.state.mode,
      saving: false,
      setMode: mocks.setModeMock,
    }
    return selector ? selector(storeState) : storeState
  }),
}))

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    mocks.state.mode = 'light'
    mocks.setModeMock.mockClear()
  })

  it('非 iconOnly：渲染三段式 radiogroup', () => {
    render(<ThemeSwitcher />)
    expect(screen.getByRole('radiogroup', { name: '明暗模式' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /浅色/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /深色/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /跟随系统/ })).toBeTruthy()
  })

  it('iconOnly：只显示一个图标按钮，点击循环 浅色→深色→跟随系统→浅色', () => {
    const renderOnce = (mode: string) => {
      mocks.state.mode = mode
      const view = render(<ThemeSwitcher iconOnly />)
      expect(screen.queryByRole('radiogroup', { name: '明暗模式' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: '明暗模式' }))
      view.unmount()
    }

    renderOnce('light')
    expect(mocks.setModeMock).toHaveBeenLastCalledWith('dark')

    renderOnce('dark')
    expect(mocks.setModeMock).toHaveBeenLastCalledWith('system')

    renderOnce('system')
    expect(mocks.setModeMock).toHaveBeenLastCalledWith('light')
  })
})
