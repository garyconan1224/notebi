/* eslint-disable react-refresh/only-export-components */
/**
 * 思维导图渲染器：mind-elixir (v5) 包装组件，替换此前的自研 SVG 树（2026-08-06）。
 *
 * - 数据契约不变：NoteBi `{ root: { id, text, children } }` ↔ mind-elixir `{ id, topic, children }`；
 *   回传时只取 id/text/children，丢弃 mind-elixir 运行时添加的 parent 反向引用，避免环与多余字段进入 PATCH。
 * - 节点编辑经 operation 事件总线实时回传（调用方走既有 PATCH 持久化）；beginEdit 只是进入编辑态，不回传。
 * - 导出 PNG/SVG 用 snapdom 对当前渲染节点截图；经 exportRef 向面板暴露 getData/getPngBlob，
 *   供「插入为图片 / 插入为大纲」使用。
 * - 主题读取 nibi-tokens 设计变量，跟随四主题套餐 × 明暗模式。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MindElixir from 'mind-elixir'
import { zh_CN } from 'mind-elixir/i18n'
import { snapdom } from '@zumer/snapdom'
import { toast } from 'sonner'
import { useAppearanceStore } from '@/store/appearanceStore'
import 'mind-elixir/style.css'

import type { MindElixirData, NodeObj, Operation, Theme } from 'mind-elixir'

export interface MindMapNode {
  id: string
  text: string
  children: MindMapNode[]
}

export interface MindMapData {
  root: MindMapNode
}

/* ── 数据转换 ────────────────────────────────────────────── */

export function toMindElixirNode(node: MindMapNode): NodeObj {
  return {
    id: node.id,
    topic: node.text,
    children: (node.children || []).map(toMindElixirNode),
  }
}

export function toMindElixirData(data: MindMapData): MindElixirData {
  return { nodeData: toMindElixirNode(data.root) }
}

export function toNotebiNode(node: NodeObj): MindMapNode {
  return {
    id: node.id,
    text: node.topic,
    children: (node.children || []).map(toNotebiNode),
  }
}

export function toNotebiData(data: MindElixirData): MindMapData {
  return { root: toNotebiNode(data.nodeData) }
}

/** 转 Markdown 大纲：根节点为二级标题，子节点为嵌套无序列表（与后端 _parse_mindmap 可互转）。 */
export function mindMapToMarkdown(data: MindMapData): string {
  const lines: string[] = [`## ${data.root.text}`, '']
  const walk = (node: MindMapNode, depth: number) => {
    for (const child of node.children || []) {
      lines.push(`${'  '.repeat(depth)}- ${child.text}`)
      walk(child, depth + 1)
    }
  }
  walk(data.root, 0)
  return lines.join('\n')
}

/* ── 主题 ────────────────────────────────────────────────── */

function cssToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** 由 nibi-tokens 设计变量构造 mind-elixir 主题；根节点用强调色，分支走调色板。 */
export function buildNotebiTheme(isDark: boolean): Theme {
  return {
    name: isDark ? 'notebi-dark' : 'notebi-light',
    type: isDark ? 'dark' : 'light',
    palette: [
      cssToken('--acc', '#ff8a36'),
      cssToken('--accent-blue', '#7c9cff'),
      cssToken('--accent-green', '#4fae6d'),
      cssToken('--accent-warm', '#d9a441'),
      cssToken('--accent-purple', '#a07ce0'),
    ],
    cssVar: {
      '--root-bgcolor': cssToken('--acc', '#ff8a36'),
      '--root-color': cssToken('--accfg', '#ffffff'),
      '--root-border-color': cssToken('--acch', 'transparent'),
      '--main-color': cssToken('--fg2', '#3d3929'),
      '--main-bgcolor': cssToken('--srf', '#ffffff'),
      '--color': cssToken('--fg', '#26221a'),
      '--bgcolor': 'transparent',
      '--selected': cssToken('--acc', '#ff8a36'),
      '--accent-color': cssToken('--acc', '#ff8a36'),
      '--panel-color': cssToken('--fg2', '#3d3929'),
      '--panel-bgcolor': cssToken('--srf', '#ffffff'),
      '--panel-border-color': cssToken('--bdr', 'rgba(25, 20, 16, 0.16)'),
    },
  }
}

