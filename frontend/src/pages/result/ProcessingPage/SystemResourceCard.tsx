import { useEffect, useState, useRef } from 'react'
import http from '@/services/client'
import { useTaskStore } from '@/store/taskStore'
import { isTaskTerminal } from '@/types/task'

interface GpuInfo {
  name: string
  utilization_percent: number
  vram_used_gb: number
  vram_total_gb: number
}

interface SystemStats {
  cpu: { percent: number; cores: number }
  ram: { used_gb: number; total_gb: number; percent: number }
  gpu: GpuInfo | null
}

interface SystemResourceCardProps {
  etaSec: number
}

const recommend = 6
const parallelLimit = Math.max(3, recommend)

export default function SystemResourceCard({ etaSec }: SystemResourceCardProps) {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tasks = useTaskStore((s) => s.tasks)

  useEffect(() => {
    const fetchStats = () => {
      http
        .get<SystemStats>('/system/stats')
        .then((res) => setStats(res.data))
        .catch(() => {
          // 静默失败，保留上一次数据
        })
    }
    fetchStats()
    intervalRef.current = setInterval(fetchStats, 3000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const gpu = stats?.gpu ?? null
  const runningCount = tasks.filter((t) => !isTaskTerminal(t.status)).length

  return (
    <div className="side-card">
      <h4>
        系统资源
        <span className="chip">
          <span
            className="chip-dot"
            style={{ background: gpu ? 'var(--accent-green)' : 'var(--ink-3)' }}
          />
          {gpu ? 'GPU active' : 'CPU only'}
        </span>
      </h4>

      {/* 四宫格 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        {/* GPU */}
        <div>
          <div className="eyebrow" style={{ fontSize: 10 }}>
            GPU
          </div>
          <div
            className="mono"
            style={{ fontSize: 28, fontFamily: 'var(--display)', fontWeight: 500 }}
          >
            {gpu ? `${gpu.utilization_percent}%` : '—'}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {gpu ? `${gpu.name} · ${gpu.vram_total_gb}G` : ''}
          </div>
        </div>

        {/* RAM */}
        <div>
          <div className="eyebrow" style={{ fontSize: 10 }}>
            RAM
          </div>
          <div
            className="mono"
            style={{ fontSize: 28, fontFamily: 'var(--display)', fontWeight: 500 }}
          >
            {stats ? `${stats.ram.used_gb}G` : '—'}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {stats ? `/ ${stats.ram.total_gb}GB` : ''}
          </div>
        </div>

        {/* VRAM */}
        <div>
          <div className="eyebrow" style={{ fontSize: 10 }}>
            VRAM
          </div>
          <div
            className="mono"
            style={{ fontSize: 28, fontFamily: 'var(--display)', fontWeight: 500 }}
          >
            {gpu ? `${gpu.vram_used_gb}G` : '—'}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {gpu ? `/ ${gpu.vram_total_gb} GB` : ''}
          </div>
        </div>

        {/* ETA */}
        <div>
          <div className="eyebrow" style={{ fontSize: 10 }}>
            ETA
          </div>
          <div
            className="mono"
            style={{ fontSize: 28, fontFamily: 'var(--display)', fontWeight: 500 }}
          >
            {etaSec > 0 ? `${etaSec}s` : runningCount > 0 ? '0s' : '—'}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            剩余时间
          </div>
        </div>
      </div>

      {/* 并行槽位条 */}
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--line)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span className="eyebrow" style={{ fontSize: 10 }}>
            并行槽位
          </span>
          <span
            className="mono"
            style={{ fontSize: 11, color: 'var(--ink-3)' }}
          >
            <b style={{ color: 'var(--ink)', fontSize: 13 }}>{runningCount}</b> /{' '}
            {parallelLimit}
            <span style={{ marginLeft: 6, color: 'var(--accent-green)' }}>
              推荐 {recommend}
            </span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {Array.from({ length: parallelLimit }).map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 5,
                borderRadius: 3,
                background:
                  i < runningCount ? 'var(--ink)' : 'var(--bg-sunken)',
                border:
                  i < runningCount ? 'none' : '1px dashed var(--line)',
              }}
            />
          ))}
        </div>
        <div
          className="mono"
          style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 6 }}
        >
          CPU {stats?.cpu.cores ?? '—'} 核 · RAM{' '}
          {stats?.ram.total_gb ?? '—'}GB
          {gpu ? ` · ${gpu.name} ${gpu.vram_total_gb}GB` : ''}
        </div>
      </div>
    </div>
  )
}
