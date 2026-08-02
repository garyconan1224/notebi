import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { CoverControls } from '@/pages/LibraryPage/CoverControls'

it('allows replacing a cover and restoring the automatic cover without bubbling to the card', () => {
  const onUpload = vi.fn()
  const onReset = vi.fn()
  const onCardClick = vi.fn()
  const file = new File(['cover'], 'cover.png', { type: 'image/png' })

  render(
    <div onClick={onCardClick}>
      <CoverControls manual onUpload={onUpload} onReset={onReset} />
    </div>,
  )

  fireEvent.click(screen.getByRole('button', { name: '更换封面' }))
  fireEvent.change(screen.getByLabelText('选择封面图片'), { target: { files: [file] } })
  expect(onUpload).toHaveBeenCalledWith(file)
  expect(onCardClick).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '恢复自动封面' }))
  expect(onReset).toHaveBeenCalledTimes(1)
  expect(onCardClick).not.toHaveBeenCalled()
})
