import { describe, expect, it } from 'vitest'
import { deriveSteps } from '@/pages/result/ProcessingPage/StepProgress'

// ── 各类型的预期步骤序列 ──
const STEPS_LINK_VIDEO  = ['PENDING', 'DOWNLOAD', 'TRANSCRIBE', 'ANALYZE', 'ANALYZE_NOTE', 'SUCCESS']
const STEPS_LOCAL_VIDEO  = ['PENDING', 'TRANSCRIBE', 'ANALYZE', 'ANALYZE_NOTE', 'SUCCESS']
const STEPS_LINK_AUDIO   = ['PENDING', 'DOWNLOAD', 'TRANSCRIBE', 'ANALYZE_NOTE', 'SUCCESS']
const STEPS_LOCAL_AUDIO  = ['PENDING', 'TRANSCRIBE', 'ANALYZE_NOTE', 'SUCCESS']
const STEPS_LINK_IMAGE   = ['PENDING', 'DOWNLOAD', 'ANALYZE', 'ANALYZE_NOTE', 'SUCCESS']
const STEPS_LOCAL_IMAGE  = ['PENDING', 'ANALYZE', 'ANALYZE_NOTE', 'SUCCESS']
const STEPS_TEXT         = ['PENDING', 'ANALYZE_NOTE', 'SUCCESS']
// 无类型信息时（类型未确定，保守显示最少步骤）
const STEPS_DEFAULT      = STEPS_TEXT

