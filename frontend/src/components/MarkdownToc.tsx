/**
 * MarkdownToc — 从 Markdown 文本提取 ##/### 标题生成目录。
 *
 * 用法：<MarkdownToc markdown={content_md} scrollRef={containerRef} />
 * - scrollRef 指向滚动容器，点击目录项时 scrollIntoView 到对应标题。
 * - 滚动时自动高亮当前章节。
 */
import { useEffect, useMemo, useState } from 'react'

interface TocEntry {
  id: string
  text: string
  level: number
}

/** 生成 slug id，与 ReactMarkdown h2/h3 组件 renderer 保持一致 */
export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '')
}

/** 递归提取 ReactNode 中的纯文本 */
export function flattenText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  if ('props' in node) return flattenText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  return ''
}

/** 从 Markdown 提取 ##/### 标题 */
export function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = []
  for (const line of markdown.split('\n')) {
    const match = line.match(/^(#{2,3})\s+(.+)/)
    if (match) {
      entries.push({ id: slugify(match[2].trim()), text: match[2].trim(), level: match[1].length })
    }
  }
  return entries
}

interface Props {
  markdown: string
  scrollRef: React.RefObject<HTMLDivElement | null>
}

export function MarkdownToc({ markdown, scrollRef }: Props) {
  const toc = useMemo(() => extractToc(markdown), [markdown])
  const [activeId, setActiveId] = useState('')

  useEffect(() => {
    const container = scrollRef.current
    if (!container || toc.length === 0) return

    function updateActive() {
      const headings = container!.querySelectorAll('h2[id], h3[id]')
      if (headings.length === 0) return
      const containerTop = container!.getBoundingClientRect().top
      const threshold = container!.clientHeight * 0.3
      let current = ''
      for (const h of headings) {
        if (h.getBoundingClientRect().top - containerTop <= threshold) current = h.id
      }
      setActiveId(current)
    }

    updateActive()
    container.addEventListener('scroll', updateActive, { passive: true })
    return () => container.removeEventListener('scroll', updateActive)
  }, [toc, markdown, scrollRef])

  if (toc.length === 0) return null

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    const container = scrollRef.current
    if (!container) return
    const target = container.querySelector(`#${CSS.escape(id)}`)
    if (target) (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="sm-toc">
      <div className="sm-toc-title">目录</div>
      <ul className="sm-toc-list">
        {toc.map((entry) => (
          <li
            key={entry.id}
            className={`sm-toc-item${entry.level === 3 ? ' sm-toc-h3' : ''}`}
            data-active={entry.id === activeId || undefined}
          >
            <a href={`#${entry.id}`} onClick={(e) => handleClick(e, entry.id)}>
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
