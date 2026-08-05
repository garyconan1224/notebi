/**
 * Q4 / D7：AI 产物的语义渲染器。
 *
 * 依据后端按 kind 校验的 content_json 渲染：
 * - mind_map：自有 HTML/SVG 树（不引图库），可折叠，导出 PNG/SVG/MD（真实位图）；
 * - action_items / key_cards / flashcards / glossary / timeline：语义组件；
 * - 旧产物（无 content_json）：由调用方回退 Markdown 并标注「旧版产物」。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'

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

/* ── 思维导图交互组件（SVG 节点 + 连线画布）─────────────────── */

function pruneCollapsed(node: MindMapNode, collapsed: Set<string>): MindMapNode {
  return {
    ...node,
    children: collapsed.has(node.id)
      ? []
      : (node.children || []).map((child) => pruneCollapsed(child, collapsed)),
  }
}

export function MindMapTree({ data, title }: { data: MindMapData; title: string }) {
  const [scale, setScale] = useState(1)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)

  const zoom = (delta: number) => {
    setScale((value) => Math.max(0.6, Math.min(1.6, Number((value + delta).toFixed(1)))))
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoom(event.deltaY < 0 ? 0.1 : -0.1)
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [])

  const { nodes, width, height } = useMemo(() => {
    const pruned = pruneCollapsed(data.root, collapsed)
    return layoutMindMap(pruned)
  }, [data, collapsed])

  const hasChildrenMap = useMemo(() => {
    const map = new Map<string, boolean>()
    const walk = (node: MindMapNode) => {
      map.set(node.id, (node.children?.length ?? 0) > 0)
      ;(node.children || []).forEach(walk)
    }
    walk(data.root)
    return map
  }, [data])

  const nodeById = useMemo(() => {
    const map = new Map<string, MindMapNode>()
    const walk = (node: MindMapNode) => {
      map.set(node.id, node)
      ;(node.children || []).forEach(walk)
    }
    walk(data.root)
    return map
  }, [data])

  const toggleNode = (node: MindMapNode) => {
    setFocusedId(node.id)
    if (!node.children || node.children.length === 0) return
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(node.id)) next.delete(node.id)
      else next.add(node.id)
      return next
    })
  }

  return (
    <div className="mindmap-wrap">
      <div className="mindmap-actions">
        <button type="button" aria-label="缩小思维导图" onClick={() => zoom(-0.1)}><ZoomOut size={14} /></button>
        <span className="mindmap-zoom-value" aria-live="polite">{Math.round(scale * 100)}%</span>
        <button type="button" aria-label="放大思维导图" onClick={() => zoom(0.1)}><ZoomIn size={14} /></button>
        <button type="button" aria-label="重置思维导图缩放" onClick={() => setScale(1)}><RotateCcw size={14} /></button>
        <button type="button" onClick={() => exportMindMapPng(data.root, title)}>导出 PNG</button>
        <button type="button" onClick={() => exportMindMapSvg(data.root, title)}>导出 SVG</button>
      </div>
      <div
        ref={viewportRef}
        className="mindmap-viewport"
        onPointerDown={(event) => {
          dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            panX: pan.x,
            panY: pan.y,
          }
        }}
        onPointerMove={(event) => {
          if (!dragRef.current) return
          setPan({
            x: dragRef.current.panX + (event.clientX - dragRef.current.startX),
            y: dragRef.current.panY + (event.clientY - dragRef.current.startY),
          })
        }}
        onPointerUp={() => {
          dragRef.current = null
        }}
        onPointerLeave={() => {
          dragRef.current = null
        }}
      >
        <div
          className="mindmap-canvas"
          data-testid="mindmap-canvas"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
        >
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="思维导图画布"
          >
            {nodes.map((laid) => {
              if (!laid.parent) return null
              const x1 = laid.parent.x + NODE_W
              const y1 = laid.parent.y + NODE_H / 2
              const x2 = laid.x
              const y2 = laid.y + NODE_H / 2
              const midX = (x1 + x2) / 2
              return (
                <path
                  key={`edge-${laid.node.id}`}
                  className="mindmap-edge"
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                />
              )
            })}
            {nodes.map((laid) => {
              const hasChildren = hasChildrenMap.get(laid.node.id) ?? false
              const isCollapsed = collapsed.has(laid.node.id)
              const isFocused = focusedId === laid.node.id
              return (
                <g
                  key={laid.node.id}
                  transform={`translate(${laid.x}, ${laid.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={hasChildren ? `${isCollapsed ? '展开' : '折叠'} ${laid.node.text}` : laid.node.text}
                  aria-expanded={hasChildren ? !isCollapsed : undefined}
                  className={`mindmap-node${laid.depth === 0 ? ' is-root' : ''}${isFocused ? ' is-focused' : ''}${isCollapsed ? ' is-collapsed' : ''}`}
                  onClick={() => {
                    const original = nodeById.get(laid.node.id)
                    if (original) toggleNode(original)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      const original = nodeById.get(laid.node.id)
                      if (original) toggleNode(original)
                    }
                  }}
                >
                  <rect width={NODE_W} height={NODE_H} rx="7" />
                  <text x={10} y={NODE_H / 2 + 4}>
                    {truncate(laid.node.text)}
                  </text>
                  {hasChildren && (
                    <text className="mindmap-node-caret" x={NODE_W - 16} y={NODE_H / 2 + 4}>
                      {isCollapsed ? '▸' : '▾'}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      </div>
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
