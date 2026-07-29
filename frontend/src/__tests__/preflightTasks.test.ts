import { describe, expect, it } from 'vitest'

import { getTopLevelTasks, normalizeTasksShape } from '@/lib/preflightTasks'

describe('preflightTasks retired music analysis', () => {
  it('does not offer music analysis for video notes', () => {
    const ids = getTopLevelTasks('video').map((task) => task.id)

    expect(ids).not.toContain('music_analysis')
  })

  it('drops legacy music analysis settings when normalizing video tasks', () => {
    const normalized = normalizeTasksShape(
      {
        summary: { enabled: true },
        music_analysis: {
          enabled: true,
          suno_format: true,
          udio_format: true,
        },
      },
      'video',
    )

    expect(normalized).not.toHaveProperty('music_analysis')
    expect(normalized).toHaveProperty('summary')
  })
})
