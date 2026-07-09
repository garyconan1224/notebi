import { useEffect, useState } from 'react'
import http from '@/services/client'

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000

export function useBackendHealth() {
  const [ok, setOk] = useState<boolean | null>(null)
  const [retries, setRetries] = useState(0)

  useEffect(() => {
    let cancelled = false

    const checkHealth = async () => {
      try {
        const res = await http.get('/health')
        if (!cancelled) {
          console.log('✅ [Health Check] 后端在线', res.data)
          setOk(true)
          setRetries(0)
        }
      } catch (err) {
        if (cancelled) return

        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`❌ [Health Check] 后端离线 (第 ${retries + 1} 次失败)`, errorMsg)

        // 如果还有重试次数，延迟后重试
        if (retries < MAX_RETRIES) {
          setRetries(retries + 1)
          const timer = setTimeout(() => {
            if (!cancelled) checkHealth()
          }, RETRY_DELAY_MS)
          return () => clearTimeout(timer)
        } else {
          // 达到最大重试次数，标记为离线
          if (!cancelled) {
            setOk(false)
          }
        }
      }
    }

    checkHealth()

    return () => {
      cancelled = true
    }
  }, [retries])

  return ok
}

