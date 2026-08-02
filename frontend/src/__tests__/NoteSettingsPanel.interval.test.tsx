import '@testing-library/jest-dom'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  NoteSettingsPanel,
  type NoteSettingsPanelProps,
} from '@/components/workspace/NoteSettingsPanel'

function baseProps(overrides: Partial<NoteSettingsPanelProps> = {}): NoteSettingsPanelProps {
  return {
    selectedNoteType: 'video',
    onSelectedNoteTypeChange: () => {},
    noteTypeCards: [{ value: 'video', label: '视频', desc: '' }],
    noteStyle: 'standard',
    onNoteStyleChange: () => {},
    speakerAwareMedia: false,
    visiblePrimaryStyleOptions: [{ id: 'standard', label: '标准总结', desc: '' }],
    visibleMoreStyleOptions: [],
    showSpeakerSettings: false,
    diarizeOn: false,
    onDiarizeChange: () => {},
    speakerCount: 'auto',
    onSpeakerCountChange: () => {},
    showFrameAnalysisSettings: true,
    embedFrames: true,
    onEmbedFramesChange: () => {},
    onUserToggled: () => {},
    visionModels: [{ providerId: 'p1', providerName: 'P', modelId: 'm1', modelName: 'M' }],
    hasVisionModel: true,
    selectedVisionModel: '__default__',
    onSelectedVisionModelChange: () => {},
    captureMode: 'manual',
    onCaptureModeChange: () => {},
    frameInterval: 5,
    onFrameIntervalChange: () => {},
    videoDuration: 600,
    userNotes: '',
    onUserNotesChange: () => {},
    ...overrides,
  }
}

function IntervalHarness() {
  const [frameInterval, setFrameInterval] = useState(5)
  return (
    <NoteSettingsPanel
      {...baseProps({ frameInterval, onFrameIntervalChange: setFrameInterval })}
    />
  )
}

describe('NoteSettingsPanel 添加素材入口：截帧间隔编辑', () => {
  it('清空输入不立即强制回默认值，blur 后回退', () => {
    render(<IntervalHarness />)
    const input = screen.getByLabelText('截帧间隔秒数') as HTMLInputElement
    expect(input).toHaveValue(5)

    fireEvent.change(input, { target: { value: '' } })
    expect(input.value).toBe('')

    fireEvent.blur(input)
    expect(input.value).toBe('5')
  })

  it('超大正整数立即提交，输入框无 max', () => {
    const changes: number[] = []
    render(
      <NoteSettingsPanel
        {...baseProps({
          frameInterval: 5,
          onFrameIntervalChange: (value) => changes.push(value),
        })}
      />,
    )
    const input = screen.getByLabelText('截帧间隔秒数') as HTMLInputElement
    expect(input).not.toHaveAttribute('max')

    fireEvent.change(input, { target: { value: String(2 ** 40) } })

    expect(changes).toEqual([2 ** 40])
  })

  it('快捷选项一键提交常用值', () => {
    const changes: number[] = []
    render(
      <NoteSettingsPanel
        {...baseProps({
          frameInterval: 5,
          onFrameIntervalChange: (value) => changes.push(value),
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '30 秒' }))

    expect(changes).toEqual([30])
  })

  it('智能模式下输入框禁用', () => {
    render(<NoteSettingsPanel {...baseProps({ captureMode: 'auto' })} />)
    expect(screen.getByLabelText('截帧间隔秒数')).toBeDisabled()
  })
})
