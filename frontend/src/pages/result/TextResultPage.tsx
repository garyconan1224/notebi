import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Star, ChevronDown, ChevronRight, Layers, Copy, Check, Download, Pencil, FileText } from 'lucide-react'

import {
  type TextResult,
  type TextCompareResult,
  type StructuredSummary,
  type MaybeAligned,
  normalizeAligned,
  addPromptVersion,
  getTextItemResult,
  getTextCompare,
  exportTextNote,
  updateTextContent,
} from '@/services/workspaces'
import { PromptVersionStack } from '@/components/result/PromptVersionStack'

import './tokens.css'
import './text-result.css'
import { ItemTagsPanel } from '@/components/workspace/ItemTagsPanel'
import { SummariesTab } from '@/components/SummariesTab'
import NoteChatDrawer from '@/components/NoteChatDrawer'

function renderSummary(
  summary: string | StructuredSummary | null | undefined,
  onJump: (charStart: number, charEnd: number, paraIndex?: number) => void,
) {
  if (!summary) return null

  // 兼容旧版纯字符串摘要
  if (typeof summary === 'string') {
    return (
      <div className="im-section">
        <div className="tx-summary-text">{summary}</div>
      </div>
    )
  }

  // T1.1: 结构化摘要
  const { abstract, key_points, golden_quotes } = summary
  return (
    <>
      {abstract && (
        <div className="im-section">
          <div className="eyebrow" style={{ marginBottom: 6 }}>摘要</div>
          <div className="tx-summary-text">{abstract}</div>
        </div>
      )}

      {key_points && key_points.length > 0 && (
        <div className="im-section">
          <div className="eyebrow" style={{ marginBottom: 8 }}>要点</div>
          <div className="tx-kp-list">
            {key_points.map((kp, i) => (
              <div
                key={i}
                className="tx-kp-item"
                data-clickable={kp.char_start !== undefined || kp.para_index !== undefined}
                onClick={kp.char_start !== undefined
                  ? () => onJump(kp.char_start!, kp.char_end!, kp.para_index)
                  : kp.para_index !== undefined
                    ? () => onJump(0, 0, kp.para_index)
                    : undefined}
              >
                <span className="tx-kp-num">{String(i + 1).padStart(2, '0')}</span>
                <div className="tx-kp-body">
                  <div className="tx-kp-text">{kp.text}</div>
                  {kp.source_excerpt && (
                    <div className="tx-kp-excerpt">
                      <span className="tx-kp-excerpt-label">原文：</span>
                      {kp.source_excerpt}
                      {kp.para_index !== undefined && (
                        <span className="tx-kp-pos">第 {kp.para_index + 1} 段</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {golden_quotes && golden_quotes.length > 0 && (
        <div className="im-section">
          <div className="eyebrow" style={{ marginBottom: 8 }}>金句</div>
          <div className="tx-gq-list">
            {golden_quotes.map((q, i) => (
              <div
                key={i}
                className="tx-gq-item"
                data-clickable={q.char_start !== undefined || q.para_index !== undefined}
                onClick={() => onJump(q.char_start, q.char_end, q.para_index)}
              >
                <blockquote className="tx-gq-text">{q.quote_text}</blockquote>
                {q.para_index !== undefined && (
                  <span className="tx-gq-pos">第 {q.para_index + 1} 段</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ── T1.2: 逐段对照视图 ──────────────────────────────────────

function ParagraphAlignView({
  originalContent,
  result,
  label,
}: {
  originalContent: string
  result: MaybeAligned | undefined
  label: string
}) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const section = normalizeAligned(result)
  if (!section) return null

  const origParas = originalContent.split(/\n{2,}/).filter(p => p.trim())
  const resultParas = section.paragraphs
  const maxLen = Math.max(origParas.length, resultParas.length)
  const mismatch = origParas.length !== resultParas.length

  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 1800)
    } catch {
      // fallback: ignore clipboard errors
    }
  }

  return (
    <div className="tx-align-container">
      {mismatch && (
        <div className="tx-align-mismatch-banner">
          段落数不一致：原文 {origParas.length} 段，{label} {resultParas.length} 段，已按序号对齐
        </div>
      )}
      {Array.from({ length: maxLen }, (_, i) => {
        const orig = origParas[i]
        const res = resultParas[i]
        return (
          <div key={i} className="tx-align-row">
            <span className="tx-align-idx">{String(i + 1).padStart(2, '0')}</span>
            <div className="tx-align-cols">
              <div className="tx-align-cell tx-align-orig">
                <div className="tx-align-cell-label">原文</div>
                <div className="tx-align-cell-text">
                  {orig || <span className="tx-align-missing">（无对应段落）</span>}
                </div>
                {orig && (
                  <button
                    className="tx-align-copy"
                    onClick={() => handleCopy(orig, i * 2)}
                  >
                    {copiedIdx === i * 2 ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                )}
              </div>
              <div className="tx-align-cell tx-align-result">
                <div className="tx-align-cell-label">{label}</div>
                <div className="tx-align-cell-text">
                  {res || <span className="tx-align-missing">（无对应段落）</span>}
                </div>
                {res && (
                  <button
                    className="tx-align-copy"
                    onClick={() => handleCopy(res, i * 2 + 1)}
                  >
                    {copiedIdx === i * 2 + 1 ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function TextResultPage() {
  const { workspaceId = '', itemId = '' } = useParams<{ workspaceId: string; itemId: string }>()
  const navigate = useNavigate()

  type FetchState =
    | { kind: 'loading' }
    | { kind: 'ready'; data: TextResult }
    | { kind: 'error'; message: string }
  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'loading' })
  const [favored, setFavored] = useState(false)
  const [highlightedCharRange, setHighlightedCharRange] = useState<[number, number] | null>(null)

  // N10: 折叠状态
  const [assocOpen, setAssocOpen] = useState(true)
  const [rewriteOpen, setRewriteOpen] = useState(true)
  const [translateOpen, setTranslateOpen] = useState(true)
  const [contentTab, setContentTab] = useState<'content' | 'summary' | 'chat'>('content')

  // T2: 在线编辑模式
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSavedRef = useRef<string | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // N10: 多文对比弹窗
  const [compareState, setCompareState] = useState<
    | { kind: 'closed' }
    | { kind: 'loading' }
    | { kind: 'ready'; data: TextCompareResult }
    | { kind: 'error'; message: string }
  >({ kind: 'closed' })

  // M5: 导出菜单
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!exportMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [exportMenuOpen])

  useEffect(() => {
    let cancelled = false
    getTextItemResult(workspaceId, itemId)
      .then((data) => {
        if (!cancelled) setFetchState({ kind: 'ready', data })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '加载笔记失败'
        setFetchState({ kind: 'error', message })
      })
    return () => { cancelled = true }
  }, [workspaceId, itemId])

  const result = fetchState.kind === 'ready' ? fetchState.data : null
  const promptVersions = result?.prompt_versions ?? []

  const chatSystemPrompt = useMemo(() => {
    if (!result) return ''
    const parts: string[] = [
      '你正在协助用户理解一篇文章。回答时基于下方提供的文章全文和摘要，不要编造文章里没有的信息。',
      '',
      '【文章全文】',
      result.content || '（暂无内容）',
    ]
    if (result.summary) {
      const summaryText = typeof result.summary === 'string'
        ? result.summary
        : [result.summary.abstract, ...(result.summary.key_points?.map(kp => kp.text) ?? [])].filter(Boolean).join('\n')
      if (summaryText) {
        parts.push('', '【摘要】', summaryText)
      }
    }
    parts.push('', '回答指引：基于上述文章内容作答；回答使用中文。')
    return parts.join('\n')
  }, [result])

  const handleAddVersion = useCallback(async (content: string) => {
    const pv = await addPromptVersion(workspaceId, itemId, content)
    setFetchState((prev) => {
      if (prev.kind !== 'ready') return prev
      return {
        kind: 'ready',
        data: { ...prev.data, prompt_versions: [...prev.data.prompt_versions, pv] },
      }
    })
    toast.success(`已保存 v${pv.version}`)
  }, [workspaceId, itemId])

  const handleFavorite = useCallback(() => {
    setFavored((prev) => {
      const next = !prev
      toast.success(next ? '已收藏此文稿' : '已取消收藏')
      return next
    })
  }, [])

  const scrollToCharRange = useCallback((charStart: number, charEnd: number, paraIndex?: number) => {
    const content = fetchState.kind === 'ready' ? fetchState.data.content : ''
    const paras = content.split(/\n{2,}/)
    let targetPara = paraIndex ?? 0
    if (paraIndex === undefined && charStart > 0) {
      let cum = 0
      for (let i = 0; i < paras.length; i++) {
        if (charStart < cum + paras[i].length) { targetPara = i; break }
        cum += paras[i].length + 2
      }
    }
    const el = document.getElementById(`tx-para-${targetPara}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (charStart > 0 && charEnd > charStart) {
      setHighlightedCharRange([charStart, charEnd])
      setTimeout(() => setHighlightedCharRange(null), 3000)
    }
  }, [fetchState])

  // N10: 多文对比
  const handleCompare = useCallback(async () => {
    setCompareState({ kind: 'loading' })
    try {
      const data = await getTextCompare(workspaceId, itemId)
      setCompareState({ kind: 'ready', data })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '多文对比失败'
      setCompareState({ kind: 'error', message })
    }
  }, [workspaceId, itemId])

  // M5: 导出文章笔记
  const handleExportMarkdown = useCallback(async () => {
    try {
      await exportTextNote(workspaceId, itemId, 'md')
    } catch (err) {
      console.error('Markdown 导出失败:', err)
      toast.error('Markdown 导出失败，请重试')
    }
    setExportMenuOpen(false)
  }, [workspaceId, itemId])

  const handleExportObsidian = useCallback(async () => {
    try {
      await exportTextNote(workspaceId, itemId, 'obsidian')
    } catch (err) {
      console.error('Obsidian 导出失败:', err)
      toast.error('Obsidian 包导出失败，请重试')
    }
    setExportMenuOpen(false)
  }, [workspaceId, itemId])

  // T2: 进入编辑模式
  const handleStartEdit = useCallback(() => {
    if (!result) return
    setEditContent(result.content)
    lastSavedRef.current = result.content
    setIsEditing(true)
    setSaveState('idle')
  }, [result])

  // T2: 退出编辑模式
  const handleCancelEdit = useCallback(() => {
    clearTimeout(debounceTimer.current)
    setIsEditing(false)
    setSaveState('idle')
  }, [])

  // T2: 自动保存（1500ms debounce，复用 ln 模式）
  useEffect(() => {
    if (!isEditing) return
    if (editContent === lastSavedRef.current) return

    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(async () => {
      setSaveState('saving')
      try {
        await updateTextContent(workspaceId, itemId, editContent)
        lastSavedRef.current = editContent
        setSaveState('saved')
        // 同步到 fetchState 以便退出编辑后显示最新内容
        setFetchState((prev) => {
          if (prev.kind !== 'ready') return prev
          return { kind: 'ready', data: { ...prev.data, content: editContent } }
        })
      } catch {
        setSaveState('error')
      }
    }, 1500)

    return () => clearTimeout(debounceTimer.current)
  }, [editContent, isEditing, workspaceId, itemId])

  if (fetchState.kind === 'loading') {
    return (
      <div className="vm-text-scope" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <span className="mono" style={{ color: 'var(--mut)' }}>加载笔记…</span>
      </div>
    )
  }
  if (fetchState.kind === 'error' || !result) {
    return (
      <div
        className="vm-text-scope"
        style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}
      >
        <span style={{ color: 'var(--err)', fontWeight: 600 }}>
          {fetchState.kind === 'error' ? fetchState.message : '没有可显示的笔记'}
        </span>
        <button className="btn-ghost" style={{ padding: '6px 12px' }} onClick={() => navigate(-1)}>
          <ArrowLeft size={14} /> 返回
        </button>
      </div>
    )
  }

  const hasAssociations = result.associations && Object.keys(result.associations).length > 0
  const hasRewrites = result.rewrites && Object.keys(result.rewrites).length > 0
  const hasTranslations = result.translations && Object.keys(result.translations).length > 0

  return (
    <div className="vm-text-scope tx-layout">
      {/* ════════ 左：正文 ════════ */}
      <div className="tx-left">
        {/* 顶部导航 */}
        <div className="vd-nav">
          <button className="btn-ghost" onClick={() => navigate(-1)} style={{ height: 28, padding: '0 10px', fontSize: 12 }}>
            <ArrowLeft size={13} /> 返回
          </button>
          <span className="vd-sep" />
          <span className="vd-title">{result.title}</span>
          <span className="kw mono" style={{ fontSize: 10, flexShrink: 0 }}>TEXT</span>
          <button
            className="btn-ghost"
            style={{ height: 24, padding: '0 8px', fontSize: 11, gap: 4, marginLeft: 6, borderRadius: 4, border: '1px solid var(--border)' }}
            onClick={() => navigate(`/workspaces/${workspaceId}/items/${itemId}/note`)}
            title="打开统一笔记（NoteShell）"
          >
            <FileText size={12} /> 统一笔记 <span style={{ fontSize: 9, opacity: 0.6 }}>beta</span>
          </button>
          <div style={{ flex: 1 }} />
          {/* M5: 导出菜单 */}
          <div className="tx-export-menu-wrapper" ref={exportMenuRef}>
            <button
              className="btn-ghost"
              style={{ height: 28, padding: '0 10px', fontSize: 12 }}
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              title="导出"
            >
              <Download size={13} /> 导出 <ChevronDown size={12} />
            </button>
            {exportMenuOpen && (
              <div className="tx-export-menu">
                <button onClick={handleExportMarkdown}>导出 Markdown</button>
                <button onClick={handleExportObsidian}>Obsidian 包</button>
              </div>
            )}
          </div>
          {/* T2: 编辑按钮 + 保存状态 */}
          {isEditing ? (
            <>
              <span className="tx-save-status" data-state={saveState}>
                {saveState === 'saving' && '保存中…'}
                {saveState === 'saved' && '已保存'}
                {saveState === 'error' && '保存失败'}
              </span>
              <button
                className="btn-ghost"
                style={{ height: 28, padding: '0 10px', fontSize: 12 }}
                onClick={handleCancelEdit}
              >
                完成
              </button>
            </>
          ) : (
            <button
              className="btn-ghost"
              style={{ height: 28, padding: '0 10px', fontSize: 12 }}
              onClick={handleStartEdit}
              title="编辑正文"
            >
              <Pencil size={13} /> 编辑
            </button>
          )}
        </div>

        {/* 标签展示 */}
        <div style={{ padding: '10px 20px 0', flexShrink: 0 }}>
          <ItemTagsPanel workspaceId={workspaceId} itemId={itemId} />
        </div>

        {/* 正文区域 */}
        <div className="tx-content-scroll">
          {isEditing ? (
            <textarea
              className="tx-edit-textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              spellCheck={false}
            />
          ) : (
          <div className="tx-content-body">
            {(() => {
              const paras = result.content.split(/\n{2,}/)
              let cum = 0
              return paras.map((para, i) => {
                const paraStart = cum
                cum += para.length + 2
                let children: React.ReactNode = para
                if (highlightedCharRange) {
                  const [hs, he] = highlightedCharRange
                  const localStart = Math.max(0, hs - paraStart)
                  const localEnd = Math.min(para.length, he - paraStart)
                  if (localStart < localEnd && localStart < para.length) {
                    children = (
                      <>
                        {para.slice(0, localStart)}
                        <mark className="tx-char-hl">{para.slice(localStart, localEnd)}</mark>
                        {para.slice(localEnd)}
                      </>
                    )
                  }
                }
                return (
                  <div key={i} id={`tx-para-${i}`} className="tx-para">
                    {children}
                  </div>
                )
              })
            })()}
          </div>
          )}
        </div>
      </div>

      {/* ════════ 右：摘要 + 联想 + 改写翻译 + 元信息 + 版本栈 ════════ */}
      <div className="tx-right">
        <div className="tx-right-header">
          <div style={{ display: 'flex', gap: 0 }}>
            <button className="vd-tab-btn" data-active={contentTab === 'content'} onClick={() => setContentTab('content')}>
              摘要
            </button>
            <button className="vd-tab-btn" data-active={contentTab === 'summary'} onClick={() => setContentTab('summary')}>
              总结
            </button>
            <button className="vd-tab-btn" data-active={contentTab === 'chat'} onClick={() => setContentTab('chat')}>
              问答
            </button>
          </div>
          {contentTab === 'content' && (
            <button className="tx-compare-btn" onClick={handleCompare}>
              <Layers size={12} /> 多文对比
            </button>
          )}
          {contentTab === 'chat' && <div style={{ flex: 1 }} />}
        </div>

        <div className="tx-right-scroll" data-tab={contentTab}>
          {contentTab === 'chat' ? (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <NoteChatDrawer
                workspaceId={workspaceId}
                systemPrompt={chatSystemPrompt}
                scopeHint="仅基于本篇文章内容回答"
                mode="inline"
              />
            </div>
          ) : contentTab === 'summary' ? (
            <div style={{ flex: 1, overflow: 'hidden', height: '100%' }}>
              <SummariesTab workspaceId={workspaceId} itemId={itemId} />
            </div>
          ) : (
          <>
          {/* 摘要 — T1.1: 支持结构化摘要 */}
          {renderSummary(result.summary, scrollToCharRange)}

          {/* N10: 联想归纳 */}
          {hasAssociations && (
            <div className="im-section">
              <button className="tx-collapse-btn" onClick={() => setAssocOpen(!assocOpen)}>
                {assocOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="eyebrow">联想归纳</span>
              </button>
              {assocOpen && (
                <div className="tx-section-body">
                  {Object.entries(result.associations!).map(([dir, text]) => (
                    <div key={dir} className="tx-section-item">
                      <div className="tx-section-item-label">{dir}</div>
                      <div>{text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* T1.2: 改写/润色 — 逐段对照 */}
          {hasRewrites && (
            <div className="im-section">
              <button className="tx-collapse-btn" onClick={() => setRewriteOpen(!rewriteOpen)}>
                {rewriteOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="eyebrow">改写 / 润色</span>
              </button>
              {rewriteOpen && (
                <div className="tx-section-body">
                  {Object.entries(result.rewrites!).map(([style, val]) => (
                    <div key={style} className="tx-section-item">
                      <div className="tx-section-item-label">{style}</div>
                      <ParagraphAlignView
                        originalContent={result.content}
                        result={val}
                        label={style}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* T1.2: 翻译 — 逐段对照 */}
          {hasTranslations && (
            <div className="im-section">
              <button className="tx-collapse-btn" onClick={() => setTranslateOpen(!translateOpen)}>
                {translateOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="eyebrow">翻译</span>
              </button>
              {translateOpen && (
                <div className="tx-section-body">
                  {Object.entries(result.translations!).map(([lang, val]) => (
                    <div key={lang} className="tx-section-item">
                      <div className="tx-section-item-label">{lang}</div>
                      <ParagraphAlignView
                        originalContent={result.content}
                        result={val}
                        label={lang}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 元信息 */}
          <div className="im-section">
            <div className="eyebrow" style={{ marginBottom: 6 }}>元信息</div>
            <div className="tx-meta-body">
              <div>来源类型：{result.source_type}</div>
              <div>字符数：{result.char_count.toLocaleString()}</div>
              {result.source_url && <div>来源：{result.source_url}</div>}
            </div>
          </div>

          {/* 提示词版本栈 */}
          <PromptVersionStack
            versions={promptVersions}
            onAddVersion={handleAddVersion}
          />
          </>
          )}
        </div>

        {/* 底部操作（问答 tab 时隐藏，聊天输入区已占底部） */}
        {contentTab !== 'chat' && (
        <div className="tx-actions">
          <button
            className="tx-btn-sub"
            data-favored={favored}
            onClick={handleFavorite}
          >
            <Star
              size={14}
              fill={favored ? 'var(--wrn)' : 'none'}
              color={favored ? 'var(--wrn)' : 'currentColor'}
            />
            {favored ? '已收藏' : '收藏'}
          </button>
        </div>
        )}
      </div>

      {/* N10: 多文对比弹窗 */}
      {compareState.kind !== 'closed' && (
        <TextCompareModal
          state={compareState}
          onClose={() => setCompareState({ kind: 'closed' })}
        />
      )}
    </div>
  )
}

// ── 多文对比弹窗 ──────────────────────────────────────────────

function TextCompareModal({
  state,
  onClose,
}: {
  state:
    | { kind: 'loading' }
    | { kind: 'ready'; data: TextCompareResult }
    | { kind: 'error'; message: string }
  onClose: () => void
}) {
  return (
    <div className="vm-text-scope tx-compare-overlay" onClick={onClose}>
      <div className="tx-compare-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tx-compare-header">
          <span className="tx-compare-title">多文对比</span>
          <button className="tx-compare-close" onClick={onClose}>×</button>
        </div>
        <div className="tx-compare-body">
          {state.kind === 'loading' && (
            <div className="tx-compare-status">加载对比数据…</div>
          )}
          {state.kind === 'error' && (
            <div className="tx-compare-status" data-error="true">{state.message}</div>
          )}
          {state.kind === 'ready' && (
            <TextCompareContent data={state.data} />
          )}
        </div>
      </div>
    </div>
  )
}

function TextCompareContent({ data }: { data: TextCompareResult }) {
  const items = data.texts.filter((t) => t.has_result)
  if (items.length === 0) {
    return <div className="tx-compare-status">没有已完成分析的文字素材</div>
  }

  return (
    <div>
      {/* LLM 对比总结（与 CompareTab 对齐：表格上方 + sunken 背景） */}
      {data.llm_summary && (
        <div
          style={{
            padding: '14px 18px',
            background: 'var(--bgalt)',
            borderRadius: 'var(--radius)',
            marginBottom: 16,
            fontSize: 13,
            lineHeight: 1.7,
            color: 'var(--fg2)',
          }}
        >
          <span className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>
            AI 对比总结
          </span>
          {data.llm_summary}
        </div>
      )}

      {/* 对比表格（与 CompareTab 对齐：素材/摘要/内容预览/字数） */}
      <table className="tx-compare-table">
        <thead>
          <tr>
            <th>素材</th>
            <th>摘要</th>
            <th>内容预览</th>
            <th>字数</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.item_id} data-current={t.is_current}>
              <td className="name-cell" data-current={t.is_current}>{t.name}</td>
              <td className="summary-cell" style={{ fontSize: 12, maxWidth: 280 }}>
                {(typeof t.summary === 'string' ? t.summary : t.summary?.abstract) || <span style={{ color: 'var(--mut)' }}>—</span>}
              </td>
              <td style={{ fontSize: 12, maxWidth: 300 }}>
                {t.content_preview || <span style={{ color: 'var(--mut)' }}>—</span>}
              </td>
              <td style={{ fontSize: 12, color: 'var(--mut)', textAlign: 'right' }}>{t.char_count.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
