/**
 * R6-B — 部署监控页（任务活动 + 应用日志）测试。
 *
 * 覆盖点（作业书 R6-B）：
 * - 复用 /pipeline/tasks?include_logs=true&limit=50；
 * - 空日志任务也从生命周期生成活动项；
 * - queued/running/failed/success 数量；
 * - 「任务活动 / 应用日志」切换；
 * - 应用日志按 latest_id 每 2 秒增量轮询；
 * - 暂停 / 恢复 / 自动跟随 / level / 类别 / 关键词过滤；
 * - 网络失败保留旧内容；
 * - unmount 清 timer；
 * - 点击任务进入处理页；
 * - 清空只清浏览器视图；
 * - 保留健康 / 版本 / uptime / CPU / 内存 / 磁盘。
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DeployMonitorPage from '@/pages/SettingPage/DeployMonitorPage'
import type { TaskRecord } from '@/types/task'
import type { AdminLogsResponse } from '@/services/monitor'

const { navigateMock, fetchMonitorTasksMock, fetchAdminLogsMock, httpGetMock } = vi.hoisted(
  () => ({
    navigateMock: vi.fn(),
    fetchMonitorTasksMock: vi.fn(),
    fetchAdminLogsMock: vi.fn(),
    httpGetMock: vi.fn(),
  }),
)

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('@/hooks/useHealthPulse', () => ({
  useHealthPulse: () => ({
    online: true,
    data: { status: 'healthy', version: 'v0.3 BETA', uptime_sec: 3600 },
    error: null,
    lastCheckedAt: Date.now(),
    bootstrapping: false,
  }),
}))

vi.mock('@/services/monitor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/monitor')>()
  return {
    ...actual,
    fetchMonitorTasks: fetchMonitorTasksMock,
    fetchAdminLogs: fetchAdminLogsMock,
  }
})

vi.mock('@/services/client', () => ({
  http: { get: httpGetMock },
  default: { get: httpGetMock },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | object) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}))

const SYSTEM_STATS = {
  data: {
    cpu: { percent: 12.5, count_logical: 8, count_physical: 4 },
    memory: { total: 16e9, available: 8e9, used: 8e9, percent: 50 },
    disk: { total: 500e9, used: 200e9, free: 300e9, percent: 40 },
    timestamp: 0,
  },
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: 'task-1',
    project_id: 'ws-1',
    task_type: 'note',
    payload: {},
    status: 'SUCCESS',
    progress: 1,
    log: [],
    result: {},
    error: '',
    retry_of: '',
    cancel_requested: false,
    created_at: '2026-07-26T10:00:00Z',
    updated_at: '2026-07-26T10:05:00Z',
    ...overrides,
  }
}

const EMPTY_LOGS: AdminLogsResponse = { entries: [], latest_id: 0 }

beforeEach(() => {
  navigateMock.mockReset()
  fetchMonitorTasksMock.mockReset()
  fetchAdminLogsMock.mockReset()
  httpGetMock.mockReset()
  httpGetMock.mockResolvedValue(SYSTEM_STATS)
  fetchMonitorTasksMock.mockResolvedValue([])
  fetchAdminLogsMock.mockResolvedValue(EMPTY_LOGS)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DeployMonitorPage 任务活动', () => {
  it('显示 queued/running/failed/success 数量', async () => {
    fetchMonitorTasksMock.mockResolvedValue([
      makeTask({ task_id: 't1', status: 'PENDING' }),
      makeTask({ task_id: 't2', status: 'ASR' }),
      makeTask({ task_id: 't3', status: 'FAILED' }),
      makeTask({ task_id: 't4', status: 'SUCCESS' }),
      makeTask({ task_id: 't5', status: 'PARTIAL' }),
    ])

    render(<DeployMonitorPage />)

    await waitFor(() => {
      expect(screen.getByTestId('count-queued').textContent).toBe('1')
    })
    expect(screen.getByTestId('count-running').textContent).toBe('1')
    expect(screen.getByTestId('count-failed').textContent).toBe('1')
    expect(screen.getByTestId('count-success').textContent).toBe('2')
  })

  it('复用 include_logs=true&limit=50 拉取任务', async () => {
    render(<DeployMonitorPage />)
    await waitFor(() => {
      expect(fetchMonitorTasksMock).toHaveBeenCalledWith(50)
    })
  })

  it('空日志任务也从生命周期生成活动项', async () => {
    fetchMonitorTasksMock.mockResolvedValue([
      makeTask({ task_id: 'silent-task', status: 'SUCCESS', log: [] }),
    ])

    render(<DeployMonitorPage />)

    await waitFor(() => {
      expect(screen.getByText(/任务创建/)).toBeTruthy()
    })
    // 终结态还会生成一条状态活动
    expect(screen.getByText(/任务已完成/)).toBeTruthy()
  })

  it('有日志的任务展开日志活动项', async () => {
    fetchMonitorTasksMock.mockResolvedValue([
      makeTask({
        task_id: 'log-task',
        status: 'ASR',
        log: [{ ts: '2026-07-26T10:01:00Z', level: 'info', message: '开始转写音频' }],
      }),
    ])

    render(<DeployMonitorPage />)

    await waitFor(() => {
      expect(screen.getByText('开始转写音频')).toBeTruthy()
    })
  })

  it('点击活动项进入处理页', async () => {
    fetchMonitorTasksMock.mockResolvedValue([
      makeTask({ task_id: 'nav-task', status: 'ASR', log: [] }),
    ])

    render(<DeployMonitorPage />)

    await waitFor(() => {
      expect(screen.getByText(/任务创建/)).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('activity-item-nav-task'))
    expect(navigateMock).toHaveBeenCalledWith('/processing/nav-task')
  })
})

describe('DeployMonitorPage 应用日志', () => {
  it('切换到应用日志并展示日志', async () => {
    fetchAdminLogsMock.mockResolvedValue({
      entries: [
        { id: 1, timestamp: 1753524000, level: 'INFO', category: 'app', message: '服务启动' },
      ],
      latest_id: 1,
    })

    render(<DeployMonitorPage />)
    fireEvent.click(screen.getByRole('button', { name: /应用日志/ }))

    await waitFor(() => {
      expect(screen.getByText(/服务启动/)).toBeTruthy()
    })
  })

  it('按 latest_id 每 2 秒增量轮询', async () => {
    vi.useFakeTimers()
    fetchAdminLogsMock.mockResolvedValueOnce({
      entries: [{ id: 1, timestamp: 1, level: 'INFO', category: 'app', message: 'first' }],
      latest_id: 1,
    })
    fetchAdminLogsMock.mockResolvedValue(EMPTY_LOGS)

    render(<DeployMonitorPage />)
    fireEvent.click(screen.getByRole('button', { name: /应用日志/ }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // 首次拉取 after_id=0
    expect(fetchAdminLogsMock).toHaveBeenCalledWith(0, expect.any(Number))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    // 第二次拉取携带上一轮 latest_id=1
    expect(fetchAdminLogsMock).toHaveBeenCalledWith(1, expect.any(Number))
  })

  it('暂停后不再轮询，恢复后继续', async () => {
    vi.useFakeTimers()
    fetchAdminLogsMock.mockResolvedValue(EMPTY_LOGS)

    render(<DeployMonitorPage />)
    fireEvent.click(screen.getByRole('button', { name: /应用日志/ }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const callsAfterFirst = fetchAdminLogsMock.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: /暂停/ }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(fetchAdminLogsMock.mock.calls.length).toBe(callsAfterFirst)

    fireEvent.click(screen.getByRole('button', { name: /恢复/ }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(fetchAdminLogsMock.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it('网络失败保留旧内容', async () => {
    vi.useFakeTimers()
    fetchAdminLogsMock.mockResolvedValueOnce({
      entries: [{ id: 1, timestamp: 1, level: 'INFO', category: 'app', message: '保留我' }],
      latest_id: 1,
    })
    fetchAdminLogsMock.mockRejectedValue(new Error('network down'))

    render(<DeployMonitorPage />)
    fireEvent.click(screen.getByRole('button', { name: /应用日志/ }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText(/保留我/)).toBeTruthy()

    // 后续轮询失败，但旧内容仍在
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(screen.getByText(/保留我/)).toBeTruthy()
  })

  it('关键词过滤日志', async () => {
    fetchAdminLogsMock.mockResolvedValue({
      entries: [
        { id: 1, timestamp: 1, level: 'INFO', category: 'app', message: 'alpha 日志' },
        { id: 2, timestamp: 2, level: 'INFO', category: 'app', message: 'beta 日志' },
      ],
      latest_id: 2,
    })

    render(<DeployMonitorPage />)
    fireEvent.click(screen.getByRole('button', { name: /应用日志/ }))

    await waitFor(() => {
      expect(screen.getByText(/alpha 日志/)).toBeTruthy()
    })
    fireEvent.change(screen.getByPlaceholderText(/关键词/), { target: { value: 'beta' } })
    expect(screen.queryByText(/alpha 日志/)).toBeNull()
    expect(screen.getByText(/beta 日志/)).toBeTruthy()
  })

  it('level 过滤日志', async () => {
    fetchAdminLogsMock.mockResolvedValue({
      entries: [
        { id: 1, timestamp: 1, level: 'INFO', category: 'app', message: 'info 行' },
        { id: 2, timestamp: 2, level: 'ERROR', category: 'app', message: 'error 行' },
      ],
      latest_id: 2,
    })

    render(<DeployMonitorPage />)
    fireEvent.click(screen.getByRole('button', { name: /应用日志/ }))

    await waitFor(() => {
      expect(screen.getByText(/error 行/)).toBeTruthy()
    })
    fireEvent.change(screen.getByTestId('log-level-filter'), { target: { value: 'ERROR' } })
    expect(screen.queryByText(/info 行/)).toBeNull()
    expect(screen.getByText(/error 行/)).toBeTruthy()
  })

  it('清空只清浏览器视图，不删服务端', async () => {
    vi.useFakeTimers()
    fetchAdminLogsMock.mockResolvedValueOnce({
      entries: [{ id: 1, timestamp: 1, level: 'INFO', category: 'app', message: '会被清空' }],
      latest_id: 1,
    })
    fetchAdminLogsMock.mockResolvedValue(EMPTY_LOGS)

    render(<DeployMonitorPage />)
    fireEvent.click(screen.getByRole('button', { name: /应用日志/ }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText(/会被清空/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /清空/ }))
    expect(screen.queryByText(/会被清空/)).toBeNull()

    // 清空后 latest_id 保留，继续增量轮询，且从不调用删除接口
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(fetchAdminLogsMock).toHaveBeenCalledWith(1, expect.any(Number))
  })

  it('unmount 清理日志轮询 timer', async () => {
    vi.useFakeTimers()
    fetchAdminLogsMock.mockResolvedValue(EMPTY_LOGS)

    const { unmount } = render(<DeployMonitorPage />)
    fireEvent.click(screen.getByRole('button', { name: /应用日志/ }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    unmount()
    const callsAfterUnmount = fetchAdminLogsMock.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    expect(fetchAdminLogsMock.mock.calls.length).toBe(callsAfterUnmount)
  })
})

describe('DeployMonitorPage 基础指标保留', () => {
  it('保留健康 / 版本 / uptime / CPU / 内存 / 磁盘', async () => {
    render(<DeployMonitorPage />)

    await waitFor(() => {
      expect(screen.getByText('v0.3 BETA')).toBeTruthy()
    })
    expect(screen.getByText(/在线/)).toBeTruthy()
    expect(screen.getByText(/1h 0m/)).toBeTruthy()
    expect(screen.getByText('12.5%')).toBeTruthy()
    expect(screen.getByText('50.0%')).toBeTruthy()
    expect(screen.getByText('40.0%')).toBeTruthy()
  })
})
