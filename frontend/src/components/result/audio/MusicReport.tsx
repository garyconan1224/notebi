/**
 * MusicReport — sub-tab 2：可视化报告
 *
 * 4 张图：BPM 走势线图、调性分布饼图、段时长条形图、节奏热度散点图
 */

import { useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts'
import type { MusicSegmentData } from '@/services/workspaces'

// 颜色方案（对应 Nibi token 语义色，5 色轮转）
const COLORS = [
  'var(--acc)',
  'var(--wrn)',
  'var(--ok)',
  'var(--fg2)',
  'var(--mut)',
]

interface MusicReportProps {
  segments: MusicSegmentData[]
}

export function MusicReport({ segments }: MusicReportProps) {
  // 图 1：BPM 走势线图
  const bpmData = useMemo(() =>
    segments.map((s, i) => ({
      idx: `段${i + 1}`,
      bpm: Math.round(s.bpm ?? 0),
    })),
    [segments]
  )

  // 图 2：调性分布饼图
  const keyData = useMemo(() => {
    const keyCount = new Map<string, number>()
    segments.forEach(s => {
      const key = s.key || '未知'
      keyCount.set(key, (keyCount.get(key) || 0) + 1)
    })
    return Array.from(keyCount.entries()).map(([name, value]) => ({ name, value }))
  }, [segments])

  // 图 3：段时长条形图
  const durData = useMemo(() =>
    segments.map((s, i) => ({
      idx: `段${i + 1}`,
      duration: Math.round((s.end ?? 0) - (s.start ?? 0)),
    })),
    [segments]
  )

  // 图 4：节奏热度散点图
  const scatterData = useMemo(() =>
    segments.map((s, i) => ({
      t: ((s.start ?? 0) + (s.end ?? 0)) / 2,
      bpm: Math.round(s.bpm ?? 0),
      z: Math.max(10, Math.round((s.end ?? 0) - (s.start ?? 0)) * 3),
      name: `段${i + 1}`,
    })),
    [segments]
  )

  if (!segments || segments.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
        未勾选「音乐分析」或暂无段数据
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
      {/* 图 1：BPM 走势线图 */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--ink)' }}>BPM 走势</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={bpmData}>
            <XAxis dataKey="idx" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ fontSize: 12, background: 'var(--bg-elev)', border: '1px solid var(--line)' }}
            />
            <Line type="monotone" dataKey="bpm" stroke={COLORS[0]} strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 图 2：调性分布饼图 */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--ink)' }}>调性分布</div>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={keyData}
              cx="50%"
              cy="50%"
              outerRadius={70}
              dataKey="value"
              labelLine={{ strokeWidth: 1 }}
            >
              {keyData.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ fontSize: 12, background: 'var(--bg-elev)', border: '1px solid var(--line)' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* 图 3：段时长条形图 */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--ink)' }}>段时长分布</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={durData}>
            <XAxis dataKey="idx" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit="s" />
            <Tooltip
              contentStyle={{ fontSize: 12, background: 'var(--bg-elev)', border: '1px solid var(--line)' }}
            />
            <Bar dataKey="duration" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 图 4：节奏热度散点图 */}
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--ink)' }}>节奏热度</div>
        <ResponsiveContainer width="100%" height={200}>
          <ScatterChart>
            <XAxis
              dataKey="t"
              name="时刻"
              unit="s"
              tick={{ fontSize: 11 }}
              label={{ value: '时刻 (s)', position: 'insideBottom', offset: -5, fontSize: 11 }}
            />
            <YAxis
              dataKey="bpm"
              name="BPM"
              tick={{ fontSize: 11 }}
              label={{ value: 'BPM', angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, background: 'var(--bg-elev)', border: '1px solid var(--line)' }}
            />
            <Scatter
              data={scatterData}
              fill={COLORS[0]}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
