import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, FileText, X } from 'lucide-react'

export type ExportContentKind = 'transcript' | 'summary' | 'media'
export type ExportLanguage = 'bilingual' | 'translation' | 'source'
export type ExportDestination = 'local' | 'notion' | 'feishu' | 'obsidian'

export interface ExportPlan {
  content: ExportContentKind
  format: string
  options: {
    withSpeaker: boolean
    withTimestamp: boolean
    language: ExportLanguage
  }
  destination: ExportDestination
}

interface NoteExportPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId: string
  title: string
  isVideoNote: boolean
  isAudioNote: boolean
  hasSpeakerData: boolean
  translationsAvailable: boolean
  onExport: (plan: ExportPlan) => void
  onCloud: (destination: Exclude<ExportDestination, 'local'>) => void
}

const STORAGE_PREFIX = 'nibi.note.export'

interface StoredState {
  content: ExportContentKind
  format: string
  withSpeaker: boolean
  withTimestamp: boolean
  language: ExportLanguage
  destination: ExportDestination
}

const LANGUAGE_KEY: Record<ExportLanguage, 'bilingual' | 'translation' | 'source'> = {
  bilingual: 'bilingual',
  translation: 'translation',
  source: 'source',
}

const TRANSCRIPT_TIMELINE_FORMATS = [
  { value: 'srt', label: 'SRT' },
  { value: 'vtt', label: 'VTT' },
  { value: 'ass', label: 'ASS' },
]

const TRANSCRIPT_DOC_FORMATS = [
  { value: 'txt', label: 'TXT' },
  { value: 'docx', label: 'Word' },
  { value: 'md', label: 'Markdown' },
]

