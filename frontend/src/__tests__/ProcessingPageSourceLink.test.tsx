import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProcessingPage from '@/pages/result/ProcessingPage'
import type { TaskRecord } from '@/types/task'

const { taskState } = vi.hoisted(() => ({
  taskState: { task: null as TaskRecord | null },
}))

vi.mock('@/store/taskStore', () => {
  const state = {
    getTask: () => taskState.task ?? undefined,
    tasks: [] as TaskRecord[],
    addTask: vi.fn(),
    updateTask: vi.fn(),
    cancelTask: vi.fn(),
    retryTask: vi.fn(),
  }
  const useTaskStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector({
      ...state,
      tasks: taskState.task ? [taskState.task] : [],
    }),
    { getState: () => state },
  )
  return { useTaskStore }
})

vi.mock('@/hooks/useTaskSse', () => ({ useTaskSse: vi.fn() }))
vi.mock('@/hooks/useGlobalEta', () => ({ useGlobalEta: () => 0 }))
vi.mock('@/services/pipeline', () => ({
  getPipelineTask: () => Promise.resolve(taskState.task),
}))
vi.mock('@/pages/result/ProcessingPage/StepProgress', () => ({
  StepProgress: () => <div>步骤进度</div>,
}))
vi.mock('@/pages/result/ProcessingPage/LiveLog', () => ({
  LiveLog: () => <div>实时日志</div>,
}))
vi.mock('@/pages/result/NoteShell', () => ({
  default: () => <div>笔记结果</div>,
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: 'task-src',
    project_id: 'ws-1',
    task_type: 'note',
    payload: { url: 'https://www.bilibili.com/video/BV1test', workspace_id: 'ws-1', item_id: 'item-1' },
    status: 'RUNNING',
    progress: 0.3,
    log: [],
    result: {},
    error: '',
    retry_of: '',
    cancel_requested: false,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:05:00Z',
    ...overrides,
  }
}

function renderPage(task: TaskRecord) {
  taskState.task = task
  return render(
    <MemoryRouter initialEntries={[`/processing/${task.task_id}`]}>
      <Routes>
        <Route path="/processing/:taskId" element={<ProcessingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProcessingPage source link', () => {
  beforeEach(() => {
    taskState.task = null
  })

  it('有外部 URL 时显示"打开原链接"语义化链接', () => {
    renderPage(makeTask())
    const link = screen.getByText('打开原链接')
    expect(link).toBeTruthy()
    const anchor = link.closest('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe('https://www.bilibili.com/video/BV1test')
    expect(anchor!.getAttribute('target')).toBe('_blank')
    expect(anchor!.getAttribute('rel')).toContain('noreferrer')
  })

  it('不再调用剪贴板 API', () => {
    renderPage(makeTask())
    // 页面上不应有"复制链接"按钮
    expect(screen.queryByText('复制链接')).toBeNull()
  })

  it('本地文件无外链时不显示源链接', () => {
    renderPage(makeTask({
      payload: { source: '/tmp/local-video.mp4', source_type: 'local', workspace_id: 'ws-1', item_id: 'item-1' },
    }))
    expect(screen.queryByText('打开原链接')).toBeNull()
    expect(screen.queryByText('复制链接')).toBeNull()
  })

  it('封面加载失败时显示稳定占位而非空白', () => {
    const task = makeTask({
      result: { video_thumbnail_url: 'https://i0.hdslb.com/cover.jpg' },
    })
    renderPage(task)
    const img = screen.getByRole('img')
    expect(img).toBeTruthy()
    // 模拟加载失败
    img.dispatchEvent(new Event('error', { bubbles: true }))
    // 失败后应显示占位区域（不是 display:none 留空白）
    expect(img.style.display).not.toBe('none')
  })
})
