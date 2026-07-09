import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'

/**
 * 表单脏检查：对比 `initial` 与 `current`，识别未保存字段 + 提供离开保护。
 *
 * 用法：
 * ```tsx
 * const guard = useDirtyGuard({ initial, current, message: t('dirty.leaveConfirm') })
 * // 页面任意 UI
 * <DirtyDot hidden={!guard.dirtyMap.groqApiKey} />
 * // 保存成功后重置基线
 * guard.commit(current)
 * ```
 *
 * 特性：
 * - `dirtyCount`：发生变更的字段数；
 * - `dirtyMap`：逐字段 boolean 索引，供 FieldRow.dirty 使用；
 * - `isDirty`：总开关；
 * - `commit(next)`：保存成功后以新值作为基线；
 * - `reset()`：丢弃草稿回到基线（调用方自行把 current 写回 initial）；
 * - 自动注册 `beforeunload` + react-router 路由阻断。
 */
export interface UseDirtyGuardOptions<T extends Record<string, unknown>> {
  /** 基线（保存态）值 */
  initial: T
  /** 当前草稿值 */
  current: T
  /** 提示文案；未传时走浏览器默认提示 */
  message?: string
  /** 是否启用（关闭时 isDirty 恒为 false） */
  enabled?: boolean
}

export interface DirtyGuardApi<T extends Record<string, unknown>> {
  isDirty: boolean
  dirtyCount: number
  dirtyMap: Record<keyof T, boolean>
  /** 保存成功后调用：以 next 作为新的基线 */
  commit: (next: T) => void
}

/** 简单深比较：只覆盖 JSON-serializable 值，设置页字段已全部命中该范围 */
function shallowOrJsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export function useDirtyGuard<T extends Record<string, unknown>>(
  opts: UseDirtyGuardOptions<T>,
): DirtyGuardApi<T> {
  const { initial, current, message, enabled = true } = opts

  // baseline 用 state 持有：commit() 后触发 re-render，useMemo 会重新对比
  const [baseline, setBaseline] = useState<T>(initial)

  // 上游 initial 引用变化时同步基线（常见于异步加载完成首次落 store）
  useEffect(() => {
    setBaseline(initial)
  }, [initial])

  const dirtyMap = useMemo(() => {
    const map = {} as Record<keyof T, boolean>
    const keys = new Set<string>([
      ...Object.keys(baseline ?? {}),
      ...Object.keys(current ?? {}),
    ])
    for (const k of keys) {
      map[k as keyof T] = !shallowOrJsonEqual(
        (baseline as Record<string, unknown>)[k],
        (current as Record<string, unknown>)[k],
      )
    }
    return map
  }, [baseline, current])

  const dirtyCount = useMemo(
    () => Object.values(dirtyMap).filter(Boolean).length,
    [dirtyMap],
  )

  const isDirty = enabled && dirtyCount > 0

  // 浏览器刷新 / 关闭标签页
  useBeforeUnload(
    useCallback(
      (e: BeforeUnloadEvent) => {
        if (!isDirty) return
        e.preventDefault()
        // 老版 Chrome 需要 returnValue 非空；新版浏览器仅读 preventDefault()
        e.returnValue = message ?? ''
      },
      [isDirty, message],
    ),
  )

  // react-router v6.4+ 路由阻断（Data Router 必须）
  const blocker = useBlocker(isDirty)
  useEffect(() => {
    if (blocker.state === 'blocked') {
      const ok = window.confirm(message ?? '有未保存的变更，确认离开吗？')
      if (ok) blocker.proceed()
      else blocker.reset()
    }
  }, [blocker, message])

  const commit = useCallback((next: T) => {
    setBaseline(next)
  }, [])

  return { isDirty, dirtyCount, dirtyMap, commit }
}