const SUMMARY_FORMATS = [
  { value: 'md', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word' },
  { value: 'pptx', label: 'PPT' },
  { value: 'long_image', label: 'Long Image' },
]

function readStoredState(itemId: string): StoredState | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}.${itemId}`)
    if (!raw) return null
    return JSON.parse(raw) as StoredState
  } catch {
    return null
  }
}

export function NoteExportPanel({
  open,
  onOpenChange,
  itemId,
  title,
  isVideoNote,
  isAudioNote,
  hasSpeakerData,
  translationsAvailable,
  onExport,
  onCloud,
}: NoteExportPanelProps) {
  const { t } = useTranslation('note')
  const stored = useMemo(() => readStoredState(itemId), [itemId])
  const [content, setContent] = useState<ExportContentKind>('transcript')
  const [format, setFormat] = useState('srt')
  const [withSpeaker, setWithSpeaker] = useState(false)
  const [withTimestamp, setWithTimestamp] = useState(true)
  const [withSubtitle, setWithSubtitle] = useState(false)
  const [language, setLanguage] = useState<ExportLanguage>('bilingual')
  const [destination, setDestination] = useState<ExportDestination>('local')

  useEffect(() => {
    if (!open) return
    setContent(stored?.content ?? 'transcript')
    setFormat(stored?.format ?? 'srt')
    setWithSpeaker(stored?.withSpeaker ?? false)
    setWithTimestamp(stored?.withTimestamp ?? true)
    setLanguage(stored?.language ?? 'bilingual')
    setDestination(stored?.destination ?? 'local')
  }, [open, stored])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  const effectiveLanguage: ExportLanguage = translationsAvailable
    ? language
    : 'source'
  const isTimelineFormat = content === 'transcript'
    && TRANSCRIPT_TIMELINE_FORMATS.some((item) => item.value === format)

  const formats = content === 'summary'
    ? SUMMARY_FORMATS
    : content === 'media'
      ? []
      : TRANSCRIPT_DOC_FORMATS

  const mediaFormats = content === 'media'
    ? isAudioNote
      ? [{ value: 'audio', label: t('export.audioOnly') }]
      : [{ value: 'original', label: t('export.originalVideo') }]
    : []

  const filename = useMemo(() => {
    const safeTitle = (title || 'untitled').replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 60) || 'media'
    if (content === 'transcript') {
      const lang = t(`export.${LANGUAGE_KEY[effectiveLanguage]}`)
      const speaker = withSpeaker ? '_with_speaker' : ''
      return `${safeTitle}_${t('export.transcript')}_${lang}${speaker}.${format}`
    }
    if (content === 'summary') {
      return `${safeTitle}_${t('export.summary')}.${format}`
    }
    if (content === 'media') {
      if (withSubtitle && format === 'original') return `${safeTitle}_视频_${t(`export.${LANGUAGE_KEY[effectiveLanguage]}`)}字幕.zip`
      if (format === 'original') return `${safeTitle}_video_original.mp4`
      if (format === 'audio') return `${safeTitle}_audio.m4a`
      if (format === 'burn') return `${safeTitle}_视频_${t(`export.${LANGUAGE_KEY[effectiveLanguage]}`)}字幕.mp4`
      return `${safeTitle}_video_${t(`export.${LANGUAGE_KEY[effectiveLanguage]}`)}_subs.zip`
    }
    return safeTitle
  }, [title, content, format, effectiveLanguage, withSpeaker, withSubtitle, t])

  const selectFormat = (value: string) => {
    setFormat(value)
  }

  const handlePrimary = () => {
    const effectiveFormat = content === 'media' && format === 'original' && withSubtitle
      ? 'softsub-srt'
      : format
    const plan: ExportPlan = {
      content,
      format: effectiveFormat,
      options: {
        withSpeaker,
        withTimestamp,
        language: effectiveLanguage,
      },
      destination,
    }
    try {
      localStorage.setItem(
        `${STORAGE_PREFIX}.${itemId}`,
        JSON.stringify({
          content,
          format,
          withSpeaker,
          withTimestamp,
          language: effectiveLanguage,
          destination,
        }),
      )
    } catch {
      /* 忽略 localStorage 失败 */
    }
    if (destination === 'local') onExport(plan)
    else onCloud(destination as Exclude<ExportDestination, 'local'>)
  }

  if (!open) return null

  const cloudDisabled = content === 'media'

  return (
    <div
      className="nibi-export-panel-backdrop"
      onMouseDown={() => onOpenChange(false)}
    >
      <section
        className="nibi-export-panel"
        role="dialog"
        aria-modal="true"
        aria-label="导出"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="nibi-export-panel-head">
          <div>
            <strong>{t('export.title')}</strong>
            <span>{t('export.stepContent').slice(4)} × {t('export.stepFormat').slice(4)} × {t('export.stepOptions').slice(4)} × {t('export.stepDestination').slice(4)}</span>
          </div>
          <button type="button" aria-label={t('export.title')} onClick={() => onOpenChange(false)}>
            <X size={15} />
          </button>
        </header>

        <div className="nibi-export-step">
          <div className="nibi-export-step-label">{t('export.stepContent')}</div>
          <div className="nibi-export-segment" role="radiogroup" aria-label="导出内容">
            {([
              { value: 'transcript', label: t('export.transcript') },
              { value: 'summary', label: t('export.summary') },
              ...(isVideoNote || isAudioNote ? [{ value: 'media', label: t('export.media') }] : []),
            ] as Array<{ value: ExportContentKind; label: string }>).map((item) => (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={content === item.value}
                className={content === item.value ? 'is-active' : ''}
                onClick={() => {
                  setContent(item.value)
                  setFormat(
                    item.value === 'transcript' ? 'srt'
                      : item.value === 'summary' ? 'md'
                        : isAudioNote ? 'audio' : 'original',
                  )
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="nibi-export-step">
          <div className="nibi-export-step-label">{t('export.stepFormat')}</div>
          {content === 'media' ? (
            <div className="nibi-export-segment" role="radiogroup" aria-label="媒体格式">
              {mediaFormats.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={format === item.value}
                  className={format === item.value ? 'is-active' : ''}
                  onClick={() => selectFormat(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : (
            <>
              {content === 'transcript' && (
                <div className="nibi-export-format-group">
                  <span>{t('export.timelineFormats')}</span>
                  <div className="nibi-export-segment" role="radiogroup" aria-label="时间轴格式">
                    {TRANSCRIPT_TIMELINE_FORMATS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        role="radio"
                        aria-checked={format === item.value}
                        className={format === item.value ? 'is-active' : ''}
                        onClick={() => selectFormat(item.value)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="nibi-export-format-group">
                <span>{content === 'transcript' ? t('export.docFormats') : t('export.summaryFormats')}</span>
                <div className="nibi-export-segment" role="radiogroup" aria-label="文档格式">
                  {formats.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={format === item.value}
                      className={format === item.value ? 'is-active' : ''}
                      onClick={() => selectFormat(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {content !== 'summary' && (
        <div className="nibi-export-step">
          <div className="nibi-export-step-label">{t('export.stepOptions')}</div>
          <div className="nibi-export-options">
            {content === 'transcript' && (
              <>
                <label className={!hasSpeakerData ? 'is-disabled' : ''}>
                  <input
                    type="checkbox"
                    checked={withSpeaker}
                    disabled={!hasSpeakerData}
                    onChange={(event) => setWithSpeaker(event.target.checked)}
                  />
                  {t('export.withSpeaker')}
                  {!hasSpeakerData && <span>{t('export.withSpeakerHint')}</span>}
                </label>
                {!isTimelineFormat && (
                  <label>
                    <input
                      type="checkbox"
                      checked={withTimestamp}
                      onChange={(event) => setWithTimestamp(event.target.checked)}
                    />
                    {t('export.withTimestamp')}
                  </label>
                )}
              </>
            )}
            {content === 'media' && isVideoNote && (
              <label>
                <input
                  type="checkbox"
                  checked={withSubtitle}
                  onChange={(event) => setWithSubtitle(event.target.checked)}
                />
                {t('export.withSubtitle')}
              </label>
            )}
            <div className="nibi-export-language" role="radiogroup" aria-label="语言">
                {(['bilingual', 'translation', 'source'] as ExportLanguage[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={effectiveLanguage === value}
                    disabled={!translationsAvailable && value !== 'source'}
                    className={effectiveLanguage === value ? 'is-active' : ''}
                    onClick={() => setLanguage(value)}
                  >
                    {t(`export.${LANGUAGE_KEY[value]}`)}
                  </button>
                ))}
              </div>
          </div>
        </div>
        )}

        <div className="nibi-export-step">
          <div className="nibi-export-step-label">{t('export.stepDestination')}</div>
          <div className="nibi-export-segment" role="radiogroup" aria-label="导出目的地">
            {([
              { value: 'local', label: t('export.local') },
              ...(!cloudDisabled
                ? [
                    { value: 'notion', label: 'Notion' },
                    { value: 'feishu', label: '飞书' },
                    { value: 'obsidian', label: 'Obsidian' },
                  ]
                : []),
            ] as Array<{ value: ExportDestination; label: string }>).map((item) => (
              <button
                key={item.value}
                type="button"
                role="radio"
                aria-checked={destination === item.value}
                className={destination === item.value ? 'is-active' : ''}
                onClick={() => setDestination(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <footer className="nibi-export-panel-foot">
          <div className="nibi-export-filename" aria-label="文件名预览">
            <FileDown size={13} /> {filename}
          </div>
          <button type="button" className="nibi-export-panel-submit" onClick={handlePrimary}>
            <FileText size={13} />
            {destination === 'local' ? t('export.startExport') : `${t('export.exportTo')} ${destination === 'notion' ? 'Notion' : destination === 'feishu' ? 'Feishu' : 'Obsidian'}`}
          </button>
        </footer>
      </section>
    </div>
  )
}

export default NoteExportPanel
