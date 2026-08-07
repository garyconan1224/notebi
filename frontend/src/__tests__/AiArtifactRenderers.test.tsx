import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ArtifactContentView } from '@/pages/result/NoteShell/AiArtifactPanel'
import {
  MindMapView,
  buildNotebiTheme,
  mindMapToMarkdown,
  toMindElixirData,
  toNotebiData,
} from '@/pages/result/NoteShell/MindMapView'
import { actionItemsToMarkdown } from '@/pages/result/NoteShell/ArtifactRenderers'
import type { NoteArtifact } from '@/services/noteArtifacts'
import { lastMindElixir, resetMindElixirMock, snapdomModuleMock } from './helpers/mindElixirMock'

vi.mock('mind-elixir', async () => (await import('./helpers/mindElixirMock')).mindElixirModuleMock)
vi.mock('mind-elixir/i18n', async () => (await import('./helpers/mindElixirMock')).mindElixirI18nMock)
vi.mock('@zumer/snapdom', async () => (await import('./helpers/mindElixirMock')).snapdomModuleMock)

function artifact(patch: Partial<NoteArtifact>): NoteArtifact {
  return {
    artifact_id: 'a1',
    kind: 'mind_map',
    title: '测试产物',
    content_md: '# md',
    source_scope: 'full_note',
    original_text: '',
    model_used: 'm',
    created_at: '2026-08-03T00:00:00Z',
    ...patch,
  }
}

vi.mock('@/services/noteArtifacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/noteArtifacts')>()
  return {
    ...actual,
    updateNoteArtifact: vi.fn().mockResolvedValue({ status: 'updated', artifact_id: 'a1' }),
  }
})

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('思维导图数据转换', () => {
  it('NoteBi 数据转 mind-elixir：text→topic 递归映射', () => {
    const data = {
      root: {
        id: 'n0',
        text: '中心主题',
        children: [{ id: 'n0-0', text: '分支一', children: [{ id: 'n0-0-0', text: '叶子', children: [] }] }],
      },
    }
    expect(toMindElixirData(data)).toEqual({
      nodeData: {
        id: 'n0',
        topic: '中心主题',
        children: [{ id: 'n0-0', topic: '分支一', children: [{ id: 'n0-0-0', topic: '叶子', children: [] }] }],
      },
    })
  })

  it('转回 NoteBi 只保留 id/text/children，丢弃 parent 反向引用等运行时字段', () => {
    const parentRef = { id: 'n0', topic: '根', children: [] } as Record<string, unknown>
    const child = { id: 'n1', topic: '子', children: [], parent: parentRef, style: { color: '#000' } }
    parentRef.children = [child]
    const out = toNotebiData({ nodeData: parentRef } as never)
    // 无环、无多余字段，可直接 JSON 序列化进 PATCH
    expect(JSON.parse(JSON.stringify(out))).toEqual({
      root: { id: 'n0', text: '根', children: [{ id: 'n1', text: '子', children: [] }] },
    })
  })

  it('mindMapToMarkdown 生成标题 + 嵌套大纲', () => {
    const md = mindMapToMarkdown({
      root: {
        id: 'n0',
        text: '核心',
        children: [
          { id: 'n1', text: '分支', children: [{ id: 'n2', text: '叶子', children: [] }] },
        ],
      },
    })
    expect(md).toBe('## 核心\n\n- 分支\n  - 叶子')
  })

  it('buildNotebiTheme 区分明暗且根节点用强调色', () => {
    const light = buildNotebiTheme(false)
    const dark = buildNotebiTheme(true)
    expect(light.name).toBe('notebi-light')
    expect(dark.name).toBe('notebi-dark')
    expect(light.type).toBe('light')
    expect(dark.type).toBe('dark')
    expect(light.palette.length).toBeGreaterThanOrEqual(3)
    expect(light.cssVar?.['--root-bgcolor']).toBeTruthy()
  })
})

