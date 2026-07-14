import { describe, expect, it } from 'vitest'

import { getStatusText, isTaskTerminal, TaskStatus } from '@/types/task'

describe('PARTIAL task status', () => {
  it('是可展示的终态', () => {
    expect(TaskStatus.PARTIAL).toBe('PARTIAL')
    expect(isTaskTerminal(TaskStatus.PARTIAL)).toBe(true)
    expect(getStatusText(TaskStatus.PARTIAL)).toBe('部分完成')
  })
})
