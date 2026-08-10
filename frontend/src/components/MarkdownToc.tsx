/**
 * MarkdownToc — 从 Markdown 文本提取 #/##/###/#### 标题生成多级目录。
 *
 * 用法：<MarkdownToc markdown={content_md} scrollRef={containerRef} />
 * - scrollRef 指向滚动容器，点击目录项时 scrollIntoView 到对应标题。
 * - 滚动时自动高亮当前章节（文字变色 + 底色块）。
 * - 支持多级缩进、子章节折叠/展开、每章节要点数量徽章。
 * - 标题 id 由 assignHeadingIds() 在 DOM 上补写，与 extractToc 共用去重逻辑保证一致。
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface TocEntry {
  id: string            // slugify + 同名去重(-2/-3)
  text: string
  level: number         // 1..4（# 数量）
  parentId: string | null
  hasChildren: boolean  // 其后存在更低级标题
  pointCount: number    // 到下一个 <=自身level 标题之间的内容块数
}

/**
 * 生成标题 id，与 Milkdown 内建规则保持一致（defaultHeadingIdGenerator）：
 * 转小写、trim、把连续空白折叠成单个连字符。保留 emoji 和标点，
 * 使目录项 href 与 Milkdown 渲染出的标题 DOM id 完全一致，点击跳转才能命中。
 */
export function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, '-')
}

/**
 * 同名标题生成唯一 id，与 Milkdown syncHeadingIdPlugin 的去重规则一致：
 * 第二个追加 -#2、第三个 -#3……（注意是「-#」前缀）。
 */
export function buildUniqueId(text: string, used: Map<string, number>): string {
  const base = slugify(text) || 'section'
  const count = used.get(base) ?? 0
  used.set(base, count + 1)
  return count === 0 ? base : `${base}-#${count + 1}`
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

/** 判定一行 markdown 是否为列表项（无序 -、*、+ 或有序 1.） */
function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]|\d+\.)\s+/.test(line) || /^\s*(?:[-*+]|\d+\.)\s*$/.test(line)
}

