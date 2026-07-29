import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskCenterPage from '@/pages/TaskCenterPage'

const { listBatchesMock, listTasksMock } = vi.hoisted(() => ({
  listBatchesMock: vi.fn(),
  listTasksMock: vi.fn(),
}))

vi.mock('@/services/taskBatches', () => ({ listTaskBatches: listBatchesMock }))
vi.mock('@/services/pipeline', () => ({ listPipelineTasks: listTasksMock }))

describe('TaskCenterPage', () => {
  beforeEach(() => {
    listBatchesMock.mockResolvedValue({
      batches: [{
        batch_id: 'b1', name: '测试批次', status: 'running',
        target_workspace_id: 'ws1', total_count: 2, completed_count: 1,
        failed_count: 0, items: [],
      }],
      total: 1,
    })
    listTasksMock.mockResolvedValue([{
      task_id: 't1', project_id: 'ws1', task_type: 'note', status: 'FAILED',
      progress: 0.5, batch_id: 'b1', payload: {}, result: {}, log: [],
    }])
  })

  it('默认批次视图，提供任务和失败视图', async () => {
    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    expect(await screen.findByText('测试批次')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批次' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '任务' }))
    expect(await screen.findByText('t1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '失败' }))
    expect(screen.getByText('查看日志')).toHaveAttribute(
      'href',
      '/settings/monitor?batch_id=b1&task_id=t1&level=ERROR',
    )
  })

  it('提供新建批量任务入口和搜索', async () => {
    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: '新建批量任务' })).toHaveAttribute('href', '/tasks/new')
    expect(screen.getByLabelText('搜索任务')).toBeInTheDocument()
  })
})
