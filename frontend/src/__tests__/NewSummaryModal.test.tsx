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

  it('音频允许选择区分说话人总结方式', () => {
    const onSubmit = vi.fn()
    render(
      <NewSummaryModal
        creating={false}
        allowSpeakerAware
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: '区分说话人总结' }))
    fireEvent.click(screen.getByText('生成'))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      summaryMode: 'speaker_aware',
    }))
  })
})