/** 判定一行是否为代码围栏开始/结束（``` 或 ~~~，允许语言后缀） */
function isFenceLine(line: string): boolean {
  return /^\s*(?:```|~~~)/.test(line)
}

/** 从 Markdown 提取 # 到 #### 标题，附带层级关系、是否有子级、章节要点块数 */
export function extractToc(markdown: string): TocEntry[] {
  const lines = markdown.split('\n')
  const entries: TocEntry[] = []
  const used = new Map<string, number>()
  // 各级「最近标题」索引：lastLevel[level-1] = entries 里的下标，undefined 表示该级暂无
  const lastAtLevel: Array<number | undefined> = []

  let pendingPointCount = 0  // 当前标题下累计的块数
  let inFence = false
  let inList = false

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')

    // 代码围栏：整块算 1 个要点；围栏内不解析标题、不计更多块
    if (isFenceLine(line)) {
      if (!inFence) {
        inFence = true
        pendingPointCount += 1
      } else {
        inFence = false
      }
      continue
    }
    if (inFence) continue

    const headingMatch = line.match(/^(#{1,4})\s+(.+)/)
    if (headingMatch) {
      const text = headingMatch[2].trim()
      const level = headingMatch[1].length
      const id = buildUniqueId(text, used)

      // 结算上一个标题的 pointCount
      if (entries.length > 0) entries[entries.length - 1].pointCount += pendingPointCount
      pendingPointCount = 0
      inList = false

      // parentId = 最近一个 level 更小的标题
      let parentId: string | null = null
      for (let l = level - 1; l >= 1; l -= 1) {
        const idx = lastAtLevel[l - 1]
        if (idx !== undefined && idx >= 0) { parentId = entries[idx].id; break }
      }

      const entry: TocEntry = {
        id, text, level,
        parentId,
        hasChildren: false,
        pointCount: 0,
      }
      entries.push(entry)
      lastAtLevel[level - 1] = entries.length - 1
      // 清理比当前更深的 lastAtLevel 引用（它们被当前标题"截断"）
      for (let l = level; l < lastAtLevel.length; l += 1) lastAtLevel[l] = undefined
      continue
    }

    // 空行：结束列表组（空行分隔的两组列表算两块）
    if (line.trim() === '') {
      inList = false
      continue
    }

    // 非标题、非空行 → 内容块
    if (isListLine(line)) {
      if (!inList) { pendingPointCount += 1; inList = true }
      continue
    }
    pendingPointCount += 1
    inList = false
  }

  // 最后一个标题的 pointCount
  if (entries.length > 0) entries[entries.length - 1].pointCount += pendingPointCount

  // hasChildren：某标题其后存在 level 更大的标题，且中间没有 <= 自身的标题
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]
    for (let j = i + 1; j < entries.length; j += 1) {
      const next = entries[j]
      if (next.level <= entry.level) break
      if (next.level > entry.level) { entry.hasChildren = true; break }
    }
  }

  return entries
}

/** 给容器内标题元素补写唯一 id（h1-h4）。调用方用 selector 限定范围（如只扫正文编辑器面板，避开笔记标题 h1）。 */
export function assignHeadingIds(
  container: HTMLElement,
  opts: { selector?: string } = {},
): void {
  const selector = opts.selector ?? 'h1, h2, h3, h4'
  const headings = Array.from(container.querySelectorAll<HTMLElement>(selector))
  const used = new Map<string, number>()
  for (const heading of headings) {
    if (heading.id) continue
    const text = heading.textContent?.trim()
    if (!text) continue
    heading.id = buildUniqueId(text, used)
  }
}

interface Props {
  markdown: string
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** 目录内缩进的最大级别（默认 4） */
  maxLevel?: number
}

export function MarkdownToc({ markdown, scrollRef, maxLevel = 4 }: Props) {
  const toc = useMemo(() => extractToc(markdown).filter((entry) => entry.level <= maxLevel), [markdown, maxLevel])
  const [activeId, setActiveId] = useState('')
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())

  // 折叠状态随正文变化自动重置（切换版本/刷新/编辑后恢复全展开）
  useEffect(() => {
    setCollapsedIds(new Set())
  }, [markdown])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || toc.length === 0) return

    function updateActive() {
      const headings = container!.querySelectorAll('h1[id], h2[id], h3[id], h4[id]')
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

  const toggleCollapse = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 用 parentId 链判断：entry 可见当且仅当其所有祖先都不在 collapsedIds 中
  const idToEntry = new Map(toc.map((entry) => [entry.id, entry]))
  const isHiddenByCollapse = (entry: TocEntry): boolean => {
    let parentId = entry.parentId
    while (parentId) {
      if (collapsedIds.has(parentId)) return true
      parentId = idToEntry.get(parentId)?.parentId ?? null
    }
    return false
  }
  const visible = toc.filter((entry) => !isHiddenByCollapse(entry))
  const isCollapsed = (id: string) => collapsedIds.has(id)

  return (
    <div className="sm-toc">
      <div className="sm-toc-title">目录</div>
      <ul className="sm-toc-list">
        {visible.map((entry) => (
          <li
            key={entry.id}
            className="sm-toc-item"
            data-level={entry.level}
            data-active={entry.id === activeId || undefined}
          >
            <button
              type="button"
              className={`sm-toc-toggle${entry.hasChildren ? '' : ' is-placeholder'}`}
              onClick={(e) => toggleCollapse(e, entry.id)}
              aria-label={isCollapsed(entry.id) ? `展开 ${entry.text}` : `折叠 ${entry.text}`}
            >
              {entry.hasChildren
                ? (isCollapsed(entry.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />)
                : <ChevronRight size={12} />}
            </button>
            <a href={`#${entry.id}`} onClick={(e) => handleClick(e, entry.id)}>
              {entry.text}
            </a>
            {entry.pointCount > 0 && <span className="sm-toc-badge">{entry.pointCount}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
