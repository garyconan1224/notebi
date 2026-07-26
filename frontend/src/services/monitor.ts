import { http } from './client'
import type { TaskRecord } from '@/types/task'

/**
 * R6-B — 部署监控数据服务。
 *
 * 只读：复用 /pipeline/tasks?include_logs=true&limit=50 与 /admin/logs。
 * 不修改任务状态，不清理服务端日志。
 */

/** /admin/logs 单条脱敏日志（与后端 LogEntry 对齐）。 */
export interface AdminLogEntry {
  id: number
  timestamp: number
  level: string
  category: string
  message: string
}

export interface AdminLogsResponse {
  entries: AdminLogEntry[]
  latest_id: number
}

/** 任务活动项：由任务日志或生命周期派生。 */
export interface ActivityItem {
  /** 唯一 key（React 用） */
  key: string
  taskId: string
  /** Unix 毫秒时间戳 */
  ts: number
  level: 'info' | 'warning' | 'error'
  text: string
  status?: string
}

export interface TaskSummaryCounts {
  queued: number
  running: number
  failed: number
  success: number
}

const TERMINAL_SUCCESS = new Set(['SUCCESS', 'PARTIAL'])

/** 复用 /pipeline/tasks?include_logs=true&limit=50。 */
export async function fetchMonitorTasks(limit = 50): Promise<TaskRecord[]> {
  const resp = await http.get<TaskRecord[] | { data: TaskRecord[] }>('/pipeline/tasks', {
    params: { include_logs: true, limit },
  })
  const raw = resp.data
  if (Array.isArray(raw)) return raw
  const wrapped = (raw as { data?: TaskRecord[] })?.data
  return Array.isArray(wrapped) ? wrapped : []
}

/** 增量拉取脱敏应用日志：只返回 ID 大于 afterId 的条目。 */
export async function fetchAdminLogs(afterId = 0, limit = 200): Promise<AdminLogsResponse> {
  const resp = await http.get<AdminLogsResponse>('/admin/logs', {
    params: { after_id: afterId, limit },
  })
  return resp.data
}

/** 统计 queued/running/failed/recent success 数量。 */
export function summarizeTasks(tasks: TaskRecord[]): TaskSummaryCounts {
  let queued = 0
  let running = 0
  let failed = 0
  let success = 0
  for (const t of tasks) {
    const status = String(t.status || '')
    if (status === 'PENDING' || status === 'AWAITING_CONFIRM') {
      queued += 1
    } else if (status === 'FAILED') {
      failed += 1
    } else if (TERMINAL_SUCCESS.has(status)) {
      success += 1
    } else if (status === 'CANCELLED') {
      // 已取消不计入四类核心指标
    } else {
      running += 1
    }
  }
  return { queued, running, failed, success }
}

function parseIsoMs(iso: string | undefined): number {
  if (!iso) return Date.now()
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : Date.now()
}

function statusText(status: string): string {
  const map: Record<string, string> = {
    SUCCESS: '已完成',
    PARTIAL: '部分完成',
    FAILED: '失败',
    CANCELLED: '已取消',
    PENDING: '排队中',
    AWAITING_CONFIRM: '等待确认',
  }
  return map[status] || '处理中'
}

/**
 * 由任务列表生成活动项。
 *
 * - 有日志的任务：展开其 log；
 * - 无日志的任务：从生命周期（created_at / 当前状态）生成至少一条活动项，
 *   保证「空日志任务也有活动」。
 */
export function buildActivityItems(tasks: TaskRecord[]): ActivityItem[] {
  const items: ActivityItem[] = []
  for (const task of tasks) {
    const logs = Array.isArray(task.log) ? task.log : []
    if (logs.length > 0) {
      for (let i = 0; i < logs.length; i += 1) {
        const entry = logs[i]
        items.push({
          key: `${task.task_id}-log-${i}`,
          taskId: task.task_id,
          ts: parseIsoMs(entry.ts),
          level: entry.level === 'error' ? 'error' : entry.level === 'warning' ? 'warning' : 'info',
          text: entry.message,
          status: task.status,
        })
      }
    } else {
      // 生命周期派生：创建 + 当前状态
      items.push({
        key: `${task.task_id}-created`,
        taskId: task.task_id,
        ts: parseIsoMs(task.created_at),
        level: 'info',
        text: `任务创建（${task.task_type || 'task'}）`,
        status: task.status,
      })
      const terminal = ['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(String(task.status))
      if (terminal) {
        items.push({
          key: `${task.task_id}-status`,
          taskId: task.task_id,
          ts: parseIsoMs(task.updated_at),
          level: task.status === 'FAILED' ? 'error' : 'info',
          text: `任务${statusText(String(task.status))}`,
          status: task.status,
        })
      }
    }
  }
  // 按时间倒序，最新在前
  items.sort((a, b) => b.ts - a.ts)
  return items
}
