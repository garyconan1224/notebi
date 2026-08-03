/**
 * Q4 / D7：AI 产物的语义渲染器。
 *
 * 依据后端按 kind 校验的 content_json 渲染：
 * - mind_map：自有 HTML/SVG 树（不引图库），可折叠，导出 PNG/SVG/MD（真实位图）；
 * - action_items / key_cards / flashcards / glossary / timeline：语义组件；
 * - 旧产物（无 content_json）：由调用方回退 Markdown 并标注「旧版产物」。
 */
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export interface MindMapNode {
  id: string
  text: string
  children: MindMapNode[]
}

export interface MindMapData {
  root: MindMapNode
}

/* ── 思维导图：树布局 + SVG 生成 ─────────────────────────────── */

const NODE_H = 30
const NODE_GAP_Y = 8
const LEVEL_W = 190
const PADDING = 16

interface LaidNode {
  node: MindMapNode
  x: number
  y: number
  depth: number
  parent: LaidNode | null
}

function countLeaves(node: MindMapNode): number {
  if (!node.children || node.children.length === 0) return 1
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0)
}

function layoutMindMap(root: MindMapNode): { nodes: LaidNode[]; width: number; height: number } {
  const nodes: LaidNode[] = []
  let maxDepth = 0

  function place(node: MindMapNode, depth: number, topSlot: number, parent: LaidNode | null): number {
    const leaves = countLeaves(node)
    const mySlot = topSlot + leaves / 2
    const laid: LaidNode = {
      node,
      depth,
      x: PADDING + depth * LEVEL_W,
      y: PADDING + mySlot * (NODE_H + NODE_GAP_Y),
      parent,
    }
    nodes.push(laid)
    maxDepth = Math.max(maxDepth, depth)
    let cursor = topSlot
    for (const child of node.children || []) {
      const childLeaves = countLeaves(child)
      place(child, depth + 1, cursor, laid)
      cursor += childLeaves
    }
    return mySlot
  }

  place(root, 0, 0, null)
  const totalLeaves = countLeaves(root)
  return {
    nodes,
    width: PADDING * 2 + (maxDepth + 1) * LEVEL_W,
    height: PADDING * 2 + totalLeaves * (NODE_H + NODE_GAP_Y),
  }
}

const NODE_W = 168

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncate(text: string, max = 22): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function mindMapToSvg(root: MindMapNode): string {
  const { nodes, width, height } = layoutMindMap(root)
  const edges: string[] = []
  for (const laid of nodes) {
    if (!laid.parent) continue
    const from = laid.parent
    const x1 = from.x + NODE_W
    const y1 = from.y + NODE_H / 2
    const x2 = laid.x
    const y2 = laid.y + NODE_H / 2
    const midX = (x1 + x2) / 2
    edges.push(
      `<path d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="oklch(70% 0.03 70)" stroke-width="1.5" />`,
    )
  }
  const boxes = nodes.map((laid) => {
    const fill = laid.depth === 0 ? 'oklch(52% 0.205 42)' : 'oklch(97% 0.005 80)'
    const stroke = laid.depth === 0 ? 'oklch(46% 0.21 42)' : 'oklch(85% 0.01 80)'
    const textColor = laid.depth === 0 ? 'oklch(100% 0 0)' : 'oklch(25% 0.012 60)'
    return [
      `<g>`,
      `<rect x="${laid.x}" y="${laid.y}" width="${NODE_W}" height="${NODE_H}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="1.2" />`,
      `<text x="${laid.x + 10}" y="${laid.y + NODE_H / 2 + 4}" font-size="12.5" font-family="'PingFang SC', 'Microsoft YaHei', sans-serif" fill="${textColor}">${escapeXml(truncate(laid.node.text))}</text>`,
      `</g>`,
    ].join('')
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="oklch(99% 0.003 85)" />`,
    ...edges,
    ...boxes,
    `</svg>`,
  ].join('\n')
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function exportMindMapSvg(root: MindMapNode, title: string) {
  const svg = mindMapToSvg(root)
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${title}.svg`)
}

export function exportMindMapPng(root: MindMapNode, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const svg = mindMapToSvg(root)
    const { width, height } = layoutMindMap(root)
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const scale = 2
      canvas.width = width * scale
      canvas.height = height * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('canvas unsupported'))
        return
      }
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob((png) => {
        if (png) {
          downloadBlob(png, `${title}.png`)
          resolve()
        } else {
          reject(new Error('png encode failed'))
        }
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('svg rasterize failed'))
    }
    img.src = url
  })
}

