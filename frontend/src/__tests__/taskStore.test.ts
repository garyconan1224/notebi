import { beforeEach, describe, expect, it } from 'vitest'
import { useTaskStore } from '@/store/taskStore'
import type { TaskRecord } from '@/types/task'

// 构造最小 TaskRecord，保留必需字段即可
const makeTask = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  task_id: 't-001',
  project_id: 'p-001',
  task_type: 'analyze',
  payload: {},
  status: 'PENDING',
  progress: 0,
  log: [],
  result: {},
  error: '',
  retry_of: '',
  cancel_requested: false,
  created_at: '',
  updated_at: '',
  ...overrides,
})

describe('taskStore smoke tests', () => {
  beforeEach(() => {
    // 每个用例前重置 store，隔离 persist middleware 可能的残留
    useTaskStore.setState({ tasks: [], hiddenTaskIds: [], currentTaskId: null, isPolling: false })
  })

  it('初始状态 tasks 为空数组', () => {
    expect(useTaskStore.getState().tasks).toEqual([])
  })

  it('addTask 后 tasks 数组长度 +1', () => {
    const before = useTaskStore.getState().tasks.length
    useTaskStore.getState().addTask(makeTask({ task_id: 't-add-1' }))
    expect(useTaskStore.getState().tasks.length).toBe(before + 1)
  })

  it('updateTask 后对应任务的 status 更新正确', () => {
    useTaskStore.getState().addTask(makeTask({ task_id: 't-upd-1', status: 'PENDING' }))
    useTaskStore.getState().updateTask('t-upd-1', { status: 'SUCCESS' })
    const updated = useTaskStore.getState().tasks.find((t) => t.task_id === 't-upd-1')
    expect(updated?.status).toBe('SUCCESS')
  })

  it('removeTask 应从列表中删除指定任务', () => {
    useTaskStore.getState().addTask(makeTask({ task_id: 't-rm-1' }))
    useTaskStore.getState().addTask(makeTask({ task_id: 't-rm-2' }))

    useTaskStore.getState().removeTask('t-rm-1')

    expect(useTaskStore.getState().tasks.map((t) => t.task_id)).toEqual(['t-rm-2'])
    expect(useTaskStore.getState().hiddenTaskIds).toContain('t-rm-1')
  })

  it('setTasks: lite 列表（空 result/log）不洗掉本地已有的丰富字段', () => {
    useTaskStore.getState().addTask(
      makeTask({
        task_id: 't-lite',
        result: { video_title: 'foo', video_thumbnail_url: 'https://img' },
        log: [{ level: 'info', message: 'started', ts: '2026-05-27T00:00:00Z' }],
      }),
    )
    // 列表接口返回 lite 记录：result 为空对象，log 为空数组
    useTaskStore.getState().setTasks([
      makeTask({
        task_id: 't-lite',
        status: 'VLM',
        progress: 0.5,
        result: {},
        log: [],
      }),
    ])
    const t = useTaskStore.getState().getTask('t-lite')!
    expect(t.result.video_title).toBe('foo')
    expect(t.result.video_thumbnail_url).toBe('https://img')
    expect(t.log).toHaveLength(1)
    // 但 status / progress 应以 incoming 为准
    expect(t.status).toBe('VLM')
    expect(t.progress).toBe(0.5)
  })

  it('setTasks: rich 列表（非空 result/log）会覆盖本地旧值', () => {
    useTaskStore.getState().addTask(
      makeTask({
        task_id: 't-rich',
        result: { video_title: 'old' },
        log: [{ level: 'info', message: 'old-log', ts: '2026-05-27T00:00:00Z' }],
      }),
    )
    useTaskStore.getState().setTasks([
      makeTask({
        task_id: 't-rich',
        result: { video_title: 'new' },
        log: [{ level: 'info', message: 'new-log', ts: '2026-05-27T01:00:00Z' }],
      }),
    ])
    const t = useTaskStore.getState().getTask('t-rich')!
    expect(t.result.video_title).toBe('new')
    expect(t.log).toHaveLength(1)
    expect(t.log[0].message).toBe('new-log')
  })

  it('setTasks: incoming 无 result 字段时也保留本地已有 result', () => {
    useTaskStore.getState().addTask(
      makeTask({
        task_id: 't-nofield',
        result: { video_title: 'keep-me' },
        log: [{ level: 'info', message: 'keep', ts: '2026-05-27T00:00:00Z' }],
      }),
    )
    // 构造一条没有 result / log 字段的 incoming 记录
    const lite: Partial<TaskRecord> = makeTask({ task_id: 't-nofield', status: 'ASR' })
    delete lite.result
    delete lite.log
    useTaskStore.getState().setTasks([lite as TaskRecord])
    const t = useTaskStore.getState().getTask('t-nofield')!
    expect(t.result.video_title).toBe('keep-me')
    expect(t.log).toHaveLength(1)
  })

  it('setTasks 不会把本地隐藏任务重新同步回来', () => {
    useTaskStore.getState().removeTask('t-hidden')
    useTaskStore.getState().setTasks([
      makeTask({ task_id: 't-hidden' }),
      makeTask({ task_id: 't-visible' }),
    ])

    expect(useTaskStore.getState().tasks.map((t) => t.task_id)).toEqual(['t-visible'])
  })

  it('updateTask: last-writer-wins-by-timestamp —— SSE 写 SUCCESS 100% 后，轮询 RUNNING 50% 被丢弃', () => {
    // 模拟 SSE 先写 SUCCESS 100%
    useTaskStore.getState().addTask(
      makeTask({
        task_id: 't-sse',
        status: 'SUCCESS',
        progress: 1.0,
        updated_at: '2026-05-27T10:00:00Z',
      }),
    )

    // 模拟轮询滞后响应 RUNNING 50%（updated_at 更早）
    useTaskStore.getState().updateTask('t-sse', {
      status: 'RUNNING',
      progress: 0.5,
      updated_at: '2026-05-27T09:00:00Z',
    })

    const t = useTaskStore.getState().getTask('t-sse')!
    expect(t.status).toBe('SUCCESS')
    expect(t.progress).toBe(1.0)
  })

  it('setTasks: last-writer-wins —— 滞后轮询不覆盖 SSE 的 SUCCESS', () => {
    // 模拟 SSE 先把 task 更新为 SUCCESS 100%（updated_at 较晚）
    useTaskStore.getState().addTask(
      makeTask({
        task_id: 't-sse-success',
        status: 'SUCCESS',
        progress: 1.0,
        updated_at: '2026-05-27T10:00:00Z',
      }),
    )

    // 模拟轮询返回旧数据（updated_at 更早，status=RUNNING）
    useTaskStore.getState().setTasks([
      makeTask({
        task_id: 't-sse-success',
        status: 'RUNNING',
        progress: 0.5,
        updated_at: '2026-05-27T09:00:00Z',
      }),
    ])

    const t = useTaskStore.getState().getTask('t-sse-success')!
    expect(t.status).toBe('SUCCESS')
    expect(t.progress).toBe(1.0)
  })

  it('updateTask: last-writer-wins-by-timestamp —— 轮询更新 updated_at 更晚时正常写入', () => {
    // 模拟 SSE 先写 RUNNING 50%
    useTaskStore.getState().addTask(
      makeTask({
        task_id: 't-poll',
        status: 'RUNNING',
        progress: 0.5,
        updated_at: '2026-05-27T10:00:00Z',
      }),
    )

    // 模拟轮询更新 updated_at 更晚，progress 更高
    useTaskStore.getState().updateTask('t-poll', {
      status: 'SUCCESS',
      progress: 1.0,
      updated_at: '2026-05-27T10:05:00Z',
    })

    const t = useTaskStore.getState().getTask('t-poll')!
    expect(t.status).toBe('SUCCESS')
    expect(t.progress).toBe(1.0)
  })
})

