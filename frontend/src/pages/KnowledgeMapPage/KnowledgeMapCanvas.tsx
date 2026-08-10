import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Graph, type GraphData, type IEvent } from '@antv/g6'
import type { KnowledgeMapData } from '@/services/knowledgeMap'

export interface KnowledgeMapCanvasProps {
  data: KnowledgeMapData
  onSelect: (nodeId: string) => void
}

export interface KnowledgeMapCanvasHandle {
  fitView: () => Promise<void>
}

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function buildGraphData(data: KnowledgeMapData): GraphData {
  const accent = token('--color-accent', 'currentColor')
  const surface = token('--color-bg-alt', 'currentColor')
  const border = token('--color-border', 'currentColor')
  const foreground = token('--color-fg', 'currentColor')
  const maxCount = Math.max(...data.nodes.map((node) => node.count), 1)

  return {
    nodes: data.nodes.map((node) => ({
      id: node.id,
      data: { label: node.label, count: node.count },
      style: {
        size: 18 + (node.count / maxCount) * 28,
        fill: node.count === maxCount ? accent : surface,
        stroke: accent,
        lineWidth: 2,
        labelText: node.label,
        labelPlacement: 'bottom',
        labelFill: foreground,
        labelFontSize: 12,
      },
    })),
    edges: data.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      style: {
        stroke: border,
        lineWidth: Math.min(5, 1 + edge.weight),
        opacity: 0.7,
      },
    })),
  }
}

export const KnowledgeMapCanvas = forwardRef<KnowledgeMapCanvasHandle, KnowledgeMapCanvasProps>(
  function KnowledgeMapCanvas({ data, onSelect }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const graphRef = useRef<Graph | null>(null)

    useImperativeHandle(ref, () => ({
      fitView: () => graphRef.current?.fitView() ?? Promise.resolve(),
    }), [])

    useEffect(() => {
      const container = containerRef.current
      if (!container || data.nodes.length === 0) return undefined

      const graph = new Graph({
        container,
        data: buildGraphData(data),
        autoFit: { type: 'view', options: { direction: 'both', when: 'always' } },
        padding: 56,
        animation: false,
        layout: {
          type: 'force',
          preventOverlap: true,
          nodeSize: 44,
          linkDistance: 150,
        },
        behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element', 'hover-activate'],
      })
      graphRef.current = graph
      graph.on('node:click', (event: IEvent) => {
        if (!('target' in event) || !event.target || !('id' in event.target)) return
        onSelect(String(event.target.id))
      })
      let disposed = false
      let rendered = false
      void graph.render().then(() => {
        rendered = true
        if (disposed) graph.destroy()
      })

      const resizeObserver = new ResizeObserver(() => graph.resize())
      resizeObserver.observe(container)

      return () => {
        resizeObserver.disconnect()
        disposed = true
        if (rendered) graph.destroy()
        graphRef.current = null
      }
    }, [data, onSelect])

    return <div ref={containerRef} className="knowledge-map-canvas" aria-label="信息地图画布" />
  },
)
