import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LocalModelsPanel from '@/pages/SettingPage/LocalModelsPanel'

const mocks = vi.hoisted(() => ({
  listLocalModels: vi.fn(),
  downloadLocalModel: vi.fn(),
  activateLocalModel: vi.fn(),
  getLocalModelStorage: vi.fn(),
  updateLocalModelStorage: vi.fn(),
}))

vi.mock('@/services/localModels', () => mocks)
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function makeModel(overrides: Record<string, unknown>) {
  return {
    model_id: 'x', family: 'fast-whisper', title: '模型', description: '描述',
    estimated_size_mb: 0, done_mb: 0, pending_mb: 0, cached: false, compatible: true,
    cache_dir: '/tmp/hf', status: 'not_downloaded', progress: 0, message: '', error: '',
    ...overrides,
  }
}

/** 取包含指定文案的模型卡片，收窄为非空 HTMLElement 供 within() 使用 */
function cardOf(text: string): HTMLElement {
  const card = screen.getByText(text).closest('article')
  if (!(card instanceof HTMLElement)) {
    throw new Error(`找不到 "${text}" 所在的 <article> 卡片`)
  }
  return card
}

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

/** 与后端 list_local_models() 真实返回顺序一致 */
const backendCatalog = [
  makeModel({ model_id: 'fast-whisper:base', family: 'fast-whisper', title: 'Faster Whisper · base' }),
  makeModel({ model_id: 'mlx-whisper:base', family: 'mlx-whisper', title: 'MLX Whisper · base', compatible: false }),
  makeModel({ model_id: 'paddleocr-zh', family: 'ocr', title: '图片文字识别 · PaddleOCR 中文', status: 'not_verified' }),
  makeModel({ model_id: 'wespeaker', family: 'speaker-embedding', title: '音色识别 · WeSpeaker' }),
]

