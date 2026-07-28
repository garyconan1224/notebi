import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NetworkSettingsPage from '@/pages/SettingPage/NetworkSettingsPage'
import { useSettingsShellStore } from '@/store/settingsShellStore'

const { getMock, patchMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
}))

vi.mock('@/services/client', () => ({
  http: { get: getMock, patch: patchMock, post: postMock },
}))

describe('NetworkSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock.mockResolvedValue({
      data: { routing_mode: 'smart', global_proxy: '' },
    })
    patchMock.mockResolvedValue({
      data: { routing_mode: 'proxy', global_proxy: 'http://127.0.0.1:7890' },
    })
    postMock.mockResolvedValue({
      data: {
        target: 'https://www.youtube.com/',
        route: '智能路由：海外站点走代理',
        proxy_used: true,
        elapsed_ms: 12,
        ok: true,
        message: 'HTTP 200',
      },
    })
  })

  it('mount GET，保存 PATCH 后再次 GET 读回', async () => {
    render(<NetworkSettingsPage />)
    await screen.findByText('网络设置')
    expect(getMock).toHaveBeenCalledWith('/network_config')

    fireEvent.click(screen.getByRole('radio', { name: /全部代理/ }))
    fireEvent.change(screen.getByLabelText('代理地址'), {
      target: { value: 'http://127.0.0.1:7890' },
    })
    getMock.mockResolvedValueOnce({
      data: {
        routing_mode: 'proxy',
        global_proxy: 'http://127.0.0.1:7890',
      },
    })
    await useSettingsShellStore.getState().saveBarState.onSave?.()

    expect(patchMock).toHaveBeenCalledWith('/network_config', {
      routing_mode: 'proxy',
      global_proxy: 'http://127.0.0.1:7890',
    })
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('三种模式说明和四个连通性测试入口常驻，不显示废弃字段', async () => {
    render(<NetworkSettingsPage />)
    await screen.findByText('网络设置')
    expect(screen.getByText(/智能路由：国内站点/)).toBeInTheDocument()
    expect(screen.getByText(/全部直连：所有站点/)).toBeInTheDocument()
    expect(screen.getByText(/全部代理：所有站点/)).toBeInTheDocument()
    for (const label of ['测试 Bilibili', '测试 YouTube', '测试 Tavily', '测试模型服务']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByText(/PO Token|Visitor Data/)).not.toBeInTheDocument()
  })

  it('连通性结果不展示代理密码', async () => {
    render(<NetworkSettingsPage />)
    await screen.findByText('网络设置')
    fireEvent.click(screen.getByRole('button', { name: '测试 YouTube' }))
    await waitFor(() => expect(postMock).toHaveBeenCalled())
    expect(screen.getByText(/智能路由：海外站点走代理/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('secret')
  })
})
