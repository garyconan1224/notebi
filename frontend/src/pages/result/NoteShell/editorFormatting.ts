import { lift, setBlockType, toggleMark, wrapIn } from '@milkdown/prose/commands'
import { liftListItem, wrapInList } from '@milkdown/prose/schema-list'
import type { Command, EditorState, Transaction } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'

export type EditorFormat =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'link'
  | 'heading'
  | 'blockquote'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'codeBlock'

export interface EditorFormattingState {
  bold: boolean
  italic: boolean
  strike: boolean
  inlineCode: boolean
  link: boolean
  heading: boolean
  blockquote: boolean
  bulletList: boolean
  orderedList: boolean
  taskList: boolean
  codeBlock: boolean
  canBold: boolean
  canItalic: boolean
  canStrike: boolean
  canInlineCode: boolean
  canLink: boolean
  canHeading: boolean
  canBlockquote: boolean
  canBulletList: boolean
  canOrderedList: boolean
  canTaskList: boolean
  canCodeBlock: boolean
}

export const EMPTY_EDITOR_FORMATTING_STATE: EditorFormattingState = {
  bold: false,
  italic: false,
  strike: false,
  inlineCode: false,
  link: false,
  heading: false,
  blockquote: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  codeBlock: false,
  canBold: false,
  canItalic: false,
  canStrike: false,
  canInlineCode: false,
  canLink: false,
  canHeading: false,
  canBlockquote: false,
  canBulletList: false,
  canOrderedList: false,
  canTaskList: false,
  canCodeBlock: false,
}

function markIsActive(state: EditorState, markName: string): boolean {
  const mark = state.schema.marks[markName]
  if (!mark) return false
  const { empty, from, to, $from } = state.selection
  if (empty) {
    return Boolean(mark.isInSet(state.storedMarks ?? $from.marks()))
  }
  return state.doc.rangeHasMark(from, to, mark)
}

function selectedTextblocksAreHeading(state: EditorState): boolean {
  const heading = state.schema.nodes.heading
  if (!heading) return false
  const { empty, from, to, $from } = state.selection
  if (empty) {
    return $from.parent.type === heading && $from.parent.attrs.level === 2
  }
  let found = false
  let allHeadings = true
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isTextblock) return
    found = true
    if (node.type !== heading || node.attrs.level !== 2) allHeadings = false
  })
  return found && allHeadings
}

function selectionIsInBulletList(state: EditorState): boolean {
  const bulletList = state.schema.nodes.bullet_list
  if (!bulletList) return false
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === bulletList) return true
  }
  return false
}

function selectionIsInNode(state: EditorState, nodeName: string): boolean {
  const nodeType = state.schema.nodes[nodeName]
  if (!nodeType) return false
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type === nodeType) return true
  }
  return false
}

function selectionIsTaskList(state: EditorState): boolean {
  const listItem = state.schema.nodes.list_item
  if (!listItem) return false
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type === listItem) return node.attrs.checked !== null
  }
  return false
}

function taskListCommand(state: EditorState): Command | null {
  const bulletList = state.schema.nodes.bullet_list
  const listItem = state.schema.nodes.list_item
  if (!bulletList || !listItem || !('checked' in listItem.spec.attrs!)) return null
  return (currentState, dispatch) => {
    let tr: Transaction | null = null
    if (!selectionIsInBulletList(currentState)) {
      const wrapped = wrapInList(bulletList)(currentState, (transaction) => {
        tr = transaction
      })
      if (!wrapped || !tr) return false
    } else {
      tr = currentState.tr
    }
    const transaction = tr as Transaction
    const $from = transaction.selection.$from
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const node = $from.node(depth)
      if (node.type !== listItem) continue
      const pos = $from.before(depth)
      transaction.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        checked: node.attrs.checked === null ? false : null,
      })
      dispatch?.(transaction)
      return true
    }
    return false
  }
}

