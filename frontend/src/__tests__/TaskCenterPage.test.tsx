import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TaskCenterPage from '@/pages/TaskCenterPage'

const { listBatchesMock, listTasksMock } = vi.hoisted(() => ({
  listBatchesMock: vi.fn(),
  listTasksMock: vi.fn(),
}))

vi.mock('@/services/taskBatches', () => ({ listTaskBatches: listBatchesMock }))
vi.mock('@/services/pipeline', () => ({ listPipelineTasks: listTasksMock }))

const runningBatch = {
  batch_id: 'b1',
  name: '测试批次',
  status: 'running',
  source_type: 'urls',
  target_workspace_id: 'ws1',
  total_count: 4,
  completed_count: 1,
  failed_count: 1,
  cancelled_count: 0,
  skipped_count: 1,
  items: [],
  created_at: '2026-07-29T08:00:00Z',
  started_at: '2026-07-29T08:01:00Z',
  completed_at: '',
}

const completedBatch = {
  ...runningBatch,
  batch_id: 'b2',
  name: '已完成播放列表',
  status: 'completed',
  source_type: 'youtube_playlist',
  target_workspace_id: 'ws2',
  total_count: 3,
  completed_count: 3,
  failed_count: 0,
  skipped_count: 0,
  created_at: '2026-07-28T08:00:00Z',
  started_at: '2026-07-28T08:01:00Z',
  completed_at: '2026-07-28T08:05:00Z',
}

describe('TaskCenterPage', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    listBatchesMock.mockResolvedValue({
      batches: [runningBatch, completedBatch],
      total: 2,
    })
    listTasksMock.mockResolvedValue([
      {
        task_id: 't1',
        project_id: 'ws1',
        task_type: 'note',
        status: 'FAILED',
        progress: 0.5,
        batch_id: 'b1',
        payload: {},
        result: { video_title: '失败的视频笔记' },
        log: [],
      },
    ])
  })

  it('默认显示批次、四个统计卡和中文批次摘要', async () => {
    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)

    expect(await screen.findByText('测试批次')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批量任务' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('task-stat-running')).toHaveTextContent('1')
    expect(screen.getByTestId('task-stat-completed')).toHaveTextContent('1')
    expect(screen.getByTestId('task-stat-attention')).toHaveTextContent('0')
    expect(screen.getByTestId('task-stat-waiting')).toHaveTextContent('0')
    expect(screen.getByText('多链接')).toBeInTheDocument()
    expect(screen.getByText('1 成功')).toBeInTheDocument()
    expect(screen.getByText('1 失败')).toBeInTheDocument()
    expect(screen.getByText('1 等待')).toBeInTheDocument()
  })

  it('将单条任务放到二级视图并隐藏技术编号', async () => {
    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    await screen.findByText('测试批次')

    fireEvent.click(screen.getByRole('button', { name: '单条任务' }))
    expect(await screen.findByText('失败的视频笔记')).toBeInTheDocument()
    expect(screen.getByText('t1')).not.toBeVisible()
    fireEvent.click(screen.getByText('诊断信息'))
    expect(screen.getByText('t1')).toBeVisible()
    expect(screen.getByRole('link', { name: '查看高级日志' })).toHaveAttribute(
      'href',
      '/settings/monitor?batch_id=b1&task_id=t1&level=ERROR',
    )
  })

  it('使用四类基础状态过滤，来源放到高级筛选', async () => {
    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    expect(await screen.findByText('测试批次')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '已完成 (1)' }))
    expect(screen.queryByText('测试批次')).not.toBeInTheDocument()
    expect(screen.getByText('已完成播放列表')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '高级筛选' }))
    fireEvent.change(screen.getByLabelText('来源'), { target: { value: 'urls' } })
    expect(screen.queryByText('已完成播放列表')).not.toBeInTheDocument()
    expect(screen.getByText('没有匹配的批次')).toBeInTheDocument()
  })

  it('有运行批次时每两秒刷新，全部终态后停止', async () => {
    vi.useFakeTimers()
    listBatchesMock
      .mockResolvedValueOnce({ batches: [runningBatch], total: 1 })
      .mockResolvedValue({ batches: [completedBatch], total: 1 })

    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(listBatchesMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(listBatchesMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(listBatchesMock).toHaveBeenCalledTimes(2)
  })
})
