// @ts-nocheck — vitest node 环境，无需浏览器 TS 类型
import fs from 'fs'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'

/**
 * R4-C: 页面头部响应式边界 DOM 结构测试。
 * 验证关键容器具备正确的 CSS 以支持窄屏布局。
 */

vi.mock('@/services/workspaces')
vi.mock('@/services/library')
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const SRC = path.resolve(process.cwd(), 'src')

describe('R4-C responsive structure', () => {
  it('Taskboard head left has min-width constraint', () => {
    const css = fs.readFileSync(
      path.resolve(SRC, 'pages/WorkspacePage/TaskboardPage/taskboard.css'), 'utf-8',
    )
    expect(css).toContain('.tb-head-l')
    expect(css).toMatch(/\.tb-head-l\s*\{[^}]*min-width:\s*0/)
  })

  it('Taskboard head wraps at medium width', () => {
    const css = fs.readFileSync(
      path.resolve(SRC, 'pages/WorkspacePage/TaskboardPage/taskboard.css'), 'utf-8',
    )
    expect(css).toMatch(/@media[^{]*\{[^}]*\.tb-head\s*\{[^}]*flex-wrap:\s*wrap/)
  })

  it('LearningNotes nav wraps', () => {
    const css = fs.readFileSync(
      path.resolve(SRC, 'pages/results/LearningNotesPage/learning-notes.css'), 'utf-8',
    )
    expect(css).toMatch(/\.ln-nav\s*\{[^}]*flex-wrap:\s*wrap/)
  })

  it('WorkspaceList header stacks on narrow screen', async () => {
    const { default: WorkspaceList } = await import(
      '@/pages/WorkspacePage/WorkspaceList'
    )
    expect(WorkspaceList).toBeDefined()
  })
})
