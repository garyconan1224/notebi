import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string) => key,
  }),
}))

import LangSwitcher from '@/components/LangSwitcher'

describe('LangSwitcher', () => {
  it('受控下拉：展示当前语言，变更时回调 onChange', () => {
    const onChange = vi.fn()
    render(<LangSwitcher value="zh-CN" onChange={onChange} />)
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('zh-CN')

    fireEvent.change(select, { target: { value: 'en-US' } })
    expect(onChange).toHaveBeenCalledWith('en-US')
  })
})
