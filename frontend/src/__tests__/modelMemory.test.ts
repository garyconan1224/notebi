import { describe, expect, it, beforeEach } from 'vitest'
import { loadModelMemory, saveModelMemory, saveTextModel, saveVisionModel } from '@/lib/modelMemory'

describe('modelMemory', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('空 localStorage 时 load 返回空串', () => {
    const mem = loadModelMemory()
    expect(mem.textProviderId).toBe('')
    expect(mem.textModelId).toBe('')
    expect(mem.visionProviderId).toBe('')
    expect(mem.visionModelId).toBe('')
  })

  it('save 后 load 能完整取回', () => {
    saveModelMemory({
      textProviderId: 'openai',
      textModelId: 'gpt-4o',
      visionProviderId: 'google',
      visionModelId: 'gemini-1.5-pro',
    })

    const mem = loadModelMemory()
    expect(mem.textProviderId).toBe('openai')
    expect(mem.textModelId).toBe('gpt-4o')
    expect(mem.visionProviderId).toBe('google')
    expect(mem.visionModelId).toBe('gemini-1.5-pro')
  })

  it('saveTextModel 只更新 text 字段，vision 不变', () => {
    saveVisionModel('google', 'gemini-1.5-pro')
    saveTextModel('openai', 'gpt-4o')

    const mem = loadModelMemory()
    expect(mem.textProviderId).toBe('openai')
    expect(mem.textModelId).toBe('gpt-4o')
    expect(mem.visionProviderId).toBe('google')
    expect(mem.visionModelId).toBe('gemini-1.5-pro')
  })

  it('saveVisionModel 只更新 vision 字段，text 不变', () => {
    saveTextModel('openai', 'gpt-4o')
    saveVisionModel('google', 'gemini-1.5-pro')

    const mem = loadModelMemory()
    expect(mem.textProviderId).toBe('openai')
    expect(mem.textModelId).toBe('gpt-4o')
    expect(mem.visionProviderId).toBe('google')
    expect(mem.visionModelId).toBe('gemini-1.5-pro')
  })

  it('saveTextModel 空 modelId 时只存 provider', () => {
    saveTextModel('anthropic', '')

    const mem = loadModelMemory()
    expect(mem.textProviderId).toBe('anthropic')
    expect(mem.textModelId).toBe('')
  })
})
