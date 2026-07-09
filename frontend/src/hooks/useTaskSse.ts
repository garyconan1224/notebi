import { useEffect, useRef } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { isTaskTerminal } from '@/types/task'
import type { TaskRecord } from '@/types/task'
import { toast } from 'sonner'

const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URL ?? 'http://127.0.0.1:8000'

/**
 * SSE 事件 payload 形状（与后端 `/pipeline/tasks/{id}/events` 对齐）。
 *
 * 后端三类事件：
 * - `{type:'task', task: TaskRecord}` — 状态/进度变化时下发
 * - `{type:'log',  entry: string}` — 新增日志行
 * - `{type:'error', message: string}` — 任务不存在等错误
 *
 * 另外有 SSE 注释行 `: heartbeat\n\n` 作为 30s 心跳，EventSource 自动忽略。
 */
interface SseTaskEvent {
  type: 'task' | 'log' | 'error'
  task?: TaskRecord
  entry?: string
  message?: string
}

/**
 * 订阅单个活跃任务的 SSE 事件流，实时同步进度到 zustand store。
 *
 * 设计要点（Phase 1F）：
 * - 仅在 `active=true && taskId` 时订阅；任务到达终结态自动断开。
 * - 复用 `taskStore.updateTask` 做精准更新，不影响其它任务。
 * - EventSource 自带 2-6s 退避重连，组件卸载时主动 close。
 * - 进度推进的"权威源"切换为 SSE；现有 `usePipelineTasks` 的 3s 轮询保留为兜底。
 *
 * @param taskId 任务 ID（undefined 时不订阅）
 * @param active 任务是否处于活跃态（非终结）；终结后建议传 false 以提前断开
 */
export function useTaskSse(taskId: string | undefined, active: boolean): void {
  const updateTask = useTaskStore((s) => s.updateTask)
  const sourceRef = useRef<EventSource | null>(null)
  const connErrorToastedRef = useRef(false)

  useEffect(() => {
    // 清理上一轮订阅
    if (sourceRef.current) {
      sourceRef.current.close()
      sourceRef.current = null
    }

    if (!active || !taskId) return

    const url = `${BASE_URL}/pipeline/tasks/${taskId}/events`
    const es = new EventSource(url)
    sourceRef.current = es

    es.addEventListener('message', (evt: MessageEvent) => {
      let payload: SseTaskEvent
      try {
        payload = JSON.parse(evt.data) as SseTaskEvent
      } catch (err) {
        console.warn('[useTaskSse] failed to parse SSE payload:', err, evt.data)
        return
      }

      if (payload.type === 'task' && payload.task) {
        updateTask(payload.task.task_id, payload.task)
        // 任务终结后主动断开，避免后端循环空转 + 前端持有死连接
        if (isTaskTerminal(payload.task.status)) {
          es.close()
          sourceRef.current = null
        }
      } else if (payload.type === 'error') {
        // 任务不存在（可能被删除）：断开
        console.warn('[useTaskSse] task error:', payload.message)
        es.close()
        sourceRef.current = null
      }
      // 'log' 事件由 TaskLogViewer 单独订阅消费，这里不重复处理
    })

    es.addEventListener('error', () => {
      // EventSource 会自动重连，只在首次断连时 toast 一次（防刷屏）
      if (!connErrorToastedRef.current) {
        toast.error('任务进度连接中断，正在自动重连...')
        connErrorToastedRef.current = true
      }
      console.warn(`[useTaskSse] connection error for ${taskId}, auto-reconnecting`)
    })

    return () => {
      es.close()
      sourceRef.current = null
    }
  }, [taskId, active, updateTask])
}
