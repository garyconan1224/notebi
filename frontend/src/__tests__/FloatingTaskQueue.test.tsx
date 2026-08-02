import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatingTaskQueue } from '@/components/FloatingTaskQueue'
import { useTaskStore } from '@/store/taskStore'
import type { TaskRecord } from '@/types/task'

const {
  cancelBatchMock,
  cancelMock,
  deleteMock,
  navigateMock,
  pauseBatchMock,
  retryMock,
  routeState,
} = vi.hoisted(() => ({
  cancelBatchMock: vi.fn(),
  cancelMock: vi.fn(),
  deleteMock: vi.fn(),
  navigateMock: vi.fn(),
  pauseBatchMock: vi.fn(),
  retryMock: vi.fn(),
  routeState: { pathname: '/library' },
}))

vi.mock('react-router-dom', () => ({
  useLocation: () => routeState,
  useNavigate: () => navigateMock,
}))

vi.mock('@/hooks/usePipelineTasks', () => ({
  usePipelineTasks: vi.fn(),
}))

vi.mock('@/services/pipeline', () => ({
  cancelPipelineTask: cancelMock,
  deletePipelineTask: deleteMock,
  retryPipelineTask: retryMock,
}))

vi.mock('@/services/taskBatches', () => ({
  cancelTaskBatch: cancelBatchMock,
  pauseTaskBatch: pauseBatchMock,
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const makeTask = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  task_id: 'task-001',
  project_id: 'workspace-1',
  task_type: 'audio',
  payload: { title: 'Audio task' },
  status: 'PENDING',
  progress: 0.2,
  log: [],
  result: {},
  error: '',
  retry_of: '',
  cancel_requested: false,
  created_at: '2026-05-25T00:00:00.000Z',
  updated_at: '2026-05-25T00:00:00.000Z',
  ...overrides,
})

const makeRunningAnchor = (): TaskRecord => makeTask({
  task_id: 'running-anchor',
  project_id: 'workspace-running',
  status: 'DOWNLOAD',
  payload: { title: 'Running anchor' },
})

describe('FloatingTaskQueue v2', () => {
  beforeEach(() => {
    // 默认放在普通非首页路径：浮窗在首页 `/` 与任务中心 `/tasks` 前缀下按产品规则隐藏，
    // 旧用例需要浮窗渲染，因此默认路由必须是非首页、非任务中心路径。
    routeState.pathname = '/library'
    navigateMock.mockReset()
    cancelMock.mockReset()
    cancelBatchMock.mockReset()
    deleteMock.mockReset()
    pauseBatchMock.mockReset()
    retryMock.mockReset()
    cancelMock.mockResolvedValue({})
    cancelBatchMock.mockResolvedValue({})
    deleteMock.mockResolvedValue({})
    pauseBatchMock.mockResolvedValue({})
    retryMock.mockResolvedValue(makeTask({ task_id: 'task-retry', status: 'PENDING' }))
    useTaskStore.setState({
      tasks: [],
      hiddenTaskIds: [],
      currentTaskId: null,
      isPolling: false,
    })
  })

  it('隐藏 SUCCESS/CANCELLED，只保留活跃任务和 FAILED 任务', () => {
    useTaskStore.setState({
      tasks: [
        makeRunningAnchor(),
        makeTask({ task_id: 'done', status: 'SUCCESS', payload: { title: 'Done task' } }),
        makeTask({ task_id: 'cancelled', status: 'CANCELLED', payload: { title: 'Cancelled task' } }),
        makeTask({ task_id: 'failed', status: 'FAILED', payload: { title: 'Failed task' } }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))

    expect(screen.getByText('Failed task')).toBeTruthy()
    expect(screen.queryByText('Done task')).toBeNull()
    expect(screen.queryByText('Cancelled task')).toBeNull()
  })

  it('PARTIAL 任务保留在队列并显示部分完成', () => {
    useTaskStore.setState({
      tasks: [
        makeRunningAnchor(),
        makeTask({
          task_id: 'partial',
          status: 'PARTIAL',
          payload: { title: '部分完成任务' },
          error: '说话人分析失败',
        }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))

    expect(screen.getByText('部分完成任务')).toBeTruthy()
    expect(screen.getByText('部分完成')).toBeTruthy()
  })

  it('摘要阶段 PARTIAL 显示仅重试摘要，并允许单独清除任务', async () => {
    useTaskStore.setState({
      tasks: [
        makeRunningAnchor(),
        makeTask({
          task_id: 'partial-summary',
          status: 'PARTIAL',
          payload: { title: '摘要未完成任务' },
          result: { partial_failure: { stage: 'summary' } },
          error: '摘要生成失败',
        }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))

    fireEvent.click(screen.getByRole('button', { name: '仅重试摘要 摘要未完成任务' }))
    await waitFor(() => {
      expect(retryMock).toHaveBeenCalledWith('partial-summary', { stage: 'summary' })
    })

    fireEvent.click(screen.getByRole('button', { name: '清除部分完成任务 摘要未完成任务' }))
    expect(useTaskStore.getState().tasks.find((task) => task.task_id === 'partial-summary')).toBeUndefined()
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('partial-summary'))
  })

  it('F3.2: 失败任务用 errorCategories 友好文案展示（限流），原始错误走 title', () => {
    useTaskStore.setState({
      tasks: [
        makeRunningAnchor(),
        makeTask({
          task_id: 'rate-limited',
          status: 'FAILED',
          payload: { title: '限流任务' },
          error: 'HTTP 429: rate limit exceeded, too many requests',
        }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))

    // 友好分类文案（而非原始 "HTTP 429..." 截断 22 字）
    expect(screen.getByText('API 配额耗尽或请求限流')).toBeTruthy()
    // 完整原始错误走 title tooltip（hover 可见）
    expect(
      screen.getByTitle('HTTP 429: rate limit exceeded, too many requests'),
    ).toBeTruthy()
  })

  it('服务重启中断显示明确错误文案', () => {
    useTaskStore.setState({
      tasks: [
        makeRunningAnchor(),
        makeTask({
          task_id: 'interrupted',
          status: 'FAILED',
          payload: { title: '中断任务' },
          error: '后端重启，任务中断',
        }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))

    expect(screen.getByText('任务被服务重启中断')).toBeTruthy()
    expect(screen.getByTitle('后端重启，任务中断')).toBeTruthy()
  })

  it('查看全部统一跳转到任务中心', () => {
    useTaskStore.setState({
      tasks: [makeTask({ status: 'DOWNLOAD' })],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))
    fireEvent.click(screen.getByRole('button', { name: '查看全部' }))

    expect(navigateMock).toHaveBeenCalledWith('/tasks')
  })

  it('批次任务跳转批次详情，单项取消会取消整个批次', async () => {
    useTaskStore.setState({
      tasks: [
        makeTask({
          task_id: 'task-a',
          batch_id: 'batch-1',
          status: 'DOWNLOAD',
          payload: { title: 'Download task' },
        }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))
    fireEvent.click(screen.getByText('Download task'))
    expect(navigateMock).toHaveBeenCalledWith('/tasks/batches/batch-1')

    navigateMock.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))
    fireEvent.click(screen.getByRole('button', { name: '取消任务 Download task' }))

    await waitFor(() => {
      expect(cancelBatchMock).toHaveBeenCalledWith('batch-1')
      expect(cancelMock).not.toHaveBeenCalled()
    })
  })

  it('暂停批次只暂停唯一批次，不把独立任务当取消处理', async () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ task_id: 'task-a', batch_id: 'batch-1', status: 'DOWNLOAD' }),
        makeTask({ task_id: 'task-b', batch_id: 'batch-1', status: 'ASR' }),
        makeTask({ task_id: 'task-c', status: 'SUM', payload: { title: 'Standalone' } }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))
    fireEvent.click(screen.getByRole('button', { name: '暂停批次' }))

    await waitFor(() => {
      expect(pauseBatchMock).toHaveBeenCalledTimes(1)
      expect(pauseBatchMock).toHaveBeenCalledWith('batch-1')
      expect(cancelMock).not.toHaveBeenCalled()
    })
  })

  it('FAILED 任务支持重试和后端清除', async () => {
    useTaskStore.setState({
      tasks: [
        makeRunningAnchor(),
        makeTask({ task_id: 'task-failed', status: 'FAILED', payload: { title: 'Failed task' } }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))
    fireEvent.click(screen.getByRole('button', { name: '重试 Failed task' }))

    await waitFor(() => expect(retryMock).toHaveBeenCalledWith('task-failed'))

    fireEvent.click(screen.getByRole('button', { name: '清除失败任务 Failed task' }))

    expect(useTaskStore.getState().tasks.find((t) => t.task_id === 'task-failed')).toBeUndefined()
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('task-failed'))
  })

  it('清除 FAILED 分组时会删除同一行里的所有失败任务', async () => {
    useTaskStore.setState({
      tasks: [
        makeRunningAnchor(),
        makeTask({
          task_id: 'note-failed-a',
          project_id: 'workspace-1',
          task_type: 'note',
          payload: { url: 'https://example.com/same-video', title: 'Failed group' },
          status: 'FAILED',
        }),
        makeTask({
          task_id: 'note-failed-b',
          project_id: 'workspace-1',
          task_type: 'note',
          payload: { url: 'https://example.com/same-video', title: 'Failed group' },
          status: 'FAILED',
          updated_at: '2026-05-25T00:01:00.000Z',
        }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))
    fireEvent.click(screen.getByRole('button', { name: '清除失败任务 Failed group' }))

    expect(useTaskStore.getState().tasks).toHaveLength(1)
    expect(useTaskStore.getState().tasks[0].task_id).toBe('running-anchor')
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('note-failed-a')
      expect(deleteMock).toHaveBeenCalledWith('note-failed-b')
    })
  })

  it('没有运行中任务时不显示浮窗，状态改由任务中心承载', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ task_id: 'queued', status: 'PENDING' }),
        makeTask({ task_id: 'failed', status: 'FAILED' }),
        makeTask({ task_id: 'partial', status: 'PARTIAL' }),
      ],
    })

    render(<FloatingTaskQueue />)

    expect(screen.queryByRole('button', { name: /任务/ })).toBeNull()
  })

  it('首页 `/` 有运行中任务也不渲染浮窗（由活动条承担进度）', () => {
    routeState.pathname = '/'
    useTaskStore.setState({
      tasks: [makeRunningAnchor()],
    })

    render(<FloatingTaskQueue />)

    expect(screen.queryByRole('button', { name: /任务/ })).toBeNull()
  })

  it('任务中心 `/tasks` 及子路由 `/tasks/batches/:id` 隐藏浮窗', () => {
    useTaskStore.setState({
      tasks: [makeRunningAnchor()],
    })

    routeState.pathname = '/tasks'
    const { unmount } = render(<FloatingTaskQueue />)
    expect(screen.queryByRole('button', { name: /任务/ })).toBeNull()
    unmount()

    routeState.pathname = '/tasks/batches/batch-1'
    render(<FloatingTaskQueue />)
    expect(screen.queryByRole('button', { name: /任务/ })).toBeNull()
  })

  it('普通非首页路径有运行中任务时浮窗正常显示', () => {
    routeState.pathname = '/library'
    useTaskStore.setState({
      tasks: [makeRunningAnchor()],
    })

    render(<FloatingTaskQueue />)

    expect(screen.getByRole('button', { name: /任务/ })).toBeTruthy()
  })

  it('当前 processing 路由任务显示查看中标记', () => {
    routeState.pathname = '/processing/task-active'
    useTaskStore.setState({
      tasks: [makeTask({ task_id: 'task-active', status: 'SUM', payload: { title: 'Current task' } })],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))

    expect(screen.getByText('查看中')).toBeTruthy()
  })

  it('同一 workspace 同一 url 的多个 task 合并成一行', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({
          task_id: 'download-001',
          project_id: 'workspace-1',
          task_type: 'download',
          payload: { url: 'https://www.bilibili.com/video/BV1LSRhBQErk' },
          status: 'SUCCESS',
          progress: 1.0,
        }),
        makeTask({
          task_id: 'analyze-001',
          project_id: 'workspace-1',
          task_type: 'analyze',
          payload: { url: 'https://www.bilibili.com/video/BV1LSRhBQErk' },
          status: 'RUNNING',
          progress: 0.5,
        }),
        makeTask({
          task_id: 'note-002',
          project_id: 'workspace-1',
          task_type: 'note',
          payload: { url: 'https://www.bilibili.com/video/BV1LSRhBQErk' },
          status: 'PENDING',
          progress: 0,
        }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))

    // 应该只显示一行，而不是三行
    // 查找所有取消任务按钮（排除批量操作按钮）
    const cancelButtons = screen.getAllByRole('button', { name: /取消任务/ })
    expect(cancelButtons.length).toBe(1)
  })

  it('note 任务进度应按真实 task.progress 显示而非 0%', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({
          task_id: 'note-001',
          project_id: 'workspace-1',
          task_type: 'note',
          payload: { title: 'Note task' },
          status: 'FRAMES',
          progress: 0.79,
        }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))

    expect(screen.getAllByText('79%').length).toBeGreaterThanOrEqual(1)
  })

  it('运行中 analyze 被选为代表 → 标题用 video_title、阶段显示截帧', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({
          task_id: 'download-003',
          project_id: 'workspace-1',
          task_type: 'download',
          payload: { url: 'https://www.bilibili.com/video/BV1LY5J6pEZD' },
          status: 'SUCCESS',
          progress: 1.0,
        }),
        makeTask({
          task_id: 'analyze-003',
          project_id: 'workspace-1',
          task_type: 'analyze',
          payload: { url: 'https://www.bilibili.com/video/BV1LY5J6pEZD', video_title: '夯到爆测试标题' },
          status: 'FRAMES',
          progress: 0.35,
        }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))

    // 标题应显示真实 video_title，不是 BV 号
    expect(screen.getByText('夯到爆测试标题')).toBeTruthy()
    // 阶段文案应显示「截帧」，不是 'SUCCESS'
    expect(screen.getByText('截帧')).toBeTruthy()
  })

  it('analyze 任务用 source_url 而非 url 时也能正确合并', () => {
    useTaskStore.setState({
      tasks: [
        makeTask({
          task_id: 'download-002',
          project_id: 'workspace-1',
          task_type: 'download',
          payload: { url: 'https://www.bilibili.com/video/BV1LSRhBQErk' },
          status: 'SUCCESS',
          progress: 1.0,
        }),
        makeTask({
          task_id: 'analyze-002',
          project_id: 'workspace-1',
          task_type: 'analyze',
          payload: { source_url: 'https://www.bilibili.com/video/BV1LSRhBQErk' },
          status: 'RUNNING',
          progress: 0.5,
        }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))

    const cancelButtons = screen.getAllByRole('button', { name: /取消任务/ })
    expect(cancelButtons.length).toBe(1)
  })
})
