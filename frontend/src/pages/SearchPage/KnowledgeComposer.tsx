import { Search, Send, Square } from 'lucide-react'

interface Props {
  value: string
  mode: 'smart' | 'exact'
  loading: boolean
  disabled?: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
}

export function KnowledgeComposer({
  value,
  mode,
  loading,
  disabled,
  onChange,
  onSubmit,
  onStop,
}: Props) {
  return (
    <div className="knowledge-composer">
      <textarea
        aria-label="知识库提问"
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (
            event.key === 'Enter'
            && !event.shiftKey
            && !event.nativeEvent.isComposing
          ) {
            event.preventDefault()
            if (!loading && !disabled && value.trim()) onSubmit()
          }
        }}
        placeholder={
          mode === 'smart'
            ? '向选中的合集提问。Enter 发送，Shift+Enter 换行。'
            : '输入标题、摘要或原文关键词。'
        }
        disabled={disabled}
      />
      {loading ? (
        <button type="button" onClick={onStop} aria-label="停止生成">
          <Square size={14} /> 停止
        </button>
      ) : (
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          aria-label={mode === 'smart' ? '发送问题' : '查找原文'}
        >
          {mode === 'smart' ? <Send size={14} /> : <Search size={14} />}
          {mode === 'smart' ? '发送' : '查找原文'}
        </button>
      )}
    </div>
  )
}
