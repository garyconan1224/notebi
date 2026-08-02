/**
 * S2 — 运行监控页测试。
 *
 * 覆盖点：
 * - 显示健康状态、版本、运行时长
 * - 显示系统指标（CPU/内存/磁盘）
 * - 用户可读的处理阶段和问题视图
 * - 原始日志折叠在高级诊断
 * - 暂停/恢复轮询
 */

import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DeployMonitorPage, {
  mergeLogEntries,
} from '@/pages/SettingPage/DeployMonitorPage'

const { httpGetMock } = vi.hoisted(() => ({
  httpGetMock: vi.fn(),
}))

vi.mock('@/hooks/useHealthPulse', () => ({
  useHealthPulse: () => ({
    online: true,
    data: { status: 'healthy', version: 'v0.4.0', uptime_sec: 3600 },
    error: null,
    lastCheckedAt: Date.now(),
    bootstrapping: false,
  }),
}))

vi.mock('@/services/client', () => ({
  default: {
    get: httpGetMock,
  },
}))

describe('DeployMonitorPage 标准日志', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/settings/monitor')
    // 模拟系统指标
    httpGetMock.mockImplementation((url: string) => {
      if (url === '/admin/system/stats') {
        return Promise.resolve({
          data: {
            cpu: { percent: 25.5, count_logical: 8, count_physical: 4 },
            memory: { total: 16 * 1024 ** 3, available: 8 * 1024 ** 3, used: 8 * 1024 ** 3, percent: 50 },
            disk: { total: 500 * 1024 ** 3, used: 200 * 1024 ** 3, free: 300 * 1024 ** 3, percent: 40 },
            timestamp: Date.now(),
          },
        })
      }
      if (url === '/admin/logs') {
        return Promise.resolve({
          data: {
            entries: [
              { id: 1, timestamp: new Date().toISOString(), level: 'INFO', category: 'app', message: 'started' },
              {
                id: 2,
                timestamp: new Date().toISOString(),
                level: 'INFO',
                category: 'pipeline',
                message: 'transcribing',
                task_id: 't1',
                batch_id: 'b1',
                stage: 'ASR',
                progress: 0.48,
                duration_ms: 1250,
                retry_count: 1,
              },
              {
                id: 3,
                timestamp: new Date().toISOString(),
                level: 'ERROR',
                category: 'provider',
                message: 'provider timeout',
                task_id: 't1',
                batch_id: 'b1',
                stage: 'SUM',
              },
            ],
            latest_id: 3,
            oldest_id: 1,
            has_more_older: false,
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
  })

  it('显示健康状态和版本', async () => {
    render(<DeployMonitorPage />)
    expect(screen.getByText('在线')).toBeInTheDocument()
    expect(screen.getByText(/v0\.4\.0/)).toBeInTheDocument()
  })

  it('S6: 不再显示设备状态卡片', async () => {
    render(<DeployMonitorPage />)
    await screen.findByText('诊断日志')
    expect(screen.queryByText('CPU 使用率')).not.toBeInTheDocument()
    expect(screen.queryByText('内存使用率')).not.toBeInTheDocument()
  })

  it('显示诊断日志，不再把日志类别作为主导航', async () => {
    render(<DeployMonitorPage />)
    expect(screen.getByText('诊断日志')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /处理进度/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /需要处理/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('日志类别')).not.toBeInTheDocument()
  })

  it('把结构化日志解释成阶段、进度、耗时和重试', async () => {
    render(<DeployMonitorPage />)
    await waitFor(() => {
      expect(screen.getByText('语音转写')).toBeInTheDocument()
      expect(screen.getByText('48%')).toBeInTheDocument()
      expect(screen.getByText(/1\.3 秒/)).toBeInTheDocument()
      expect(screen.getByText(/已重试 1 次/)).toBeInTheDocument()
    })
  })

  it('优先显示需要处理的问题，并提供所属环节', async () => {
    render(<DeployMonitorPage />)
    const issuesButton = await screen.findByRole('button', { name: /需要处理/ })
    fireEvent.click(issuesButton)
    const activitySection = issuesButton.closest('section')
    expect(activitySection).not.toBeNull()
    const activityList = activitySection!.querySelector('.monitor-activity-list')
    expect(activityList).not.toBeNull()
    expect(within(activityList!).getByText('provider timeout')).toBeVisible()
    expect(within(activityList!).getByText('生成总结')).toBeVisible()
  })

  it('原始日志默认折叠在高级诊断', async () => {
    render(<DeployMonitorPage />)
    await screen.findByText('语音转写')
    expect(screen.getByText('started')).not.toBeVisible()
    fireEvent.click(screen.getByText('高级诊断日志'))
    expect(screen.getByText('started')).toBeVisible()
  })

  it('有暂停/恢复按钮', () => {
    render(<DeployMonitorPage />)
    expect(screen.getByRole('button', { name: /暂停/ })).toBeInTheDocument()
  })

  it('高级诊断保留技术级别过滤', () => {
    render(<DeployMonitorPage />)
    fireEvent.click(screen.getByText('高级诊断日志'))
    expect(screen.getByLabelText('日志级别')).toBeInTheDocument()
  })

  it('在同一事件流中把最新日志放在最前，并提供已知 ID 选择器', async () => {
    render(<DeployMonitorPage />)
    await screen.findByText('语音转写')
    fireEvent.click(screen.getByText('高级诊断日志'))

    const rawLogs = document.querySelector('.monitor-raw-logs')
    expect(rawLogs?.firstElementChild?.textContent).toContain('provider timeout')
    expect(screen.getByLabelText('任务 ID').tagName).toBe('SELECT')
    expect(screen.getByLabelText('批次 ID').tagName).toBe('SELECT')
    expect(screen.getByLabelText('任务 ID')).toHaveTextContent('t1')
    expect(screen.getByText('诊断事件')).toBeInTheDocument()
  })

  it('首次只按最新 200 条加载标准日志', async () => {
    render(<DeployMonitorPage />)
    await waitFor(() => {
      expect(httpGetMock).toHaveBeenCalledWith('/admin/logs', {
        params: { limit: 200 },
      })
    })
    expect(
      httpGetMock.mock.calls.some(([url]) => String(url).includes('/pipeline/tasks')),
    ).toBe(false)
  })

  it('URL 中的 batch 和 level 初始化过滤器', async () => {
    window.history.replaceState({}, '', '/settings/monitor?batch_id=b1&level=ERROR')
    render(<DeployMonitorPage />)
    await screen.findByText('诊断日志')
    fireEvent.click(screen.getByText('高级诊断日志'))
    expect(screen.getByLabelText('日志级别')).toHaveValue('ERROR')
    expect(screen.getByLabelText('批次 ID')).toHaveValue('b1')
  })

  it('加载更早使用当前 oldest_id', async () => {
    httpGetMock.mockImplementation((url: string, options?: { params?: Record<string, number> }) => {
      if (url === '/admin/system/stats') {
        return Promise.resolve({
          data: {
            cpu: { percent: 1, count_logical: 1, count_physical: 1 },
            memory: { total: 1, available: 1, used: 0, percent: 0 },
            disk: { total: 1, used: 0, free: 1, percent: 0 },
            timestamp: Date.now(),
          },
        })
      }
      if (url === '/admin/logs' && options?.params?.before_id === 10) {
        return Promise.resolve({
          data: {
            entries: [{ id: 1, timestamp: new Date().toISOString(), level: 'INFO', category: 'app', message: 'older' }],
            latest_id: 20,
            oldest_id: 1,
            has_more_older: false,
          },
        })
      }
      if (url === '/admin/logs') {
        return Promise.resolve({
          data: {
            entries: [{ id: 10, timestamp: new Date().toISOString(), level: 'INFO', category: 'app', message: 'newest' }],
            latest_id: 20,
            oldest_id: 10,
            has_more_older: true,
          },
        })
      }
      return Promise.resolve({ data: {} })
    })
    render(<DeployMonitorPage />)
    fireEvent.click(await screen.findByRole('button', { name: '加载更早' }))
    await waitFor(() =>
      expect(httpGetMock).toHaveBeenCalledWith('/admin/logs', {
        params: { before_id: 10, limit: 100 },
      }),
    )
  })

  it('提供脱敏诊断导出说明', async () => {
    render(<DeployMonitorPage />)
    expect(await screen.findByRole('button', { name: '导出诊断' })).toBeInTheDocument()
    expect(screen.getByText(/已自动脱敏，不包含 API 密钥和 Cookie/)).toBeInTheDocument()
  })

  it('初始加载与增量轮询重叠时按日志 id 去重', () => {
    const timestamp = new Date().toISOString()
    const initial = [
      { id: 455, timestamp, level: 'INFO', category: 'app', message: 'first' },
      { id: 456, timestamp, level: 'INFO', category: 'app', message: 'initial' },
    ]
    const polled = [
      { id: 456, timestamp, level: 'INFO', category: 'app', message: 'updated' },
      { id: 457, timestamp, level: 'INFO', category: 'app', message: 'next' },
    ]

    expect(mergeLogEntries(initial, polled).map((entry) => [entry.id, entry.message])).toEqual([
      [455, 'first'],
      [456, 'updated'],
      [457, 'next'],
    ])
  })
})
