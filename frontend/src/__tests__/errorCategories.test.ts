import { describe, expect, it } from 'vitest'
import { AUDIO_ERROR_GUIDANCE, categorizeError } from '@/lib/errorCategories'

describe('audio error guidance', () => {
  it('classifies common audio failures with actionable suggestions', () => {
    expect(categorizeError('ASR 全部失败，无法转写音频').category).toBe('transcription')
    expect(categorizeError('本地音频不存在').category).toBe('audio_source')
    expect(categorizeError('pyannote 模型不可用').category).toBe('speaker_identification')
    expect(categorizeError('摘要生成失败').category).toBe('summary')
  })

  it('exposes setup-page guidance for each audio failure class', () => {
    expect(AUDIO_ERROR_GUIDANCE.map((item) => item.title)).toEqual([
      '音频文件无法读取',
      '音频转写失败',
      '说话人识别不可用',
      '音频总结生成失败',
      '真实波形不可用',
    ])
  })
})
