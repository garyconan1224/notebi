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

import { useAppearanceStore, FONT_SLOT_LABELS, FONT_SLOT_SCOPE } from '@/store/appearanceStore'
import type { FontSlotId } from '@/services/settings'

const PREVIEW_TEXT = 'NoteBi 笔记 · 00:07 背景与动机 Aa Bb 123'

interface BuiltinCandidate {
  label: string
  family: string | null
}

const BUILTIN_CANDIDATES: BuiltinCandidate[] = [
  { label: '系统无衬线（默认）', family: null },
  { label: '系统衬线', family: "'Songti SC', 'SimSun', Georgia, serif" },
  { label: 'Inter', family: "'Inter', system-ui, sans-serif" },
  { label: 'Noto Sans SC', family: "'Noto Sans SC', system-ui, sans-serif" },
  { label: 'Noto Serif SC', family: "'Noto Serif SC', 'Songti SC', Georgia, serif" },
  { label: '得意黑（展示）', family: "'Smiley Sans', 'Noto Serif SC', Georgia, serif" },
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
          toast.error(`「${file.name}」不是支持的字体格式（WOFF2/WOFF/TTF/OTF）`)
          continue
        }
        if (file.size > MAX_FONT_BYTES) {
          toast.error(`「${file.name}」超过 20MB 限制`)
          continue
        }
        try {
          await uploadFont(slot, file)
          toast.success(`字体「${file.name}」已应用到${FONT_SLOT_LABELS[slot]}`)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : '字体上传失败')
        }
      }
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemoveUploaded = async (fontId: string, family: string) => {
    if (value === family || inUseElsewhere(family)) {
      toast.error('该字体仍在使用：请先在相应槽位恢复默认链再删除')
      return
    }
    try {
      await removeFont(fontId)
      toast.success('本地字体已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <div className="font-slot-card" data-slot={slot}>
      <div className="font-slot-head">
        <strong>{FONT_SLOT_LABELS[slot]}</strong>
        <button
          type="button"
          className="btn-ghost"
          style={{ fontSize: 12, padding: '2px 8px' }}
          disabled={value === null}
          onClick={() => void setFontSlot(slot, null)}
        >
          恢复默认
        </button>
      </div>
      <p className="font-slot-scope">{FONT_SLOT_SCOPE[slot]}</p>

      <div className="font-slot-preview" style={previewStyle} aria-hidden="true">
        {PREVIEW_TEXT}
      </div>

      <select
        className="font-slot-select"
        aria-label={`${FONT_SLOT_LABELS[slot]}候选`}
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
            {candidate.label}
          </option>
        ))}
        {uploadedFonts.map((font) => (
          <option
            key={font.id}
            value={font.family}
            style={{ fontFamily: `'${font.family}', sans-serif` }}
            onMouseEnter={() => setPreviewFamily(`'${font.family}', sans-serif`)}
          >
            {font.family}（本地）
          </option>
        ))}
      </select>

      {uploadedFonts.length > 0 && (
        <ul className="font-slot-uploaded">
          {uploadedFonts.map((font) => (
            <li key={font.id}>
              <span style={{ fontFamily: `'${font.family}', sans-serif` }}>{font.family}</span>
              <span className="kw">本地</span>
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: 12, padding: '1px 6px' }}
                onClick={() => void handleRemoveUploaded(font.id, font.family)}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="font-slot-upload">
        <Upload size={12} />
        {busy ? '上传中…' : '上传本地字体（WOFF2/WOFF/TTF/OTF ≤20MB）'}
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
