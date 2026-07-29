import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TaskboardHead } from '@/pages/WorkspacePage/TaskboardPage/TaskboardHead'
import { TabsNav } from '@/pages/WorkspacePage/TaskboardPage/TabsNav'

const BACKGROUND = {
  content_type: '',
  participants: [],
  topic: '',
  glossary: [],
  purpose: '',
}

describe('合集退役功能', () => {
  it('旧标签栏不再展示风格报告', () => {
    render(<TabsNav active="materials" onChange={vi.fn()} />)

    expect(screen.queryByText('风格报告')).toBeNull()
    expect(screen.queryByText('Style Report')).toBeNull()
  })

  it('顶部更多菜单不再展示风格报告', () => {
    const { container } = render(
      <TaskboardHead
        name="测试合集"
        materialCount={0}
        background={BACKGROUND}
      />,
    )

    const menuButtons = container.querySelectorAll<HTMLButtonElement>(
      '.tb-head-more-wrap > .btn',
    )
    fireEvent.click(menuButtons[menuButtons.length - 1])

    expect(screen.queryByText('风格报告')).toBeNull()
  })
})
