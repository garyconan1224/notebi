import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import SpeakerDiarizationRow, {
  type SpeakerDiarizationInfo,
} from '@/pages/result/NoteShell/SpeakerDiarizationRow'

function speaker(id: string, name = ''): SpeakerDiarizationInfo {
  return {
    id,
    displayName: name || id.replace(/^SPEAKER_/, 'S'),
    role: '',
    color: '#4f8fd8',
    count: 4,
    durationSec: 40,
    percent: 50,
  }
}

describe('SpeakerDiarizationRow（D1 说话人四状态）', () => {
  it('未请求区分说话人且无数据：整层不渲染', () => {
    const { container } = render(
      <SpeakerDiarizationRow status="none" speakers={[]} onRetry={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('已请求且处理中：紧凑状态行，无重试按钮', () => {
    render(<SpeakerDiarizationRow status="running" speakers={[]} onRetry={vi.fn()} />)
    expect(screen.getByText(/区分说话人.*进行中|正在区分说话人/)).not.toBeNull()
    expect(screen.queryByRole('button', { name: /重试/ })).toBeNull()
  })

  it('已请求且失败：紧凑状态行 + 重试按钮', () => {
    const onRetry = vi.fn()
    render(<SpeakerDiarizationRow status="failed" speakers={[]} onRetry={onRetry} />)
    expect(screen.getByText(/区分说话人.*失败|未完成区分说话人/)).not.toBeNull()
    const retry = screen.getByRole('button', { name: /重试/ })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalled()
  })

  it('失败态重试中禁用按钮并显示提交中', () => {
    render(
      <SpeakerDiarizationRow status="failed" speakers={[]} onRetry={vi.fn()} retrying />,
    )
    const retry = screen.getByRole('button', { name: /重试|正在提交/ })
    expect((retry as HTMLButtonElement).disabled).toBe(true)
  })

  it('有数据：默认折叠为一行「N 位说话人」，不展开明细', () => {
    render(
      <SpeakerDiarizationRow
        status="data"
        speakers={[speaker('SPEAKER_00'), speaker('SPEAKER_01'), speaker('SPEAKER_02')]}
        onRetry={vi.fn()}
      />,
    )
    expect(screen.getByText(/3 位说话人/)).not.toBeNull()
    expect(screen.queryByLabelText('SPEAKER_00 姓名')).toBeNull()
  })

  it('展开后可重命名说话人并保存', () => {
    const onSave = vi.fn()
    render(
      <SpeakerDiarizationRow
        status="data"
        speakers={[speaker('SPEAKER_00'), speaker('SPEAKER_01')]}
        onRetry={vi.fn()}
        onRename={onSave}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /2 位说话人/ }))
    const input = screen.getByLabelText('SPEAKER_00 姓名')
    fireEvent.change(input, { target: { value: '主持人' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('SPEAKER_00', '主持人', '')
  })
})
