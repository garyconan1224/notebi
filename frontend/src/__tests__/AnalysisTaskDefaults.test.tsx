import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalysisDefaultsPage from '@/pages/SettingPage/AnalysisDefaultsPage'

const { getTaskDefaultsMock, updateTaskDefaultsMock, successMock } = vi.hoisted(
  () => ({
    getTaskDefaultsMock: vi.fn(),
    updateTaskDefaultsMock: vi.fn(),
    successMock: vi.fn(),
  }),
)

vi.mock('@/services/taskDefaults', () => ({
  getTaskDefaults: getTaskDefaultsMock,
  updateTaskDefaults: updateTaskDefaultsMock,
}))

vi.mock('sonner', () => ({
  toast: {
    success: successMock,
    error: vi.fn(),
  },
}))

vi.mock('@/pages/SettingPage/PerformanceTierPage', () => ({
  default: () => <div>性能档位内容</div>,
}))
vi.mock('@/pages/SettingPage/TranscriberPage', () => ({
  default: () => <div>转写设置内容</div>,
}))

const SAVED = {
  summary_template: 'detailed',
  video_frame_analysis: false,
  frame_interval_sec: 12,
  diarize: true,
  speaker_count: 3,
  summary_language: 'zh-Hans',
  summary_language_custom: '',
}

describe('AnalysisDefaultsPage task defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTaskDefaultsMock.mockResolvedValue(SAVED)
    updateTaskDefaultsMock.mockResolvedValue(SAVED)
  })

  it('读取并展示全部笔记任务默认值，不出现音乐或模型字段', async () => {
    render(<AnalysisDefaultsPage />)

    fireEvent.click(screen.getByRole('tab', { name: '任务默认勾选' }))

    expect(await screen.findByLabelText('默认摘要模板')).toHaveValue('detailed')
    expect(screen.getByLabelText('视频画面分析与笔记配图')).not.toBeChecked()
    expect(screen.getByLabelText('默认截帧间隔')).toHaveValue(12)
    expect(screen.getByLabelText('默认区分说话人')).toBeChecked()
    expect(screen.getByLabelText('默认说话人数')).toHaveValue('3')
    expect(screen.getByLabelText('总结输出语言')).toHaveValue('zh-Hans')
    expect(screen.queryByText(/音乐|BPM|Suno|Udio/)).not.toBeInTheDocument()
    expect(screen.queryByText(/模型选择|视觉模型/)).not.toBeInTheDocument()
  })

  it('不再暴露没有后端消费者的截帧设置，画面分析默认值仍由任务默认勾选管理', async () => {
    render(<AnalysisDefaultsPage />)

    expect(screen.queryByRole('tab', { name: '截帧设置' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '任务默认勾选' }))
    expect(await screen.findByLabelText('视频画面分析与笔记配图')).toBeInTheDocument()
    expect(screen.getByLabelText('默认截帧间隔')).toBeInTheDocument()
  })

  it('允许保存自定义的总结输出语言', async () => {
    const custom = { ...SAVED, summary_language: 'custom', summary_language_custom: 'fr-CA' }
    getTaskDefaultsMock
      .mockResolvedValueOnce(SAVED)
      .mockResolvedValueOnce(custom)
    updateTaskDefaultsMock.mockResolvedValue(custom)
    render(<AnalysisDefaultsPage />)
    fireEvent.click(screen.getByRole('tab', { name: '任务默认勾选' }))

    fireEvent.change(await screen.findByLabelText('总结输出语言'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('自定义语言标签'), { target: { value: 'fr-CA' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(updateTaskDefaultsMock).toHaveBeenCalledWith(custom))
  })

  it('PATCH 保存后再次 GET 读回一致', async () => {
    getTaskDefaultsMock
      .mockResolvedValueOnce(SAVED)
      .mockResolvedValueOnce({ ...SAVED, frame_interval_sec: 18 })
    updateTaskDefaultsMock.mockResolvedValue({
      ...SAVED,
      frame_interval_sec: 18,
    })
    render(<AnalysisDefaultsPage />)
    fireEvent.click(screen.getByRole('tab', { name: '任务默认勾选' }))
    const interval = await screen.findByLabelText('默认截帧间隔')

    fireEvent.change(interval, { target: { value: '18' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(updateTaskDefaultsMock).toHaveBeenCalledWith({
        ...SAVED,
        frame_interval_sec: 18,
      })
    })
    expect(getTaskDefaultsMock).toHaveBeenCalledTimes(2)
    expect(successMock).toHaveBeenCalledWith('任务默认值已保存并读回验证')
  })

  it('S2: 截帧间隔可输入 300 和 600，无上限截断', async () => {
    getTaskDefaultsMock
      .mockResolvedValueOnce(SAVED)
      .mockResolvedValueOnce({ ...SAVED, frame_interval_sec: 300 })
    updateTaskDefaultsMock.mockResolvedValue({ ...SAVED, frame_interval_sec: 300 })
    render(<AnalysisDefaultsPage />)
    fireEvent.click(screen.getByRole('tab', { name: '任务默认勾选' }))
    const interval = await screen.findByLabelText('默认截帧间隔')

    fireEvent.change(interval, { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(updateTaskDefaultsMock).toHaveBeenCalledWith({
        ...SAVED,
        frame_interval_sec: 300,
      })
    })
    // 输入框没有 max 属性
    expect(interval).not.toHaveAttribute('max')
  })
})