/* ── 思维导图交互组件（HTML 可折叠树）───────────────────────── */

function MindMapBranch({ node, depth }: { node: MindMapNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = (node.children?.length ?? 0) > 0
  return (
    <li className="mindmap-node">
      <div className="mindmap-node-row" data-depth={Math.min(depth, 3)}>
        {hasChildren ? (
          <button
            type="button"
            className="mindmap-toggle"
            aria-expanded={open}
            aria-label={open ? `折叠 ${node.text}` : `展开 ${node.text}`}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="mindmap-leaf-dot" aria-hidden="true" />
        )}
        <span className="mindmap-node-text">{node.text}</span>
      </div>
      {hasChildren && open && (
        <ul className="mindmap-children">
          {node.children.map((child) => (
            <MindMapBranch key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function MindMapTree({ data, title }: { data: MindMapData; title: string }) {
  return (
    <div className="mindmap-wrap">
      <div className="mindmap-actions">
        <button type="button" onClick={() => exportMindMapPng(data.root, title)}>导出 PNG</button>
        <button type="button" onClick={() => exportMindMapSvg(data.root, title)}>导出 SVG</button>
      </div>
      <ul className="mindmap-tree">
        <MindMapBranch node={data.root} depth={0} />
      </ul>
    </div>
  )
}

/* ── 其余 kind 的语义渲染 ────────────────────────────────────── */

export function ActionItemsView({ items }: { items: Array<{ id: string; text: string; done: boolean }> }) {
  return (
    <ul className="artifact-action-items">
      {items.map((item) => (
        <li key={item.id} className={item.done ? 'is-done' : ''}>
          <input type="checkbox" readOnly checked={item.done} aria-label={item.text} />
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  )
}

export function KeyCardsView({ cards }: { cards: Array<{ id: string; title: string; body: string }> }) {
  return (
    <div className="artifact-key-cards">
      {cards.map((card) => (
        <article key={card.id} className="artifact-key-card">
          <h4>{card.title}</h4>
          <p>{card.body}</p>
        </article>
      ))}
    </div>
  )
}

export function FlashcardsView({ cards }: { cards: Array<{ id: string; question: string; answer: string }> }) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  return (
    <div className="artifact-flashcards">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className="artifact-flashcard"
          aria-expanded={Boolean(revealed[card.id])}
          onClick={() => setRevealed((current) => ({ ...current, [card.id]: !current[card.id] }))}
        >
          <span className="artifact-flashcard-q">Q · {card.question}</span>
          {revealed[card.id] && <span className="artifact-flashcard-a">A · {card.answer}</span>}
          {!revealed[card.id] && <span className="artifact-flashcard-hint">点击显示答案</span>}
        </button>
      ))}
    </div>
  )
}

export function GlossaryView({ rows }: { rows: Array<{ term: string; definition: string; context: string }> }) {
  return (
    <table className="artifact-table">
      <thead>
        <tr><th>术语</th><th>通俗解释</th><th>材料中的语境</th></tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.term}-${index}`}>
            <td>{row.term}</td>
            <td>{row.definition}</td>
            <td>{row.context}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function TimelineView({ rows }: { rows: Array<{ time: string; event: string; who: string; impact: string }> }) {
  return (
    <table className="artifact-table">
      <thead>
        <tr><th>时间/顺序</th><th>事件或观点</th><th>参与者</th><th>影响</th></tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.time}-${index}`}>
            <td>{row.time}</td>
            <td>{row.event}</td>
            <td>{row.who}</td>
            <td>{row.impact}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ── 统一入口：按 kind + content_json 选择渲染器 ────────────── */

export type ArtifactContentJson =
  | MindMapData
  | { items: Array<{ id: string; text: string; done: boolean }> }
  | { cards: Array<{ id?: string; title?: string; body?: string; question?: string; answer?: string }> }
  | { columns?: string[]; rows: Array<Record<string, string>> }
  | null

export function useHasStructuredContent(kind: string, contentJson: ArtifactContentJson): boolean {
  return useMemo(() => {
    if (!contentJson) return false
    if (kind === 'mind_map') return Boolean((contentJson as MindMapData).root)
    if (kind === 'action_items') return Array.isArray((contentJson as { items?: unknown[] }).items)
    if (kind === 'key_cards' || kind === 'flashcards') return Array.isArray((contentJson as { cards?: unknown[] }).cards)
    if (kind === 'glossary' || kind === 'timeline') return Array.isArray((contentJson as { rows?: unknown[] }).rows)
    return false
  }, [kind, contentJson])
}
