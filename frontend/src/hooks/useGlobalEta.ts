import { useEffect, useRef, useState } from 'react'
import { useTaskStore } from '@/store/taskStore'
import { isTaskTerminal } from '@/types/task'

/** 进度样本：进度值 + 时间戳（ms） */
interface ProgressSample {
  p: number
  t: number
}

const WINDOW_SIZE = 5 // 每个任务保留的进度样本数
const SMOOTHING = 0.3 // ETA 平滑系数（EMA）：越大越跟手但越抖，越小越平滑但越滞后

/**
 * 计算下一个 ETA 显示值（纯函数，便于单测）。
 *
 * 规则：
 * - target<=0（速率还没估出来 / 暂时丢失）：保持上一个显示值，没显示过则 -1（隐藏）。
 * - 首次（prev<0）或活跃任务集合变化（changed）：直接用 target（重新基线）。
 * - 其余：EMA 平滑跟踪 target —— display = α·target + (1-α)·prev。
 *   既不剧烈跳变（α 把 rate 抖动 / 阶段切换压平），也不会减过头到不真实的小值
 *   —— 显示值始终向真实 target 收敛，而不是无脑每秒减 1。
 */
export function nextEta(prev: number, target: number, changed: boolean): number {
  if (target <= 0) return prev > 0 ? prev : -1
  if (prev < 0 || changed) return Math.max(1, target)
  const smoothed = SMOOTHING * target + (1 - SMOOTHING) * prev
  return Math.max(1, Math.round(smoothed))
}

/**
 * 全局 ETA：所有活跃任务剩余秒数之和（秒）。无活跃任务返回 -1（不显示）。
 *
 * 设计（2026-06 简洁版重写，替换旧的双 effect 版）：
 * - 采样 effect（依赖 tasks）：进度变化时把 (progress, 时间戳) 推入每个任务的滚动窗口，
 *   并把最新 tasks 同步到 tasksRef 供定时器读取。只采样，不改显示值。
 * - 倒计时 effect（依赖 []，整个生命周期只建一次）：每秒读 ref 算 target=Σ(剩余/速率)，
 *   用 nextEta（EMA 平滑）更新显示值。
 *
 * 修掉旧版三个问题：
 * 1. 旧版两个 effect 都依赖 tasks 且都 setEta → 进度更新频繁时定时器被反复重建、
 *    「每秒减1」几乎执行不到（倒计时卡顿）。本版定时器依赖 [] 只建一次。
 * 2. 旧版 hasFreshUpdate 时不做平滑 → 阶段切换 ETA 上跳。本版 nextEta 用 EMA 平滑跟踪 target。
 * 3. 去掉旧版的阻尼系数(0.7/0.3)、stallPenalty 等魔法数（只留一个平滑系数 SMOOTHING）。
 */
export function useGlobalEta(): number {
  const tasks = useTaskStore((s) => s.tasks)
  const [eta, setEta] = useState(-1)

  const tasksRef = useRef(tasks)
  const samplesRef = useRef<Map<string, ProgressSample[]>>(new Map())
  const cachedRateRef = useRef<Map<string, number>>(new Map())
  const lastActiveKeyRef = useRef('')

  /** 滚动窗口首尾算速率（进度/秒）；样本不足时沿用缓存值 */
  function calcRate(taskId: string): number {
    const samples = samplesRef.current.get(taskId)
    if (!samples || samples.length < 2) {
      return cachedRateRef.current.get(taskId) ?? 0
    }
    const oldest = samples[0]
    const newest = samples[samples.length - 1]
    const dt = (newest.t - oldest.t) / 1000
    if (dt <= 0) return cachedRateRef.current.get(taskId) ?? 0
    const rate = (newest.p - oldest.p) / dt
    if (rate > 0) cachedRateRef.current.set(taskId, rate)
    return rate
  }

  // 采样：进度变化时推样本 + 同步最新 tasks 到 ref（不改显示值）
  useEffect(() => {
    tasksRef.current = tasks
    const now = Date.now()
    for (const t of tasks) {
      if (isTaskTerminal(t.status) || t.progress <= 0 || t.progress >= 1) continue
      const samples = samplesRef.current.get(t.task_id) ?? []
      const last = samples[samples.length - 1]
      if (!last || t.progress !== last.p) {
        const merged = [...samples, { p: t.progress, t: now }]
        if (merged.length > WINDOW_SIZE) merged.splice(0, merged.length - WINDOW_SIZE)
        samplesRef.current.set(t.task_id, merged)
      }
    }
  }, [tasks])

  // 倒计时：每秒一次，整个生命周期只建一次
  useEffect(() => {
    const timer = setInterval(() => {
      const active = tasksRef.current.filter(
        (t) => !isTaskTerminal(t.status) && t.progress > 0 && t.progress < 1,
      )
      if (active.length === 0) {
        lastActiveKeyRef.current = ''
        setEta(-1)
        return
      }
      let target = 0
      for (const t of active) {
        const rate = calcRate(t.task_id)
        if (rate > 0) target += (1 - t.progress) / rate
      }
      const targetSec = Math.round(target)
      const activeKey = active
        .map((t) => t.task_id)
        .sort()
        .join(',')
      const changed = activeKey !== lastActiveKeyRef.current
      lastActiveKeyRef.current = activeKey
      setEta((prev) => nextEta(prev, targetSec, changed))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return eta
}