describe('LocalModelsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listLocalModels.mockResolvedValue(models)
    mocks.downloadLocalModel.mockResolvedValue(undefined)
    mocks.activateLocalModel.mockResolvedValue(undefined)
    mocks.getLocalModelStorage.mockResolvedValue({ directory: '', effective_cache_dir: '/tmp/hf' })
    mocks.updateLocalModelStorage.mockResolvedValue({ directory: '', effective_cache_dir: '/tmp/hf' })
  })

  it('列出本地模型、状态和缓存目录', async () => {
    render(<LocalModelsPanel />)
    expect(await screen.findByText('Faster Whisper · base')).toBeInTheDocument()
    // 缓存路径在折叠区城内，仍在 DOM 中
    expect(screen.getAllByText(/\/tmp\/hf/)).toHaveLength(3)
    expect(screen.getByText('待下载')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: '下载' })
    expect(buttons[0]).toBeEnabled()
    expect(buttons[1]).toBeDisabled()
  })

  it('S5: 模型按用途分组显示组标题', async () => {
    render(<LocalModelsPanel />)
    const headers = await screen.findAllByText('语音转写')
    expect(headers.length).toBeGreaterThanOrEqual(1)
  })

  it('按真实后端 family 归组：同用途只出现一个组标题且不丢失模型', async () => {
    mocks.listLocalModels.mockResolvedValue(backendCatalog)
    const { container } = render(<LocalModelsPanel />)
    await screen.findByText('Faster Whisper · base')

    // fast-whisper + mlx-whisper 合并为一个“语音转写”组，不再重复
    expect(screen.getAllByText('语音转写')).toHaveLength(1)
    // speaker-diarization + speaker-embedding 合并为一个“说话人识别”组
    expect(screen.getAllByText('说话人识别')).toHaveLength(1)
    // 后端 family 值是 ocr（不是 paddleocr），必须映射为可读用途
    expect(screen.getAllByText('图片文字识别')).toHaveLength(1)

    // 组标题顺序按后端目录首次出现顺序
    const headers = [...container.querySelectorAll('.local-model-purpose-header')]
      .map((node) => node.textContent)
    expect(headers).toEqual(['语音转写', '图片文字识别', '说话人识别'])

    // 所有模型仍在页面中
    for (const model of backendCatalog) {
      expect(screen.getByText(model.title)).toBeInTheDocument()
    }
  })

  it('未知 family 归入“其他”分组，不丢失也不显示原始 family', async () => {
    mocks.listLocalModels.mockResolvedValue([
      ...models,
      makeModel({ model_id: 'mystery-1', family: 'mystery-engine', title: '实验模型 X' }),
    ])
    render(<LocalModelsPanel />)
    await screen.findByText('实验模型 X')

    expect(screen.getByText('其他')).toBeInTheDocument()
    expect(screen.queryByText('mystery-engine')).not.toBeInTheDocument()
  })

  it('主动作随状态切换：下载 / 下载中禁用 / 切换使用 / 使用中', async () => {
    mocks.listLocalModels.mockResolvedValue([
      makeModel({ model_id: 'fast-whisper:base', title: '未下载模型', status: 'not_downloaded' }),
      makeModel({ model_id: 'fast-whisper:small', title: '下载中模型', status: 'downloading', progress: 0.42 }),
      makeModel({ model_id: 'fast-whisper:medium', title: '已就绪模型', status: 'ready', cached: true, progress: 1, active: false }),
      makeModel({ model_id: 'fast-whisper:large', title: '使用中模型', status: 'ready', cached: true, progress: 1, active: true }),
    ])
    render(<LocalModelsPanel />)
    await screen.findByText('未下载模型')

    expect(within(cardOf('未下载模型')).getByRole('button', { name: '下载' })).toBeEnabled()

    const downloadingCard = cardOf('下载中模型')
    expect(within(downloadingCard).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    expect(within(downloadingCard).getByRole('button', { name: '下载中…' })).toBeDisabled()

    expect(within(cardOf('已就绪模型')).getByRole('button', { name: '切换使用' })).toBeEnabled()

    const activeCard = cardOf('使用中模型')
    expect(within(activeCard).getByRole('button', { name: '使用中' })).toBeDisabled()
  })

  it('S5: 已下载未启用时显示“切换使用”按钮而非灰色“已下载”', async () => {
    mocks.listLocalModels.mockResolvedValue([
      {
        model_id: 'fast-whisper:base', family: 'fast-whisper', title: 'Faster Whisper · base',
        description: '本地转写', estimated_size_mb: 145, done_mb: 145, pending_mb: 0,
        cached: true, compatible: true, cache_dir: '/tmp/hf', status: 'ready',
        progress: 1, message: '已就绪', error: '', active: false,
      },
    ])
    render(<LocalModelsPanel />)
    // 应显示“切换使用”按钮而非灰色“已下载”
    expect(await screen.findByRole('button', { name: '切换使用' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '已下载' })).toBeNull()
  })

  it('失败时主区显示可读摘要，原始技术错误默认折叠', async () => {
    mocks.listLocalModels.mockResolvedValue([
      makeModel({
        model_id: 'paddleocr-zh', family: 'ocr', title: '图片文字识别 · PaddleOCR 中文',
        status: 'failed', error: 'Traceback: ConnectionError https://hf.internal/cache/x',
      }),
    ])
    render(<LocalModelsPanel />)
    await screen.findByText('图片文字识别 · PaddleOCR 中文')

    // 人类可读失败摘要在主区
    expect(screen.getByText(/下载失败，可以重试/)).toBeVisible()
    // 原始技术错误默认折叠，不作為主视觉
    const rawError = screen.getByText(/Traceback: ConnectionError/)
    expect(rawError).not.toBeVisible()
    fireEvent.click(screen.getByText('原始错误'))
    expect(rawError).toBeVisible()
  })

  it('只在点击下载后请求后台下载并刷新状态', async () => {
    render(<LocalModelsPanel />)
    fireEvent.click((await screen.findAllByRole('button', { name: '下载' }))[0])
    await waitFor(() => expect(mocks.downloadLocalModel).toHaveBeenCalledWith('fast-whisper:base'))
    expect(mocks.listLocalModels).toHaveBeenCalledTimes(2)
  })
})