/* ── 导出句柄（供面板「插入为图片 / 大纲」使用）───────────── */

export interface MindMapExportHandle {
  downloadPng: (filename: string) => Promise<void>
  downloadSvg: (filename: string) => Promise<void>
  getPngBlob: () => Promise<Blob>
  getData: () => MindMapData
}

export interface MindMapExportRef {
  current: MindMapExportHandle | null
}

/* ── 组件 ────────────────────────────────────────────────── */

export interface MindMapViewProps {
  data: MindMapData
  title: string
  workspaceId?: string
  itemId?: string
  artifactId?: string
  onUpdated?: (contentJson: MindMapData) => void
  exportRef?: MindMapExportRef
}

function useSystemDark(mode: string): boolean {
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches),
  )
  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [mode])
  return systemDark
}

export function MindMapView({ data, title, onUpdated, exportRef }: MindMapViewProps) {
  const { t } = useTranslation('note')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mindRef = useRef<MindElixir | null>(null)
  const onUpdatedRef = useRef(onUpdated)
  const initialDataRef = useRef(data)

  useEffect(() => {
    onUpdatedRef.current = onUpdated
  })

  const themeId = useAppearanceStore((state) => state.theme)
  const mode = useAppearanceStore((state) => state.mode)
  const systemDark = useSystemDark(mode)
  const isDark = mode === 'dark' || (mode === 'system' && systemDark)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const mind = new MindElixir({
      el,
      direction: MindElixir.SIDE,
      toolBar: true,
      keypress: true,
      overflowHidden: true,
      contextMenu: { locale: zh_CN },
      newTopicName: t('mindmap.newNode'),
      theme: buildNotebiTheme(isDark),
    })
    const handleOperation = (op: Operation) => {
      if (op.name === 'beginEdit') return
      onUpdatedRef.current?.(toNotebiData(mind.getData()))
    }
    mind.bus.addListener('operation', handleOperation)
    const error = mind.init(toMindElixirData(initialDataRef.current))
    if (error) {
      console.error('mind map init failed', error)
    }
    requestAnimationFrame(() => {
      if (mindRef.current === mind) mind.scaleFit()
    })
    mindRef.current = mind

    if (exportRef) {
      exportRef.current = {
        downloadPng: async (filename) => {
          const result = await snapdom(mind.nodes)
          await result.download({ format: 'png', filename })
        },
        downloadSvg: async (filename) => {
          const result = await snapdom(mind.nodes)
          await result.download({ format: 'svg', filename })
        },
        getPngBlob: async () => {
          const result = await snapdom(mind.nodes)
          return result.toBlob({ type: 'png' })
        },
        getData: () => toNotebiData(mind.getData()),
      }
    }

    return () => {
      if (exportRef) exportRef.current = null
      mind.bus.removeListener('operation', handleOperation)
      mind.destroy()
      mindRef.current = null
    }
    // 实例只随挂载创建一次；切换产物由父级 key 触发重新挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    mindRef.current?.changeTheme(buildNotebiTheme(isDark), true)
  }, [themeId, isDark])

  const download = async (format: 'png' | 'svg') => {
    const mind = mindRef.current
    if (!mind) return
    try {
      const result = await snapdom(mind.nodes)
      await result.download({ format, filename: title })
    } catch {
      toast.error(t('mindmap.exportFailed'))
    }
  }

  return (
    <div className="mindmap-wrap">
      <div className="mindmap-actions">
        <button type="button" onClick={() => void download('png')}>{t('mindmap.exportPng')}</button>
        <button type="button" onClick={() => void download('svg')}>{t('mindmap.exportSvg')}</button>
      </div>
      <div ref={containerRef} className="mindmap-canvas" data-testid="mindmap-canvas" aria-label={title} />
    </div>
  )
}
