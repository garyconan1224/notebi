import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProvidersAndModelsPage from '@/pages/SettingPage/ProvidersAndModelsPage'
import { http } from '@/services/client'

// Mock http
vi.mock('@/services/client', () => ({
  http: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

// Mock configStore
const configMocks = vi.hoisted(() => ({ setConfig: vi.fn() }))
vi.mock('@/store/configStore', () => ({
  useConfigStore: vi.fn(() => ({
    textProviderId: '',
    textModelId: '',
    visionProviderId: '',
    visionModelId: '',
    embeddingProviderId: '',
    embeddingModelId: '',
    rerankProviderId: '',
    rerankModelId: '',
    setConfig: configMocks.setConfig,
  })),
}))

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}))

// Mock sonner
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: toastMocks }))

// 供应商 / 模型管理子页打桩：它们内部也有「设置」字样，会干扰默认模型卡片按钮定位
vi.mock('@/pages/SettingPage/ProvidersManagementPage', () => ({ default: () => null }))
vi.mock('@/pages/SettingPage/ModelManagementPage', () => ({ default: () => null }))

const MOCK_MODELS = {
  data: {
    models: [
      { id: 'gpt-4', name: 'GPT-4' },
      { id: 'gpt-4-vision', name: 'GPT-4 Vision' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
    ],
  },
}

/** 构造 /providers 响应，可覆盖各 role 的 default_models 与全局默认 provider */
const makeProviders = (
  defaultModels: Record<string, string> = { chat: 'gpt-4', vision: 'gpt-4-vision' },
  defaultProviderForChat = 'openai',
) => ({
  data: [
    {
      id: 'openai',
      name: 'OpenAI',
      kind: 'openai',
      enabled: true,
      capabilities: ['chat', 'vision'],
      default_models: defaultModels,
    },
  ],
  default_provider_for_chat: defaultProviderForChat,
  default_provider_for_vision: 'openai',
})

/** 让 http.get 按 URL 返回 /providers 与 /providers/openai/models */
const mockGet = (providersPayload: unknown) => {
  vi.mocked(http.get).mockImplementation(async (url: string) => {
    if (url === '/providers') return { data: providersPayload }
    if (url === '/providers/openai/models') return { data: MOCK_MODELS }
    return { data: {} }
  })
}

describe('ProvidersAndModelsPage 默认模型显示（阶段 D）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET /providers 返回 snake_case default_models 和 default_provider_for_chat 时，chat 卡片显示真实 provider/model', async () => {
    mockGet(makeProviders())

    render(<ProvidersAndModelsPage />)

    await waitFor(() => {
      // chat 卡片应显示 OpenAI / gpt-4（负向前瞻排除 gpt-4-vision 的干扰）
      expect(screen.getByText(/OpenAI \/ gpt-4(?!-)/)).toBeTruthy()
    })
  })

  it('vision 卡片也应显示已配置的默认模型', async () => {
    mockGet(makeProviders())

    render(<ProvidersAndModelsPage />)

    await waitFor(() => {
      expect(screen.getByText(/OpenAI \/ gpt-4-vision/)).toBeTruthy()
    })
  })

  it('provider 不存在或 model 已从列表消失时，显示可理解的异常状态，不把有效配置误判为未设置', async () => {
    mockGet(makeProviders({ chat: 'deprecated-model' }, 'openai'))

    render(<ProvidersAndModelsPage />)

    await waitFor(() => {
      // 应显示 provider 名 + 模型 ID（即使模型不在列表中）
      const text = screen.getByText(/OpenAI \/ deprecated-model/)
      expect(text).toBeTruthy()
    })
  })
})

