import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { StatusBadge } from '@/components/ui/status-badge'

describe('Open Design product primitives', () => {
  it('keeps title, description and actions in one page header', () => {
    render(
      <PageHeader
        eyebrow="LOCAL WORKSPACE"
        title="任务中心"
        description="查看每个公开处理阶段。"
        actions={<button type="button">刷新</button>}
      />,
    )

    expect(screen.getByRole('heading', { name: '任务中心' })).toBeInTheDocument()
    expect(screen.getByText('LOCAL WORKSPACE')).toBeInTheDocument()
    expect(screen.getByText('查看每个公开处理阶段。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument()
  })

  it('uses a neutral surface section and text-backed status', () => {
    render(
      <>
        <Section title="公开阶段" description="不显示隐藏推理">
          <div>生成总结</div>
        </Section>
        <StatusBadge status="running">处理中</StatusBadge>
      </>,
    )

    expect(screen.getByText('公开阶段').closest('[data-slot="section"]')).toHaveClass(
      'bg-[var(--srf)]',
    )
    expect(screen.getByText('处理中')).toHaveAttribute('data-status', 'running')
  })
})
