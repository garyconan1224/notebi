import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DownloadSettingsPage from '@/pages/SettingPage/DownloadSettingsPage'
import { useSettingsShellStore } from '@/store/settingsShellStore'

const { getMock, patchMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  patchMock: vi.fn(),
  postMock: vi.fn(),
  deleteMock: vi.fn(),
}))

vi.mock('@/services/client', () => ({
  http: {
    get: getMock,
    patch: patchMock,
    post: postMock,
    delete: deleteMock,
  },
}))

const config = {
  output_dir: '',
  filename_template: '%(title)s.%(ext)s',
  proxy_mode: 'inherit',
  cookie_mode: 'browser',
  cookie_browser: 'chrome',
  cookie_profile: '',
  cookie_file_path: '',
  concurrency_limit: 2,
  retry_count: 2,
  socket_timeout: 30,
}

describe('DownloadSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock.mockResolvedValue({ data: config })
    patchMock.mockResolvedValue({ data: config })
    postMock.mockResolvedValue({ data: { readable: true, message: '可读' } })
    deleteMock.mockResolvedValue({ data: { success: true } })
  })

  it('mount GET，保存后再次 GET 读回', async () => {
    render(<DownloadSettingsPage />)
    await screen.findByText('下载配置')
    expect(getMock).toHaveBeenCalledWith('/download_config')
    fireEvent.change(screen.getByLabelText('并发下载数'), {
      target: { value: '4' },
    })
    await useSettingsShellStore.getState().saveBarState.onSave?.()
    expect(patchMock).toHaveBeenCalledWith(
      '/download_config',
      expect.objectContaining({ concurrency_limit: 4 }),
    )
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('常用设置和用途说明常驻，代理只在网络设置页维护', async () => {
    render(<DownloadSettingsPage />)
    await screen.findByText('下载配置')
    for (const label of [
      '输出目录',
      '文件名模板',
      '并发下载数',
      '重试次数',
      '连接超时（秒）',
      'Cookie 设置',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.queryByText('代理策略')).not.toBeInTheDocument()
    expect(screen.getByText(/关闭浏览器后再测试/)).toBeInTheDocument()
    expect(screen.getByText(/Netscape 格式/)).toBeInTheDocument()
    expect(screen.queryByText(/PO Token|Visitor Data/)).not.toBeInTheDocument()
  })

  it('Cookie 提供测试、导入和删除入口', async () => {
    render(<DownloadSettingsPage />)
    await screen.findByText('下载配置')
    expect(screen.getByRole('button', { name: '测试 Cookie' })).toBeInTheDocument()
    expect(screen.getByLabelText('导入 cookies.txt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除 Cookie 文件' })).toBeInTheDocument()
  })
})
