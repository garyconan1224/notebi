import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RecentTasks } from '@/pages/WorkbenchPage/RecentTasks'
import type { TaskRecord } from '@/types/task'

// Mock usePipelineTasks to avoid actual polling
vi.mock('@/hooks/usePipelineTasks', () => ({
  usePipelineTasks: vi.fn(),
}))

// Mock taskStore
vi.mock('@/store/taskStore', () => ({
  useTaskStore: vi.fn(() => []),
}))

const makeTask = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  task_id: 't-001',
  project_id: 'p-001',
  task_type: 'video',
  payload: { url: 'https://example.com/video.mp4' },
  status: 'SUCCESS',
  progress: 1,
  log: [],
  result: {},
  error: '',
  retry_of: '',
  cancel_requested: false,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  ...overrides,
})

describe('RecentTasks crash prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('result.summary 为完整 ItemSummary 对象时不抛异常', () => {
    const summaryObject = {
      summary_id: 's-1',
      template: 'standard',
      version: 0,
      summary_mode: 'general',
      name: '测试总结',
      background_for_summary: '',
      content_md: '# 总结内容',
      model_used: 'test-model',
      coverage: 0.95,
      created_at: '2026-07-01T00:00:00Z',
    }
    const task = makeTask({
      task_id: 't-summary-obj',
      task_type: 'summary',
      result: { summary: summaryObject },
    })

    expect(() => {
      render(
        <MemoryRouter>
          <RecentTasks tasks={[task]} />
        </MemoryRouter>,
      )
    }).not.toThrow()
  })

  it('task_type=summary 不生成最近任务卡', () => {
    const summaryTask = makeTask({
      task_id: 't-summary',
      task_type: 'summary',
      result: { video_title: '总结任务', summary: '总结内容' },
    })
    const normalTask = makeTask({
      task_id: 't-normal',
      task_type: 'video',
      result: { video_title: '普通任务', note_summary: '普通摘要' },
    })

    render(
      <MemoryRouter>
        <RecentTasks tasks={[summaryTask, normalTask]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('普通任务')).toBeTruthy()
    expect(screen.queryByText('总结任务')).toBeNull()
  })

  it('普通 note/audio/video/text 任务的字符串摘要仍正常显示', () => {
    const tasks = [
      makeTask({ task_id: 't-video', task_type: 'video', result: { video_title: '视频', note_summary: '视频摘要' } }),
      makeTask({ task_id: 't-audio', task_type: 'audio', result: { video_title: '音频', summary: '音频摘要' } }),
      makeTask({ task_id: 't-text', task_type: 'text', result: { video_title: '文本', description: '文本描述' } }),
    ]

    render(
      <MemoryRouter>
        <RecentTasks tasks={tasks} />
      </MemoryRouter>,
    )

    expect(screen.getByText('视频摘要')).toBeTruthy()
    expect(screen.getByText('音频摘要')).toBeTruthy()
    expect(screen.getByText('文本描述')).toBeTruthy()
  })

  it('description、note_summary 为非字符串异常值时也不把对象交给 React', () => {
    const task = makeTask({
      task_id: 't-bad',
      task_type: 'video',
      result: {
        video_title: '异常任务',
        note_summary: { nested: 'object' },
        description: ['array', 'value'],
      },
    })

    expect(() => {
      render(
        <MemoryRouter>
          <RecentTasks tasks={[task]} />
        </MemoryRouter>,
      )
    }).not.toThrow()

    // 标题仍应显示
    expect(screen.getByText('异常任务')).toBeTruthy()
  })
})
