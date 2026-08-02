import { describe, expect, it } from 'vitest'

import { getAvailableTranscriberTypes, getDeviceOptions } from '@/services/transcriber'

describe('ASR hardware strategy controls', () => {
  it('把自动策略作为默认选项', () => {
    expect(getAvailableTranscriberTypes()[0]).toMatchObject({ value: 'auto' })
  })

  it('fast-whisper 暴露 auto/CPU/CUDA，并按真实探测禁用 CUDA', () => {
    const withCuda = getDeviceOptions('fast-whisper', { cuda_devices: 2 })
    expect(withCuda).toEqual([
      { value: 'auto', label: '自动（按当前硬件推荐）', disabled: false },
      { value: 'cpu', label: 'CPU', disabled: false },
      { value: 'cuda', label: 'NVIDIA CUDA', disabled: false },
    ])

    const withoutCuda = getDeviceOptions('fast-whisper', { cuda_devices: 0 })
    expect(withoutCuda.find((o) => o.value === 'cuda')).toEqual({
      value: 'cuda',
      label: 'NVIDIA CUDA',
      disabled: true,
    })
    expect(withoutCuda.find((o) => o.value === 'cpu')).toMatchObject({ disabled: false })
  })

  it('mlx-whisper / auto / groq 不暴露通用设备选择器', () => {
    // MLX 的 Metal 设备由框架自动管理；auto 跟随硬件策略；groq 在云端转写。
    expect(getDeviceOptions('mlx-whisper', { cuda_devices: 0 })).toEqual([])
    expect(getDeviceOptions('auto', { cuda_devices: 1 })).toEqual([])
    expect(getDeviceOptions('groq', { cuda_devices: 0 })).toEqual([])
  })
})
