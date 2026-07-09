import { useCallback, useState } from 'react'
import { Plus, X } from 'lucide-react'

interface AddVersionFormProps {
  onSubmit: (content: string) => Promise<void>
  onCancel: () => void
}

export function AddVersionForm({ onSubmit, onCancel }: AddVersionFormProps) {
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    const trimmed = content.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      await onSubmit(trimmed)
      setContent('')
    } finally {
      setSubmitting(false)
    }
  }, [content, onSubmit])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="输入提示词内容…"
        rows={3}
        style={{
          width: '100%',
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.6,
          border: '1px solid var(--line)',
          background: 'var(--bg-sunken)',
          color: 'var(--ink)',
          padding: '8px 10px',
          resize: 'vertical',
          fontFamily: 'var(--mono)',
        }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            height: 28,
            padding: '0 10px',
            borderRadius: 6,
            fontSize: 11,
            border: '1px solid var(--line)',
            background: 'transparent',
            color: 'var(--ink-3)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <X size={10} /> 取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !content.trim()}
          style={{
            height: 28,
            padding: '0 10px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            border: 'none',
            background: submitting || !content.trim() ? 'var(--ink-4)' : 'var(--ink)',
            color: 'var(--bg)',
            cursor: submitting || !content.trim() ? 'default' : 'pointer',
          }}
        >
          {submitting ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}

/** 没有版本时的空状态 + 新增按钮 */
export function EmptyVersionState({ onAdd }: { onAdd: () => void }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>提示词版本</div>
      <span className="mono" style={{ fontSize: 12, color: 'var(--ink-4)' }}>暂无版本</span>
      <button
        onClick={onAdd}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginTop: 8,
          height: 28,
          padding: '0 10px',
          borderRadius: 6,
          fontSize: 11,
          border: '1px solid var(--line)',
          background: 'transparent',
          color: 'var(--ink-2)',
          cursor: 'pointer',
        }}
      >
        <Plus size={12} /> 新增版本
      </button>
    </div>
  )
}
