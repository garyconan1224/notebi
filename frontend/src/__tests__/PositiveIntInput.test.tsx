import '@testing-library/jest-dom'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PositiveIntInput } from '@/components/ui/positive-int-input'

function Harness({
  initial = 5,
  quickOptions,
  onChange,
}: {
  initial?: number
  quickOptions?: readonly number[]
  onChange?: (value: number) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <PositiveIntInput
      aria-label="截帧间隔"
      value={value}
      quickOptions={quickOptions}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

describe('PositiveIntInput（任意正整数契约）', () => {
  it('清空输入时不立即强制回默认值', () => {
    const onChange = vi.fn()
    render(<Harness initial={5} onChange={onChange} />)
    const input = screen.getByLabelText('截帧间隔') as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })

    expect(input.value).toBe('')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('blur 时非法值回退到最后有效值', () => {
    const onChange = vi.fn()
    render(<Harness initial={5} onChange={onChange} />)
    const input = screen.getByLabelText('截帧间隔') as HTMLInputElement

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(input.value).toBe('5')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('0 和负数编辑中不提交，blur 后回退', () => {
    const onChange = vi.fn()
    render(<Harness initial={12} onChange={onChange} />)
    const input = screen.getByLabelText('截帧间隔') as HTMLInputElement

    fireEvent.change(input, { target: { value: '0' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(input.value).toBe('12')

    fireEvent.change(input, { target: { value: '-3' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(input.value).toBe('12')
  })

  it('有效正整数立即提交；接受超大正整数且没有 max', () => {
    const onChange = vi.fn()
    render(<Harness initial={5} onChange={onChange} />)
    const input = screen.getByLabelText('截帧间隔') as HTMLInputElement

    expect(input).toHaveAttribute('min', '1')
    expect(input).not.toHaveAttribute('max')

    const huge = String(2 ** 40)
    fireEvent.change(input, { target: { value: huge } })

    expect(onChange).toHaveBeenLastCalledWith(2 ** 40)
  })

  it('快捷选项立即提交且不引入最大值', () => {
    const onChange = vi.fn()
    render(<Harness initial={5} onChange={onChange} quickOptions={[5, 10, 30, 60]} />)

    fireEvent.click(screen.getByRole('button', { name: '30 秒' }))

    expect(onChange).toHaveBeenLastCalledWith(30)
    const input = screen.getByLabelText('截帧间隔') as HTMLInputElement
    expect(input).not.toHaveAttribute('max')
  })
})
