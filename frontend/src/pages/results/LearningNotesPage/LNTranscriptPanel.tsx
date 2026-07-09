import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileCode, Globe, Loader2, Quote } from 'lucide-react'
import { toast } from 'sonner'
import type { VideoResultTranscriptLine } from '@/services/workspaces'
import { updateTranscriptSegment, translateTranscriptSegments } from '@/services/workspaces'
import type { TranscriptTranslations } from '@/types/workspace'
import { useLnEditorStore } from '@/store/lnEditorStore'

type TranscriptMode = 'original' | 'bilingual' | 'translated'

const TRANSLATE_LANGS: { value: string; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
]

const langLabel = (lang: string) => TRANSLATE_LANGS.find((l) => l.value === lang)?.label ?? lang

function extractTranslateErrorMessage(error: unknown): string {
  const err = error as {
    code?: string
    message?: string
    response?: { data?: { detail?: unknown } }
  }
  const detail = err.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (err.code === 'ECONNABORTED') return '翻译超时，请稍后重试'
  if (err.message?.trim()) return err.message.trim()
  return '翻译失败'
}

interface LNTranscriptPanelProps {
  transcript: VideoResultTranscriptLine[]
  currentTime: number
  onSeek: (sec: number) => void
  workspaceId: string
  itemId: string
  /** 字幕保存成功后回调（父组件可借此刷新 source.md 展示） */
  onSaved?: () => void
  /** 原始素材 Markdown（有值时显示「字幕/原始素材」切换 tab） */
  sourceMd?: string
  /** 已有的译文缓存（key=目标语言，value={idx→text} 或 [{idx,text}]） */
  translations?: TranscriptTranslations | null
  title?: string
  countLabel?: string
}

function activeTranscriptIdx(
  transcript: VideoResultTranscriptLine[],
  currentSec: number,
): number {
  let best = -1
  for (let i = 0; i < transcript.length; i++) {
    if (transcript[i].t_sec <= currentSec) best = i
  }
  return best
}

function translationMapForLang(
  translations: TranscriptTranslations | null | undefined,
  lang: string,
): Record<number, string> | null {
  const value = translations?.[lang]
  if (!value) return null

  const map: Record<number, string> = {}
  if (Array.isArray(value)) {
    for (const seg of value) {
      if (typeof seg.idx === 'number' && seg.text) map[seg.idx] = seg.text
    }
  } else {
    for (const [idx, text] of Object.entries(value)) {
      const n = Number(idx)
      if (Number.isFinite(n) && text) map[n] = text
    }
  }
  return Object.keys(map).length > 0 ? map : null
}

function normalizeTranslations(
  translations: TranscriptTranslations | null | undefined,
): Record<string, Record<number, string>> {
  const cache: Record<string, Record<number, string>> = {}
  if (!translations) return cache
  for (const lang of Object.keys(translations)) {
    const normalized = translationMapForLang(translations, lang)
    if (normalized) cache[lang] = normalized
  }
  return cache
}

