import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { expect, it } from 'vitest'

import { ItemCard } from '@/pages/LibraryPage/ItemCard'
import type { LibraryItem } from '@/services/library'

function LocationProbe() {
  return <output>{useLocation().pathname}</output>
}

it('opens the current material task instead of the first historical task', () => {
  const item = {
    item_id: 'item-1',
    workspace_id: 'ws-1',
    workspace_name: '测试合集',
    workspace_kind: 'note',
    type: 'video',
    source: 'url',
    source_value: 'https://example.com/video',
    name: '正在分析的视频',
    status: 'processing',
    created_at: '2026-07-29T00:00:00Z',
    updated_at: '2026-07-29T00:01:00Z',
    duration_seconds: null,
    thumbnail: null,
    results_summary: { has_summary: false, has_transcript: false },
    primary_task_status: 'RUNNING',
    primary_task_id: 'analyze-current',
    related_task_ids: ['download-old', 'analyze-current'],
  } as LibraryItem

  render(
    <MemoryRouter initialEntries={['/notes']}>
      <ItemCard item={item} />
      <LocationProbe />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByText('正在分析的视频'))

  expect(screen.getByText('/processing/analyze-current')).toBeInTheDocument()
})
