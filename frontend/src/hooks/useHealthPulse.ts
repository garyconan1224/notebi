import { useEffect, useRef, useState } from 'react'
import http from '@/services/client'

/**
 * 后端健康状态载荷（与 /health 冻结契约对齐）。
 */
export interface HealthPulseData {
  status: string
  version: string
  uptime_sec: number
}

export interface HealthPulseState {
  /** 最近一次握手是否成功 */
  online: boolean
  /** 最近一次健康体（失败时为 null） */
  data: HealthPulseData | null
  /** 最近一次采样错误（UI 可展示原因） */
  error: string | null
  /** 最近一次采样时间（Unix 毫秒） */
  lastCheckedAt: number | null
  /** 是否正在首次握手（仅首次 true，后续轮询不改变） */
  bootstrapping: boolean
}

const INITIAL_STATE: HealthPulseState = {
  online: false,
  data: null,
  error: null,
  lastCheckedAt: null,
  bootstrapping: true,
}

/**
 * 定时轮询后端 /health 端点，向上层暴露"在线/离线 + 版本 + uptime"。
 *
 * @param intervalMs 轮询间隔（毫秒），默认 5000；传 0 表示仅执行一次
 *
 * 实现要点：
 * - 使用 setInterval + AbortController；组件卸载时清理；
 * - 轮询期间若切换到后台（document.hidden），仍按周期执行（不做暂停，
 *   方便 DeployMonitorPage 固定刷新节奏，后续若需节流可 expose 参数）；
 * - 请求错误不会抛出，统一落在 state.error / state.online=false。
 *
 * 返回值可直接驱动 StatCard 与页面顶栏指示灯。
 */
export function useHealthPulse(intervalMs = 5000): HealthPulseState {
  const [state, setState] = useState<HealthPulseState>(INITIAL_STATE)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      // 取消上一次未完成的请求，避免慢网下多个飞行请求堆叠
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await http.get<HealthPulseData>('/health', {
          signal: controller.signal,
          timeout: Math.max(2000, intervalMs - 500),
        })
        if (cancelled) return
        setState({
          online: true,
          data: res.data,
          error: null,
          lastCheckedAt: Date.now(),
          bootstrapping: false,
        })
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        setState((prev) => ({
          online: false,
          data: prev.data,
          error: msg,
          lastCheckedAt: Date.now(),
          bootstrapping: false,
        }))
      }
    }

    // 立即执行一次，然后按间隔轮询
    tick()
    if (intervalMs <= 0) return () => { cancelled = true }

    const timer = window.setInterval(tick, intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      abortRef.current?.abort()
    }
  }, [intervalMs])

  return state
}

