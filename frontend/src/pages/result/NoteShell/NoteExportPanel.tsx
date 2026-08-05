import { useEffect, useMemo, useState } from 'react'
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

const LANGUAGE_LABEL: Record<ExportLanguage, string> = {
  bilingual: '双语',
  translation: '仅翻译',
  source: '仅原文',
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
  { value: 'long_image', label: '长图' },
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
      ? [{ value: 'audio', label: '仅音频文件' }]
      : [{ value: 'original', label: '原视频' }]
    : []

  const filename = useMemo(() => {
    const safeTitle = (title || '未命名').replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 60) || 'media'
    if (content === 'transcript') {
      const lang = LANGUAGE_LABEL[effectiveLanguage]
      const speaker = withSpeaker ? '_带说话人' : ''
      return `${safeTitle}_转写_${lang}${speaker}.${format}`
    }
    if (content === 'summary') {
      return `${safeTitle}_总结.${format}`
    }
    if (content === 'media') {
      if (withSubtitle && format === 'original') return `${safeTitle}_视频_${LANGUAGE_LABEL[effectiveLanguage]}字幕.zip`
      if (format === 'original') return `${safeTitle}_视频_原始.mp4`
      if (format === 'audio') return `${safeTitle}_音频.m4a`
      if (format === 'burn') return `${safeTitle}_视频_${LANGUAGE_LABEL[effectiveLanguage]}字幕.mp4`
      return `${safeTitle}_视频_${LANGUAGE_LABEL[effectiveLanguage]}字幕.zip`
    }
    return safeTitle
  }, [title, content, format, effectiveLanguage, withSpeaker, withSubtitle])

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
            <strong>导出</strong>
            <span>内容 × 格式 × 选项 × 目的地</span>
          </div>
          <button type="button" aria-label="关闭导出" onClick={() => onOpenChange(false)}>
            <X size={15} />
          </button>
        </header>

        <div className="nibi-export-step">
          <div className="nibi-export-step-label">1 · 内容</div>
          <div className="nibi-export-segment" role="radiogroup" aria-label="导出内容">
            {([
              { value: 'transcript', label: '转写' },
              { value: 'summary', label: '总结' },
              ...(isVideoNote || isAudioNote ? [{ value: 'media', label: '媒体文件' }] : []),
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
          <div className="nibi-export-step-label">2 · 格式</div>
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
                  <span>时间轴格式</span>
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
                <span>{content === 'transcript' ? '文档格式' : '总结格式'}</span>
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
          <div className="nibi-export-step-label">3 · 选项</div>
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
                  带说话人
                  {!hasSpeakerData && <span>该录音未识别到说话人</span>}
                </label>
                {!isTimelineFormat && (
                  <label>
                    <input
                      type="checkbox"
                      checked={withTimestamp}
                      onChange={(event) => setWithTimestamp(event.target.checked)}
                    />
                    带时间轴
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
                带字幕
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
                    {LANGUAGE_LABEL[value]}
                  </button>
                ))}
              </div>
          </div>
        </div>
        )}

        <div className="nibi-export-step">
          <div className="nibi-export-step-label">4 · 目的地</div>
          <div className="nibi-export-segment" role="radiogroup" aria-label="导出目的地">
            {([
              { value: 'local', label: '本地下载' },
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
            {destination === 'local' ? '开始导出' : `导出到 ${destination === 'notion' ? 'Notion' : destination === 'feishu' ? '飞书' : 'Obsidian'}`}
          </button>
        </footer>
      </section>
    </div>
  )
}

export default NoteExportPanel
