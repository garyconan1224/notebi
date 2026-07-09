// Phase 3C.5: 把 TagFilterState 与 URL search params 双向同步。
//
// URL 格式：?tags.content_type=教程,访谈&tags.difficulty=入门&tags.custom=关键词
// - 维度多选用半角逗号分隔
// - custom_tags 走 ?tags.custom=<文本>（contains 语义）

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { SYSTEM_TAG_DIMENSION_KEYS } from '@/constants/tagDimensions'
import type { SystemTagDimension, WorkspaceItem } from '@/types/workspace'
import type {
  DimensionSelection,
  TagFilterState,
} from '@/components/workspace/TagFilterBar'

const SYSTEM_KEYS = SYSTEM_TAG_DIMENSION_KEYS as readonly SystemTagDimension[]
const QUERY_PREFIX = 'tags.'
const CUSTOM_KEY = 'tags.custom'

function parse(params: URLSearchParams): TagFilterState {
  const dims: DimensionSelection = {}
  for (const key of SYSTEM_KEYS) {
    const raw = params.get(`${QUERY_PREFIX}${key}`)
    if (!raw) continue
    const arr = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    if (arr.length > 0) dims[key] = arr
  }
  return {
    dimensions: dims,
    customQuery: params.get(CUSTOM_KEY) ?? '',
  }
}

function serialize(state: TagFilterState, base: URLSearchParams): URLSearchParams {
  // 复制原 params，只覆写 tags.* 相关项
  const next = new URLSearchParams(base)
  // 先清掉所有 tags.* 旧值
  const removed: string[] = []
  next.forEach((_, k) => {
    if (k.startsWith(QUERY_PREFIX)) removed.push(k)
  })
  removed.forEach(k => next.delete(k))

  for (const key of SYSTEM_KEYS) {
    const arr = state.dimensions[key]
    if (arr && arr.length > 0) {
      next.set(`${QUERY_PREFIX}${key}`, arr.join(','))
    }
  }
  if (state.customQuery.trim()) {
    next.set(CUSTOM_KEY, state.customQuery.trim())
  }
  return next
}

export function useTagFilter(): {
  filter: TagFilterState
  setFilter: (next: TagFilterState) => void
  filterItems: (items: WorkspaceItem[]) => WorkspaceItem[]
  hasActiveFilter: boolean
} {
  const [searchParams, setSearchParams] = useSearchParams()

  const filter = useMemo(() => parse(searchParams), [searchParams])

  const setFilter = useCallback(
    (next: TagFilterState) => {
      setSearchParams(serialize(next, searchParams), { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const filterItems = useCallback(
    (items: WorkspaceItem[]) => {
      const customQ = filter.customQuery.trim().toLowerCase()
      const activeDims = SYSTEM_KEYS.filter(k => (filter.dimensions[k] ?? []).length > 0)
      if (activeDims.length === 0 && !customQ) return items
      return items.filter(it => {
        const tags = it.tags ?? {}
        // 跨维度 AND：每个激活维度都必须满足
        for (const key of activeDims) {
          const selected = filter.dimensions[key] ?? []
          const v = tags[key]
          if (typeof v !== 'string' || !selected.includes(v)) return false
        }
        if (customQ) {
          const ct = tags.custom_tags ?? []
          if (!ct.some(t => t.toLowerCase().includes(customQ))) return false
        }
        return true
      })
    },
    [filter],
  )

  const hasActiveFilter = useMemo(() => {
    if (filter.customQuery.trim()) return true
    return SYSTEM_KEYS.some(k => (filter.dimensions[k] ?? []).length > 0)
  }, [filter])

  return { filter, setFilter, filterItems, hasActiveFilter }
}