export default function LNTranscriptPanel({
  transcript,
  currentTime,
  onSeek,
  workspaceId,
  itemId,
  onSaved,
  sourceMd,
  translations,
  title = '转录',
  countLabel,
}: LNTranscriptPanelProps) {
  const [mode, setMode] = useState<TranscriptMode>('original')
  const [showSourceMd, setShowSourceMd] = useState(false)
  const [translateLang, setTranslateLang] = useState('zh')
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState('')
  const [translationCache, setTranslationCache] = useState<Record<string, Record<number, string>>>(
    () => normalizeTranslations(translations),
  )
  const localTranslations = translationCache[translateLang] ?? null
  const translatableCount = useMemo(
    () => transcript.filter((line) => String(line.text || '').trim()).length,
    [transcript],
  )
  const translatedCount = useMemo(() => {
    if (!localTranslations) return 0
    let count = 0
    for (let i = 0; i < transcript.length; i++) {
      if (!String(transcript[i]?.text || '').trim()) continue
      if (String(localTranslations[i] || '').trim()) count += 1
    }
    return count
  }, [localTranslations, transcript])
  const hasCachedTranslation = Boolean(localTranslations)
  const hasTranslation = translatableCount > 0 && translatedCount === translatableCount
  const hasPartialTranslation = hasCachedTranslation && !hasTranslation
  const activeIdx = useMemo(
    () => activeTranscriptIdx(transcript, currentTime),
    [transcript, currentTime],
  )
  const activeRef = useRef<HTMLDivElement>(null)
  const insertAtCursor = useLnEditorStore((s) => s.insertAtCursor)

  // ── 双击编辑状态 ──
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  // 乐观更新：保存成功后立即在面板回显新文字（key=段下标），免刷新；重进页面组件重挂即清空
  const [localEdits, setLocalEdits] = useState<Record<number, string>>({})

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeIdx])

  const handleEditSave = useCallback(
    async (idx: number) => {
      const trimmed = editText.trim()
      const current = localEdits[idx] ?? transcript[idx]?.text ?? ''
      if (trimmed === current) {
        setEditingIdx(null)
        return
      }
      try {
        await updateTranscriptSegment(workspaceId, itemId, idx, trimmed)
        // 乐观更新：空内容 = 恢复原文（移除 override 回退到原 text），否则记下新文字
        setLocalEdits((prev) => {
          const next = { ...prev }
          if (trimmed) next[idx] = trimmed
          else delete next[idx]
          return next
        })
        toast.success('字幕已保存')
        onSaved?.()
      } catch {
        toast.error('保存失败，请重试')
      }
      setEditingIdx(null)
    },
    [editText, transcript, workspaceId, itemId, localEdits, onSaved],
  )

  const handleEditCancel = useCallback(() => {
    setEditingIdx(null)
    setEditText('')
  }, [])

  const handleTranslate = useCallback(async () => {
    setTranslating(true)
    setTranslateError('')
    try {
      const res = await translateTranscriptSegments(
        workspaceId,
        itemId,
        translateLang,
        hasCachedTranslation,
      )
      const idxMap: Record<number, string> = {}
      for (const s of res.segments) {
        if (s.text) idxMap[s.idx] = s.text
      }
      const filled = transcript.reduce((count, line, idx) => {
        if (!String(line.text || '').trim()) return count
        return String(idxMap[idx] || '').trim() ? count + 1 : count
      }, 0)
      if (filled !== translatableCount) {
        throw new Error(`字幕翻译结果不完整：${filled}/${translatableCount} 条`)
      }
      setTranslationCache((prev) => ({ ...prev, [translateLang]: idxMap }))
      setMode('translated')
      toast.success(res.cached ? '已加载缓存译文' : '翻译完成')
    } catch (error) {
      const message = extractTranslateErrorMessage(error)
      setTranslateError(message)
      toast.error(message)
    }
    setTranslating(false)
  }, [workspaceId, itemId, translateLang, hasCachedTranslation, transcript, translatableCount])

  useEffect(() => {
    const next = normalizeTranslations(translations)
    if (Object.keys(next).length === 0) return
    setTranslationCache((prev) => ({ ...next, ...prev }))
  }, [translations])

  const handleLanguageChange = useCallback((lang: string) => {
    setTranslateLang(lang)
    setTranslateError('')
    const cached = translationCache[lang]
    if (!cached) {
      setMode('original')
      return
    }
    let filled = 0
    let total = 0
    for (let i = 0; i < transcript.length; i++) {
      if (!String(transcript[i]?.text || '').trim()) continue
      total += 1
      if (String(cached[i] || '').trim()) filled += 1
    }
    setMode(total > 0 && filled === total ? 'translated' : 'original')
  }, [translationCache, transcript])

  function handleQuote(line: VideoResultTranscriptLine, text: string, e: React.MouseEvent) {
    e.stopPropagation()
    const md = `> [${line.t_str}] ${text}\n`
    const inserted = insertAtCursor(md)
    if (inserted) {
      toast.success('已引用字幕')
    } else {
      toast.error('请先切到 MD 视图')
    }
  }

  if (transcript.length === 0) {
    return (
      <div className="ln-transcript-panel">
        <div className="ln-tr-empty">暂无字幕轨（该素材未生成转录）</div>
      </div>
    )
  }

  return (
    <div className="ln-transcript-panel">
      <div className="ln-tr-head">
        <div className="ln-tr-head-main">
          <span className="ln-tr-title">{title}</span>
          <span className="ln-tr-count">{countLabel ?? `${transcript.length} 条`}</span>
          {hasTranslation && (
            <span className="ln-tr-status">已译 {langLabel(translateLang)}</span>
          )}
          {hasPartialTranslation && (
            <span className="ln-tr-status ln-tr-status--warning">
              译文不完整 {translatedCount}/{translatableCount}
            </span>
          )}
          {translating && (
            <span className="ln-tr-status ln-tr-status--loading">正在生成译文</span>
          )}
          {translateError && (
            <span className="ln-tr-status ln-tr-status--error">{translateError}</span>
          )}
        </div>
        <div className="ln-tr-head-tools">
          <div className="ln-tr-display-tabs" aria-label="字幕显示模式">
            <button
              className="ln-tr-tab"
              data-active={mode === 'original' ? 'true' : undefined}
              onClick={() => setMode('original')}
            >
              原文
            </button>
            <button
              className="ln-tr-tab"
              data-active={mode === 'bilingual' ? 'true' : undefined}
              disabled={!hasTranslation || translating}
              onClick={() => setMode('bilingual')}
            >
              双语
            </button>
            <button
              className="ln-tr-tab"
              data-active={mode === 'translated' ? 'true' : undefined}
              disabled={!hasTranslation || translating}
              onClick={() => setMode('translated')}
            >
              译文
            </button>
          </div>
          <div className="ln-tr-translate-actions">
            <label className="ln-tr-lang">
              <span>译为</span>
              <select
                className="ln-tr-lang-select"
                value={translateLang}
                disabled={translating}
                onChange={(e) => handleLanguageChange(e.target.value)}
              >
                {TRANSLATE_LANGS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </label>
            <button
              className="ln-tr-translate-btn"
              data-variant={hasCachedTranslation ? 'secondary' : 'primary'}
              disabled={translating}
              onClick={handleTranslate}
            >
              {translating ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Globe size={13} />
              )}
              <span>
                {translating ? '翻译中...' : translateError ? '重试' : hasCachedTranslation ? '重新翻译' : '翻译'}
              </span>
            </button>
          </div>
        </div>
      </div>
      {/* 顶层切换：字幕 | 原始素材（仅当 sourceMd 有值时显示） */}
      {sourceMd && (
        <div className="ln-tr-mode-tabs">
          <button
            className="ln-tr-tab"
            data-active={!showSourceMd ? 'true' : undefined}
            onClick={() => setShowSourceMd(false)}
          >
            字幕
          </button>
          <button
            className="ln-tr-tab"
            data-active={showSourceMd ? 'true' : undefined}
            onClick={() => setShowSourceMd(true)}
          >
            <FileCode size={11} style={{ marginRight: 3 }} /> 原始素材
          </button>
        </div>
      )}
      {showSourceMd ? (
        <div style={{ padding: '10px 14px', fontSize: 13, lineHeight: 1.7, color: 'var(--ink-2)', overflowY: 'auto' }}>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{sourceMd}</pre>
        </div>
      ) : (
        <>
          {transcript.map((line, i) => {
            const isEditing = editingIdx === i
            const displayText = localEdits[i] ?? line.text
            const speakerPrefix = line.speaker ? `[${line.speaker}] ` : ''
            const translatedText = localTranslations?.[i]
            const quoteText = mode === 'translated' || mode === 'bilingual'
              ? translatedText || displayText
              : displayText
            return (
              <div
                key={`${line.t_sec}-${i}`}
                ref={i === activeIdx ? activeRef : undefined}
                className="ln-tr-row"
                data-active={i === activeIdx}
                onClick={() => !isEditing && onSeek(line.t_sec)}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditingIdx(i)
                  setEditText(displayText)
                }}
              >
                <span className="ln-tr-time">{line.t_str}</span>
                {isEditing ? (
                  <input
                    className="ln-tr-edit-input"
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleEditSave(i)
                      if (e.key === 'Escape') handleEditCancel()
                    }}
                    onBlur={() => handleEditSave(i)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="ln-tr-text">
                    {mode !== 'translated' && (
                      <span className={mode === 'bilingual' && translatedText ? 'ln-tr-original' : undefined}>
                        {speakerPrefix}{displayText}
                      </span>
                    )}
                    {mode === 'bilingual' && translatedText && (
                      <span className="ln-tr-translated">{translatedText}</span>
                    )}
                    {mode === 'translated' && (
                      <span className="ln-tr-translated">{translatedText || displayText}</span>
                    )}
                  </span>
                )}
                <button
                  className="ln-tr-quote"
                  title="引用到笔记"
                  onClick={(e) => handleQuote(line, quoteText, e)}
                >
                  <Quote size={12} />
                </button>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
