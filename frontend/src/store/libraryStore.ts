// L3 chip 筛选 + L4 排序 + 视图切换 + localStorage 持久化
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FilterKey = 'all' | 'video' | 'audio' | 'image' | 'text' | 'collection' | 'running'

const VALID_FILTER_KEYS = new Set<FilterKey>(['all', 'video', 'audio', 'image', 'text', 'collection', 'running'])

function normalizeFilters(filters?: string[]): FilterKey[] {
  const mapped = (filters ?? [])
    .map((key) => (key === 'workspace' ? 'collection' : key))
    .filter((key): key is FilterKey => VALID_FILTER_KEYS.has(key as FilterKey))
  return mapped.length > 0 ? Array.from(new Set(mapped)) : ['all']
}

export const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'image', label: '图文' },
  { key: 'text', label: '文本' },
  { key: 'collection', label: '合集' },
  { key: 'running', label: '生成中' },
]

export type SortBy =
  | 'created_desc'
  | 'created_asc'
  | 'completed_desc'
  | 'duration_desc'
  | 'duration_asc'
  | 'status'

export const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'created_desc', label: '创建时间（新 → 旧）' },
  { value: 'created_asc', label: '创建时间（旧 → 新）' },
  { value: 'completed_desc', label: '完成时间（最近在前）' },
  { value: 'duration_desc', label: '时长（长 → 短）' },
  { value: 'duration_asc', label: '时长（短 → 长）' },
  { value: 'status', label: '状态（错误优先）' },
]

export type ViewMode = 'grid' | 'list'
export type CardColumns = 2 | 3 | 4 | 5

export const CARD_COLUMN_OPTIONS: { value: CardColumns; label: string }[] = [
  { value: 2, label: '每行 2 个' },
  { value: 3, label: '每行 3 个' },
  { value: 4, label: '每行 4 个' },
  { value: 5, label: '每行 5 个' },
]

function normalizeCardColumns(value: unknown): CardColumns {
  return value === 2 || value === 4 || value === 5 ? value : 3
}

interface LibraryStore {
  selectedFilters: FilterKey[]
  toggleFilter: (key: FilterKey) => void
  setSelectedFilters: (filters: FilterKey[]) => void
  sortBy: SortBy
  setSortBy: (sort: SortBy) => void
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  cardColumns: CardColumns
  setCardColumns: (columns: CardColumns) => void
}

export const useLibraryStore = create<LibraryStore>()(
  persist(
    (set) => ({
      selectedFilters: ['all'],

      toggleFilter: (key) =>
        set((s) => {
          const prev = normalizeFilters(s.selectedFilters)
          const has = prev.includes(key)

          if (key === 'all') {
            return { selectedFilters: ['all'] }
          }

          if (has) {
            const next = prev.filter((k) => k !== key)
            return { selectedFilters: next.length > 0 ? next : ['all'] }
          }

          const next = prev.filter((k) => k !== 'all').concat(key)
          return { selectedFilters: next }
        }),

      setSelectedFilters: (filters) =>
        set({ selectedFilters: normalizeFilters(filters) }),

      sortBy: 'created_desc',
      setSortBy: (sortBy) => set({ sortBy }),

      viewMode: 'grid',
      setViewMode: (viewMode) => set({ viewMode }),

      cardColumns: 3,
      setCardColumns: (cardColumns) => set({ cardColumns: normalizeCardColumns(cardColumns) }),
    }),
    {
      name: 'nibi-library',
      version: 3,
      migrate: (persistedState) => {
        const state = persistedState as Partial<LibraryStore> | undefined
        return {
          ...state,
          selectedFilters: normalizeFilters((state?.selectedFilters as string[] | undefined) ?? ['all']),
          cardColumns: normalizeCardColumns(state?.cardColumns),
        }
      },
    },
  ),
)
