import { useLibraryStore, FILTER_OPTIONS, type FilterKey } from '@/store/libraryStore'

interface FilterChipsProps {
  counts?: Record<FilterKey, number>
}

export function FilterChips({ counts }: FilterChipsProps) {
  const selectedFilters = useLibraryStore((s) => s.selectedFilters)
  const toggleFilter = useLibraryStore((s) => s.toggleFilter)

  return (
    <div className="lib-chips">
      {FILTER_OPTIONS.map(({ key, label }) => {
        const active = selectedFilters.includes(key)
        const count = counts?.[key]
        return (
          <button
            key={key}
            onClick={() => toggleFilter(key)}
            className={`lib-chip${active ? ' lib-chip--active' : ''}`}
          >
            {label}
            {count != null && (
              <span className="lib-chip-count">{count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
