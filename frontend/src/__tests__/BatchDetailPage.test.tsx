import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BatchDetailPage from '@/pages/TaskCenterPage/BatchDetailPage'

const {
  cancelMock,
  getMock,
  pauseMock,
  resumeMock,
  retryMock,
} = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  getMock: vi.fn(),
  pauseMock: vi.fn(),
  resumeMock: vi.fn(),
  retryMock: vi.fn(),
}))

vi.mock('@/services/taskBatches', () => ({
  cancelTaskBatch: cancelMock,
  getTaskBatch: getMock,
  pauseTaskBatch: pauseMock,
  resumeTaskBatch: resumeMock,
  retryFailedTaskBatch: retryMock,
}))

const batch = {
  batch_id: 'batch-1',
  name: '测试批次',
  status: 'running',
  target_workspace_id: 'ws-1',
  source_type: 'urls',
  settings_snapshot: {},
  total_count: 2,
  completed_count: 1,
  failed_count: 1,
  cancelled_count: 0,
  skipped_count: 0,
  created_at: '',
  started_at: '',
  completed_at: '',
  pause_requested: false,
  cancel_requested: false,
  items: [
    {
      batch_item_id: 'item-1',
      source_url: 'https://example.com/1',
      source_title: '素材一',
      action: 'process',
      task_id: 'task-2',
      task_ids: ['task-1', 'task-2'],
      status: 'failed',
      attempt_no: 2,
      error: 'failed',
    },
  ],
} as const

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/tasks/batches/batch-1']}>
      <Routes>
        <Route path="/tasks/batches/:batchId" element={<BatchDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('BatchDetailPage', () => {
  beforeEach(() => {
    getMock.mockReset()
    pauseMock.mockReset()
    resumeMock.mockReset()
    cancelMock.mockReset()
    retryMock.mockReset()
    getMock.mockResolvedValue(batch)
    pauseMock.mockResolvedValue({ ...batch, status: 'paused' })
    cancelMock.mockResolvedValue({ ...batch, status: 'partial_cancelled' })
    retryMock.mockResolvedValue({ ...batch, status: 'running' })
  })

  it('展示批次汇总、attempt 和真实日志链接', async () => {
    renderPage()
    expect(await screen.findByText('测试批次')).toBeInTheDocument()
    expect(screen.getByText('1/2 完成 · 1 失败 · running')).toBeInTheDocument()
    expect(screen.getByText('素材一')).toBeInTheDocument()
    expect(screen.getByText('task-1')).toBeInTheDocument()
    expect(screen.getByText('task-2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看日志' })).toHaveAttribute(
      'href',
      '/settings/monitor?batch_id=batch-1',
    )
  })

  it('取消拒绝确认时不调用接口，确认时才取消', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderPage()
    await screen.findByText('测试批次')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(cancelMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith('batch-1'))
    confirm.mockRestore()
  })
})
