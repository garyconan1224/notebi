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
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DeployMonitorPage from '@/pages/SettingPage/DeployMonitorPage'

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
})
