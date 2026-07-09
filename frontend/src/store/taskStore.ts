import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TaskRecord } from '@/types/task'
import { isTaskTerminal } from '@/types/task'
import { cancelPipelineTask, retryPipelineTask } from '@/services/pipeline'
import { toast } from 'sonner'

interface TaskStoreState {
  // 状态
  tasks: TaskRecord[]
  hiddenTaskIds: string[]
  currentTaskId: string | null
  isPolling: boolean

  // 操作
  setTasks: (tasks: TaskRecord[]) => void
  addTask: (task: TaskRecord) => void
  removeTask: (taskId: string) => void
  removeByProject: (projectId: string) => void
  updateTask: (taskId: string, task: Partial<TaskRecord>) => void
  setCurrentTask: (taskId: string | null) => void
  setIsPolling: (isPolling: boolean) => void
  cancelTask: (taskId: string) => Promise<void>
  retryTask: (taskId: string) => Promise<void>

  // 便利方法
  getTask: (taskId: string) => TaskRecord | undefined
  getCurrentTask: () => TaskRecord | undefined
}

export const useTaskStore = create<TaskStoreState>()(
  persist(
    (set, get) => ({
      tasks: [],
      hiddenTaskIds: [],
      currentTaskId: null,
      isPolling: false,

      // 用后端全量列表同步 store。
      // 防御逻辑：若后端返回空数组（网络抖动/重启），保留本地仍在追踪的非终结任务，
      // 避免进行中的任务因一次空响应被清空。
      setTasks: (incoming) =>
        set((state) => {
          const hiddenIds = new Set(state.hiddenTaskIds)
          const visibleIncoming = incoming.filter((t) => !hiddenIds.has(t.task_id))
          if (incoming.length === 0) {
            // 后端返回空：仅保留本地非终结状态任务（下载中、等待中等）
            const activeLocally = state.tasks.filter((t) => !isTaskTerminal(t.status))
            return { tasks: activeLocally }
          }
          // 正常同步：以后端数据为准，同时将本地有但后端没有的非终结任务补回。
          // 列表接口 include_result=false / include_logs=false 返回的 result/log
          // 是 lite 占位（{} / []），不能洗掉本地已有的丰富字段（SSE 填进来的）。
          const existingById = new Map(state.tasks.map((t) => [t.task_id, t]))
          const mergedIncoming = visibleIncoming.map((t) => {
            const existing = existingById.get(t.task_id)
            if (!existing) return t

            // last-writer-wins：轮询数据若比本地旧，且本地状态更"前进"，保留本地
            const existingTs = new Date(existing.updated_at || 0).getTime()
            const incomingTs = new Date(t.updated_at || 0).getTime()
            if (incomingTs < existingTs) {
              // progress 不能倒退
              if (t.progress !== undefined && t.progress < (existing.progress ?? 0)) {
                return { ...existing, result: existing.result, log: existing.log }
              }
              // status 不能从 SUCCESS/FAILED 退回 RUNNING/PENDING
              const higherStatus = new Set(['SUCCESS', 'FAILED', 'CANCELLED'])
              if (higherStatus.has(existing.status) && !higherStatus.has(t.status)) {
                return { ...existing, result: existing.result, log: existing.log }
              }
            }

            return {
              ...existing,
              ...t,
              result:
                t.result && Object.keys(t.result).length > 0
                  ? t.result
                  : existing.result,
              log: t.log && t.log.length > 0 ? t.log : existing.log,
            }
          })
          const backendIds = new Set(visibleIncoming.map((t) => t.task_id))
          // 本地有、后端没有、且非终态的任务补回，避免一次空响应/SSE 抢先把刚
          // 冒头的任务洗掉。但 PENDING 任务若后端已无、且 updated_at 久远，视为
          // 僵尸（如历史 /tmp/test.mp3 的 persist 残留）丢弃——否则它永远 PENDING、
          // 后端永远没有，每次合并都被复活，任务面板永远多一个。仅保留「新鲜」
          // PENDING（覆盖刚 addTask、后端列表尚未收录的竞态窗口）。
          const FRESH_PENDING_MS = 2 * 60 * 1000
          const nowTs = Date.now()
          const localOnlyActive = state.tasks.filter((t) => {
            if (backendIds.has(t.task_id) || isTaskTerminal(t.status)) return false
            if (t.status === 'PENDING') {
              const ts = new Date(t.updated_at || 0).getTime()
              return nowTs - ts < FRESH_PENDING_MS
            }
            return false
          })
          return { tasks: [...mergedIncoming, ...localOnlyActive] }
        }),

      addTask: (task) =>
        set((state) => {
          // 如果已存在同 ID 的任务则更新，否则追加
          const existingIndex = state.tasks.findIndex((t) => t.task_id === task.task_id)
          if (existingIndex >= 0) {
            const newTasks = [...state.tasks]
            newTasks[existingIndex] = task
            return { tasks: newTasks }
          }
          return { tasks: [task, ...state.tasks] }
        }),

      removeTask: (taskId) =>
        set((state) => ({
          hiddenTaskIds: state.hiddenTaskIds.includes(taskId)
            ? state.hiddenTaskIds
            : [...state.hiddenTaskIds, taskId],
          tasks: state.tasks.filter((t) => t.task_id !== taskId),
        })),

      // 1-C：删除合集/笔记后即时清空该 project 关联的所有任务，不等 5s 轮询
      removeByProject: (projectId) =>
        set((state) => ({
          tasks: state.tasks.filter((t) => t.project_id !== projectId),
        })),

      updateTask: (taskId, updates) =>
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.task_id !== taskId) return t

            // last-writer-wins-by-timestamp：防止滞后的轮询响应覆盖 SSE 的实时更新
            const existingUpdatedAt = new Date(t.updated_at || 0).getTime()
            const incomingUpdatedAt = new Date(updates.updated_at || 0).getTime()

            // 如果传入的 updated_at 更早，且 status/progress 没"往前"走，丢弃这次写入
            if (incomingUpdatedAt < existingUpdatedAt) {
              // progress 不能倒退
              if (updates.progress !== undefined && updates.progress < (t.progress ?? 0)) {
                return t
              }
              // status 不能从 SUCCESS 退回 RUNNING
              if (updates.status === 'RUNNING' && t.status === 'SUCCESS') {
                return t
              }
            }

            return {
              ...t,
              ...updates,
              _localUpdatedAt: Date.now(),
            }
          }),
        })),

      setCurrentTask: (taskId) => set({ currentTaskId: taskId }),
      setIsPolling: (isPolling) => set({ isPolling }),

      // 调用后端 cancel 接口，并乐观地更新本地状态为 CANCELLED
      cancelTask: async (taskId) => {
        try {
          await cancelPipelineTask(taskId)
          set((state) => ({
            tasks: state.tasks.map((t) =>
              t.task_id === taskId ? { ...t, status: 'CANCELLED' } : t
            ),
          }))
        } catch (err) {
          console.error(`[taskStore] cancelTask ${taskId} failed:`, err)
          toast.error('取消任务失败，请稍后重试')
        }
      },

      // 调用后端 retry 接口，创建新的重试任务（后端返回新任务记录）
      retryTask: async (taskId) => {
        try {
          const newTask = await retryPipelineTask(taskId)
          // 将新的重试任务追加到列表
          set((state) => ({
            tasks: [newTask, ...state.tasks],
            currentTaskId: newTask.task_id, // 自动切换到新重试任务
          }))
          toast.success('任务已重新提交')
        } catch (err) {
          console.error(`[taskStore] retryTask ${taskId} failed:`, err)
          toast.error('重试失败，请稍后再试')
        }
      },

      getTask: (taskId) => {
        const tasks = get().tasks
        return tasks.find((t) => t.task_id === taskId)
      },

      getCurrentTask: () => {
        const state = get()
        if (!state.currentTaskId) return undefined
        return state.getTask(state.currentTaskId)
      },
    }),
    {
      name: 'task-storage',
      partialize: (state) => ({
        tasks: state.tasks,
        hiddenTaskIds: state.hiddenTaskIds,
      } as Pick<TaskStoreState, 'tasks' | 'hiddenTaskIds'>),
    }
  )
)