describe('taskStore removeTasks 精确移除（阶段 C）', () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: [], hiddenTaskIds: [], currentTaskId: null, isPolling: false })
  })

  it('removeTasks 精确移除一组 task ID，不影响同 workspace 其它素材任务', () => {
    useTaskStore.getState().addTask(makeTask({ task_id: 't-a', project_id: 'ws-1' }))
    useTaskStore.getState().addTask(makeTask({ task_id: 't-a-summary', project_id: 'ws-1' }))
    useTaskStore.getState().addTask(makeTask({ task_id: 't-b', project_id: 'ws-1' }))

    useTaskStore.getState().removeTasks(['t-a', 't-a-summary'])

    const ids = useTaskStore.getState().tasks.map((t) => t.task_id)
    expect(ids).toEqual(['t-b'])
    // 被删任务进入隐藏集合，防止飞行中的旧轮询复活
    expect(useTaskStore.getState().hiddenTaskIds).toContain('t-a')
    expect(useTaskStore.getState().hiddenTaskIds).toContain('t-a-summary')
    expect(useTaskStore.getState().hiddenTaskIds).not.toContain('t-b')
  })

  it('removeTasks 后被隐藏的 task 不会被 setTasks 重新同步回来', () => {
    useTaskStore.getState().removeTasks(['t-gone'])
    useTaskStore.getState().setTasks([
      makeTask({ task_id: 't-gone' }),
      makeTask({ task_id: 't-stay' }),
    ])

    expect(useTaskStore.getState().tasks.map((t) => t.task_id)).toEqual(['t-stay'])
  })

  it('removeTasks 空数组不改变状态', () => {
    useTaskStore.getState().addTask(makeTask({ task_id: 't-keep' }))
    const before = useTaskStore.getState().tasks.length

    useTaskStore.getState().removeTasks([])

    expect(useTaskStore.getState().tasks.length).toBe(before)
  })

  it('removeByProject 仍只用于整个 workspace 隐藏/删除场景', () => {
    useTaskStore.getState().addTask(makeTask({ task_id: 't-ws1-a', project_id: 'ws-1' }))
    useTaskStore.getState().addTask(makeTask({ task_id: 't-ws1-b', project_id: 'ws-1' }))
    useTaskStore.getState().addTask(makeTask({ task_id: 't-ws2-a', project_id: 'ws-2' }))

    useTaskStore.getState().removeByProject('ws-1')

    const ids = useTaskStore.getState().tasks.map((t) => t.task_id)
    expect(ids).toEqual(['t-ws2-a'])
  })
})
