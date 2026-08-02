import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BatchCreatePage from '@/pages/TaskCenterPage/BatchCreatePage'

const { previewMock, createMock, getTaskDefaultsMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  createMock: vi.fn(),
  getTaskDefaultsMock: vi.fn(),
}))

vi.mock('@/services/taskBatches', () => ({
  previewTaskBatch: previewMock,
  createTaskBatch: createMock,
}))

vi.mock('@/services/taskDefaults', () => ({
  getTaskDefaults: getTaskDefaultsMock,
}))

describe('BatchCreatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    getTaskDefaultsMock.mockResolvedValue({
      summary_template: 'standard',
      video_frame_analysis: true,
      frame_interval_sec: 5,
      diarize: false,
      speaker_count: null,
    })
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

  it('加载保存值并允许本次任务显式覆盖', async () => {
    getTaskDefaultsMock.mockResolvedValue({
      summary_template: 'detailed',
      video_frame_analysis: false,
      frame_interval_sec: 12,
      diarize: true,
      speaker_count: 3,
    })
    render(<MemoryRouter><BatchCreatePage /></MemoryRouter>)

    expect(await screen.findByLabelText('笔记风格')).toHaveValue('detailed')
    expect(screen.getByLabelText('画面分析')).not.toBeChecked()
    expect(screen.getByLabelText('截帧间隔')).toHaveValue(12)
    expect(screen.getByLabelText('区分说话人')).toBeChecked()
    expect(screen.getByLabelText('说话人数')).toHaveValue('3')

    fireEvent.click(screen.getByLabelText('画面分析'))
    fireEvent.change(screen.getByLabelText('截帧间隔'), {
      target: { value: '7' },
    })
    fireEvent.change(screen.getByLabelText('说话人数'), {
      target: { value: 'auto' },
    })
    fireEvent.change(screen.getByLabelText('素材来源'), {
      target: { value: 'https://example.com/1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '预览素材' }))
    expect(await screen.findByText('https://example.com/1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '开始生成笔记' }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      settings: expect.objectContaining({
        note_style: 'detailed',
        frame_analysis: true,
        frame_interval: 7,
        diarize: true,
        speaker_count: null,
      }),
    }))
  })
})

describe('BatchCreatePage 截帧间隔编辑（任意正整数契约）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    getTaskDefaultsMock.mockResolvedValue({
      summary_template: 'standard',
      video_frame_analysis: true,
      frame_interval_sec: 5,
      diarize: false,
      speaker_count: null,
    })
  })

  it('清空输入不变成 0，blur 回退最后有效值', async () => {
    render(<MemoryRouter><BatchCreatePage /></MemoryRouter>)
    const interval = await screen.findByLabelText('截帧间隔') as HTMLInputElement
    expect(interval).toHaveValue(5)

    fireEvent.change(interval, { target: { value: '' } })
    expect(interval.value).toBe('')
    fireEvent.blur(interval)
    expect(interval.value).toBe('5')
  })

  it('超大正整数原样进入批量提交 payload', async () => {
    render(<MemoryRouter><BatchCreatePage /></MemoryRouter>)
    const interval = await screen.findByLabelText('截帧间隔') as HTMLInputElement

    fireEvent.change(interval, { target: { value: String(2 ** 40) } })
    fireEvent.change(screen.getByLabelText('素材来源'), {
      target: { value: 'https://example.com/1' },
    })
    fireEvent.click(screen.getByRole('button', { name: '预览素材' }))
    expect(await screen.findByText('https://example.com/1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '开始生成笔记' }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      settings: expect.objectContaining({ frame_interval: 2 ** 40 }),
    }))
  })
})
