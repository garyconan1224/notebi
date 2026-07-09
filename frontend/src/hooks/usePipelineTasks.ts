import { useEffect, useRef, useCallback } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { http } from '@/services/client'
import { isTaskTerminal } from '@/types/task'
import type { TaskRecord } from '@/types/task'
import { toast } from 'sonner'

interface UsePipelineTasksOptions {
  projectId?: string
  pollInterval?: number // 毫秒，默认 3000
  enabled?: boolean
  limit?: number
  includeLogs?: boolean
  includeResult?: boolean
}

/**
 * Hook：轮询后端任务列表，实时更新 Zustand store
 *
 * 使用场景：任务中心 (TaskDashboard) 中轮询所有任务
 * SSE 细粒度日志推送由 TaskLogViewer 单独处理
 */
export const usePipelineTasks = (options: UsePipelineTasksOptions = {}) => {
  const {
    projectId,
    pollInterval = 3000,
    enabled = true,
    limit = 50,
    includeLogs = false,
    includeResult = false,
  } = options

  const { setTasks, updateTask, setIsPolling } = useTaskStore()
  const tasks = useTaskStore((s) => s.tasks)

  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const perTaskIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 用 ref 保存最新 tasks，避免 setInterval 闭包过时引用
  const tasksRef = useRef<TaskRecord[]>(tasks)
  const isFirstRunRef = useRef(true)
  const fetchFailedRef = useRef(false)

  // 同步最新 tasks 到 ref，避免 setInterval 捕获过时闭包
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  // 单次批量拉取全列表（初始加载 + 周期性全量刷新）
  const fetchTasks = useCallback(async () => {
    try {
      const url = '/pipeline/tasks'
      const params: Record<string, string | boolean | number> = {
        include_logs: includeLogs,
        include_result: includeResult,
        limit,
      }
      if (projectId) params.project_id = projectId
      // 后端 list_tasks 直接返回裸数组 [...], 不是 { data: [...] } 包装格式
      const resp = await http.get<TaskRecord[] | { data: TaskRecord[] }>(url, { params })

      const raw = resp.data
      // 兼容后端直接返回数组或 { data: [...] } 两种结构
      const taskList: TaskRecord[] = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { data: TaskRecord[] })?.data)
          ? (raw as { data: TaskRecord[] }).data
          : []

      console.log('[usePipelineTasks] 拉取的任务数据:', taskList)
      setTasks(taskList)
      isFirstRunRef.current = false
      fetchFailedRef.current = false
    } catch (error) {
      console.error('Failed to fetch pipeline tasks:', error)
      // 仅在首次加载失败或错误状态切换时 toast（轮询每 3s 一次，不能刷屏）
      if (isFirstRunRef.current || !fetchFailedRef.current) {
        toast.error('加载任务列表失败，请检查网络或后端状态')
        fetchFailedRef.current = true
      }
      isFirstRunRef.current = false
    }
  }, [projectId, setTasks, limit, includeLogs, includeResult])

  // ── Per-task 精准轮询：仅对非终结状态任务调用 GET /pipeline/tasks/{task_id} ──
  useEffect(() => {
    if (!enabled) {
      if (perTaskIntervalRef.current) {
        clearInterval(perTaskIntervalRef.current)
        perTaskIntervalRef.current = null
      }
      return
    }

    // 存储每轮正在飞行的 AbortController，组件卸载时统一 abort
    let inFlightControllers: AbortController[] = []

    const pollActiveTasks = async () => {
      // 从 ref 取最新任务列表，过滤出非终结状态任务
      const activeTasks = tasksRef.current.filter(
        (t) => !isTaskTerminal(t.status)
      )

      // 没有活跃任务时跳过本轮
      if (activeTasks.length === 0) return

      // 为本轮所有请求创建独立的 AbortController
      const controllers = activeTasks.map(() => new AbortController())
      inFlightControllers = controllers

      // 并发请求所有活跃任务的最新状态
      await Promise.allSettled(
        activeTasks.map(async (task, idx) => {
          try {
            const resp = await http.get<TaskRecord | { data: TaskRecord }>(
              `/pipeline/tasks/${task.task_id}`,
              { signal: controllers[idx].signal }
            )

            // 兼容直接返回 TaskRecord 或 { data: TaskRecord } 两种格式
            const raw = resp.data
            const updated: TaskRecord =
              raw && typeof raw === 'object' && 'task_id' in raw
                ? (raw as TaskRecord)
                : (raw as { data: TaskRecord }).data

            // 用 updateTask 精准更新 store，不覆盖其他任务
            updateTask(updated.task_id, updated)
          } catch (err: unknown) {
            // 请求被主动取消（组件卸载）时静默忽略
            if (err instanceof Error && err.name === 'CanceledError') return
            console.error(`[useTaskPolling] 任务 ${task.task_id} 轮询失败:`, err)
          }
        })
      )

      inFlightControllers = []
    }

    // 启动 per-task 轮询定时器
    perTaskIntervalRef.current = setInterval(pollActiveTasks, pollInterval)

    return () => {
      // 清除定时器
      if (perTaskIntervalRef.current) {
        clearInterval(perTaskIntervalRef.current)
        perTaskIntervalRef.current = null
      }
      // 取消所有飞行中的请求，防止内存泄漏与竞态条件
      inFlightControllers.forEach((ctrl) => ctrl.abort())
      inFlightControllers = []
    }
  }, [enabled, pollInterval, updateTask])

  // ── 启动/停止全量批量轮询 ──
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setIsPolling(false)
      return
    }

    // 立即执行一次
    fetchTasks()
    setIsPolling(true)

    // 然后启动定时轮询
    intervalRef.current = setInterval(fetchTasks, pollInterval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setIsPolling(false)
    }
  }, [enabled, pollInterval, fetchTasks, setIsPolling])

  return { fetchTasks }
}
