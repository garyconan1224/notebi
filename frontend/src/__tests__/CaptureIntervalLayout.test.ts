/**
 * Q1 红灯 4：截帧间隔控件（.capture-interval）不得用固定高度承载两行内容。
 *
 * 背景：PositiveIntInput 自带快捷按钮行（输入框 + 5/10/30/60 按钮，自然两行），
 * 旧 CSS 给 .capture-interval 固定 height: 28px，第二行溢出并与相邻字段重叠。
 * 契约：容器用 min-height + flex-wrap 承载自然高度；真实几何（320px/125% 缩放）
 * 由 Playwright 视觉矩阵验收。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(
  resolve(__dirname, '../styles/nibi-components.css'),
  'utf-8',
)

/** 提取所有选择器命中给定 class 的规则块声明文本 */
function blocksFor(selectorPart: string): string[] {
  const blocks: string[] = []
  // 逐段切分「选择器 { 声明 }」（媒体查询内层规则同样命中）
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = ruleRe.exec(css)) !== null) {
    const selector = m[1]
    // 跳过 @media 头本身（其后是 { 嵌套 }，正则只取无嵌套声明块）
    if (selector.trim().startsWith('@')) continue
    const selectors = m[1].split(',').map((s) => s.trim())
    if (selectors.includes(selectorPart)) blocks.push(m[2])
  }
  return blocks
}

describe('截帧间隔容器布局契约（.capture-interval）', () => {
  const blocks = blocksFor('.capture-interval')

  it('规则存在', () => {
    expect(blocks.length).toBeGreaterThan(0)
  })

  it('不得使用固定 height 承载可换行内容', () => {
    for (const decls of blocks) {
      expect(decls).not.toMatch(/(^|;|\s)height\s*:/)
    }
  })

  it('用 min-height 保持单行视觉高度', () => {
    expect(blocks.some((d) => /min-height\s*:/.test(d))).toBe(true)
  })

  it('允许换行（flex-wrap），快捷按钮行不溢出容器', () => {
    expect(blocks.some((d) => /flex-wrap\s*:\s*wrap/.test(d))).toBe(true)
  })
})

describe('PositiveIntInput 快捷行自身可换行', () => {
  it('快捷按钮容器是 flex-wrap', () => {
    // 组件实现契约：快捷行 className 必须含 flex-wrap（在组件源码中断言）
    const tsx = readFileSync(
      resolve(__dirname, '../components/ui/positive-int-input.tsx'),
      'utf-8',
    )
    expect(tsx).toMatch(/flex-wrap/)
  })
})
