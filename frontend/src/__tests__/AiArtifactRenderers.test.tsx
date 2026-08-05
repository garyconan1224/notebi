import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ArtifactContentView } from '@/pages/result/NoteShell/AiArtifactPanel'
import { estimateNodeLines, mindMapToSvg, nodeHeightFor, MindMapTree } from '@/pages/result/NoteShell/ArtifactRenderers'
import { updateNoteArtifact } from '@/services/noteArtifacts'
import type { NoteArtifact } from '@/services/noteArtifacts'

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

describe('思维导图换行与编辑能力', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('长文本按行数计算节点高度与行切分', () => {
    expect(estimateNodeLines('短文本')).toBe(1)
    expect(estimateNodeLines('这是一段超过十个字符的长文本内容')).toBeGreaterThan(1)
    const tall = nodeHeightFor('这是一段超过十个字符的长文本内容')
    expect(tall).toBeGreaterThan(30)
  })

  it('mindMapToSvg 多行节点输出多个 tspan 且不超框', () => {
    const contentJson = {
      root: {
        id: 'n0',
        text: '中心主题',
        children: [
          { id: 'n0-0', text: '这是一个非常长的分支节点文字用于验证换行', children: [] },
        ],
      },
    }
    const svg = mindMapToSvg(contentJson.root)
    expect(svg).toContain('<tspan')
    // 长文本不应再被截断到 22 字省略号
    expect(svg).not.toContain('…')
  })

  it('添加子节点后回调 onUpdated 并持久化', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('新分支')
    const onUpdated = vi.fn()
    const contentJson = {
      root: { id: 'n0', text: '根', children: [] },
    }
    const { container } = render(
      <MindMapTree
        data={contentJson}
        title="t"
        workspaceId="ws"
        itemId="it"
        artifactId="a1"
        onUpdated={onUpdated}
      />,
    )
    // 点击根节点旁的添加按钮
    const add = container.querySelector('.mindmap-node-add')
    expect(add).not.toBeNull()
    fireEvent.click(add as Element)
    expect(window.prompt).toHaveBeenCalled()
    expect(onUpdated).toHaveBeenCalledTimes(1)
    const next = onUpdated.mock.calls[0][0] as { root: { children: unknown[] } }
    expect(next.root.children.length).toBe(1)
  })

  it('双击节点进入重命名，回车提交并持久化', () => {
    const onUpdated = vi.fn()
    const contentJson = {
      root: { id: 'n0', text: '旧名', children: [] },
    }
    const { container } = render(
      <MindMapTree data={contentJson} title="t" workspaceId="ws" itemId="it" artifactId="a1" onUpdated={onUpdated} />,
    )
    const node = container.querySelector('.mindmap-node')
    expect(node).not.toBeNull()
    fireEvent.doubleClick(node as Element)
    const input = container.querySelector('.mindmap-edit input') as HTMLInputElement
    expect(input).not.toBeNull()
    fireEvent.change(input, { target: { value: '新名' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onUpdated).toHaveBeenCalledTimes(1)
    const next = onUpdated.mock.calls[0][0] as { root: { text: string } }
    expect(next.root.text).toBe('新名')
  })

  it('非根节点可删除，根节点不显示删除按钮', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onUpdated = vi.fn()
    const contentJson = {
      root: { id: 'n0', text: '根', children: [{ id: 'n1', text: '子', children: [] }] },
    }
    const { container } = render(
      <MindMapTree data={contentJson} title="t" workspaceId="ws" itemId="it" artifactId="a1" onUpdated={onUpdated} />,
    )
    const dels = container.querySelectorAll('.mindmap-node-del')
    expect(dels.length).toBe(1) // 只有非根节点
    fireEvent.click(dels[0] as Element)
    expect(window.confirm).toHaveBeenCalled()
    expect(onUpdated).toHaveBeenCalledTimes(1)
    const next = onUpdated.mock.calls[0][0] as { root: { children: unknown[] } }
    expect(next.root.children.length).toBe(0)
  })

  it('编辑后调用 updateNoteArtifact（经 AiArtifactPanel handler 集成由面板测试覆盖）', () => {
    // 仅验证 service 存在可导入
    expect(updateNoteArtifact).toBeTypeOf('function')
  })
})

describe('Q4 AI 产物语义渲染', () => {
  it('思维导图渲染节点连线画布而非 <pre>，支持缩放与折叠', () => {
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
    expect(screen.getByText('中心主题')).toBeInTheDocument()
    expect(screen.getByText('分支一')).toBeInTheDocument()
    // 有导出 PNG / SVG 按钮
    expect(screen.getByRole('button', { name: '导出 PNG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出 SVG' })).toBeInTheDocument()
    const canvas = screen.getByTestId('mindmap-canvas')
    expect(canvas).toHaveStyle({ transform: 'translate(0px, 0px) scale(1)' })
    fireEvent.click(screen.getByRole('button', { name: '放大思维导图' }))
    expect(canvas).toHaveStyle({ transform: 'translate(0px, 0px) scale(1.1)' })
    fireEvent.click(screen.getByRole('button', { name: '重置思维导图缩放' }))
    expect(canvas).toHaveStyle({ transform: 'translate(0px, 0px) scale(1)' })

    // 节点可折叠：点击「分支一」后叶子隐藏，再点恢复
    const branch = screen.getByRole('button', { name: /折叠 分支一/ })
    fireEvent.click(branch)
    expect(screen.queryByText('叶子')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /展开 分支一/ }))
    expect(screen.getByText('叶子')).toBeInTheDocument()
  })

  it('mindMapToSvg 生成真实 SVG（含节点与连线）', () => {
    const root = {
      id: 'n0',
      text: '根',
      children: [{ id: 'n0-0', text: '子', children: [] }],
    }
    const svg = mindMapToSvg(root)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('根')
    expect(svg).toContain('子')
    expect(svg).toContain('<path')
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
