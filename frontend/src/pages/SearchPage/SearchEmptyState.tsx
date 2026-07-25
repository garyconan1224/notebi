import { Search as SearchIcon } from 'lucide-react'

interface Props {
  history: string[]
  onSearch: (query: string) => void
  onQuery: (query: string) => void
}

export function SearchEmptyState({ history, onSearch, onQuery }: Props) {
  return (
    <section className="search-empty">
      <SearchIcon size={20} />
      <div className="search-empty-title">从一个具体问题开始</div>
      <div className="search-empty-desc">回答会附带原文来源，可直接跳回内容核验。</div>
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
