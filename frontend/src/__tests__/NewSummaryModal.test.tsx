import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NewSummaryModal } from '@/components/NewSummaryModal'

const storeMocks = vi.hoisted(() => ({
  fetchProviders: vi.fn(),
  setConfig: vi.fn(),
}))

vi.mock('@/store/providerStore', () => ({
  useProviderStore: (selector: (state: unknown) => unknown) => selector({
    providers: [],
    providerModels: {},
    modelsLoading: {},
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
})
