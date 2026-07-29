import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchLibrary: vi.fn(),
  tasks: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/services/library', () => ({
  fetchLibrary: mocks.fetchLibrary,
}))
vi.mock('@/hooks/usePipelineTasks', () => ({
  usePipelineTasks: vi.fn(),
}))
vi.mock('@/store/taskStore', () => ({
  useTaskStore: vi.fn((selector: (state: { tasks: Array<Record<string, unknown>> }) => unknown) =>
    selector({ tasks: mocks.tasks }),
  ),
}))

import { RecentTasks } from '@/pages/WorkbenchPage/RecentTasks'

const baseItem = {
  content_id: 'content-1',
  lineage_id: 'lineage-1',
  workspace_name: '收件箱',
  workspace_kind: 'note' as const,
  type: 'video' as const,
  source: 'url' as const,
  source_value: 'https://example.com',
  status: 'done' as const,
  created_at: '2026-07-01T00:00:00Z',
  duration_seconds: 60,
  thumbnail: null,
  results_summary: { has_summary: true, has_transcript: true },
  primary_task_status: 'SUCCESS',
  related_task_ids: ['task-1'],
}

describe('workbench recent notes projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tasks = [
      {
        task_id: 'running-1',
        project_id: 'ws-running',
        task_type: 'video',
        status: 'TRANSCRIBING',
        progress: 0.42,
        payload: { url: 'https://example.com/running' },
        result: { video_title: '正在转写的素材' },
      },
    ]
    mocks.fetchLibrary.mockResolvedValue({
      items: [
        {
          ...baseItem,
          item_id: 'older',
          workspace_id: 'ws-1',
          name: '较早笔记',
          updated_at: '2026-07-02T00:00:00Z',
        },
        {
          ...baseItem,
          item_id: 'latest',
          workspace_id: 'ws-2',
          name: '最新笔记',
          updated_at: '2026-07-03T00:00:00Z',
        },
      ],
      workspaces: [],
    })
  })

  it('uses the same durable library ordering as notes and separates active work', async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<RecentTasks />} />
          <Route path="/workspaces/:workspaceId/items/:itemId/note" element={<div>笔记详情</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '最近笔记' })).toBeTruthy()
    await waitFor(() => expect(mocks.fetchLibrary).toHaveBeenCalledWith(false))

    const cards = screen.getAllByTestId('recent-note-card')
    expect(cards[0].textContent).toContain('最新笔记')
    expect(cards[1].textContent).toContain('较早笔记')
    expect(screen.getByText('正在转写的素材')).toBeTruthy()
    expect(screen.getByText('42%')).toBeTruthy()

    fireEvent.click(cards[0])
    expect(await screen.findByText('笔记详情')).toBeTruthy()
  })
})
