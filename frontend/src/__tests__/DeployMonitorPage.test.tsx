/**
 * S2 — 部署监控页（标准日志）测试。
 *
 * 覆盖点：
 * - 显示健康状态、版本、运行时长
 * - 显示系统指标（CPU/内存/磁盘）
 * - 标准日志单视图（无“任务活动/应用日志”双标签）
 * - 日志级别过滤
 * - 暂停/恢复轮询
 */

import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
              { id: 2, timestamp: new Date().toISOString(), level: 'ERROR', category: 'task', message: 'failed' },
            ],
            latest_id: 2,
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

  it('显示系统指标', async () => {
    render(<DeployMonitorPage />)
    await waitFor(() => {
      expect(screen.getByText('CPU 使用率')).toBeInTheDocument()
      expect(screen.getByText('内存使用率')).toBeInTheDocument()
      expect(screen.getByText('磁盘使用率')).toBeInTheDocument()
    })
  })

  it('显示标准日志标题，不显示双标签', async () => {
    render(<DeployMonitorPage />)
    expect(screen.getByText('标准日志')).toBeInTheDocument()
    // 不应该有旧的双标签
    expect(screen.queryByText('任务活动')).not.toBeInTheDocument()
    expect(screen.queryByText('应用日志')).not.toBeInTheDocument()
  })

  it('显示日志条目', async () => {
    render(<DeployMonitorPage />)
    await waitFor(() => {
      expect(screen.getByText('started')).toBeInTheDocument()
      expect(screen.getByText('failed')).toBeInTheDocument()
    })
  })

  it('有暂停/恢复按钮', async () => {
    render(<DeployMonitorPage />)
    expect(screen.getByRole('button', { name: /暂停/ })).toBeInTheDocument()
  })

  it('有级别过滤下拉框', async () => {
    render(<DeployMonitorPage />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
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
    await screen.findByText('标准日志')
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
