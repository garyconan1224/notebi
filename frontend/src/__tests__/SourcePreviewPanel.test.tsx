import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SourcePreviewPanel } from '@/pages/SearchPage/SourcePreviewPanel'

const sources = [
  {
    source_id: 's1',
    workspace_id: 'w1',
    workspace_name: '合集一',
    item_id: 'i1',
    item_title: '视频一',
    item_type: 'video' as const,
    excerpt: '第一段证据',
    start_ms: 30_000,
    score: 0.91,
    jump_url: '/note/1?start_ms=30000',
  },
  {
    source_id: 's2',
    workspace_id: 'w1',
    workspace_name: '合集一',
    item_id: 'i2',
    item_title: '视频二',
    item_type: 'video' as const,
    excerpt: '第二段证据',
    start_ms: 60_000,
    score: 0.82,
    jump_url: '/note/2?start_ms=60000',
  },
]

describe('SourcePreviewPanel', () => {
  it('navigates sources and opens the uniquely selected source', () => {
    const onSelect = vi.fn()
    render(
      <MemoryRouter>
        <SourcePreviewPanel
          sources={sources}
          activeSourceId="s1"
          onSelect={onSelect}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('第一段证据')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一个来源' }))
    expect(onSelect).toHaveBeenCalledWith('s2')
    expect(screen.getByRole('link', { name: '在笔记中打开' })).toHaveAttribute(
      'href',
      '/note/1?start_ms=30000',
    )
  })
})
