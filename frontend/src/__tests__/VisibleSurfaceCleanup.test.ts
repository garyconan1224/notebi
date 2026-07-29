// @ts-nocheck — repository-shape invariant runs in Vitest's Node environment.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(process.cwd(), 'src')

describe('S5 visible surface cleanup', () => {
  it('does not ship placeholder navigation or stale beta labels', () => {
    const indexHtml = readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8')
    expect(indexHtml).toContain('<html lang="zh-CN">')
    expect(indexHtml).toContain('<title>NoteBi</title>')
    expect(indexHtml).not.toContain('<title>frontend</title>')

    const appShell = readFileSync(path.join(SRC, 'layouts/AppShell.tsx'), 'utf8')
    expect(appShell).not.toContain('即将上线')
    expect(appShell).not.toContain('placeholder')

    for (const page of ['VideoResultPage.tsx', 'ImageResultPage.tsx', 'TextResultPage.tsx']) {
      const source = readFileSync(path.join(SRC, 'pages/result', page), 'utf8')
      expect(source).not.toContain('统一笔记 beta')
    }
  })

  it('removes pages and options that have no production entry or consumer', () => {
    const retiredPaths = [
      'constant/note.ts',
      'pages/result/BatchProcessingPage/index.tsx',
      'pages/result/BatchProcessingPage/batch-processing.css',
      '__tests__/QueueTab.test.tsx',
      'pages/WorkspacePage/TaskboardPage/QueueTab.tsx',
      'pages/WorkspacePage/TaskboardPage/CompareTab.tsx',
      'pages/WorkspacePage/TaskboardPage/KnowledgeQATab.tsx',
      'pages/WorkspacePage/TaskboardPage/TagsTab.tsx',
      'pages/results/LearningNotesPage/index.tsx',
      'pages/results/LearningNotesPage/ChatDrawer.tsx',
      'pages/results/LearningNotesPage/LNNotesPanel.tsx',
      'pages/results/LearningNotesPage/MdView.tsx',
    ]

    for (const retiredPath of retiredPaths) {
      expect(existsSync(path.join(SRC, retiredPath)), retiredPath).toBe(false)
    }

    const configStore = readFileSync(path.join(SRC, 'store/configStore.ts'), 'utf8')
    expect(configStore).not.toMatch(/\bdefaultQuality\s*:/)
    expect(configStore).not.toMatch(/\bdefaultFormats\s*:/)
    expect(configStore).not.toMatch(/\bdefaultStyle\s*:/)
    expect(configStore).not.toMatch(/\bdownloadMode\s*:/)
    expect(configStore).toContain('delete obj.defaultQuality')
    expect(configStore).toContain('delete obj.downloadMode')
  })
})
