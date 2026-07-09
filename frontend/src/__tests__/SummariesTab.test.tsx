/**
 * SummariesTab 组件测试。
 *
 * 测试：列表渲染 / 新建弹窗 / 删除调用 / 选中状态 / 对比模式。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SummariesTab } from '@/components/SummariesTab'
import type { ItemSummary } from '@/services/summaries'

/* ── mock services ────────────────────────────────────────────── */

const mocks = vi.hoisted(() => ({
  listSummaries: vi.fn(),
  createSummary: vi.fn(),
  deleteSummary: vi.fn(),
  renameSummary: vi.fn(),
  getItemNote: vi.fn(),
}))

vi.mock('@/services/summaries', () => ({
  listSummaries: mocks.listSummaries,
  createSummary: mocks.createSummary,
  deleteSummary: mocks.deleteSummary,
  renameSummary: mocks.renameSummary,
}))

vi.mock('@/services/workspaces', () => ({
  getItemNote: mocks.getItemNote,
}))

vi.mock('sonner', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

/* ── fixtures ─────────────────────────────────────────────────── */

const SUMMARY_1: ItemSummary = {
  summary_id: 's1',
  template: 'concise',
  version: 0,
  name: '',
  background_for_summary: '',
  content_md: '# 简洁摘要 v0\n\n这是第一版摘要',
  model_used: 'openai/gpt-4o',
  created_at: '2026-05-28T12:00:00Z',
}

const SUMMARY_2: ItemSummary = {
  summary_id: 's2',
  template: 'concise',
  version: 1,
  name: '',
  background_for_summary: '背景信息',
  content_md: '# 简洁摘要 v1\n\n这是第二版',
  model_used: 'openai/gpt-4o',
  created_at: '2026-05-28T13:00:00Z',
}

const SUMMARY_DETAILED: ItemSummary = {
  summary_id: 's3',
  template: 'detailed',
  version: 0,
  name: '',
  background_for_summary: '',
  content_md: '## 要点\n\n- 要点1\n- 要点2',
  model_used: 'deepseek/deepseek-chat',
  created_at: '2026-05-28T14:00:00Z',
}

const SUMMARY_QUOTES: ItemSummary = {
  summary_id: 's4',
  template: 'quotes',
  version: 0,
  name: '',
  background_for_summary: '',
  content_md: '> 金句一\n\n> 金句二',
  model_used: 'openai/gpt-4o',
  created_at: '2026-05-28T15:00:00Z',
}

/* ── tests ────────────────────────────────────────────────────── */

describe('SummariesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getItemNote.mockResolvedValue({})
  })

  it('加载后显示扁平版列表', async () => {
    mocks.listSummaries.mockResolvedValue([SUMMARY_1, SUMMARY_2, SUMMARY_DETAILED])

    render(<MemoryRouter><SummariesTab workspaceId="ws-1" itemId="item-1" /></MemoryRouter>)

    await waitFor(() => {
      // 扁平列表每条 = 模板名 · v{n}（label + preview 可能都匹配，用 getAllByText）
      expect(screen.getAllByText(/简洁摘要.*v0/).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/简洁摘要.*v1/).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/详细要点.*v0/).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('自动选中第一项并渲染 markdown', async () => {
    mocks.listSummaries.mockResolvedValue([SUMMARY_1])

    render(<MemoryRouter><SummariesTab workspaceId="ws-1" itemId="item-1" /></MemoryRouter>)

    await waitFor(() => {
      // 列表项 + 标题都显示
      expect(screen.getAllByText(/简洁摘要.*v0/).length).toBeGreaterThanOrEqual(1)
    })
    // markdown 内容（preview 也可能包含相同文字，用 getAllByText）
    expect(screen.getAllByText(/这是第一版摘要/).length).toBeGreaterThanOrEqual(1)
  })

  it('点击版本切换选中', async () => {
    mocks.listSummaries.mockResolvedValue([SUMMARY_1, SUMMARY_2])

    render(<MemoryRouter><SummariesTab workspaceId="ws-1" itemId="item-1" /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getAllByText(/简洁摘要.*v1/).length).toBeGreaterThanOrEqual(1)
    })

    // 点击 v1 条目（取第一个匹配 — 列表项里的 label）
    fireEvent.click(screen.getAllByText(/简洁摘要.*v1/)[0])

    await waitFor(() => {
      expect(screen.getAllByText(/这是第二版/).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('点击「+ 新建」打开弹窗，点击「生成」调用 createSummary', async () => {
    mocks.listSummaries.mockResolvedValue([SUMMARY_1])
    mocks.createSummary.mockResolvedValue(SUMMARY_2)

    render(<MemoryRouter><SummariesTab workspaceId="ws-1" itemId="item-1" /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByText('+ 新建')).toBeTruthy()
    })

    // 打开弹窗
    fireEvent.click(screen.getByText('+ 新建'))

    // 弹窗里的生成按钮
    const generateBtn = screen.getByText('生成')
    expect(generateBtn).toBeTruthy()

    // 点击生成
    fireEvent.click(generateBtn)

    await waitFor(() => {
      expect(mocks.createSummary).toHaveBeenCalledWith(
        'ws-1',
        'item-1',
        'standard',
        '',
        { provider_id: '', model: '', search_web: false },
      )
    })
  })

  it('note API 推荐工具模板时，新建总结默认使用工具推荐', async () => {
    mocks.listSummaries.mockResolvedValue([])
    mocks.createSummary.mockResolvedValue({
      ...SUMMARY_1,
      template: 'tool_recommendation',
    })
    mocks.getItemNote.mockResolvedValue({
      summary_hint: { default_template: 'tool_recommendation' },
    })

    render(<MemoryRouter><SummariesTab workspaceId="ws-1" itemId="item-1" /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByText('+ 新建总结')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('+ 新建总结'))
    fireEvent.click(screen.getByText('生成'))

    await waitFor(() => {
      expect(mocks.createSummary).toHaveBeenCalledWith(
        'ws-1',
        'item-1',
        'tool_recommendation',
        '',
        { provider_id: '', model: '', search_web: false },
      )
    })
  })

  it('点击删除调用 deleteSummary', async () => {
    mocks.listSummaries.mockResolvedValue([SUMMARY_1])
    mocks.deleteSummary.mockResolvedValue(undefined)

    render(<MemoryRouter><SummariesTab workspaceId="ws-1" itemId="item-1" /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getAllByText(/简洁摘要.*v0/).length).toBeGreaterThanOrEqual(1)
    })

    // 主显示区的删除按钮
    const deleteButtons = screen.getAllByText('删除')
    fireEvent.click(deleteButtons[0])

    await waitFor(() => {
      expect(mocks.deleteSummary).toHaveBeenCalledWith('ws-1', 'item-1', 's1')
    })
  })

  it('空列表显示新建引导', async () => {
    mocks.listSummaries.mockResolvedValue([])

    render(<MemoryRouter><SummariesTab workspaceId="ws-1" itemId="item-1" /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getByText(/生成一份内容总结/)).toBeTruthy()
    })
  })

  it('勾选 2 份后进入对比模式，并排显示', async () => {
    mocks.listSummaries.mockResolvedValue([SUMMARY_1, SUMMARY_2, SUMMARY_DETAILED])

    render(<MemoryRouter><SummariesTab workspaceId="ws-1" itemId="item-1" /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getAllByText(/简洁摘要.*v1/).length).toBeGreaterThanOrEqual(1)
    })

    // 找到所有 checkbox
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThanOrEqual(2)

    // 勾选前两个
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])

    // 「对比」按钮出现
    const enterBtn = screen.getByText(/对比/)
    expect(enterBtn).toBeTruthy()

    // 进入对比
    fireEvent.click(enterBtn)

    // 两份内容应同时显示（split view）
    expect(screen.getAllByText(/这是第一版摘要/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/这是第二版/).length).toBeGreaterThanOrEqual(1)

    // 退出对比按钮出现
    expect(screen.getByText(/退出对比/)).toBeTruthy()
  })

  it('第 4 个勾选被禁用 + toast 提示', async () => {
    mocks.listSummaries.mockResolvedValue(
      [SUMMARY_1, SUMMARY_2, SUMMARY_DETAILED, SUMMARY_QUOTES],
    )

    render(<MemoryRouter><SummariesTab workspaceId="ws-1" itemId="item-1" /></MemoryRouter>)

    await waitFor(() => {
      expect(screen.getAllByText(/金句提取/).length).toBeGreaterThanOrEqual(1)
    })

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBe(4)

    // 勾选 3 个
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    fireEvent.click(checkboxes[2])

    // 第 4 个仍然可以点击（checkbox 本身不 disabled，但 title 提示）
    // 点击后应触发 toast.warning
    fireEvent.click(checkboxes[3])

    const { toast } = await import('sonner')
    expect(toast.warning).toHaveBeenCalledWith('最多对比 3 份')
  })
})