describe('ProvidersAndModelsPage 默认模型保存与读回（P1）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PUT 成功且 GET 读回值与目标一致时，才提示成功并同步 configStore', async () => {
    // 初始 chat 为空；保存后读回为 gpt-4
    mockGet(makeProviders({}))
    vi.mocked(http.put).mockResolvedValue({ data: {} })

    render(<ProvidersAndModelsPage />)
    // 等待加载完成；初始各 role 均未设置 → 多个「设置」按钮，取第一个（chat 卡片）
    fireEvent.click((await screen.findAllByText('设置'))[0])

    // 选择供应商
    const providerSelect = await screen.findByRole('combobox')
    fireEvent.change(providerSelect, { target: { value: 'openai' } })
    // 选择模型 gpt-4
    fireEvent.click(await screen.findByText('gpt-4'))
    // 读回将返回 chat=gpt-4
    mockGet(makeProviders({ chat: 'gpt-4' }))
    fireEvent.click(screen.getByText('确认'))

    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalled()
    })
    expect(http.put).toHaveBeenCalledWith('/providers/openai', {
      default_models: { chat: 'gpt-4' },
    })
    expect(configMocks.setConfig).toHaveBeenCalledWith({ textProviderId: 'openai', textModelId: 'gpt-4' })
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('PUT 成功但 GET 读回失败（抛错）时，不提示成功，提示保存失败', async () => {
    mockGet(makeProviders({}))
    vi.mocked(http.put).mockResolvedValue({ data: {} })

    render(<ProvidersAndModelsPage />)
    fireEvent.click((await screen.findAllByText('设置'))[0])
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'openai' } })
    fireEvent.click(await screen.findByText('gpt-4'))
    // 保存后的读回 GET 失败
    vi.mocked(http.get).mockRejectedValue(new Error('network down'))
    fireEvent.click(screen.getByText('确认'))

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalled()
    })
    expect(toastMocks.success).not.toHaveBeenCalled()
    expect(configMocks.setConfig).not.toHaveBeenCalled()
  })

  it('PUT 成功但 GET 读回值与目标不一致时，不提示成功，提示保存未生效', async () => {
    mockGet(makeProviders({}))
    vi.mocked(http.put).mockResolvedValue({ data: {} })

    render(<ProvidersAndModelsPage />)
    fireEvent.click((await screen.findAllByText('设置'))[0])
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'openai' } })
    fireEvent.click(await screen.findByText('gpt-4'))
    // 读回返回的是另一个模型（后端未真正保存目标值）
    mockGet(makeProviders({ chat: 'gpt-3.5-turbo' }))
    fireEvent.click(screen.getByText('确认'))

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalled()
    })
    expect(toastMocks.success).not.toHaveBeenCalled()
    expect(configMocks.setConfig).not.toHaveBeenCalled()
  })

  it('清空默认模型：PUT 空值且读回为空时，提示已清除并清空 configStore', async () => {
    // 初始 chat=gpt-4（卡片显示「更换」）
    mockGet(makeProviders({ chat: 'gpt-4' }))
    vi.mocked(http.put).mockResolvedValue({ data: {} })

    render(<ProvidersAndModelsPage />)
    // chat 卡片已有模型 → 按钮为「更换」
    fireEvent.click(await screen.findByText('更换'))
    // 读回将返回 chat 已清空
    mockGet(makeProviders({}))
    fireEvent.click(await screen.findByText('清除'))

    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalled()
    })
    expect(http.put).toHaveBeenCalledWith('/providers/openai', {
      default_models: { chat: '' },
    })
    expect(configMocks.setConfig).toHaveBeenCalledWith({ textProviderId: '', textModelId: '' })
  })

  it('清空默认模型但后端读回仍保留旧值时，不提示成功', async () => {
    mockGet(makeProviders({ chat: 'gpt-4' }))
    vi.mocked(http.put).mockResolvedValue({ data: {} })

    render(<ProvidersAndModelsPage />)
    fireEvent.click(await screen.findByText('更换'))
    // 后端没有真正清空，读回仍为旧模型。
    mockGet(makeProviders({ chat: 'gpt-4' }))
    fireEvent.click(await screen.findByText('清除'))

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalled()
    })
    expect(toastMocks.success).not.toHaveBeenCalled()
    expect(configMocks.setConfig).not.toHaveBeenCalled()
  })
})

// ── 第 2 批：能力感知的默认模型选择 ─────────────────────────
// 后端接口实况：/providers/{id}/models 会把上游返回的
// capabilities / supported_modalities / supported_inputs 透传为模型级
// capabilities（token 空间不保证是 chat|vision|embedding|rerank）；
// 失败时返回 { models: [], error: "..." }。前端只能据此三态判断，
// 不允许凭模型名猜能力。

