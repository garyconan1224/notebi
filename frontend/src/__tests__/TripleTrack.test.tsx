import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/workspaces', () => ({}))

import { TripleTrack } from '@/pages/result/TripleTrack'

describe('TripleTrack', () => {
  it('shows visual evidence instead of a retired prompt track', () => {
    render(
      <TripleTrack
        frames={[{
          idx: 0,
          ts: '00:00',
          sec: 0,
          shot_type: 'wide',
          title: '开场',
          subtitle: '',
          description: '山间日出',
          tags: { scene: ['山'] },
        }]}
        transcript={[]}
        activeFrame={0}
        currentSec={0}
        onFrameClick={vi.fn()}
        onTranscriptClick={vi.fn()}
      />,
    )

    expect(screen.getByText('轨道 3 · 画面描述')).toBeTruthy()
    expect(screen.queryByText('轨道 3 · 提示词区间')).toBeNull()
  })
})
