/**
 * Milkdown 时间码 ProseMirror 插件
 *
 * 扫描正文文本节点中的裸 [mm:ss] / [mm:ss~mm:ss]，
 * 生成 inline decoration（class note-ts-chip）使其显示为可点击 chip。
 * Decoration 不修改文档模型，序列化回 markdown 天然还是裸 [mm:ss]。
 */
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import type { EditorState } from '@milkdown/prose/state'
import type { Node } from '@milkdown/prose/model'

import { TS_RE, parseTs } from '@/pages/results/LearningNotesPage/HtmlView'

/**
 * 反转义 Milkdown commonmark 序列化器对时间码方括号的转义。
 * 把 \[mm:ss] / \[mm:ss~mm:ss]（左右括号任一被转义）还原成裸 [mm:ss]。
 * 非时间码的转义方括号（如 \[note]）不受影响。
 */
export function unescapeNoteTimestamps(md: string): string {
  return md.replace(
    /\\?\[(\d{1,2}:\d{2}(?::\d{2})?(?:~\d{1,2}:\d{2}(?::\d{2})?)?)\\?\]/g,
    '[$1]',
  )
}

/**
 * 扫描 state.doc，返回所有命中的 timestamp inline decorations。
 * 跳过 code_block 和 inlineCode。
 */
export function buildTimestampDecorations(state: EditorState): DecorationSet {
  const decos: Decoration[] = []

  state.doc.descendants((node: Node, pos: number, parent: Node | null) => {
    if (!node.isText || !node.text) return
    // 跳过代码块
    if (parent && parent.type.name === 'code_block') return
    // 跳过行内代码（commonmark schema 的 mark 名是 'code'）
    if (node.marks.some((m) => m.type.name === 'code' || m.type.name === 'inlineCode')) return

    TS_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TS_RE.exec(node.text)) !== null) {
      const from = pos + m.index
      const to = from + m[0].length
      decos.push(
        Decoration.inline(from, to, {
          class: 'note-ts-chip',
          'data-sec': String(parseTs(m[1])),
        }),
      )
    }
  })

  return DecorationSet.create(state.doc, decos)
}

/**
 * 创建时间码 ProseMirror Plugin。
 * @param getOnSeek - 拿到最新 onSeek 回调的闭包（避免插件闭包捕获旧引用）
 */
export function timestampPlugin(
  getOnSeek: () => (sec: number) => void,
): Plugin {
  return new Plugin({
    key: new PluginKey('note-ts'),
    props: {
      decorations(state) {
        return buildTimestampDecorations(state)
      },
      handleClick(_view, _pos, event) {
        const t = event.target as HTMLElement
        if (t?.classList?.contains('note-ts-chip')) {
          const sec = Number(t.getAttribute('data-sec'))
          if (!Number.isNaN(sec)) {
            getOnSeek()(sec)
            return true
          }
        }
        return false
      },
    },
  })
}
