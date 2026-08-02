import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/locales/i18n'

const {
  fetchAsrHardwareStatusMock,
  fetchWhisperModelsStatusMock,
} = vi.hoisted(() => ({
  fetchAsrHardwareStatusMock: vi.fn(),
  fetchWhisperModelsStatusMock: vi.fn(),
}))

// 每个用例通过修改该对象切换 store 中的转写配置
const transcriberState = {
  transcriber: {
    type: 'auto' as string,
    whisperModelSize: 'medium',
    language: 'zh',
    device: 'auto',
    groqApiKey: '',
    initialPrompt: '',
    cpuThreads: 0,
    beamSize: 5,
    vadFilter: true,
  },
}

vi.mock('@/store/configStore', () => ({
  useConfigStore: (selector: (state: typeof transcriberState) => unknown) => selector(transcriberState),
}))

vi.mock('@/store/settingsShellStore', () => ({
  useSettingsShellStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setSaveBar: vi.fn(), resetSaveBar: vi.fn() }),
}))

vi.mock('@/hooks/useDirtyGuard', () => ({
  useDirtyGuard: () => ({
    dirtyMap: {},
    dirtyCount: 0,
    commit: vi.fn(),
  }),
}))

vi.mock('@/services/transcriber', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/transcriber')>()
  return {
    ...actual,
    fetchAsrHardwareStatus: fetchAsrHardwareStatusMock,
    fetchWhisperModelsStatus: fetchWhisperModelsStatusMock,
    updateTranscriberConfig: vi.fn(),
  }
})

import TranscriberPage from '@/pages/SettingPage/TranscriberPage'

const HARDWARE_APPLE_MLX = {
  platform: 'Darwin',
  architecture: 'arm64',
  strategy: 'apple-silicon-mlx',
  cuda_devices: 0,
  mlx_available: true,
  recommended_engine: 'mlx-whisper',
  recommended_device: 'mps',
  recommendation: 'Apple Silicon 使用 MLX Whisper；模型或依赖未就绪时自动使用 CPU int8。',
  fallback: 'fast-whisper / CPU int8',
}

describe('TranscriberPage 设备区域可信化', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transcriberState.transcriber = { ...transcriberState.transcriber, type: 'auto', device: 'auto' }
    fetchAsrHardwareStatusMock.mockResolvedValue(HARDWARE_APPLE_MLX)
    fetchWhisperModelsStatusMock.mockResolvedValue({ cache_dir: '', models: [] })
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Macintosh; Intel Mac OS X 10_15_7' })
  })

  it('MLX Whisper 显示固定 Metal 说明，不展示通用设备选择器', async () => {
    transcriberState.transcriber = { ...transcriberState.transcriber, type: 'mlx-whisper', device: 'mps' }

    render(<TranscriberPage />)

    expect(await screen.findByText(/Apple GPU · Metal（由 MLX 自动管理）/)).toBeInTheDocument()
    expect(screen.queryByLabelText('设备')).not.toBeInTheDocument()
    // 不允许声称 MLX 可在 CPU/CUDA 上手动运行
    expect(screen.queryByText('NVIDIA CUDA')).not.toBeInTheDocument()
  })

  it('Faster Whisper 显示 CPU/CUDA 选择器，CUDA 按真实硬件状态禁用', async () => {
    fetchAsrHardwareStatusMock.mockResolvedValue({ ...HARDWARE_APPLE_MLX, cuda_devices: 0 })
    transcriberState.transcriber = { ...transcriberState.transcriber, type: 'fast-whisper', device: 'cpu' }

    render(<TranscriberPage />)

    const device = await screen.findByLabelText('设备')
    expect(device).toBeInTheDocument()
    const cuda = screen.getByRole('option', { name: 'NVIDIA CUDA' })
    expect(cuda).toBeDisabled()
    expect(screen.getByRole('option', { name: 'CPU' })).toBeEnabled()
    expect(screen.queryByText(/Apple GPU · Metal/)).not.toBeInTheDocument()
  })

  it('自动选择展示硬件探测结果与 Apple/NVIDIA/CPU 优先级说明', async () => {
    render(<TranscriberPage />)

    // 硬件探测结果可见
    expect(await screen.findByText(/自动硬件策略 · Darwin arm64/)).toBeInTheDocument()
    expect(screen.getByText(/Apple Silicon 优先 MLX\/Metal/)).toBeInTheDocument()
    // auto 不提供手动设备选择器
    await waitFor(() => expect(fetchAsrHardwareStatusMock).toHaveBeenCalled())
    expect(screen.queryByLabelText('设备')).not.toBeInTheDocument()
  })
})
