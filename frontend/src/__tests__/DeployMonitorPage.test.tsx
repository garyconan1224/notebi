/**
 * S6 — 诊断日志页测试。
 *
 * 覆盖点：
 * - 收敛为单一「诊断日志」界面：不再有处理进度/需要处理分区
 * - 每条事件优先显示人能理解的 summary、可能原因、建议操作
 * - 原始模块名 / technical_detail 收进可展开的卡片详情
 * - 旧日志缺少新字段时用 message 作摘要，不崩溃
 * - 保留级别、任务、批次、合集、关键词过滤和脱敏导出
 * - 初始加载参数、URL 过滤初始化、加载更早、增量去重
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

const TIMESTAMP = new Date().toISOString()

/** 三条日志：旧格式、结构化进度、结构化失败。 */
function mockLogEntries() {
  return [
    { id: 1, timestamp: TIMESTAMP, level: 'INFO', category: 'app', message: 'started' },
    {
      id: 2,
      timestamp: TIMESTAMP,
      level: 'INFO',
      category: 'pipeline',
      message: 'transcribing audio segment 3/10',
      task_id: 't1',
      batch_id: 'b1',
      workspace_id: 'w1',
      stage: 'ASR',
      progress: 0.48,
      duration_ms: 1250,
      retry_count: 1,
      retry_max: 3,
      summary: '语音转写进行中',
      correlation_id: 'corr-1',
    },
    {
      id: 3,
      timestamp: TIMESTAMP,
      level: 'ERROR',
      category: 'provider',
      message: 'provider timeout after 60s',
      task_id: 't1',
      batch_id: 'b1',
      workspace_id: 'w1',
      stage: 'SUM',
      event_code: 'E_PROVIDER_TIMEOUT',
      operation: 'summarize',
      component: 'summary_generator',
      outcome: 'failure',
      summary: '总结生成失败',
      probable_cause: '上游模型响应超时',
      suggested_action: '稍后重试或更换模型',
      error_code: 'TIMEOUT',
      provider: 'siliconflow',
      model: 'qwen-max',
      technical_detail: 'ReadTimeout after 60s',
    },
  ]
}

