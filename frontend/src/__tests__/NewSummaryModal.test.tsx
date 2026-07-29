import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NewSummaryModal } from '@/components/NewSummaryModal'

const storeMocks = vi.hoisted(() => ({
  fetchProviders: vi.fn(),
  setConfig: vi.fn(),
  providerState: {
    providers: [] as Array<{
      id: string
      name: string
      enabled: boolean
      capabilities: string[]
      default_models?: Record<string, string>
    }>,
    providerModels: {} as Record<string, Array<{ id: string; name: string }>>,
    modelsLoading: {} as Record<string, boolean>,
  },
}))

const templateMocks = vi.hoisted(() => ({
  fetchTemplates: vi.fn(),
}))

const taskDefaultsMocks = vi.hoisted(() => ({
  getTaskDefaults: vi.fn(),
}))

vi.mock('@/services/taskDefaults', () => ({
  getTaskDefaults: taskDefaultsMocks.getTaskDefaults,
}))

vi.mock('@/services/templates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/templates')>()
  return { ...actual, fetchTemplates: templateMocks.fetchTemplates }
})

vi.mock('@/store/providerStore', () => ({
  useProviderStore: (selector: (state: unknown) => unknown) => selector({
    ...storeMocks.providerState,
    fetchProviders: storeMocks.fetchProviders,
  }),
}))

vi.mock('@/store/configStore', () => ({
  useConfigStore: (selector: (state: unknown) => unknown) => selector({
    summaryProviderId: '',
    summaryModelId: '',
    setConfig: storeMocks.setConfig,
  }),
}))

describe('NewSummaryModal', () => {
  beforeEach(() => {
    storeMocks.providerState.providers = []
    storeMocks.providerState.providerModels = {}
    storeMocks.providerState.modelsLoading = {}
    vi.clearAllMocks()
    templateMocks.fetchTemplates.mockResolvedValue([])
    taskDefaultsMocks.getTaskDefaults.mockResolvedValue({
      summary_template: 'standard', video_frame_analysis: true, frame_interval_sec: 5,
      diarize: false, speaker_count: null, summary_language: 'zh-Hans', summary_language_custom: '',
    })
  })

  it('defaultTemplate late arrival does not overwrite manual template choice', () => {
    const onSubmit = vi.fn()
    const { rerender } = render(
      <NewSummaryModal creating={false} onSubmit={onSubmit} onClose={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /精简摘要/ }))
    rerender(
      <NewSummaryModal
        creating={false}
        defaultTemplate="tool_recommendation"
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('生成'))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      template: 'concise',
    }))
  })

  it('auto-selects an available configured chat provider and model', async () => {
    storeMocks.providerState.providers = [{
      id: 'openai_compatible-siliconflow',
      name: 'SiliconFlow',
      enabled: true,
      capabilities: ['chat'],
      default_models: { chat: 'Qwen/Qwen3-8B' },
    }]
    storeMocks.providerState.providerModels = {
      'openai_compatible-siliconflow': [{ id: 'Qwen/Qwen3-8B', name: 'Qwen/Qwen3-8B' }],
    }

    const onSubmit = vi.fn()
    render(<NewSummaryModal creating={false} onSubmit={onSubmit} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getAllByRole('combobox')[1]).toHaveProperty('value', 'openai_compatible-siliconflow')
      expect(screen.getAllByRole('combobox')[2]).toHaveProperty('value', 'Qwen/Qwen3-8B')
    })
    fireEvent.click(screen.getByText('生成'))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'openai_compatible-siliconflow',
      model: 'Qwen/Qwen3-8B',
    }))
  })

  it('使用全局默认语言，并允许仅覆盖本次总结', async () => {
    taskDefaultsMocks.getTaskDefaults.mockResolvedValue({
      summary_template: 'standard', video_frame_analysis: true, frame_interval_sec: 5,
      diarize: false, speaker_count: null, summary_language: 'en', summary_language_custom: '',
    })
    const onSubmit = vi.fn()
    render(<NewSummaryModal creating={false} onSubmit={onSubmit} onClose={vi.fn()} />)
    expect(await screen.findByLabelText('本次总结语言')).toHaveProperty('value', 'en')
    fireEvent.change(screen.getByLabelText('本次总结语言'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('本次自定义语言标签'), { target: { value: 'fr-CA' } })
    fireEvent.click(screen.getByText('生成'))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      summaryLanguage: 'custom', summaryLanguageCustom: 'fr-CA',
    }))
  })

  it('音频默认使用普通总结，勾选后才显示区分说话人的专属方式', () => {
    const onSubmit = vi.fn()
    render(
      <NewSummaryModal
        creating={false}
        allowSpeakerAware
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByText('区分说话人的总结方式')).toBeNull()
    expect(screen.getByText('常用模板')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '区分说话人' }))
    expect(screen.getByText('区分说话人的总结方式')).toBeTruthy()
    expect(screen.getByRole('button', { name: /咨询师录音版本详细总结/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /咨询师录音版会议纪要\/客户声音/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^会议纪要逐人立场/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /线下采访/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /客户接待/ })).toBeTruthy()
    expect(screen.queryByText('更多模板：')).toBeNull()
    fireEvent.click(screen.getByText('生成'))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      summaryMode: 'speaker_aware',
      template: 'speaker_consultant_detailed',
    }))
  })

  it('音频新建总结从 style_audio 加载设置中的风格模板', async () => {
    render(
      <NewSummaryModal
        creating={false}
        allowSpeakerAware
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(templateMocks.fetchTemplates).toHaveBeenCalledWith('style_audio')
    })
  })

  it('没有说话人识别结果时禁用区分说话人并提示重新分析', () => {
    render(
      <NewSummaryModal
        creating={false}
        allowSpeakerAware
        speakerAwareAvailable={false}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('checkbox', { name: '区分说话人' })).toHaveProperty('disabled', true)
    expect(screen.getByText('请重新分析并开启“区分说话人”')).toBeTruthy()
    expect(screen.getByRole('button', { name: '生成' })).toHaveProperty('disabled', false)
  })
})
