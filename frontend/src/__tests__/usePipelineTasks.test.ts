import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// vi.mock 会被 hoist 到文件顶部，用 vi.hoisted 声明共享 mock 引用
const { getMock } = vi.hoisted(() => ({ getMock: vi.fn(() => Promise.resolve({ data: [] })) }))
vi.mock('@/services/client', () => ({
  http: { get: getMock },
}))

import { usePipelineTasks } from '@/hooks/usePipelineTasks'
import { useTaskStore } from '@/store/taskStore'

describe('usePipelineTasks smoke tests', () => {
  beforeEach(() => {
    getMock.mockClear()
    useTaskStore.setState({ tasks: [], currentTaskId: null, isPolling: false })
  })

  it('enabled:false 时不发起请求', async () => {
    renderHook(() => usePipelineTasks({ enabled: false }))
    // 给潜在的 effect 一个 tick
    await Promise.resolve()
    expect(getMock).not.toHaveBeenCalled()
  })

  it('返回的 fetchTasks 是函数', () => {
    const { result } = renderHook(() => usePipelineTasks({ enabled: false }))
    expect(typeof result.current.fetchTasks).toBe('function')
  })
})

