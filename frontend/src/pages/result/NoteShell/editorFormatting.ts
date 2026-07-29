import { setBlockType, toggleMark } from '@milkdown/prose/commands'
import { liftListItem, wrapInList } from '@milkdown/prose/schema-list'
import type { Command, EditorState, Transaction } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'

export type EditorFormat = 'bold' | 'italic' | 'heading' | 'bulletList'

export interface EditorFormattingState {
  bold: boolean
  italic: boolean
  heading: boolean
  bulletList: boolean
  canBold: boolean
  canItalic: boolean
  canHeading: boolean
  canBulletList: boolean
}

export const EMPTY_EDITOR_FORMATTING_STATE: EditorFormattingState = {
  bold: false,
  italic: false,
  heading: false,
  bulletList: false,
  canBold: false,
  canItalic: false,
  canHeading: false,
  canBulletList: false,
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

function commandForFormat(state: EditorState, format: EditorFormat): Command | null {
  if (format === 'bold') {
    const strong = state.schema.marks.strong
    return strong ? toggleMark(strong) : null
  }
  if (format === 'italic') {
    const emphasis = state.schema.marks.emphasis
    return emphasis ? toggleMark(emphasis) : null
  }
  if (format === 'heading') {
    const heading = state.schema.nodes.heading
    const paragraph = state.schema.nodes.paragraph
    if (!heading || !paragraph) return null
    return selectedTextblocksAreHeading(state)
      ? setBlockType(paragraph)
      : setBlockType(heading, { level: 2 })
  }
  const bulletList = state.schema.nodes.bullet_list
  const listItem = state.schema.nodes.list_item
  if (!bulletList || !listItem) return null
  return selectionIsInBulletList(state)
    ? liftListItem(listItem)
    : wrapInList(bulletList)
}

export function getEditorFormattingState(state: EditorState): EditorFormattingState {
  const boldCommand = commandForFormat(state, 'bold')
  const italicCommand = commandForFormat(state, 'italic')
  const headingCommand = commandForFormat(state, 'heading')
  const bulletListCommand = commandForFormat(state, 'bulletList')
  return {
    bold: markIsActive(state, 'strong'),
    italic: markIsActive(state, 'emphasis'),
    heading: selectedTextblocksAreHeading(state),
    bulletList: selectionIsInBulletList(state),
    canBold: Boolean(boldCommand?.(state)),
    canItalic: Boolean(italicCommand?.(state)),
    canHeading: Boolean(headingCommand?.(state)),
    canBulletList: Boolean(bulletListCommand?.(state)),
  }
}

export function applyEditorFormatToState(
  state: EditorState,
  format: EditorFormat,
): EditorState | null {
  const command = commandForFormat(state, format)
  if (!command) return null
  let nextState = state
  const applied = command(state, (transaction: Transaction) => {
    nextState = state.apply(transaction)
  })
  return applied ? nextState : null
}

export function runEditorFormat(view: EditorView, format: EditorFormat): boolean {
  const command = commandForFormat(view.state, format)
  if (!command) return false
  const applied = command(view.state, view.dispatch, view)
  if (applied) view.focus()
  return applied
}
