import { describe, expect, it } from 'vitest'

import { buildTimelineTicks } from '@/pages/results/LearningNotesPage/LNVideoPanel'

describe('LNVideoPanel timeline ticks', () => {
  it('uses readable time intervals and always includes the true duration', () => {
    expect(buildTimelineTicks(600)).toEqual([
      { sec: 0, label: '00:00', position: 0 },
      { sec: 120, label: '02:00', position: 20 },
      { sec: 240, label: '04:00', position: 40 },
      { sec: 360, label: '06:00', position: 60 },
      { sec: 480, label: '08:00', position: 80 },
      { sec: 600, label: '10:00', position: 100 },
    ])
  })

  it('returns no tick marks before metadata provides a duration', () => {
    expect(buildTimelineTicks(0)).toEqual([])
  })
})
