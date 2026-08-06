import { Search as SearchIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  history: string[]
  onSearch: (query: string) => void
  onQuery: (query: string) => void
}

export function SearchEmptyState({ history, onSearch, onQuery }: Props) {
  const { t } = useTranslation('pages')
  return (
    <section className="search-empty">
      <SearchIcon size={20} />
      <div className="search-empty-title">{t('knowledge.emptyTitle')}</div>
      <div className="search-empty-desc">{t('knowledge.emptyDesc')}</div>
      {history.length > 0 && (
        <div className="search-history-chips">
          {history.map(item => (
            <button key={item} onClick={() => {
              onQuery(item)
              onSearch(item)
            }}>
              {item}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
