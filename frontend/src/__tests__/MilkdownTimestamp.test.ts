import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/prose/model'
import { EditorState } from '@milkdown/prose/state'

import { TS_RE, parseTs } from '@/pages/results/LearningNotesPage/HtmlView'
import { buildTimestampDecorations, unescapeNoteTimestamps } from '@/pages/result/NoteShell/milkdownTimestamp'

/* ── 辅助：构造最小 ProseMirror state ────────────────────────── */

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    code_block: { content: 'text*', group: 'block', code: true },
    text: { group: 'inline' },
  },
  marks: {
    code: {},
  },
})

function makeState(md: string, inCodeBlock = false, inInlineCode = false) {
  const textNode = schema.text(md)
  let blockNode
  if (inCodeBlock) {
    blockNode = schema.nodes.code_block.create(null, textNode)
  } else {
    const content = inInlineCode
      ? schema.text(md, [schema.marks.code.create()])
      : textNode
    blockNode = schema.nodes.paragraph.create(null, content)
  }
  return EditorState.create({ schema: schema as any, doc: schema.nodes.doc.create(null, blockNode) }) // eslint-disable-line @typescript-eslint/no-explicit-any
}

/* ── parseTs 秒数 ─────────────────────────────────────────────── */

describe('parseTs', () => {
  it('mm:ss → 秒', () => {
    expect(parseTs('01:30')).toBe(90)
  })
  it('hh:mm:ss → 秒', () => {
    expect(parseTs('1:02:03')).toBe(3723)
  })
  it('mm:ss 带范围 ~ 只取第一段', () => {
    // TS_RE 捕获组 m[1] 是第一段时间码
    const m = TS_RE.exec('[01:30~02:00]')
    expect(m).not.toBeNull()
    expect(parseTs(m![1])).toBe(90)
  })
})

/* ── buildTimestampDecorations ─────────────────────────────────── */

describe('buildTimestampDecorations', () => {
  it('给 [mm:ss] 生成 1 个 decoration', () => {
    const state = makeState('重点在 [01:30] 这一段')
    const ds = buildTimestampDecorations(state)
    const found = ds.find(0, state.doc.content.size)
    expect(found).toHaveLength(1)
    const deco = found[0]
    // 装饰范围的文本应该等于 [01:30]
    const slice = state.doc.textBetween(deco.from, deco.to)
    expect(slice).toBe('[01:30]')
  })

  it('[mm:ss~mm:ss] 也生成 decoration', () => {
    const state = makeState('看 [01:30~02:00] 这段')
    const ds = buildTimestampDecorations(state)
    const found = ds.find(0, state.doc.content.size)
    expect(found).toHaveLength(1)
    const slice = state.doc.textBetween(found[0].from, found[0].to)
    expect(slice).toBe('[01:30~02:00]')
  })

  it('多个时间码各生成独立 decoration', () => {
    const state = makeState('[00:10] 开头 [05:00] 结尾')
    const ds = buildTimestampDecorations(state)
    const found = ds.find(0, state.doc.content.size)
    expect(found).toHaveLength(2)
  })

  it('code_block 内不生成 decoration', () => {
    const state = makeState('[01:30]', true)
    const ds = buildTimestampDecorations(state)
    const found = ds.find(0, state.doc.content.size)
    expect(found).toHaveLength(0)
  })

  it('inlineCode (mark) 内不生成 decoration', () => {
    const state = makeState('[01:30]', false, true)
    const ds = buildTimestampDecorations(state)
    const found = ds.find(0, state.doc.content.size)
    expect(found).toHaveLength(0)
  })

  it('普通文本不含时间码时无 decoration', () => {
    const state = makeState('没有任何时间码的普通段落')
    const ds = buildTimestampDecorations(state)
    const found = ds.find(0, state.doc.content.size)
    expect(found).toHaveLength(0)
  })
})

/* ── unescapeNoteTimestamps ──────────────────────────────────── */

describe('unescapeNoteTimestamps', () => {
  it('反转义 \\[05:00] → [05:00]', () => {
    expect(unescapeNoteTimestamps('### \\[05:00]多层级要点总结')).toBe('### [05:00]多层级要点总结')
  })
  it('反转义范围 \\[01:30~02:00] → [01:30~02:00]', () => {
    expect(unescapeNoteTimestamps('\\[01:30~02:00] 看这段')).toBe('[01:30~02:00] 看这段')
  })
  it('已是裸时间码 [05:00] 保持不变', () => {
    const input = '### [05:00]多层级要点总结'
    expect(unescapeNoteTimestamps(input)).toBe(input)
  })
  it('非时间码的转义方括号（如 \\[note]）不被还原', () => {
    const input = '参考 \\[note] 这里'
    expect(unescapeNoteTimestamps(input)).toBe(input)
  })
})
