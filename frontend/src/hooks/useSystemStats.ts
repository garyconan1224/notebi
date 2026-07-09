import { useEffect, useRef, useState } from 'react'

import { getSystemStats } from '@/services/admin'
import type { SystemStats } from '@/services/admin'

const POLL_INTERVAL = 10_000

export interface UseSystemStatsResult {
  stats: SystemStats | null
  online: boolean
}

/** 10s 轮询 /admin/system/stats，失败时 online=false */
export function useSystemStats(): UseSystemStatsResult {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [online, setOnline] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    let timer: ReturnType<typeof setInterval> | null = null

    const tick = () => {
      getSystemStats()
        .then((data) => {
          if (!mountedRef.current) return
          setStats(data)
          setOnline(true)
        })
        .catch(() => {
          if (!mountedRef.current) return
          setOnline(false)
        })
    }

    tick()
    timer = setInterval(tick, POLL_INTERVAL)

    return () => {
      mountedRef.current = false
      if (timer) clearInterval(timer)
    }
  }, [])

  return { stats, online }
}
