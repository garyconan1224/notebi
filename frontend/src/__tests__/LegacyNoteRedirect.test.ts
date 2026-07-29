import { describe, expect, it } from 'vitest'

import { legacyDetailRedirect } from '@/router'

describe('legacy result detail redirects', () => {
  it('converges every legacy detail URL on NoteShell while preserving deep-link query', () => {
    const response = legacyDetailRedirect({
      params: { workspaceId: 'ws-1', itemId: 'item-1' },
      request: new Request('http://localhost/workspaces/ws-1/items/item-1/video_detail?start_ms=12000&field=transcript'),
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(
      '/workspaces/ws-1/items/item-1/note?start_ms=12000&field=transcript',
    )
  })
})
