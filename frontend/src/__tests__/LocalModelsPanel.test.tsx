import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LocalModelsPanel from '@/pages/SettingPage/LocalModelsPanel'

const mocks = vi.hoisted(() => ({
  listLocalModels: vi.fn(),
  downloadLocalModel: vi.fn(),
}))

vi.mock('@/services/localModels', () => mocks)
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const models = [
  {
    model_id: 'fast-whisper:base', family: 'fast-whisper', title: 'Faster Whisper · base',
    description: '本地转写', estimated_size_mb: 145, done_mb: 0, pending_mb: 0,
    cached: false, compatible: true, cache_dir: '/tmp/hf', status: 'not_downloaded',
    progress: 0, message: '未下载', error: '',
  },
  {
    model_id: 'mlx-whisper:base', family: 'mlx-whisper', title: 'MLX Whisper · base',
    description: 'Apple Silicon', estimated_size_mb: 0, done_mb: 0, pending_mb: 0,
    cached: false, compatible: false, cache_dir: '/tmp/hf', status: 'not_downloaded',
    progress: 0, message: '未下载', error: '',
  },
]

describe('LocalModelsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listLocalModels.mockResolvedValue(models)
    mocks.downloadLocalModel.mockResolvedValue(undefined)
  })

  it('列出本地模型、状态和缓存目录', async () => {
    render(<LocalModelsPanel />)
    expect(await screen.findByText('Faster Whisper · base')).toBeInTheDocument()
    expect(screen.getAllByText(/缓存：\/tmp\/hf/)).toHaveLength(2)
    expect(screen.getByText('待下载')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: '下载' })
    expect(buttons[0]).toBeEnabled()
    expect(buttons[1]).toBeDisabled()
  })

  it('只在点击下载后请求后台下载并刷新状态', async () => {
    render(<LocalModelsPanel />)
    fireEvent.click((await screen.findAllByRole('button', { name: '下载' }))[0])
    await waitFor(() => expect(mocks.downloadLocalModel).toHaveBeenCalledWith('fast-whisper:base'))
    expect(mocks.listLocalModels).toHaveBeenCalledTimes(2)
  })

  it('explains how to authorize the gated Pyannote fallback before retrying', async () => {
    mocks.listLocalModels.mockResolvedValue([
      ...models,
      {
        model_id: 'pyannote', family: 'speaker-diarization', title: '说话人回退 · Pyannote Community-1',
        description: '需要 Hugging Face Token 与模型许可', estimated_size_mb: 0, done_mb: 0, pending_mb: 0,
        cached: false, compatible: true, cache_dir: '/tmp/hf', status: 'failed',
        progress: 0, message: '下载失败', error: 'Cannot access gated repo', requires_token: true,
      },
    ])

    render(<LocalModelsPanel />)

    expect(await screen.findByText(/Community-1 的访问许可阻止了下载/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开模型授权页' })).toHaveAttribute(
      'href',
      'https://huggingface.co/pyannote/speaker-diarization-community-1',
    )
  })
})
