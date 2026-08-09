/**
 * MarkdownToc.extractToc —— 多级目录提取逻辑。
 *
 * 覆盖：
 * - h1-h4 四级标题全部纳入
 * - parentId / hasChildren 层级关系
 * - pointCount 内容块计数（段落、连续列表组、代码块）
 * - 同名标题 id 去重（-2/-3）
 */
import { describe, expect, it } from 'vitest'
import { buildUniqueId, extractToc, slugify } from '@/components/MarkdownToc'

describe('slugify', () => {
  it('与 Milkdown 规则一致：转小写、折叠空白为连字符、保留 emoji 和标点', () => {
    expect(slugify('Step 1：获取 BillyNotes 本地版本')).toBe('step-1：获取-billynotes-本地版本')
    // emoji 和中文标点被保留（Milkdown defaultHeadingIdGenerator 只处理空白）
    expect(slugify('🎯 学完你将掌握：')).toBe('🎯-学完你将掌握：')
  })
})

describe('buildUniqueId', () => {
  it('同名标题追加 -#2/-#3 去重（与 Milkdown syncHeadingIdPlugin 一致）', () => {
    const used = new Map<string, number>()
    expect(buildUniqueId('同名', used)).toBe('同名')
    expect(buildUniqueId('同名', used)).toBe('同名-#2')
    expect(buildUniqueId('同名', used)).toBe('同名-#3')
  })
})

describe('extractToc', () => {
  it('提取 h1-h4 全部级别', () => {
    const md = [
      '# 大标题',
      '## 二级标题',
      '### 三级标题',
      '#### 四级标题',
    ].join('\n')
    const toc = extractToc(md)
    expect(toc.map((t) => t.level)).toEqual([1, 2, 3, 4])
    expect(toc.map((t) => t.id)).toEqual(['大标题', '二级标题', '三级标题', '四级标题'])
  })

  it('计算 parentId：子标题归属最近的低级标题', () => {
    const md = [
      '# A',
      '## B',
      '### C',
      '## D',
    ].join('\n')
    const toc = extractToc(md)
    const byText = Object.fromEntries(toc.map((t) => [t.text, t]))
    expect(byText['A'].parentId).toBeNull()
    expect(byText['B'].parentId).toBe('a')
    expect(byText['C'].parentId).toBe('b')
    expect(byText['D'].parentId).toBe('a')
  })

  it('计算 hasChildren', () => {
    const md = [
      '# A',
      '## B',
      '### C',
      '## D',
    ].join('\n')
    const toc = extractToc(md)
    const byText = Object.fromEntries(toc.map((t) => [t.text, t]))
    expect(byText['A'].hasChildren).toBe(true)
    expect(byText['B'].hasChildren).toBe(true)
    expect(byText['C'].hasChildren).toBe(false)
    expect(byText['D'].hasChildren).toBe(false)
  })

  it('pointCount：段落各计 1 块', () => {
    const md = [
      '## 章节',
      '第一段',
      '第二段',
      '第三段',
      '## 下一章',
    ].join('\n')
    const toc = extractToc(md)
    expect(toc[0].pointCount).toBe(3)
    expect(toc[1].pointCount).toBe(0)
  })

  it('pointCount：连续列表项算 1 组，空行分隔的两组算 2', () => {
    const md = [
      '## 章节',
      '- 项一',
      '- 项二',
      '- 项三',
      '',
      '1. 有序一',
      '2. 有序二',
      '## 下一章',
    ].join('\n')
    const toc = extractToc(md)
    expect(toc[0].pointCount).toBe(2)
  })

  it('pointCount：代码围栏整体算 1 块', () => {
    const md = [
      '## 章节',
      '```ts',
      'const a = 1',
      'const b = 2',
      '```',
      '## 下一章',
    ].join('\n')
    const toc = extractToc(md)
    expect(toc[0].pointCount).toBe(1)
  })

  it('同名标题 id 去重，与 DOM 补写语义一致', () => {
    const md = [
      '## 同名',
      '内容',
      '## 同名',
      '内容',
    ].join('\n')
    const toc = extractToc(md)
    expect(toc[0].id).toBe('同名')
    expect(toc[1].id).toBe('同名-#2')
  })

  it('代码围栏内的 # 不解析为标题', () => {
    const md = [
      '## 章节',
      '```md',
      '# 围栏内标题',
      '```',
      '## 下一章',
    ].join('\n')
    const toc = extractToc(md)
    expect(toc.map((t) => t.text)).toEqual(['章节', '下一章'])
  })
})
