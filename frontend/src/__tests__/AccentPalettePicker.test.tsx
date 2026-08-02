import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { AccentPalettePicker } from '@/components/AccentPalettePicker'

describe('AccentPalettePicker', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-accent')
  })

  it('切换强调配色会更新根元素并持久化选择', () => {
    render(<AccentPalettePicker />)

    fireEvent.click(screen.getByRole('radio', { name: '青苔' }))

    expect(document.documentElement).toHaveAttribute('data-accent', 'sage')
    expect(window.localStorage.getItem('nibi.accent-theme')).toBe('sage')
    expect(screen.getByRole('radio', { name: '青苔' })).toHaveAttribute('aria-checked', 'true')
  })
})
