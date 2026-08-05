import { describe, expect, it } from 'vitest'

import { stripUnresolvedFramePlaceholders } from '@/pages/result/NoteShell/frameMarkdown'

describe('stripUnresolvedFramePlaceholders', () => {
  it('删除未解析的 *FRAME- 占位符图片，保留正文', () => {
    const md = [
      '## 第一节',
      '',
      '正文内容',
      '',
      '![配图](*FRAME-[01:23])',
      '',
      '## 第二节',
    ].join('\n')
    const cleaned = stripUnresolvedFramePlaceholders(md)
    expect(cleaned).toContain('## 第一节')
    expect(cleaned).toContain('正文内容')
    expect(cleaned).toContain('## 第二节')
    expect(cleaned).not.toContain('*FRAME-')
  })

  it('真实图片 URL 与普通文本原样保留', () => {
    const md = '![真实图](/static/frames/1.jpg)\n\n文本'
    expect(stripUnresolvedFramePlaceholders(md)).toBe(md)
  })

  it('空字符串直接返回', () => {
    expect(stripUnresolvedFramePlaceholders('')).toBe('')
  })
})
