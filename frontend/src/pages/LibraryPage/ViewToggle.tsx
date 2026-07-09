import { useLibraryStore, type ViewMode } from '@/store/libraryStore'

export function ViewToggle() {
  const viewMode = useLibraryStore((s) => s.viewMode)
  const setViewMode = useLibraryStore((s) => s.setViewMode)

  return (
    <div className="view-toggle">
      {([
        { id: 'grid' as ViewMode, title: '网格视图' },
        { id: 'list' as ViewMode, title: '列表视图' },
      ]).map(({ id, title }) => {
        const on = viewMode === id
        return (
          <button
            key={id}
            onClick={() => setViewMode(id)}
            title={title}
            className={`view-toggle-btn${on ? ' view-toggle-btn--active' : ''}`}
          >
            {id === 'grid' ? (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <rect x="0.5" y="0.5" width="5" height="5" rx="1.5" fill="currentColor" />
                <rect x="7.5" y="0.5" width="5" height="5" rx="1.5" fill="currentColor" />
                <rect x="0.5" y="7.5" width="5" height="5" rx="1.5" fill="currentColor" />
                <rect x="7.5" y="7.5" width="5" height="5" rx="1.5" fill="currentColor" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <rect x="0.5" y="0.5" width="12" height="2" rx="1" fill="currentColor" />
                <rect x="0.5" y="5.5" width="12" height="2" rx="1" fill="currentColor" />
                <rect x="0.5" y="10.5" width="12" height="2" rx="1" fill="currentColor" />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}
