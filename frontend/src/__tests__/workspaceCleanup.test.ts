import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(() => Promise.resolve({ data: {
    note_count: 1,
    replica_count: 2,
    note_items: 3,
    replica_items: 4,
  } })),
  postMock: vi.fn(() => Promise.resolve({ data: {
    kind: 'replica',
    mode: 'trash',
    count: 2,
    workspace_ids: ['replica-1', 'replica-2'],
  } })),
}))

vi.mock('@/services/client', () => ({
  http: { get: getMock, post: postMock },
}))

import {
  cleanupWorkspacesByKind,
  getWorkspaceKindSummary,
} from '@/services/workspaces'

describe('workspace cleanup services', () => {
  beforeEach(() => {
    getMock.mockClear()
    postMock.mockClear()
  })

  it('reads workspace kind summary from the static endpoint', async () => {
    const result = await getWorkspaceKindSummary()

    expect(getMock).toHaveBeenCalledWith('/workspaces/kind-summary')
    expect(result.replica_count).toBe(2)
  })

  it('only sends replica trash cleanup requests', async () => {
    const result = await cleanupWorkspacesByKind('replica')

    expect(postMock).toHaveBeenCalledWith('/workspaces/cleanup-by-kind', {
      kind: 'replica',
      mode: 'trash',
    })
    expect(result.workspace_ids).toEqual(['replica-1', 'replica-2'])
  })
})
