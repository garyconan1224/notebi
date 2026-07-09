import { beforeEach, describe, expect, it, vi } from 'vitest'

const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn(() => Promise.resolve({ data: { status: 'accepted', task_id: 'task-1' } })),
}))

vi.mock('@/services/client', () => ({
  http: { post: postMock },
}))

import { createNoteTask } from '@/services/pipeline'
import { featuresToSteps } from '@/lib/featuresToSteps'

describe('createNoteTask', () => {
  beforeEach(() => {
    postMock.mockClear()
  })

  it('把 workspace_id 同步写入 project_id 和 payload', async () => {
    await createNoteTask({
      url: 'https://example.com/video',
      material_type: 'video',
      enabled_features: ['video_summary', 'subtitle_export'],
      background: { topic: 'Phase R' },
      workspace_id: 'workspace-1',
    })

    expect(postMock).toHaveBeenCalledWith('/pipeline/tasks', {
      project_id: 'workspace-1',
      task_type: 'note',
      payload: {
        url: 'https://example.com/video',
        material_type: 'video',
        enabled_features: ['video_summary', 'subtitle_export'],
        background: { topic: 'Phase R' },
        workspace_id: 'workspace-1',
      },
      steps: ['download', 'transcribe', 'analyze', 'note'],
    })
  })
})

describe('featuresToSteps', () => {
  it('视觉分析不触发转写，字幕/转写类 feature 触发转写', () => {
    expect(featuresToSteps('video', ['visual_analysis'])).toEqual(['download', 'analyze', 'note'])
    expect(featuresToSteps('video', ['subtitle_export'])).toEqual(['download', 'transcribe', 'analyze', 'note'])
  })
})