describe('DeployMonitorPage 诊断日志', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/settings/monitor')
    httpGetMock.mockImplementation((url: string) => {
      if (url === '/admin/logs') {
        return Promise.resolve({
          data: {
            entries: mockLogEntries(),
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

  it('S6: 收敛为单一诊断日志界面，不再有处理进度/需要处理分区', async () => {
    render(<DeployMonitorPage />)
    expect(await screen.findByText('诊断日志')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /处理进度/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /需要处理/ })).not.toBeInTheDocument()
    expect(screen.queryByText('高级诊断日志')).not.toBeInTheDocument()
  })

  it('优先显示人能理解的 summary、可能原因、建议操作', async () => {
    render(<DeployMonitorPage />)
    expect(await screen.findByText('总结生成失败')).toBeInTheDocument()
    expect(screen.getByText('语音转写进行中')).toBeInTheDocument()
    expect(screen.getByText(/可能原因：/)).toHaveTextContent('上游模型响应超时')
    expect(screen.getByText(/建议操作：/)).toHaveTextContent('稍后重试或更换模型')
  })

  it('旧日志缺少新字段时用 message 作为摘要，不崩溃', async () => {
    render(<DeployMonitorPage />)
    expect(await screen.findByText('started')).toBeInTheDocument()
    // 旧日志没有可能原因/建议操作行
    const legacyCard = screen.getByText('started').closest('article')
    expect(legacyCard).not.toBeNull()
    expect(within(legacyCard!).queryByText(/可能原因/)).not.toBeInTheDocument()
    expect(within(legacyCard!).queryByText(/建议操作/)).not.toBeInTheDocument()
  })

  it('原始模块名与 technical_detail 收进可展开详情', async () => {
    render(<DeployMonitorPage />)
    const summary = await screen.findByText('总结生成失败')
    const card = summary.closest('article')!
    // 默认折叠：技术信息不可见
    expect(within(card).queryByText(/ReadTimeout after 60s/)).not.toBeVisible()
    expect(within(card).queryByText(/summary_generator/)).not.toBeVisible()
    // 展开后可见
    fireEvent.click(within(card).getByText('技术详情'))
    expect(within(card).getByText(/ReadTimeout after 60s/)).toBeVisible()
    expect(within(card).getByText(/summary_generator/)).toBeVisible()
    expect(within(card).getByText(/E_PROVIDER_TIMEOUT/)).toBeVisible()
    // 原始 message 也收进详情（与 summary 不同时）
    expect(within(card).getByText(/provider timeout after 60s/)).toBeVisible()
  })

  it('保留级别过滤', async () => {
    render(<DeployMonitorPage />)
    await screen.findByText('总结生成失败')
    fireEvent.change(screen.getByLabelText('日志级别'), { target: { value: 'ERROR' } })
    expect(screen.queryByText('语音转写进行中')).not.toBeInTheDocument()
    expect(screen.getByText('总结生成失败')).toBeInTheDocument()
  })

  it('保留任务 / 批次 / 合集选择器与关键词过滤', async () => {
    render(<DeployMonitorPage />)
    await screen.findByText('总结生成失败')
    expect(screen.getByLabelText('任务 ID')).toHaveTextContent('t1')
    expect(screen.getByLabelText('批次 ID')).toHaveTextContent('b1')
    expect(screen.getByLabelText('合集 ID')).toHaveTextContent('w1')

    fireEvent.change(screen.getByLabelText('关键词'), { target: { value: '转写' } })
    expect(screen.getByText('语音转写进行中')).toBeInTheDocument()
    expect(screen.queryByText('总结生成失败')).not.toBeInTheDocument()
    expect(screen.queryByText('started')).not.toBeInTheDocument()
  })

  it('同一事件流中最新日志在最前', async () => {
    render(<DeployMonitorPage />)
    await screen.findByText('总结生成失败')
    const list = document.querySelector('.monitor-activity-list')
    expect(list?.firstElementChild?.textContent).toContain('总结生成失败')
  })

  it('有暂停/恢复按钮', () => {
    render(<DeployMonitorPage />)
    expect(screen.getByRole('button', { name: /暂停/ })).toBeInTheDocument()
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
    // 过滤栏常驻可见，无需展开
    expect(screen.getByLabelText('日志级别')).toHaveValue('ERROR')
    expect(screen.getByLabelText('批次 ID')).toHaveValue('b1')
  })

  it('加载更早使用当前 oldest_id', async () => {
    httpGetMock.mockImplementation((url: string, options?: { params?: Record<string, number> }) => {
      if (url === '/admin/logs' && options?.params?.before_id === 10) {
        return Promise.resolve({
          data: {
            entries: [{ id: 1, timestamp: TIMESTAMP, level: 'INFO', category: 'app', message: 'older' }],
            latest_id: 20,
            oldest_id: 1,
            has_more_older: false,
          },
        })
      }
      if (url === '/admin/logs') {
        return Promise.resolve({
          data: {
            entries: [{ id: 10, timestamp: TIMESTAMP, level: 'INFO', category: 'app', message: 'newest' }],
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
    const initial = [
      { id: 455, timestamp: TIMESTAMP, level: 'INFO', category: 'app', message: 'first' },
      { id: 456, timestamp: TIMESTAMP, level: 'INFO', category: 'app', message: 'initial' },
    ]
    const polled = [
      { id: 456, timestamp: TIMESTAMP, level: 'INFO', category: 'app', message: 'updated' },
      { id: 457, timestamp: TIMESTAMP, level: 'INFO', category: 'app', message: 'next' },
    ]

    expect(mergeLogEntries(initial, polled).map((entry) => [entry.id, entry.message])).toEqual([
      [455, 'first'],
      [456, 'updated'],
      [457, 'next'],
    ])
  })
})