function commandForFormat(
  state: EditorState,
  format: EditorFormat,
  value = '',
): Command | null {
  if (format === 'bold') {
    const strong = state.schema.marks.strong
    return strong ? toggleMark(strong) : null
  }
  if (format === 'italic') {
    const emphasis = state.schema.marks.emphasis
    return emphasis ? toggleMark(emphasis) : null
  }
  if (format === 'strike') {
    const strike = state.schema.marks.strike_through
    return strike ? toggleMark(strike) : null
  }
  if (format === 'inlineCode') {
    const inlineCode = state.schema.marks.inlineCode
    return inlineCode ? toggleMark(inlineCode) : null
  }
  if (format === 'link') {
    const link = state.schema.marks.link
    return link ? toggleMark(link, { href: value || 'https://', title: null }) : null
  }
  if (format === 'heading') {
    const heading = state.schema.nodes.heading
    const paragraph = state.schema.nodes.paragraph
    if (!heading || !paragraph) return null
    return selectedTextblocksAreHeading(state)
      ? setBlockType(paragraph)
      : setBlockType(heading, { level: 2 })
  }
  if (format === 'blockquote') {
    const blockquote = state.schema.nodes.blockquote
    if (!blockquote) return null
    return selectionIsInNode(state, 'blockquote') ? lift : wrapIn(blockquote)
  }
  if (format === 'codeBlock') {
    const codeBlock = state.schema.nodes.code_block
    const paragraph = state.schema.nodes.paragraph
    if (!codeBlock || !paragraph) return null
    return selectionIsInNode(state, 'code_block')
      ? setBlockType(paragraph)
      : setBlockType(codeBlock)
  }
  if (format === 'taskList') return taskListCommand(state)
  if (format === 'orderedList') {
    const orderedList = state.schema.nodes.ordered_list
    const listItem = state.schema.nodes.list_item
    if (!orderedList || !listItem) return null
    return selectionIsInNode(state, 'ordered_list')
      ? liftListItem(listItem)
      : wrapInList(orderedList)
  }
  const bulletList = state.schema.nodes.bullet_list
  const listItem = state.schema.nodes.list_item
  if (!bulletList || !listItem) return null
  return selectionIsInBulletList(state)
    ? liftListItem(listItem)
    : wrapInList(bulletList)
}

export function getEditorFormattingState(state: EditorState): EditorFormattingState {
  const commands = {
    bold: commandForFormat(state, 'bold'),
    italic: commandForFormat(state, 'italic'),
    strike: commandForFormat(state, 'strike'),
    inlineCode: commandForFormat(state, 'inlineCode'),
    link: commandForFormat(state, 'link'),
    heading: commandForFormat(state, 'heading'),
    blockquote: commandForFormat(state, 'blockquote'),
    bulletList: commandForFormat(state, 'bulletList'),
    orderedList: commandForFormat(state, 'orderedList'),
    taskList: commandForFormat(state, 'taskList'),
    codeBlock: commandForFormat(state, 'codeBlock'),
  }
  return {
    bold: markIsActive(state, 'strong'),
    italic: markIsActive(state, 'emphasis'),
    strike: markIsActive(state, 'strike_through'),
    inlineCode: markIsActive(state, 'inlineCode'),
    link: markIsActive(state, 'link'),
    heading: selectedTextblocksAreHeading(state),
    blockquote: selectionIsInNode(state, 'blockquote'),
    bulletList: selectionIsInBulletList(state),
    orderedList: selectionIsInNode(state, 'ordered_list'),
    taskList: selectionIsTaskList(state),
    codeBlock: selectionIsInNode(state, 'code_block'),
    canBold: Boolean(commands.bold?.(state)),
    canItalic: Boolean(commands.italic?.(state)),
    canStrike: Boolean(commands.strike?.(state)),
    canInlineCode: Boolean(commands.inlineCode?.(state)),
    canLink: Boolean(commands.link?.(state)),
    canHeading: Boolean(commands.heading?.(state)),
    canBlockquote: Boolean(commands.blockquote?.(state)),
    canBulletList: Boolean(commands.bulletList?.(state)),
    canOrderedList: Boolean(commands.orderedList?.(state)),
    canTaskList: Boolean(commands.taskList?.(state)),
    canCodeBlock: Boolean(commands.codeBlock?.(state)),
  }
}

export function applyEditorFormatToState(
  state: EditorState,
  format: EditorFormat,
  value = '',
): EditorState | null {
  const command = commandForFormat(state, format, value)
  if (!command) return null
  let nextState = state
  const applied = command(state, (transaction: Transaction) => {
    nextState = state.apply(transaction)
  })
  return applied ? nextState : null
}

export function runEditorFormat(view: EditorView, format: EditorFormat, value = ''): boolean {
  const command = commandForFormat(view.state, format, value)
  if (!command) return false
  const applied = command(view.state, view.dispatch, view)
  if (applied) view.focus()
  return applied
}
