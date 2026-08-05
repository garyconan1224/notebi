import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const changeLanguage = vi.fn()

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      i18n: { language: 'zh-CN', changeLanguage },
      t: (key: string) => key,
    }),
  }
})

import LangSwitcher from '@/components/LangSwitcher'

describe('LangSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('只更新草稿，点「确定」才真正切换语言', () => {
    render(<LangSwitcher />)
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('zh-CN')

    fireEvent.change(select, { target: { value: 'en-US' } })
    expect(changeLanguage).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(changeLanguage).toHaveBeenCalledWith('en-US')
  })

  it('点「取消」还原草稿且不切换语言', () => {
    render(<LangSwitcher />)
    const select = screen.getByRole('combobox')

    fireEvent.change(select, { target: { value: 'en-US' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(select).toHaveValue('zh-CN')
    expect(changeLanguage).not.toHaveBeenCalled()
  })
})
