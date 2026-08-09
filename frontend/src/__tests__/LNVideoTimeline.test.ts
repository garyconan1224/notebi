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

  it('does not duplicate the trailing tick when duration is a float (e.g. 60.000363)', () => {
    const ticks = buildTimelineTicks(60.000363)
    const labels = ticks.map((t) => t.label)
    // 循环刻度 01:00 与末尾 01:00 只保留一个
    expect(labels.filter((label) => label === '01:00')).toHaveLength(1)
    // 末尾刻度仍是真实时长（01:00）
    expect(ticks[ticks.length - 1].label).toBe('01:00')
  })

  it('keeps a distinct trailing tick when the last loop mark is far from the real duration', () => {
    const ticks = buildTimelineTicks(72)
    expect(ticks.map((t) => t.label)).toEqual(['00:00', '00:15', '00:30', '00:45', '01:00', '01:12'])
  })

  it('replaces the trailing loop mark when it sits too close to the real duration (no overlapping ticks)', () => {
    // 364s：循环末刻度 06:00(98.9%) 与真实时长 06:04(100%) 几乎重叠，
    // 应替换而不是追加，避免时间轴末端两个刻度叠在一起。
    const ticks = buildTimelineTicks(364)
    expect(ticks.map((t) => t.label)).toEqual(['00:00', '02:00', '04:00', '06:04'])
    expect(ticks[ticks.length - 1].position).toBe(100)
  })
})