describe('deriveSteps', () => {
  // ── 步骤序列矩阵 ──

  it('链接视频 → 6 步：排队→下载→转录→分析→生成笔记→完成', () => {
    const steps = deriveSteps('PENDING', 0, 'link', 'video')
    expect(steps.map(s => s.id)).toEqual(STEPS_LINK_VIDEO)
  })

  it('本地视频 → 5 步：排队→转录→分析→生成笔记→完成（无下载）', () => {
    const steps = deriveSteps('PENDING', 0, 'local', 'video')
    expect(steps.map(s => s.id)).toEqual(STEPS_LOCAL_VIDEO)
  })

  it('链接音频 → 5 步：排队→下载→转录→生成笔记→完成（无分析）', () => {
    const steps = deriveSteps('PENDING', 0, 'link', 'audio')
    expect(steps.map(s => s.id)).toEqual(STEPS_LINK_AUDIO)
  })

  it('本地音频 → 4 步：排队→转录→生成笔记→完成', () => {
    const steps = deriveSteps('PENDING', 0, 'local', 'audio')
    expect(steps.map(s => s.id)).toEqual(STEPS_LOCAL_AUDIO)
  })

  it('链接图文 → 5 步：排队→下载→分析→生成笔记→完成（无转录）', () => {
    const steps = deriveSteps('PENDING', 0, 'link', 'image_text')
    expect(steps.map(s => s.id)).toEqual(STEPS_LINK_IMAGE)
  })

  it('链接图片 kind_hint=image → 按图文流程显示', () => {
    const steps = deriveSteps('PENDING', 0, 'link', 'image')
    expect(steps.map(s => s.id)).toEqual(STEPS_LINK_IMAGE)
  })

  it('本地图文 → 4 步：排队→分析→生成笔记→完成', () => {
    const steps = deriveSteps('PENDING', 0, 'local', 'image_text')
    expect(steps.map(s => s.id)).toEqual(STEPS_LOCAL_IMAGE)
  })

  it('本地图片 kind_hint=image → 按图文流程显示', () => {
    const steps = deriveSteps('PENDING', 0, 'local', 'image')
    expect(steps.map(s => s.id)).toEqual(STEPS_LOCAL_IMAGE)
  })

  it('文字 → 3 步：排队→生成笔记→完成', () => {
    const steps = deriveSteps('PENDING', 0, 'link', 'text')
    expect(steps.map(s => s.id)).toEqual(STEPS_TEXT)
  })

  it('无类型信息 → 默认链接视频 6 步', () => {
    const steps = deriveSteps('PENDING', 0)
    expect(steps.map(s => s.id)).toEqual(STEPS_DEFAULT)
  })

  // ── 状态映射（链接视频 6 步基准） ──

  it('PENDING, progress=0 → 排队 running，其余 queued', () => {
    const steps = deriveSteps('PENDING', 0, 'link', 'video')
    expect(steps[0]).toMatchObject({ id: 'PENDING', state: 'running', pct: 0 })
    steps.slice(1).forEach(s => {
      expect(s.state).toBe('queued')
      expect(s.pct).toBe(0)
    })
  })

  it('DOWNLOAD, progress=0.05 → 排队 done，下载 running(pct=0.05)', () => {
    const steps = deriveSteps('DOWNLOAD', 0.05, 'link', 'video')
    expect(steps[0]).toMatchObject({ id: 'PENDING', state: 'done', pct: 1 })
    expect(steps[1]).toMatchObject({ id: 'DOWNLOAD', state: 'running', pct: 0.05 })
    steps.slice(2).forEach(s => {
      expect(s.state).toBe('queued')
      expect(s.pct).toBe(0)
    })
  })

  it('ASR(链接视频) → 转录 running', () => {
    const steps = deriveSteps('ASR', 0.25, 'link', 'video')
    expect(steps[0]).toMatchObject({ id: 'PENDING', state: 'done', pct: 1 })
    expect(steps[1]).toMatchObject({ id: 'DOWNLOAD', state: 'done', pct: 1 })
    expect(steps[2]).toMatchObject({ id: 'TRANSCRIBE', state: 'running', pct: 0.25 })
  })

  it('FRAMES(链接视频) → 转录·分析 并行 running（转录不提前标完成）', () => {
    const steps = deriveSteps('FRAMES', 0.4, 'link', 'video')
    expect(steps.map(s => s.id)).toEqual(STEPS_LINK_VIDEO)
    // PENDING + DOWNLOAD done
    expect(steps[0]).toMatchObject({ state: 'done' })
    expect(steps[1]).toMatchObject({ state: 'done' })
    // #19: 转录与分析后端并行，FRAMES 期两轨都 running，转录不被提前标完成
    expect(steps[2]).toMatchObject({ id: 'TRANSCRIBE', state: 'running' })
    expect(steps[3]).toMatchObject({ id: 'ANALYZE', state: 'running', pct: 0.4 })
    // 生成笔记 / 完成 仍排队
    expect(steps[4]).toMatchObject({ state: 'queued' })
    expect(steps[5]).toMatchObject({ state: 'queued' })
  })

  it('VLM(链接图文) → 分析 running（无转录步骤）', () => {
    const steps = deriveSteps('VLM', 0.6, 'link', 'image_text')
    expect(steps.map(s => s.id)).toEqual(STEPS_LINK_IMAGE)
    expect(steps[2]).toMatchObject({ id: 'ANALYZE', state: 'running', pct: 0.6 })
  })

  it('SUM → 生成笔记 running', () => {
    const steps = deriveSteps('SUM', 0.8, 'link', 'video')
    // 前 4 步 done
    expect(steps.slice(0, 4).map(s => s.state)).toEqual(['done', 'done', 'done', 'done'])
    expect(steps[4]).toMatchObject({ id: 'ANALYZE_NOTE', state: 'running', pct: 0.8 })
  })

  it('SUCCESS, progress=1.0 → 全部 done', () => {
    const steps = deriveSteps('SUCCESS', 1.0, 'link', 'video')
    steps.forEach(s => {
      expect(s.state).toBe('done')
      expect(s.pct).toBe(1)
    })
  })

  it('FAILED → 全部 queued', () => {
    const steps = deriveSteps('FAILED', 0.5, 'link', 'video')
    steps.forEach(s => {
      expect(s.state).toBe('queued')
      expect(s.pct).toBe(0)
    })
  })

  it('CANCELLED → 全部 queued', () => {
    const steps = deriveSteps('CANCELLED', 0.5, 'link', 'video')
    steps.forEach(s => {
      expect(s.state).toBe('queued')
      expect(s.pct).toBe(0)
    })
  })

  it('未知状态 → 排队 running', () => {
    const steps = deriveSteps('UNKNOWN', 0.5, 'link', 'video')
    expect(steps[0]).toMatchObject({ id: 'PENDING', state: 'running', pct: 0.5 })
    steps.slice(1).forEach(s => {
      expect(s.state).toBe('queued')
      expect(s.pct).toBe(0)
    })
  })

  it('PROBE → 下载 running', () => {
    const steps = deriveSteps('PROBE', 0.06, 'link', 'video')
    expect(steps[0]).toMatchObject({ id: 'PENDING', state: 'done', pct: 1 })
    expect(steps[1]).toMatchObject({ id: 'DOWNLOAD', state: 'running', pct: 0.06 })
    expect(steps[2]).toMatchObject({ id: 'TRANSCRIBE', state: 'queued', pct: 0 })
  })

  it('ASR(本地视频) → 转录 running（无下载步骤）', () => {
    const steps = deriveSteps('ASR', 0.3, 'local', 'video')
    expect(steps.map(s => s.id)).toEqual(STEPS_LOCAL_VIDEO)
    expect(steps[1]).toMatchObject({ id: 'TRANSCRIBE', state: 'running', pct: 0.3 })
  })

  it('ASR(音频) → 转录 running（无分析步骤）', () => {
    const steps = deriveSteps('ASR', 0.3, 'link', 'audio')
    expect(steps.map(s => s.id)).toEqual(STEPS_LINK_AUDIO)
    expect(steps[2]).toMatchObject({ id: 'TRANSCRIBE', state: 'running', pct: 0.3 })
  })

  // ── AWAITING_CONFIRM ──

  it('AWAITING_CONFIRM → 全部 queued', () => {
    const steps = deriveSteps('AWAITING_CONFIRM', 0, 'link', 'video')
    steps.forEach(s => {
      expect(s.state).toBe('queued')
      expect(s.pct).toBe(0)
    })
  })
})
