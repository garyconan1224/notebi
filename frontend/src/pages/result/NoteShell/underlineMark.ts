/**
 * 自定义下划线 mark：渲染为 <u>，markdown 中持久化为 <u>text</u>。
 *
 * Milkdown commonmark/gfm 没有下划线语法，这里用内联 HTML <u> 作为载体：
 * - 注册 remark 插件：把 <u> / </u> html 节点重命名为 underlineHtml，
 *   避免被 commonmark 的 html 节点按「字面标签」处理；
 * - parseMarkdown：underlineHtml 开/闭节点 → 打开/关闭 underline mark；
 * - toMarkdown：带 underline 的文本输出为 <u>text</u>。
 */
import type { MarkSchema, Root } from '@milkdown/transformer'

const HTML_U_TAG_RE = /^<\/?u>$/i

export function underlineHtmlRemarkPlugin() {
  return (tree: Root) => {
    type MdNode = { type?: string; value?: unknown; children?: MdNode[] }
    const visit = (node: MdNode) => {
      if (node.type === 'html' && HTML_U_TAG_RE.test(String(node.value ?? ''))) {
        node.type = 'underlineHtml'
      }
      node.children?.forEach(visit)
    }
    visit(tree as MdNode)
  }
}

export const underlineMarkSchema: MarkSchema = {
  parseDOM: [{ tag: 'u' }, { tag: 'ins' }],
  toDOM: () => ['u', 0],
  parseMarkdown: {
    match: (node) => node.type === 'underlineHtml',
    runner: (state, node, markType) => {
      if (String(node.value ?? '').startsWith('</')) {
        state.closeMark(markType)
      } else {
        state.openMark(markType)
      }
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'underline',
    runner: (state, _mark, node) => {
      state.addNode('html', undefined, `<u>${node.text ?? ''}</u>`)
      return true
    },
  },
}
