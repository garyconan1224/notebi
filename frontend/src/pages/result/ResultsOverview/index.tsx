import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { getWorkspace } from '@/services/workspaces'
import { resolveItemRoute } from '@/lib/resolveItemRoute'

import '../tokens.css'
import './overview.css'

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }

/**
 * 结果总览页：NoteBi 单产品化后，所有素材统一进入对应结果页（笔记 / 视频 / 图片 / 文字）。
 * 本组件仅负责加载素材并按 resolveItemRoute 重定向；保留加载与错误兜底状态。
 * 历史上此处曾渲染复刻结果总览（时间轴 / 摘要 / 导出工作包），随复刻能力一并移除。
 */
export default function ResultsOverview() {
  const { workspaceId = '', itemId = '' } = useParams<{ workspaceId: string; itemId: string }>()
  const navigate = useNavigate()
  const [pageState, setPageState] = useState<PageState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const ws = await getWorkspace(workspaceId)
        if (cancelled) return
        const item = ws.items.find((it) => it.item_id === itemId)
        if (!item) {
          setPageState({ kind: 'error', message: '素材不存在' })
          return
        }
        navigate(resolveItemRoute(workspaceId, item), { replace: true })
      } catch (err: unknown) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '加载结果失败'
        setPageState({ kind: 'error', message })
      }
    }

    load()
    return () => { cancelled = true }
  }, [workspaceId, itemId, navigate])

  if (pageState.kind === 'error') {
    return (
      <div className="vm-overview-scope" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <span style={{ color: 'var(--accent-pink)', fontWeight: 600 }}>{pageState.message}</span>
        <button className="btn-ghost" style={{ padding: '6px 12px' }} onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>
      </div>
    )
  }

  return (
    <div className="vm-overview-scope" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <span className="mono" style={{ color: 'var(--ink-3)' }}>正在打开结果…</span>
    </div>
  )
}