describe('思维导图编辑接线（mind-elixir 包装）', () => {
  beforeEach(() => {
    resetMindElixirMock()
    vi.clearAllMocks()
  })

  it('挂载时以双向布局与转换后的数据初始化', () => {
    render(
      <MindMapView
        data={{ root: { id: 'n0', text: '根', children: [{ id: 'n1', text: '子', children: [] }] } }}
        title="t"
      />,
    )
    const mind = lastMindElixir()
    expect(mind.options.direction).toBe(2) // SIDE 双向
    expect(mind.init).toHaveBeenCalledWith({
      nodeData: { id: 'n0', topic: '根', children: [{ id: 'n1', topic: '子', children: [] }] },
    })
  })

  it('编辑操作经 operation 事件回传 onUpdated 以持久化', () => {
    const onUpdated = vi.fn()
    render(
      <MindMapView data={{ root: { id: 'n0', text: '根', children: [] } }} title="t" onUpdated={onUpdated} />,
    )
    const mind = lastMindElixir()
    mind.getData.mockReturnValue({
      nodeData: { id: 'n0', topic: '根', children: [{ id: 'x', topic: '新分支', children: [] }] },
    })
    act(() => mind.emit('operation', { name: 'addChild' }))
    expect(onUpdated).toHaveBeenCalledTimes(1)
    expect(onUpdated.mock.calls[0][0]).toEqual({
      root: { id: 'n0', text: '根', children: [{ id: 'x', text: '新分支', children: [] }] },
    })
  })

  it('beginEdit 只是进入编辑态，不触发持久化', () => {
    const onUpdated = vi.fn()
    render(
      <MindMapView data={{ root: { id: 'n0', text: '根', children: [] } }} title="t" onUpdated={onUpdated} />,
    )
    act(() => lastMindElixir().emit('operation', { name: 'beginEdit' }))
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('卸载时销毁实例并解绑事件', () => {
    const { unmount } = render(
      <MindMapView data={{ root: { id: 'n0', text: '根', children: [] } }} title="t" />,
    )
    const mind = lastMindElixir()
    unmount()
    expect(mind.destroy).toHaveBeenCalled()
    expect(mind.listeners['operation'] ?? []).toHaveLength(0)
  })

  it('提供 PNG / SVG 导出按钮，点击走 snapdom 截图', () => {
    render(
      <MindMapView data={{ root: { id: 'n0', text: '根', children: [] } }} title="导图标题" />,
    )
    act(() => {
      screen.getByRole('button', { name: '导出 PNG' }).click()
    })
    expect(snapdomModuleMock.snapdom).toHaveBeenCalled()
  })
})

describe('Q4 AI 产物语义渲染', () => {
  beforeEach(() => {
    resetMindElixirMock()
    vi.clearAllMocks()
  })

  it('思维导图经 mind-elixir 画布渲染而非 <pre>', () => {
    const contentJson = {
      root: {
        id: 'n0',
        text: '中心主题',
        children: [
          { id: 'n0-0', text: '分支一', children: [{ id: 'n0-0-0', text: '叶子', children: [] }] },
        ],
      },
    }
    const { container } = render(
      <ArtifactContentView artifact={artifact({ kind: 'mind_map', content_md: '- 中心主题', content_json: contentJson })} />,
    )
    expect(container.querySelector('pre.note-artifact-content')).toBeNull()
    expect(screen.getByTestId('mindmap-canvas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出 PNG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出 SVG' })).toBeInTheDocument()
  })

  it('行动项渲染为带勾选框的列表', () => {
    const contentJson = {
      items: [
        { id: 'a0', text: '写周报', done: false },
        { id: 'a1', text: '开评审会', done: true },
      ],
    }
    const { container } = render(
      <ArtifactContentView artifact={artifact({ kind: 'action_items', content_md: '- [ ] 写周报', content_json: contentJson })} />,
    )
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
    expect(screen.getByText('写周报')).toBeInTheDocument()
  })

  it('行动项明细作为不可勾选元信息渲染，只有主任务有勾选框', () => {
    const contentJson = {
      items: [
        {
          id: 'a0',
          text: '写周报',
          done: false,
          details: ['负责人：未明确', '完成标准：周五前提交'],
        },
      ],
    }
    const { container } = render(
      <ArtifactContentView artifact={artifact({ kind: 'action_items', content_md: '- [ ] 写周报', content_json: contentJson })} />,
    )
    // 只有主任务一个勾选框，明细不生成勾选框
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    expect(screen.getByText('写周报')).toBeInTheDocument()
    expect(screen.getByText('负责人：未明确')).toBeInTheDocument()
    expect(screen.getByText('完成标准：周五前提交')).toBeInTheDocument()
  })

  it('actionItemsToMarkdown 按 done 生成 - [x]/- [ ] 并保留明细子行', () => {
    const md = actionItemsToMarkdown([
      { id: 'a0', text: '写周报', done: true, details: ['负责人：小张'] },
      { id: 'a1', text: '开评审会', done: false },
    ])
    expect(md).toBe('- [x] 写周报\n  - 负责人：小张\n\n- [ ] 开评审会')
  })

  it('术语表渲染为语义表格', () => {
    const contentJson = {
      columns: ['术语', '解释', '语境'],
      rows: [{ term: 'API', definition: '应用程序接口', context: '开放接口' }],
    }
    render(
      <ArtifactContentView artifact={artifact({ kind: 'glossary', content_md: '|a|b|', content_json: contentJson })} />,
    )
    expect(screen.getByText('API')).toBeInTheDocument()
    expect(screen.getByText('应用程序接口')).toBeInTheDocument()
  })

  it('旧版产物（无 content_json）回退 Markdown 并标注旧版', () => {
    const { container } = render(
      <ArtifactContentView artifact={artifact({ kind: 'mind_map', content_md: '# 旧内容', content_json: null })} />,
    )
    expect(screen.getByText('旧版产物')).toBeInTheDocument()
    expect(container.querySelector('pre.note-artifact-content')).not.toBeNull()
    expect(screen.getByText('# 旧内容')).toBeInTheDocument()
  })

  it('闪卡点击后显示答案', () => {
    const contentJson = {
      cards: [{ id: 'f0', question: '什么是光合作用？', answer: '植物利用光能合成有机物。' }],
    }
    render(
      <ArtifactContentView artifact={artifact({ kind: 'flashcards', content_md: 'Q: ...', content_json: contentJson })} />,
    )
    expect(screen.getByText(/什么是光合作用/)).toBeInTheDocument()
    expect(screen.queryByText(/植物利用光能/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /什么是光合作用/ }))
    expect(screen.getByText(/植物利用光能/)).toBeInTheDocument()
  })
})
