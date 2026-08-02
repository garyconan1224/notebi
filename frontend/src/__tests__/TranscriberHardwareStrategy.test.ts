import { describe, expect, it } from 'vitest'

import { getAvailableTranscriberTypes, getDeviceOptions } from '@/services/transcriber'

describe('ASR hardware strategy controls', () => {
  it('把自动策略作为默认选项，仍保留手动 CUDA 覆盖', () => {
    expect(getAvailableTranscriberTypes()[0]).toMatchObject({ value: 'auto' })
    expect(getDeviceOptions('auto')).toEqual(expect.arrayContaining([
      { value: 'auto', label: '自动（按当前硬件推荐）' },
      { value: 'cuda', label: 'NVIDIA CUDA' },
    ]))
  })
})
