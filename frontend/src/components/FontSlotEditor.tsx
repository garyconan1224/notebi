/**
 * Q6 / D6：字体槽位编辑器（FontSlotEditor）。
 *
 * 每个槽位五要素缺一不可：
 * 1. 当前值 + 候选下拉（项用自身字体实时渲染，本地上传带「本地」角标）
 * 2. 预览行（固定样例，按该槽真实字号渲染，悬停即预览不落盘）
 * 3. 适用范围说明（一行只读）
 * 4. 上传本地字体（WOFF2/WOFF/TTF/OTF ≤20MB，后端二次校验签名）
 * 5. 删除/回退（被使用字体先回退默认链再删；每槽「恢复默认」）
 */
import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

import { useAppearanceStore } from '@/store/appearanceStore'
import type { FontSlotId } from '@/services/settings'

const SLOT_LABEL_KEY: Record<FontSlotId, string> = {
  ui: 'general.fontSlot.uiLabel',
  cap: 'general.fontSlot.capLabel',
  sum: 'general.fontSlot.sumLabel',
}
const SLOT_SCOPE_KEY: Record<FontSlotId, string> = {
  ui: 'general.fontSlot.uiScope',
  cap: 'general.fontSlot.capScope',
  sum: 'general.fontSlot.sumScope',
}

interface BuiltinCandidate {
  label: string
  labelKey?: string
  family: string | null
}

const BUILTIN_CANDIDATES: BuiltinCandidate[] = [
  { label: '系统无衬线（默认）', labelKey: 'general.fontSlot.candidateSystemSans', family: null },
  { label: '系统衬线', labelKey: 'general.fontSlot.candidateSystemSerif', family: "'Songti SC', 'SimSun', Georgia, serif" },
  { label: 'Inter', family: "'Inter', system-ui, sans-serif" },
  { label: 'Noto Sans SC', family: "'Noto Sans SC', system-ui, sans-serif" },
  { label: 'Noto Serif SC', family: "'Noto Serif SC', 'Songti SC', Georgia, serif" },
  { label: '得意黑（展示）', labelKey: 'general.fontSlot.candidateSmileySans', family: "'Smiley Sans', 'Noto Serif SC', Georgia, serif" },
  { label: 'JetBrains Mono', family: "'JetBrains Mono', ui-monospace, monospace" },
]

const SLOT_PREVIEW_STYLE: Record<FontSlotId, React.CSSProperties> = {
  ui: { fontSize: 14 },
  cap: { fontSize: 16, fontWeight: 600 },
  sum: { fontSize: 16, lineHeight: 1.6 },
}

const MAX_FONT_BYTES = 20 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['.woff2', '.woff', '.ttf', '.otf']

export function FontSlotEditor({ slot }: { slot: FontSlotId }) {
  const { t } = useTranslation('settings')
  const slotLabel = t(SLOT_LABEL_KEY[slot])
  const value = useAppearanceStore((state) => state.fonts[slot])
  const uploadedFonts = useAppearanceStore((state) => state.uploaded_fonts)
  const setFontSlot = useAppearanceStore((state) => state.setFontSlot)
  const uploadFont = useAppearanceStore((state) => state.uploadFont)
  const removeFont = useAppearanceStore((state) => state.removeFont)

  const [previewFamily, setPreviewFamily] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeFamily = previewFamily === undefined ? value : previewFamily
  const previewStyle: React.CSSProperties = {
    ...SLOT_PREVIEW_STYLE[slot],
    fontFamily: activeFamily ?? undefined,
  }

  const inUseElsewhere = (family: string) => {
    const fonts = useAppearanceStore.getState().fonts
    return (Object.keys(fonts) as FontSlotId[]).some(
      (key) => key !== slot && fonts[key] === family,
    )
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    try {
      for (const file of Array.from(files)) {
        const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : ''
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          toast.error(t('general.fontSlot.unsupportedFormat', { name: file.name }))
          continue
        }
        if (file.size > MAX_FONT_BYTES) {
          toast.error(t('general.fontSlot.tooLarge', { name: file.name }))
          continue
        }
        try {
          await uploadFont(slot, file)
          toast.success(t('general.fontSlot.applied', { name: file.name, slot: slotLabel }))
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t('general.fontSlot.uploadFailed'))
        }
      }
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemoveUploaded = async (fontId: string, family: string) => {
    if (value === family || inUseElsewhere(family)) {
      toast.error(t('general.fontSlot.inUse'))
      return
    }
    try {
      await removeFont(fontId)
      toast.success(t('general.fontSlot.deleted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('general.fontSlot.deleteFailed'))
    }
  }

  return (
    <div className="font-slot-card" data-slot={slot}>
      <div className="font-slot-head">
        <strong>{slotLabel}</strong>
        <button
          type="button"
          className="btn-ghost"
          style={{ fontSize: 12, padding: '2px 8px' }}
          disabled={value === null}
          onClick={() => void setFontSlot(slot, null)}
        >
          {t('general.fontSlot.reset')}
        </button>
      </div>
      <p className="font-slot-scope">{t(SLOT_SCOPE_KEY[slot])}</p>

      <div className="font-slot-preview" style={previewStyle} aria-hidden="true">
        {t('general.fontSlot.previewText')}
      </div>

      <select
        className="font-slot-select"
        aria-label={t('general.fontSlot.optionsAria', { label: slotLabel })}
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.value
          void setFontSlot(slot, next === '' ? null : next)
        }}
        onMouseLeave={() => setPreviewFamily(undefined)}
      >
        {BUILTIN_CANDIDATES.map((candidate) => (
          <option
            key={candidate.label}
            value={candidate.family ?? ''}
            style={{ fontFamily: candidate.family ?? undefined }}
            onMouseEnter={() => setPreviewFamily(candidate.family)}
          >
            {candidate.labelKey ? t(candidate.labelKey) : candidate.label}
          </option>
        ))}
        {uploadedFonts.map((font) => (
          <option
            key={font.id}
            value={font.family}
            style={{ fontFamily: `'${font.family}', sans-serif` }}
            onMouseEnter={() => setPreviewFamily(`'${font.family}', sans-serif`)}
          >
            {t('general.fontSlot.uploadedOption', { family: font.family })}
          </option>
        ))}
      </select>

      {uploadedFonts.length > 0 && (
        <ul className="font-slot-uploaded">
          {uploadedFonts.map((font) => (
            <li key={font.id}>
              <span style={{ fontFamily: `'${font.family}', sans-serif` }}>{font.family}</span>
              <span className="kw">{t('general.fontSlot.local')}</span>
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: 12, padding: '1px 6px' }}
                onClick={() => void handleRemoveUploaded(font.id, font.family)}
              >
                {t('general.fontSlot.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="font-slot-upload">
        <Upload size={12} />
        {busy ? t('general.fontSlot.uploading') : t('general.fontSlot.upload')}
        <input
          ref={fileInputRef}
          type="file"
          accept=".woff2,.woff,.ttf,.otf"
          multiple
          disabled={busy}
          onChange={(event) => void handleFiles(event.target.files)}
          style={{ display: 'none' }}
        />
      </label>
    </div>
  )
}

export default FontSlotEditor