/** 带模型级 capabilities 的模型列表：覆盖 supported / unsupported / unknown 三态 */
const CAP_MODELS = {
  data: {
    models: [
      // vision 用途显式支持（capabilities 含 vision）
      { id: 'vision-pro', name: 'Vision Pro', capabilities: ['chat', 'vision'] },
      // 显式声明了 chat 但未声明 vision → 对 vision 用途显式不支持
      { id: 'plain-chat', name: 'Plain Chat', capabilities: ['chat'] },
      // 上游未返回 capabilities → 能力未知
      { id: 'mystery', name: 'Mystery' },
    ],
  },
}

const mockGetWithModels = (providersPayload: unknown, modelsPayload: unknown) => {
  vi.mocked(http.get).mockImplementation(async (url: string) => {
    if (url === '/providers') return { data: providersPayload }
    if (url === '/providers/openai/models') return { data: modelsPayload }
    if (url === '/providers/anthropic/models') return { data: modelsPayload }
    return { data: {} }
  })
}

/** 打开 vision 卡片（第 2 个）的选择器并选中 openai 供应商 */
async function openVisionPicker() {
  fireEvent.click((await screen.findAllByText('设置'))[1])
  fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'openai' } })
}

describe('默认模型选择器：能力感知（第 2 批）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('模型行显示用途能力标签；显式支持当前用途的模型标「推荐：已验证支持当前用途」', async () => {
    mockGetWithModels(makeProviders({}), CAP_MODELS)
    render(<ProvidersAndModelsPage />)
    await openVisionPicker()

    // 推荐理由（vision-pro 的 capabilities 含 vision）
    expect(await screen.findByText('推荐：已验证支持当前用途')).toBeTruthy()
    // 用途能力标签（透传的 capabilities 显示出来）
    expect(screen.getByText('chat · vision')).toBeTruthy()
  })

  it('能力未知的模型显示「能力待确认」，仍在候选列表且可选', async () => {
    mockGetWithModels(makeProviders({}), CAP_MODELS)
    render(<ProvidersAndModelsPage />)
    await openVisionPicker()

    expect(await screen.findByText('mystery')).toBeTruthy()
    expect(screen.getByText('能力待确认')).toBeTruthy()
  })

  it('显式不支持当前用途的模型标注说明，但不从候选排除', async () => {
    mockGetWithModels(makeProviders({}), CAP_MODELS)
    render(<ProvidersAndModelsPage />)
    await openVisionPicker()

    // plain-chat 声明了 chat 未声明 vision → 次级区域但仍在列表
    expect(await screen.findByText('plain-chat')).toBeTruthy()
    expect(screen.getByText('未声明当前用途')).toBeTruthy()
  })

  it('能力未知（次级）模型可以选中并保存读回成功', async () => {
    mockGetWithModels(makeProviders({}), CAP_MODELS)
    vi.mocked(http.put).mockResolvedValue({ data: {} })
    render(<ProvidersAndModelsPage />)
    await openVisionPicker()

    fireEvent.click(await screen.findByText('mystery'))
    // 保存后读回 vision=mystery
    mockGetWithModels(makeProviders({ vision: 'mystery' }), CAP_MODELS)
    fireEvent.click(screen.getByText('确认'))

    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalled()
    })
    expect(http.put).toHaveBeenCalledWith('/providers/openai', {
      default_models: { vision: 'mystery' },
    })
  })

  it('capabilities token 全部不可识别时视为能力未知，不误报不支持', async () => {
    // 上游返回的 token 不在 role 空间（如 supported_inputs: ["audio"]）
    mockGetWithModels(makeProviders({}), {
      data: { models: [{ id: 'odd-model', name: 'Odd', capabilities: ['audio'] }] },
    })
    render(<ProvidersAndModelsPage />)
    await openVisionPicker()

    expect(await screen.findByText('odd-model')).toBeTruthy()
    expect(screen.getByText('能力待确认')).toBeTruthy()
    expect(screen.queryByText('未声明当前用途')).toBeNull()
  })

  it('提供商搜索过滤供应商下拉项', async () => {
    const twoProviders = {
      data: [
        { id: 'openai', name: 'OpenAI', kind: 'openai', enabled: true, capabilities: ['chat'], default_models: {} },
        { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', enabled: true, capabilities: ['chat'], default_models: {} },
      ],
      default_provider_for_chat: '',
      default_provider_for_vision: '',
    }
    mockGetWithModels(twoProviders, MOCK_MODELS)
    render(<ProvidersAndModelsPage />)
    fireEvent.click((await screen.findAllByText('设置'))[0])

    const providerSearch = await screen.findByPlaceholderText('搜索供应商...')
    fireEvent.change(providerSearch, { target: { value: 'anth' } })

    const options = screen.getAllByRole('option')
    const texts = options.map((o) => o.textContent)
    expect(texts.join('|')).toContain('Anthropic (anthropic)')
    expect(texts.join('|')).not.toContain('OpenAI')
  })

  it('用途筛选「支持当前用途」只显示推荐区模型', async () => {
    mockGetWithModels(makeProviders({}), CAP_MODELS)
    render(<ProvidersAndModelsPage />)
    await openVisionPicker()

    fireEvent.click(await screen.findByText('支持当前用途'))

    expect(screen.getByText('vision-pro')).toBeTruthy()
    expect(screen.queryByText('mystery')).toBeNull()
    expect(screen.queryByText('plain-chat')).toBeNull()
  })

  it('模型列表上游报错时显示可读错误态，不与「暂无模型」混淆', async () => {
    // 后端在上游失败时返回扁平的 { models: [], error: "..." }（不抛 500）
    mockGetWithModels(makeProviders({}), { models: [], error: 'upstream timeout' })
    render(<ProvidersAndModelsPage />)
    fireEvent.click((await screen.findAllByText('设置'))[0])
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'openai' } })

    expect(await screen.findByText(/模型加载失败/)).toBeTruthy()
    expect(screen.getByText(/upstream timeout/)).toBeTruthy()
    expect(screen.queryByText('该供应商暂无模型')).toBeNull()
  })

  it('Escape 关闭模型选择器并把焦点还给触发按钮', async () => {
    mockGet(makeProviders({}))
    render(<ProvidersAndModelsPage />)
    const triggers = await screen.findAllByText('设置')
    fireEvent.click(triggers[0])

    expect(await screen.findByText('选择默认对话模型')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByText('选择默认对话模型')).toBeNull()
    })
    expect(document.activeElement).toBe(triggers[0].closest('button'))
  })

  it('浮层外部 pointerdown 关闭模型选择器', async () => {
    mockGet(makeProviders({}))
    render(<ProvidersAndModelsPage />)
    fireEvent.click((await screen.findAllByText('设置'))[0])

    expect(await screen.findByText('选择默认对话模型')).toBeTruthy()
    fireEvent.pointerDown(document.body)

    await waitFor(() => {
      expect(screen.queryByText('选择默认对话模型')).toBeNull()
    })
  })
})

describe('S3: 页面结构重组', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('页面不再出现独立“模型管理”区块', async () => {
    mockGet(makeProviders())
    render(<ProvidersAndModelsPage />)
    await waitFor(() => {
      expect(screen.getByText('默认模型')).toBeTruthy()
    })
    // “模型管理”标题不应存在
    expect(screen.queryByText('模型管理')).toBeNull()
  })

  it('模型选择器支持搜索过滤', async () => {
    mockGet(makeProviders({}))
    render(<ProvidersAndModelsPage />)
    fireEvent.click((await screen.findAllByText('设置'))[0])
    const providerSelect = await screen.findByRole('combobox')
    fireEvent.change(providerSelect, { target: { value: 'openai' } })

    // 搜索框存在
    const searchInput = await screen.findByPlaceholderText('搜索模型...')
    expect(searchInput).toBeTruthy()

    // 搜索 "vision" 只留下 gpt-4-vision
    fireEvent.change(searchInput, { target: { value: 'vision' } })
    expect(screen.getByText('gpt-4-vision')).toBeTruthy()
    expect(screen.queryByText('gpt-3.5-turbo')).toBeNull()
  })
})
