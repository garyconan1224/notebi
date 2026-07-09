/**
 * SummariesTab — 结果页「总结」标签页。
 *
 * 左侧：扁平版列表（点即应用到正文，高亮当前项，双击可改名）。
 * 右侧：主显示区（react-markdown 渲染）。
 * + 新建 → NewSummaryModal 弹窗。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'

const MAX_COMPARE = 3

import {
  createSummary,
  deleteSummary,
  listSummaries,
  renameSummary,
  type ItemSummary,
} from '@/services/summaries'
import { getItemNote } from '@/services/workspaces'
import { withStatusToast } from '@/lib/statusToast'

import { flattenText, MarkdownToc, slugify } from './MarkdownToc'
import { NewSummaryModal } from './NewSummaryModal'

import './summaries-tab.css'

// remarkGfm 类型与 react-markdown 不完全兼容，统一 cast 一次
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const remarkPlugins: any[] = [remarkGfm]

/* ── 模板标签（与 backend summary_templates.py 对齐） ─────── */

const TEMPLATE_LABEL_MAP: Record<string, string> = {
  concise: '简洁摘要',
  detailed: '详细要点',
  quotes: '金句提取',
  meeting: '会议纪要',
  xhs: '小红书风格',
  longform: '公众号长文',
  lecture: '教学笔记',
  interview: '访谈整理',
  shownotes: '播客 shownotes',
  oral: '口播稿',
  steps: '步骤教程',
  outline: '大纲',
  qa: '问答卡(Anki)',
  actions: '行动清单',
  tool_recommendation: '工具推荐',
  science_popularization: '知识科普',
  standard: '标准总结',
}

function templateLabel(id: string): string {
  return TEMPLATE_LABEL_MAP[id] ?? id
}

/** 版本显示名：有自定义 name 则显示 name，否则 模板名 · v{n} */
function versionLabel(s: ItemSummary): string {
  if (s.name) return s.name
  return `${templateLabel(s.template)} · v${s.version}`
}

/* ── Props ─────────────────────────────────────────────── */

interface SummariesTabProps {
  workspaceId: string
  itemId: string
  onApplyToNote?: (summary: ItemSummary) => void
  activeSummaryId?: string
  /** create/delete/rename 后通知父组件同步 summaries 列表 */
  onRefresh?: () => void
}

/* ── 主组件 ────────────────────────────────────────────── */

