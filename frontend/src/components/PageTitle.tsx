import { useEffect } from 'react'

import { buildDocumentTitle } from '@/lib/pageTitle'

interface PageTitleProps {
  title?: string
}

export function PageTitle({ title }: PageTitleProps) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = buildDocumentTitle(title)
    return () => {
      document.title = previousTitle
    }
  }, [title])

  return null
}
