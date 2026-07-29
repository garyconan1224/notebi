import { Schema, type Node as ProseMirrorNode } from '@milkdown/prose/model'
import { EditorState, TextSelection } from '@milkdown/prose/state'
import { describe, expect, it } from 'vitest'

import {
  applyEditorFormatToState,
  getEditorFormattingState,
} from '@/pages/result/NoteShell/editorFormatting'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: {
      attrs: { level: { default: 2 } },
      content: 'inline*',
      group: 'block',
    },
    blockquote: { content: 'block+', group: 'block' },
    code_block: { content: 'text*', group: 'block', marks: '' },
    text: { group: 'inline' },
    bullet_list: { content: 'list_item+', group: 'block' },
    ordered_list: { content: 'list_item+', group: 'block' },
    list_item: {
      attrs: { checked: { default: null } },
      content: 'paragraph block*',
    },
  },
  marks: {
    strong: {},
    emphasis: {},
    strike_through: {},
    inlineCode: { code: true },
    link: { attrs: { href: {}, title: { default: null } } },
  },
})

function paragraph(text: string): ProseMirrorNode {
  return schema.node('paragraph', null, text ? schema.text(text) : undefined)
}

function stateWithDoc(
  doc: ProseMirrorNode,
  from: number,
  to = from,
): EditorState {
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, from, to),
  })
}

function textPosition(doc: ProseMirrorNode, text: string): number {
  let result = -1
  doc.descendants((node, position) => {
    if (node.isText && node.text === text) result = position
  })
  if (result < 0) throw new Error(`missing text: ${text}`)
  return result
}

describe('NoteShell editor formatting commands', () => {
  it('中文选区可加粗，空选区斜体会进入后续输入状态', () => {
    const doc = schema.node('doc', null, [paragraph('中文内容')])
    const selected = stateWithDoc(doc, 1, 3)

    const bold = applyEditorFormatToState(selected, 'bold')

    expect(bold).not.toBeNull()
    expect(bold!.doc.rangeHasMark(1, 3, schema.marks.strong)).toBe(true)

    const cursor = stateWithDoc(doc, 2)
    const italic = applyEditorFormatToState(cursor, 'italic')

    expect(italic).not.toBeNull()
    expect(italic!.storedMarks?.some((mark) => mark.type === schema.marks.emphasis)).toBe(true)
    expect(getEditorFormattingState(italic!).italic).toBe(true)
  })

  it('多行选区转换为二级标题，再次执行恢复为普通段落', () => {
    const doc = schema.node('doc', null, [paragraph('第一行'), paragraph('第二行')])
    const selected = stateWithDoc(doc, 1, doc.content.size - 1)

    const headings = applyEditorFormatToState(selected, 'heading')

    expect(headings).not.toBeNull()
    expect(headings!.doc.child(0).type.name).toBe('heading')
    expect(headings!.doc.child(0).attrs.level).toBe(2)
    expect(headings!.doc.child(1).type.name).toBe('heading')

    const restored = applyEditorFormatToState(headings!, 'heading')
    expect(restored).not.toBeNull()
    expect(restored!.doc.child(0).type.name).toBe('paragraph')
    expect(restored!.doc.child(1).type.name).toBe('paragraph')
  })

  it('嵌套列表中的当前项再次执行列表命令时只提升一级', () => {
    const innerItem = schema.node('list_item', null, [paragraph('内层')])
    const innerList = schema.node('bullet_list', null, [innerItem])
    const outerItem = schema.node('list_item', null, [paragraph('外层'), innerList])
    const doc = schema.node('doc', null, [
      schema.node('bullet_list', null, [outerItem]),
    ])
    const innerPosition = textPosition(doc, '内层')
    const selected = stateWithDoc(doc, innerPosition, innerPosition + 2)

    const lifted = applyEditorFormatToState(selected, 'bulletList')

    expect(lifted).not.toBeNull()
    const list = lifted!.doc.child(0)
    expect(list.type.name).toBe('bullet_list')
    expect(list.childCount).toBe(2)
    expect(list.child(0).textContent).toBe('外层')
    expect(list.child(1).textContent).toBe('内层')
  })

  it('支持删除线、行内代码、引用、有序列表和待办列表', () => {
    const doc = schema.node('doc', null, [paragraph('需要整理的内容')])
    const selected = stateWithDoc(doc, 1, doc.content.size - 1)

    const strike = applyEditorFormatToState(selected, 'strike')
    expect(strike!.doc.rangeHasMark(1, 7, schema.marks.strike_through)).toBe(true)

    const inlineCode = applyEditorFormatToState(selected, 'inlineCode')
    expect(inlineCode!.doc.rangeHasMark(1, 7, schema.marks.inlineCode)).toBe(true)

    const quote = applyEditorFormatToState(selected, 'blockquote')
    expect(quote!.doc.child(0).type.name).toBe('blockquote')

    const ordered = applyEditorFormatToState(selected, 'orderedList')
    expect(ordered!.doc.child(0).type.name).toBe('ordered_list')

    const task = applyEditorFormatToState(selected, 'taskList')
    expect(task!.doc.child(0).type.name).toBe('bullet_list')
    expect(task!.doc.child(0).child(0).attrs.checked).toBe(false)
  })

  it('链接格式保留目标地址', () => {
    const doc = schema.node('doc', null, [paragraph('链接文字')])
    const selected = stateWithDoc(doc, 1, doc.content.size - 1)

    const linked = applyEditorFormatToState(selected, 'link', 'https://example.com')

    expect(linked).not.toBeNull()
    const marks = linked!.doc.child(0).child(0).marks
    expect(marks[0].type).toBe(schema.marks.link)
    expect(marks[0].attrs.href).toBe('https://example.com')
  })
})
