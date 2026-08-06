import { Search, Send, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('pages')
  return (
    <div className="knowledge-composer">
      <textarea
        aria-label={t('knowledge.composerTitle')}
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
            ? t('knowledge.composerHint')
            : t('knowledge.composerSearchHint')
        }
        disabled={disabled}
      />
      {loading ? (
        <button type="button" onClick={onStop} aria-label={t('knowledge.stopGenerating')}>
          <Square size={14} /> 停止
        </button>
      ) : (
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          aria-label={mode === 'smart' ? t('knowledge.sendQuestion') : t('knowledge.findSource')}
        >
          {mode === 'smart' ? <Send size={14} /> : <Search size={14} />}
          {mode === 'smart' ? t('knowledge.send') : '查找原文'}
        </button>
      )}
    </div>
  )
}
