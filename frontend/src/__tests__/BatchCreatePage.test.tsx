import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BatchCreatePage from '@/pages/TaskCenterPage/BatchCreatePage'

const { previewMock, createMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  createMock: vi.fn(),
}))

vi.mock('@/services/taskBatches', () => ({
  previewTaskBatch: previewMock,
  createTaskBatch: createMock,
}))

describe('BatchCreatePage', () => {
  beforeEach(() => {
    previewMock.mockResolvedValue({
      total: 1,
      items: [{
        batch_item_id: 'i1',
        source_url: 'https://example.com/1',
        status: 'new',
        existing_workspace_id: '',
        suggested_action: 'process',
      }],
    })
    createMock.mockResolvedValue({ batch_id: 'b1' })
  })

  it('七类来源、目标合集和四项常用设置一页常驻', () => {
    render(<MemoryRouter><BatchCreatePage /></MemoryRouter>)
    const source = screen.getByLabelText('来源类型')
    for (const label of ['多 URL', '本地文件', 'Bilibili 合集', 'Bilibili 收藏夹', 'Bilibili UP 主', 'Bilibili 分 P', 'YouTube playlist']) {
      expect(source).toContainHTML(label)
    }
    expect(screen.getByLabelText('目标合集')).toBeInTheDocument()
    expect(screen.getByLabelText('笔记风格')).toBeInTheDocument()
    expect(screen.getByLabelText('识别类型')).toBeInTheDocument()
    expect(screen.getByText('区分说话人')).toBeInTheDocument()
    expect(screen.getByText('画面分析')).toBeInTheDocument()
    expect(screen.queryByText('学习笔记')).not.toBeInTheDocument()
  })

  it('预览前不创建任务，预览后可逐项选动作并固定 note', async () => {
    render(<MemoryRouter><BatchCreatePage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('素材来源'), {
      target: { value: 'https://example.com/1' },
    })
    expect(createMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '预览素材' }))
    expect(await screen.findByText('https://example.com/1')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('动作 1'), { target: { value: 'skip' } })
    fireEvent.click(screen.getByRole('button', { name: '开始生成笔记' }))
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      settings: expect.objectContaining({ task_type: 'note' }),
      items: [expect.objectContaining({ action: 'skip' })],
    }))
  })
})
