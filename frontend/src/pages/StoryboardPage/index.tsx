import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, Play, Film } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { getWorkspace } from '@/services/workspaces'
import type { WorkspaceRecord } from '@/types/workspace'
import './storyboard.css'

/**
 * StoryboardPage — 分镜页面（H5.2，方案 A markdown 直展）
 *
 * 数据来源：URL query `?workspace=X&item=Y` → workspace.items[Y].results.{plan_a,plan_b,plan_c}
 * 决议：D1 仅展示 / D2 markdown 直展 / D3 生成按钮 + .fcpxml 禁用（→ Phase [C]）
 *
 * 后端：shared/storyboard_generator.py 已存在，输出 3 个 markdown plan。
 * shot-by-shot 网格视觉留给 [C] AI 导演阶段（需要后端 schema 升级）。
 */

type TabKey = 'A' | 'B' | 'C'

interface Plan {
  key: TabKey
  name: string
  desc: string
  markdown: string
}

const TAB_META: Record<TabKey, { name: string; desc: string }> = {
  A: { name: '方案 A', desc: 'PLAN_A · 主推' },
  B: { name: '方案 B', desc: 'PLAN_B · 平衡' },
  C: { name: '方案 C', desc: 'PLAN_C · 探索' },
}

function extractPlans(results: Record<string, unknown> | undefined): Plan[] | null {
  if (!results) return null
  const a = (results.plan_a as string | undefined) ?? ''
  const b = (results.plan_b as string | undefined) ?? ''
  const c = (results.plan_c as string | undefined) ?? ''
  if (!a && !b && !c) return null
  return (['A', 'B', 'C'] as TabKey[]).map((k) => ({
    key: k,
    ...TAB_META[k],
    markdown: { A: a, B: b, C: c }[k],
  }))
}

function extractHook(markdown: string): string {
  const cleaned = markdown.replace(/^#.*$/gm, '').trim()
  const para = cleaned.split('\n\n').find((p) => p.trim().length > 20)
  if (!para) return '基于转录 + 视觉分析，AI 生成的改编方案。'
  return para.trim().slice(0, 180) + (para.length > 180 ? '…' : '')
}

export default function StoryboardPage() {
  const [params] = useSearchParams()
  const workspaceId = params.get('workspace') ?? ''
  const itemId = params.get('item') ?? ''
  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<TabKey>('A')

  useEffect(() => {
    if (!workspaceId) return
    setLoading(true)
    getWorkspace(workspaceId)
      .then((w) => {
        setWorkspace(w)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : '加载失败')
        setLoading(false)
      })
  }, [workspaceId])

  const item = useMemo(() => {
    if (!workspace || !itemId) return null
    return workspace.items.find((it) => it.item_id === itemId) ?? null
  }, [workspace, itemId])

  const plans = useMemo(() => {
    const itemResults = item?.results as Record<string, unknown> | undefined
    return extractPlans(itemResults)
  }, [item])

  const currentPlan = plans?.find((p) => p.key === active) ?? plans?.[0] ?? null

  // ─── Render branches ───

  if (!workspaceId || !itemId) {
    return (
      <div className="sb-scroll">
        <EmptyState
          title="选择素材查看分镜"
          hint="STORYBOARD"
          body={
            <>
              请从任务中心打开某个素材，再进入「分镜」页面。
              <br />
              暂未在 URL 提供 <code>?workspace=...&item=...</code> 参数。
            </>
          }
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="sb-scroll">
        <div className="sb-loading">加载中…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="sb-scroll">
        <EmptyState title="加载失败" hint="ERROR" body={error} />
      </div>
    )
  }

  if (!item) {
    return (
      <div className="sb-scroll">
        <EmptyState title="素材未找到" hint="NOT FOUND" body="请检查链接是否正确。" />
      </div>
    )
  }

  if (!plans || !currentPlan) {
    return (
      <div className="sb-scroll">
        <EmptyState
          title="本素材还没有分镜任务"
          hint="EMPTY"
          body={
            <>
              请先在
              <Link
                to={`/workspaces/${workspaceId}`}
                style={{ margin: '0 4px', color: 'var(--ink)', textDecoration: 'underline' }}
              >
                任务中心
              </Link>
              触发分镜任务（storyboard）。
              <br />
              完成后回到此页面查看 3 个方案对比。
            </>
          }
        />
      </div>
    )
  }

  return (
    <div className="sb-scroll">
      {/* ── Page head ── */}
      <div className="sb-page-head">
        <div className="top-row">
          <div>
            <div className="eyebrow">
              STORYBOARD · 3 VARIANTS · {item.name || item.item_id.slice(0, 8)}
            </div>
            <h1 className="sb-title">三种改编方向</h1>
            <p className="sb-lede">
              基于转录 + 视觉分析，AI 生成三种脚本化改编——不同长度、调性、平台适配。选一种继续编辑。
            </p>
          </div>
          <div className="sb-actions">
            <button
              className="btn"
              disabled
              title="导出 Final Cut XML — Phase [C] AI 导演模块"
              style={{ opacity: 0.5, cursor: 'not-allowed' }}
            >
              <Download size={14} />
              导出 .fcpxml
              <span className="sb-phase-c-pill">PHASE C</span>
            </button>
            <button
              className="btn btn-primary"
              disabled
              title="生成视频预览 — Phase [C] AI 导演模块"
              style={{ opacity: 0.5, cursor: 'not-allowed' }}
            >
              <Play size={14} />
              生成预览
            </button>
          </div>
        </div>
      </div>

      {/* ── Card body ── */}
      <div className="sb-page-body">
        <div className="storyboard-card">
          {/* Tab row */}
          <div className="sb-tabs">
            {plans.map((p) => (
              <button
                key={p.key}
                className="sb-tab"
                data-active={active === p.key}
                onClick={() => setActive(p.key)}
              >
                <div className="ix">{p.key}</div>
                <div className="nm">{p.name}</div>
                <div className="ds">{p.desc}</div>
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="sb-body">
            <div className="plan-hd">
              <div className="left">
                <div className="plan-title">{currentPlan.name}</div>
                <p className="plan-hook">{extractHook(currentPlan.markdown)}</p>
              </div>
              <div className="sb-side-cards">
                <div className="sb-side-card">
                  <div className="eyebrow">字数</div>
                  <div className="val">{currentPlan.markdown.length}</div>
                </div>
                <div className="sb-side-card">
                  <div className="eyebrow">方案</div>
                  <div className="val">{currentPlan.key}</div>
                </div>
              </div>
            </div>

            {/* Markdown rendering — replaces shot grid per D2 方案 A */}
            <div className="sb-markdown">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <ReactMarkdown remarkPlugins={[remarkGfm as any]}>
                {currentPlan.markdown || '_（此方案内容为空）_'}
              </ReactMarkdown>
            </div>

            <div
              className="sb-empty-hint"
              style={{ marginTop: 14, textAlign: 'center', opacity: 0.7 }}
            >
              SHOT-BY-SHOT 网格 / .FCPXML 导出 / 视频预览生成 → Phase [C] AI 导演模块
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface EmptyStateProps {
  title: string
  hint: string
  body: React.ReactNode
}

function EmptyState({ title, hint, body }: EmptyStateProps) {
  return (
    <div className="sb-empty">
      <div className="sb-empty-icon">
        <Film size={28} />
      </div>
      <div className="sb-empty-hint" style={{ marginBottom: 6 }}>
        {hint}
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  )
}
