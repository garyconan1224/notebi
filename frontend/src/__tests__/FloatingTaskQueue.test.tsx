import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatingTaskQueue } from '@/components/FloatingTaskQueue'
import { useTaskStore } from '@/store/taskStore'
import type { TaskRecord } from '@/types/task'

const { cancelMock, deleteMock, navigateMock, retryMock, routeState } = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  deleteMock: vi.fn(),
  navigateMock: vi.fn(),
  retryMock: vi.fn(),
  routeState: { pathname: '/' },
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

describe('FloatingTaskQueue v2', () => {
  beforeEach(() => {
    routeState.pathname = '/'
    navigateMock.mockReset()
    cancelMock.mockReset()
    deleteMock.mockReset()
    retryMock.mockReset()
    cancelMock.mockResolvedValue({})
    deleteMock.mockResolvedValue({})
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

  it('F3.2: 失败任务用 errorCategories 友好文案展示（限流），原始错误走 title', () => {
    useTaskStore.setState({
      tasks: [
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

  it('查看全部优先跳转到当前合集的批量处理页', () => {
    useTaskStore.setState({
      tasks: [makeTask({ status: 'DOWNLOAD' })],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))
    fireEvent.click(screen.getByRole('button', { name: '查看全部' }))

    expect(navigateMock).toHaveBeenCalledWith('/processing/batch/workspace-1')
  })

  it('查看全部没有有效合集时回退到 /workspaces', () => {
    useTaskStore.setState({
      tasks: [makeTask({ project_id: 'default_project', status: 'DOWNLOAD' })],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))
    fireEvent.click(screen.getByRole('button', { name: '查看全部' }))

    expect(navigateMock).toHaveBeenCalledWith('/workspaces')
  })

  it('进行中任务支持单项取消和批量暂停', async () => {
    useTaskStore.setState({
      tasks: [
        makeTask({ task_id: 'task-a', status: 'DOWNLOAD', payload: { title: 'Download task' } }),
        makeTask({ task_id: 'task-b', status: 'ASR', payload: { title: 'Transcribe task' } }),
      ],
    })

    render(<FloatingTaskQueue />)
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))
    fireEvent.click(screen.getByRole('button', { name: '取消任务 Download task' }))
    fireEvent.click(screen.getByRole('button', { name: '暂停全部' }))

    await waitFor(() => {
      expect(cancelMock).toHaveBeenCalledWith('task-a')
      expect(cancelMock).toHaveBeenCalledWith('task-b')
    })
  })

  it('FAILED 任务支持重试和后端清除', async () => {
    useTaskStore.setState({
      tasks: [makeTask({ task_id: 'task-failed', status: 'FAILED', payload: { title: 'Failed task' } })],
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

    expect(useTaskStore.getState().tasks).toHaveLength(0)
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('note-failed-a')
      expect(deleteMock).toHaveBeenCalledWith('note-failed-b')
    })
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
