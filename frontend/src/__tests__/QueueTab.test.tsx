import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { QueueTab } from '@/pages/WorkspacePage/TaskboardPage/QueueTab'
import { useTaskStore } from '@/store/taskStore'
import type { TaskRecord } from '@/types/task'

function makeTask(task_id: string, project_id: string, name: string): TaskRecord {
  return {
    task_id,
    project_id,
    task_type: 'note',
    payload: { name },
    status: 'PENDING',
    progress: 0,
    log: [],
    result: {},
    error: '',
    retry_of: '',
    cancel_requested: false,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }
}

describe('QueueTab', () => {
  beforeEach(() => {
    useTaskStore.setState({
      tasks: [],
      currentTaskId: null,
      isPolling: false,
    })
  })

  it('只显示当前 workspace 的任务', () => {
    useTaskStore.setState({
      tasks: [
        makeTask('task-a', 'workspace-a', 'A task'),
        makeTask('task-b', 'workspace-b', 'B task'),
      ],
    })

    render(
      <MemoryRouter>
        <QueueTab workspaceId="workspace-a" />
      </MemoryRouter>,
    )

    expect(screen.getByText('A task')).toBeTruthy()
    expect(screen.queryByText('B task')).toBeNull()
  })
})
