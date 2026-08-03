import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TaskCenterPage from '@/pages/TaskCenterPage'

const { listBatchesMock, listTasksMock, deleteTaskMock, deleteBatchMock } = vi.hoisted(() => ({
  listBatchesMock: vi.fn(),
  listTasksMock: vi.fn(),
  deleteTaskMock: vi.fn(),
  deleteBatchMock: vi.fn(),
}))

vi.mock('@/services/taskBatches', () => ({
  listTaskBatches: listBatchesMock,
  deleteTaskBatch: deleteBatchMock,
}))
vi.mock('@/services/pipeline', () => ({
  listPipelineTasks: listTasksMock,
  deletePipelineTask: deleteTaskMock,
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-probe">{location.pathname + location.search}</div>
}

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
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    listBatchesMock.mockResolvedValue({
      batches: [runningBatch, completedBatch],
      total: 2,
    })
    deleteTaskMock.mockResolvedValue(undefined)
    deleteBatchMock.mockResolvedValue({ deleted: true })
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

  it('展示公开处理阶段与已完成总结预览，不把内部思维当作可见日志', async () => {
    listTasksMock.mockResolvedValueOnce([{
      task_id: 'summary-1', project_id: 'ws1', task_type: 'summary', status: 'SUCCESS', progress: 1,
      batch_id: '', payload: { workspace_id: 'ws1', item_id: 'item-1' },
      result: { summary: { content_md: '# 结论\n\n这是可查看的总结正文。' } },
      log: [{ ts: '2026-07-29T08:00:00Z', level: 'info', message: '正在保存总结版本' }],
    }])
    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    await screen.findByText('测试批次')
    fireEvent.click(screen.getByRole('button', { name: '单条任务' }))

    expect(await screen.findByText('当前环节')).toBeInTheDocument()
    expect(screen.getByText('正在保存总结版本')).toBeInTheDocument()
    expect(screen.getByText('总结预览')).toBeInTheDocument()
    expect(screen.getByText(/这是可查看的总结正文/)).toBeInTheDocument()
    expect(screen.getByText(/不展示模型的内部思维过程/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开完整总结' })).toHaveAttribute(
      'href', '/workspaces/ws1/items/item-1/note',
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

  it('失败任务卡片跳处理详情，成功任务有产出路径时跳结果页', async () => {
    listTasksMock.mockResolvedValue([
      {
        task_id: 't1', project_id: 'ws1', task_type: 'note', status: 'FAILED', progress: 0.5,
        batch_id: 'b1', payload: { workspace_id: 'ws1', item_id: 'i1' },
        result: { video_title: '失败的视频笔记' }, log: [],
      },
      {
        task_id: 's1', project_id: 'ws1', task_type: 'note', status: 'SUCCESS', progress: 1,
        batch_id: 'b1', payload: { workspace_id: 'ws1', item_id: 'i2' },
        result: { video_title: '成功笔记' }, log: [],
      },
      {
        task_id: 's2', project_id: 'ws1', task_type: 'note', status: 'SUCCESS', progress: 1,
        batch_id: 'b1', payload: {}, result: { video_title: '无路径成功' }, log: [],
      },
    ])
    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    await screen.findByText('测试批次')
    fireEvent.click(screen.getByRole('button', { name: '单条任务' }))

    expect(await screen.findByRole('link', { name: '打开失败的视频笔记' })).toHaveAttribute(
      'href', '/processing/t1',
    )
    expect(screen.getByRole('link', { name: '打开成功笔记' })).toHaveAttribute(
      'href', '/workspaces/ws1/items/i2/note',
    )
    expect(screen.getByRole('link', { name: '打开无路径成功' })).toHaveAttribute(
      'href', '/processing/s2',
    )
  })

  it('内部链接与诊断折叠只执行自身动作，不触发卡片导航', async () => {
    render(
      <MemoryRouter>
        <LocationProbe />
        <TaskCenterPage />
      </MemoryRouter>,
    )
    await screen.findByText('测试批次')
    fireEvent.click(screen.getByRole('button', { name: '单条任务' }))
    await screen.findByText('失败的视频笔记')

    // 展开诊断信息：只切换 details，不导航
    fireEvent.click(screen.getByText('诊断信息'))
    expect(screen.getByText('t1')).toBeVisible()
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/')

    // 点击高级日志链接：只跳到监控页，不先进处理详情
    fireEvent.click(screen.getByRole('link', { name: '查看高级日志' }))
    expect(screen.getByTestId('location-probe')).toHaveTextContent(
      '/settings/monitor?batch_id=b1&task_id=t1&level=ERROR',
    )
  })

  it('点击卡片空白区进入对应详情页', async () => {
    render(
      <MemoryRouter>
        <LocationProbe />
        <TaskCenterPage />
      </MemoryRouter>,
    )
    await screen.findByText('测试批次')
    fireEvent.click(screen.getByRole('button', { name: '单条任务' }))

    fireEvent.click(await screen.findByRole('link', { name: '打开失败的视频笔记' }))
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/processing/t1')
  })

  it('删除终态任务：忙碌态禁用按钮，成功后提示并刷新', async () => {
    let resolveDelete: () => void = () => {}
    deleteTaskMock.mockReturnValue(new Promise<void>((resolve) => {
      resolveDelete = resolve
    }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    await screen.findByText('测试批次')
    fireEvent.click(screen.getByRole('button', { name: '单条任务' }))

    fireEvent.click(await screen.findByRole('button', { name: '删除记录' }))
    expect(deleteTaskMock).toHaveBeenCalledWith('t1')
    expect(await screen.findByRole('button', { name: '删除中…' })).toBeDisabled()

    await act(async () => {
      resolveDelete()
      await Promise.resolve()
    })
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('已删除任务记录')
    // 初始加载 1 次 + 删除成功后刷新 1 次
    await waitFor(() => expect(listTasksMock).toHaveBeenCalledTimes(2))
  })

  it('删除失败时给出可读提示，卡片保留并可重试', async () => {
    deleteTaskMock.mockRejectedValue(new Error('boom'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    await screen.findByText('测试批次')
    fireEvent.click(screen.getByRole('button', { name: '单条任务' }))

    fireEvent.click(await screen.findByRole('button', { name: '删除记录' }))
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('删除失败，请稍后重试'))

    const retryButton = await screen.findByRole('button', { name: '删除记录' })
    expect(retryButton).toBeEnabled()
    fireEvent.click(retryButton)
    await waitFor(() => expect(deleteTaskMock).toHaveBeenCalledTimes(2))
  })

  it('Q7/D5：终态批次卡显示删除记录，运行中批次不显示', async () => {
    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    await screen.findByText('测试批次')

    // 运行中批次（b1）没有删除入口；终态批次（b2）有
    const deleteButtons = screen.getAllByRole('button', { name: '删除记录' })
    expect(deleteButtons).toHaveLength(1)
    expect(deleteButtons[0].closest('article')).not.toBeNull()
  })

  it('Q7/D5：确认删除终态批次会说明不删素材并刷新列表', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    await screen.findByText('测试批次')

    fireEvent.click(screen.getByRole('button', { name: '删除记录' }))

    // 确认框逐字说明不删子任务/笔记/素材/媒体/导出
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('不会删除子任务、笔记、素材、媒体文件或导出产物'),
    )
    expect(deleteBatchMock).toHaveBeenCalledWith('b2')
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith('已删除批次记录'))
    // 删除后刷新批次列表
    await waitFor(() => expect(listBatchesMock).toHaveBeenCalledTimes(2))
  })

  it('Q7/D5：取消确认时不调用删除', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MemoryRouter><TaskCenterPage /></MemoryRouter>)
    await screen.findByText('测试批次')

    fireEvent.click(screen.getByRole('button', { name: '删除记录' }))
    expect(deleteBatchMock).not.toHaveBeenCalled()
  })
})
