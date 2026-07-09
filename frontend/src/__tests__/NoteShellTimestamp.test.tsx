import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderNoteTimestampChildren } from '@/pages/result/NoteShell/note-shell-utils'

describe('renderNoteTimestampChildren', () => {
  it('把阅读态时间戳渲染为可点击 seek chip', () => {
    const onSeek = vi.fn()

    render(
      <p>
        {renderNoteTimestampChildren('重点在 [01:30~02:00] 这一段', onSeek)}
      </p>,
    )

    fireEvent.click(screen.getByRole('button', { name: '[01:30~02:00]' }))

    expect(onSeek).toHaveBeenCalledWith(90)
  })

  it('不处理代码里的时间戳', () => {
    const onSeek = vi.fn()

    render(
      <p>
        {renderNoteTimestampChildren(<code>[01:30]</code>, onSeek)}
      </p>,
    )

    expect(screen.queryByRole('button', { name: '[01:30]' })).toBeNull()
    expect(screen.getByText('[01:30]').tagName).toBe('CODE')
  })
})