export function SummariesTab({ workspaceId, itemId, onApplyToNote, activeSummaryId, onRefresh }: SummariesTabProps) {
  const navigate = useNavigate()
  const [summaries, setSummaries] = useState<ItemSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ItemSummary | null>(null)
  const [showModal, setShowModal] = useState(false)
  /** null = 没在生成；string = 正在生成的模板 id（列表里显示进度条） */
  const [creatingTemplate, setCreatingTemplate] = useState<string | null>(null)
  const [defaultTemplate, setDefaultTemplate] = useState<string | undefined>(undefined)

  // 对比模式
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isCompareMode, setIsCompareMode] = useState(false)

  // 排序：'newest' = 最新在前（默认），'oldest' = 最早在前
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')

  // 改名
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)

  /* ── 加载列表 ────────────────────────────────────────── */

  const refresh = useCallback(async () => {
    try {
      const data = await listSummaries(workspaceId, itemId)
      setSummaries(data)
      // 自动选中第一项
      if (!selected && data.length > 0) {
        setSelected(data[0])
      }
    } catch {
      toast.error('加载总结列表失败')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, itemId, selected])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 获取 summary_hint（图文内容分类推荐模板）
  useEffect(() => {
    let cancelled = false
    getItemNote(workspaceId, itemId)
      .then(note => {
        if (!cancelled && note.summary_hint?.default_template) {
          setDefaultTemplate(note.summary_hint.default_template)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, itemId])

  /* ── 创建（从弹窗回调） ─────────────────────────────── */

  const handleCreate = useCallback(async (opts: {
    template: string
    background: string
    providerId: string
    model: string
    searchWeb: boolean
  }) => {
    // 立刻关弹窗，列表里显示生成进度
    setShowModal(false)
    setCreatingTemplate(opts.template)
    const toastId = `summary-create-${workspaceId}-${itemId}-${opts.template}`
    const creatingLabel = templateLabel(opts.template)
    toast.loading(`正在生成${creatingLabel}…`, { id: toastId })

    try {
      const s = await createSummary(workspaceId, itemId, opts.template, opts.background, {
        provider_id: opts.providerId,
        model: opts.model,
        search_web: opts.searchWeb,
      })
      toast.success(`${templateLabel(s.template)} v${s.version} 生成完成`, { id: toastId })
      await refresh()
      onRefresh?.()
      setSelected(s)
    } catch (err: unknown) {
      const axiosData = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      if (axiosData && axiosData.includes('chat model')) {
        toast.error('请先在设置中配置 LLM 模型', {
          id: toastId,
          action: { label: '去设置', onClick: () => navigate('/settings/models') },
        })
      } else {
        const msg = err instanceof Error ? err.message : '生成失败'
        toast.error(msg, { id: toastId })
      }
    } finally {
      setCreatingTemplate(null)
    }
  }, [workspaceId, itemId, refresh, onRefresh, navigate])

  /* ── 删除 ────────────────────────────────────────────── */

  const handleDelete = useCallback(
    async (summaryId: string) => {
      try {
        await withStatusToast(
          () => deleteSummary(workspaceId, itemId, summaryId),
          {
            id: `summary-delete-${summaryId}`,
            loading: '正在删除总结…',
            success: '总结已删除',
            error: '删除总结失败',
          },
        )
        if (selected?.summary_id === summaryId) {
          setSelected(null)
        }
        await refresh()
        onRefresh?.()
      } catch (err) {
        console.error('删除总结失败:', err)
      }
    },
    [workspaceId, itemId, selected, refresh, onRefresh],
  )

  /* ── 改名 ────────────────────────────────────────────── */

  const startRename = useCallback((s: ItemSummary) => {
    setEditingId(s.summary_id)
    setEditingName(s.name || '')
  }, [])

  const commitRename = useCallback(async () => {
    if (!editingId) return
    try {
      const updated = await withStatusToast(
        () => renameSummary(workspaceId, itemId, editingId, editingName.trim()),
        {
          id: `summary-rename-${editingId}`,
          loading: '正在保存总结名称…',
          success: '总结名称已保存',
          error: '总结改名失败',
        },
      )
      setSummaries((prev) => prev.map((s) => (s.summary_id === editingId ? { ...s, name: updated.name } : s)))
      if (selected?.summary_id === editingId) {
        setSelected((prev) => (prev ? { ...prev, name: updated.name } : prev))
      }
      onRefresh?.()
    } catch (err) {
      console.error('总结改名失败:', err)
    } finally {
      setEditingId(null)
      setEditingName('')
    }
  }, [editingId, editingName, workspaceId, itemId, selected, onRefresh])

  const cancelRename = useCallback(() => {
    setEditingId(null)
    setEditingName('')
  }, [])

  /* ── 复制 markdown ───────────────────────────────────── */

  const handleCopy = useCallback(() => {
    if (selected) {
      navigator.clipboard.writeText(selected.content_md)
      toast.success('已复制 markdown')
    }
  }, [selected])

  /* ── 对比模式 ────────────────────────────────────────── */

  const toggleSelect = useCallback((summaryId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(summaryId)) {
        next.delete(summaryId)
      } else if (next.size < MAX_COMPARE) {
        next.add(summaryId)
      } else {
        toast.warning(`最多对比 ${MAX_COMPARE} 份`)
      }
      return next
    })
  }, [])

  const enterCompare = useCallback(() => {
    setIsCompareMode(true)
  }, [])

  const exitCompare = useCallback(() => {
    setIsCompareMode(false)
    setSelectedIds(new Set())
  }, [])

  const compareItems = useMemo(
    () => summaries.filter((s) => selectedIds.has(s.summary_id)),
    [summaries, selectedIds],
  )

  /** 按时间排序后的列表 */
  const sortedSummaries = useMemo(() => {
    const arr = [...summaries]
    arr.sort((a, b) => {
      const ta = new Date(a.created_at).getTime()
      const tb = new Date(b.created_at).getTime()
      return sortOrder === 'newest' ? tb - ta : ta - tb
    })
    return arr
  }, [summaries, sortOrder])

  /* ── 渲染 ────────────────────────────────────────────── */

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--ink-3)' }}>加载中…</div>
  }

  // ── 空态：居中引导 ────────────────────────────────────
  if (summaries.length === 0 && !creatingTemplate) {
    return (
      <div className="sm-empty-guide">
        <h2 className="sm-empty-title">生成一份内容总结</h2>
        <p className="sm-empty-subtitle">选一个模板，AI 帮你把转录文本整理成可读笔记</p>
        <button className="sm-btn-generate" onClick={() => setShowModal(true)}>
          + 新建总结
        </button>
        {showModal && (
          <NewSummaryModal
            creating={false}
            defaultTemplate={defaultTemplate}
            onSubmit={handleCreate}
            onClose={() => setShowModal(false)}
          />
        )}
      </div>
    )
  }

  // ── 有总结：sidebar + main ────────────────────────────
  return (
    <div className="sm-summaries-root">
      {/* 左侧列表 */}
      <aside className="sm-sidebar">
        <div className="sm-sidebar-header">
          <span style={{ fontWeight: 600, fontSize: 13 }}>总结列表</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {selectedIds.size >= 2 && !isCompareMode && (
              <button className="sm-btn-compare" onClick={enterCompare}>
                ⇄ 对比 ({selectedIds.size})
              </button>
            )}
            {isCompareMode && (
              <button className="sm-btn-compare" onClick={exitCompare}>
                ✕ 退出对比
              </button>
            )}
            <button
              className="sm-btn-sort"
              onClick={() => setSortOrder((v) => (v === 'newest' ? 'oldest' : 'newest'))}
              title={sortOrder === 'newest' ? '最新在前' : '最早在前'}
            >
              {sortOrder === 'newest' ? '↓新' : '↑旧'}
            </button>
            <button
              className="sm-btn-new"
              onClick={() => setShowModal(true)}
              title="新建总结"
            >
              + 新建
            </button>
          </div>
        </div>

        {/* 生成中进度项（列表顶部） */}
        {creatingTemplate && (
          <div className="sm-version-item sm-creating">
            <div className="sm-version-info">
              <span className="sm-version-label">{templateLabel(creatingTemplate)}</span>
              <span className="sm-version-preview" style={{ color: 'var(--accent-pink)' }}>
                正在生成…
              </span>
            </div>
            <div className="sm-creating-spinner" />
          </div>
        )}

        {/* 扁平版列表：每条 = 模板名·v{n} 或自定义名 + 时间 */}
        {sortedSummaries.map((s) => {
          const isActive = activeSummaryId === s.summary_id || selected?.summary_id === s.summary_id
          const isEditing = editingId === s.summary_id
          return (
            <div
              key={s.summary_id}
              className={`sm-version-item ${isActive ? 'active' : ''}`}
              onClick={() => {
                if (!isEditing) {
                  setSelected(s)
                  onApplyToNote?.(s)
                }
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                startRename(s)
              }}
            >
              <input
                type="checkbox"
                className="sm-checkbox"
                checked={selectedIds.has(s.summary_id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleSelect(s.summary_id)}
                title={
                  !selectedIds.has(s.summary_id) && selectedIds.size >= MAX_COMPARE
                    ? `最多对比 ${MAX_COMPARE} 份`
                    : undefined
                }
              />
              <div className="sm-version-info">
                {isEditing ? (
                  <input
                    className="sm-rename-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') cancelRename()
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    placeholder={versionLabel(s)}
                  />
                ) : (
                  <>
                    <div className="sm-version-label-row">
                      <span className="sm-version-label">{versionLabel(s)}</span>
                      <span className="sm-version-time">
                        {new Date(s.created_at).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <span className="sm-version-preview">
                      {s.content_md.replace(/[#*_>\-\n]/g, ' ').trim().slice(0, 30)}
                      {s.content_md.length > 30 ? '…' : ''}
                    </span>
                  </>
                )}
              </div>
              <button
                className="sm-btn-delete"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(s.summary_id)
                }}
                title="删除"
              >
                ×
              </button>
            </div>
          )
        })}
      </aside>

      {/* 右侧主显示 */}
      <main className={`sm-main ${isCompareMode ? 'sm-compare' : ''}`}>
        {isCompareMode ? (
          <div className="sm-compare-columns">
            {compareItems.map((s) => (
              <div key={s.summary_id} className="sm-compare-col">
                <div className="sm-compare-col-head">
                  <span className="sm-main-title">{versionLabel(s)}</span>
                  <span className="sm-main-meta">
                    {new Date(s.created_at).toLocaleString()}
                    {s.model_used && ` · ${s.model_used}`}
                  </span>
                  <button
                    className="sm-btn-delete"
                    onClick={() => handleDelete(s.summary_id)}
                    title="删除"
                  >
                    ×
                  </button>
                </div>
                <div className="sm-compare-col-body">
                  <ReactMarkdown remarkPlugins={remarkPlugins}>
                    {s.content_md}
                  </ReactMarkdown>
                </div>
                <div className="sm-compare-col-actions">
                  {onApplyToNote && (
                    <button
                      onClick={() => onApplyToNote(s)}
                      style={{ fontWeight: 600, color: 'var(--accent-pink)' }}
                    >
                      应用到主笔记
                    </button>
                  )}
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(s.content_md)
                      toast.success('已复制')
                    }}
                  >
                    复制 markdown
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : selected ? (
          <>
            <div className="sm-main-header">
              <span className="sm-main-title">{versionLabel(selected)}</span>
              <span className="sm-main-meta">
                {new Date(selected.created_at).toLocaleString()}
                {selected.model_used && ` · ${selected.model_used}`}
              </span>
            </div>
            <MarkdownToc markdown={selected.content_md} scrollRef={scrollRef} />
            <div className="sm-main-content" ref={scrollRef}>
              <ReactMarkdown
                remarkPlugins={remarkPlugins}
                components={{
                  h2: ({ children, ...props }) => <h2 id={slugify(flattenText(children))} {...props}>{children}</h2>,
                  h3: ({ children, ...props }) => <h3 id={slugify(flattenText(children))} {...props}>{children}</h3>,
                }}
              >
                {selected.content_md}
              </ReactMarkdown>
            </div>
            <div className="sm-main-actions">
              {onApplyToNote && (
                <button
                  onClick={() => onApplyToNote(selected)}
                  style={{ fontWeight: 600, color: 'var(--accent-pink)' }}
                >
                  应用到主笔记
                </button>
              )}
              <button onClick={handleCopy}>复制</button>
              <button onClick={() => setShowModal(true)}>重新生成</button>
              <button onClick={() => handleDelete(selected.summary_id)}>删除</button>
            </div>
          </>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--ink-3)',
            }}
          >
            选择一份总结查看
          </div>
        )}
      </main>

      {/* 新建弹窗 */}
      {showModal && (
        <NewSummaryModal
          creating={creatingTemplate !== null}
          defaultTemplate={defaultTemplate}
          onSubmit={handleCreate}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
