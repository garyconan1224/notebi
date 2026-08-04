import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ArtifactContentView } from '@/pages/result/NoteShell/AiArtifactPanel'
import { mindMapToSvg } from '@/pages/result/NoteShell/ArtifactRenderers'
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

describe('Q4 AI 产物语义渲染', () => {
  it('思维导图渲染自有树而非 <pre>，支持折叠', () => {
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
    expect(canvas).toHaveStyle({ transform: 'scale(1)' })
    fireEvent.click(screen.getByRole('button', { name: '放大思维导图' }))
    expect(canvas).toHaveStyle({ transform: 'scale(1.1)' })
    fireEvent.click(screen.getByRole('button', { name: '重置思维导图缩放' }))
    expect(canvas).toHaveStyle({ transform: 'scale(1)' })
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
