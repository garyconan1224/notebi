/**
 * 自定义多色高亮 mark：渲染为 <mark data-color="...">，markdown 中持久化为内联 HTML。
 *
 * 与 underlineMark 同一套「内联 HTML 载体」模式：
 * - 注册 remark 插件：把 <mark ...> / </mark> html 节点重命名为 highlightHtml，
 *   避免被 commonmark 的 html 节点按「字面标签」处理；
 * - parseMarkdown：highlightHtml 开/闭节点 → 打开/关闭 highlight mark（开节点解析 data-color）；
 * - toMarkdown：带 highlight 的文本输出为 <mark data-color="...">text</mark>。
 */
import type { MarkSchema, Root } from '@milkdown/transformer'

const HTML_MARK_OPEN_RE = /^<mark(\s[^>]*)?>$/i
const HTML_MARK_CLOSE_RE = /^<\/mark>$/i
const DATA_COLOR_RE = /data-color="([^"]*)"/i

/** 高亮调色板：value 为落盘/渲染用的十六进制色值 */
export const HIGHLIGHT_COLORS = [
  { value: '#fff59d', label: 'highlightYellow' },
  { value: '#c5e1a5', label: 'highlightGreen' },
  { value: '#90caf9', label: 'highlightBlue' },
  { value: '#f8bbd0', label: 'highlightPink' },
  { value: '#ce93d8', label: 'highlightPurple' },
] as const

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].value

export function highlightHtmlRemarkPlugin() {
  return (tree: Root) => {
    type MdNode = { type?: string; value?: unknown; children?: MdNode[] }
    const visit = (node: MdNode) => {
      const value = String(node.value ?? '')
      if (node.type === 'html' && (HTML_MARK_OPEN_RE.test(value) || HTML_MARK_CLOSE_RE.test(value))) {
        node.type = 'highlightHtml'
      }
      node.children?.forEach(visit)
    }
    visit(tree as MdNode)
  }
}

export const highlightMarkSchema: MarkSchema = {
  attrs: { color: { default: DEFAULT_HIGHLIGHT_COLOR } },
  parseDOM: [
    {
      tag: 'mark',
      getAttrs: (dom) => ({
        color: (dom as HTMLElement).getAttribute('data-color') || DEFAULT_HIGHLIGHT_COLOR,
      }),
    },
  ],
  toDOM: (mark) => [
    'mark',
    { 'data-color': mark.attrs.color, style: `background-color: ${mark.attrs.color};` },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'highlightHtml',
    runner: (state, node, markType) => {
      const value = String(node.value ?? '')
      if (HTML_MARK_CLOSE_RE.test(value)) {
        state.closeMark(markType)
      } else {
        const color = DATA_COLOR_RE.exec(value)?.[1] || DEFAULT_HIGHLIGHT_COLOR
        state.openMark(markType.create({ color }))
      }
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, mark, node) => {
      const color = mark.attrs.color || DEFAULT_HIGHLIGHT_COLOR
      state.addNode('html', undefined, `<mark data-color="${color}">${node.text ?? ''}</mark>`)
      return true
    },
  },
}
