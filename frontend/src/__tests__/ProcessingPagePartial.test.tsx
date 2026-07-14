import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProcessingPage from '@/pages/result/ProcessingPage'
import type { TaskRecord } from '@/types/task'

const { retryTask, taskState } = vi.hoisted(() => ({
  retryTask: vi.fn(),
  taskState: { task: null as TaskRecord | null },
}))

vi.mock('@/store/taskStore', () => {
  const state = {
    getTask: () => taskState.task ?? undefined,
    tasks: [] as TaskRecord[],
    addTask: vi.fn(),
    updateTask: vi.fn(),
    cancelTask: vi.fn(),
    retryTask,
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

const partialTask: TaskRecord = {
  task_id: 'audio-partial',
  project_id: 'ws-1',
  task_type: 'audio',
  payload: {
    source: '/tmp/interview.m4a',
    source_type: 'local',
    workspace_id: 'ws-1',
    item_id: 'item-1',
    summary_mode: 'speaker_aware',
  },
  status: 'PARTIAL',
  progress: 1,
  log: [],
  result: {
    project_id: 'ws-1',
    transcript: '转录已完成',
    audio: { title: '访谈', filename: 'interview.m4a', duration_sec: 120 },
    partial_failure: {
      stage: 'diarization',
      code: 'inference_failed',
      message: '说话人模型加载失败',
    },
  },
  error: '说话人模型加载失败',
  retry_of: '',
  cancel_requested: false,
  created_at: '2026-07-13T00:00:00Z',
  updated_at: '2026-07-13T00:10:00Z',
}

describe('ProcessingPage partial audio', () => {
  beforeEach(() => {
    taskState.task = partialTask
    retryTask.mockReset()
  })

  it('保留可查看结果，并只重试说话人分析', async () => {
    render(
      <MemoryRouter initialEntries={['/processing/audio-partial']}>
        <Routes>
          <Route path="/processing/:taskId" element={<ProcessingPage />} />
          <Route path="/workspaces/:workspaceId/items/:itemId/note" element={<div>结果路由</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('部分完成')).toBeTruthy()
    expect(screen.getByText('转录和字幕已经保留')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()

    const viewButtons = screen.getAllByRole('button', { name: /查看结果/ })
    expect((viewButtons[0] as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '仅重试说话人分析' }))
    await waitFor(() => {
      expect(retryTask).toHaveBeenCalledWith('audio-partial', { stage: 'diarization' })
    })
  })
})
