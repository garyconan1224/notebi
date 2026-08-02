import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/pages/result/NoteShell/note-shell.css'),
  'utf8',
)

it('keeps the draggable note splitter in its own layout gap', () => {
  const splitterRule = stylesheet.match(/\.nibi-note-splitter\s*\{[^}]*\}/)?.[0] ?? ''

  expect(splitterRule).toContain('flex: 0 0 14px')
  expect(splitterRule).toContain('margin: 0')
  expect(splitterRule).not.toContain('margin: 0 -5px')
})

it('hides speaker profile chips only when their panel is collapsed', () => {
  expect(stylesheet).toContain('.nibi-audio-speaker-chips[data-collapsed="true"] > :not(.nibi-audio-speaker-toggle)')
  expect(stylesheet).toContain('display: none')
})
