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
vi.mock('@/pages/SettingPage/ScreenshotPage', () => ({
  default: () => <div>截帧设置内容</div>,
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
    expect(screen.queryByText(/音乐|BPM|Suno|Udio/)).not.toBeInTheDocument()
    expect(screen.queryByText(/模型选择|视觉模型/)).not.toBeInTheDocument()
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
})
