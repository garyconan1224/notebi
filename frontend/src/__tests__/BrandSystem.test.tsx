import '@testing-library/jest-dom'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BrandLockup, BrandMark } from '@/components/brand/Brand'
import { PageTitle } from '@/components/PageTitle'
import { buildDocumentTitle } from '@/lib/pageTitle'

describe('NoteBi brand system', () => {
  it('renders one accessible brand mark and lockup from the shared component', () => {
    const { rerender } = render(<BrandMark />)

    expect(screen.getByRole('img', { name: 'NoteBi' })).toHaveAttribute(
      'data-brand-mark',
      'note-timeline',
    )
    expect(screen.getByTestId('brand-recording-dot')).toBeInTheDocument()

    rerender(<BrandLockup />)
    expect(screen.getByRole('img', { name: 'NoteBi' })).toBeInTheDocument()
    expect(screen.getByTestId('brand-wordmark')).toHaveTextContent('NoteBi')
  })

  it('builds consistent page titles and applies them while mounted', () => {
    expect(buildDocumentTitle()).toBe('NoteBi')
    expect(buildDocumentTitle('设置')).toBe('设置 · NoteBi')

    const originalTitle = document.title
    const view = render(<PageTitle title="任务中心" />)
    expect(document.title).toBe('任务中心 · NoteBi')

    view.unmount()
    expect(document.title).toBe(originalTitle)
  })

  it('uses the shared ink-and-recording-dot identity in browser metadata', () => {
    const root = process.cwd()
    const favicon = readFileSync(path.join(root, 'public/favicon.svg'), 'utf8')
    const logo = readFileSync(path.join(root, 'public/notebi-logo.svg'), 'utf8')
    const browserIcon = readFileSync(
      path.join(root, 'public/notebi-browser-icon.svg'),
      'utf8',
    )
    const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8')

    for (const asset of [favicon, logo, browserIcon]) {
      expect(asset).toContain('#151311')
      expect(asset).toContain('#c66a2b')
    }
    expect(favicon).not.toContain('#863bff')
    expect(indexHtml).toContain('name="theme-color" content="#faf8f3"')
    expect(indexHtml).toContain('rel="apple-touch-icon"')
    expect(indexHtml).toContain('rel="manifest"')
  })
})
