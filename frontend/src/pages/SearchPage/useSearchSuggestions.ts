import { useEffect, useState } from 'react'

import { getSearchSuggestions } from '@/services/search'

export function useSearchSuggestions(query: string): string[] {
  const [suggestions, setSuggestions] = useState<string[]>([])
  useEffect(() => {
    const value = query.trim()
    if (!value) {
      setSuggestions([])
      return
    }
    const timer = window.setTimeout(() => {
      void Promise.resolve()
        .then(() => getSearchSuggestions(value))
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query])
  return suggestions
}
